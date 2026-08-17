import { AppError } from '@/utils/errors';

/**
 * OAuth 2.0 Authorization Code flow with PKCE, for browsers without
 * `identity.getAuthToken` (Firefox).
 *
 * PKCE exists precisely so a public client can complete the code exchange without a
 * client secret, which is what makes this safe in an extension: there is no secret to
 * embed and therefore none to leak.
 *
 * Two deliberate choices about what is *not* stored:
 *
 *  - **No refresh token.** `access_type=offline` is not requested, so Google never
 *    issues one and there is no long-lived credential sitting in extension storage. The
 *    access token lasts about an hour.
 *  - **Silent renewal instead.** When the token expires, the flow is retried
 *    non-interactively with `prompt=none`. If the user still has a live Google session
 *    the browser completes it invisibly; if not, they are asked to reconnect. That keeps
 *    Firefox's security posture close to Chromium's, where the browser holds the token
 *    and the extension never sees a refresh token either.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface PkceResult {
  accessToken: string;
  grantedScopes: string[];
  /** Epoch milliseconds. */
  expiresAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url encoded: 43 characters, within the 43-128 spec range. */
function createVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Runs the flow and returns an access token.
 *
 * `interactive: false` is used for silent status checks and renewals. It must never
 * show UI, so it also sends `prompt=none`; Google then either redirects immediately or
 * returns `interaction_required`, which is reported as "not connected" rather than as a
 * failure.
 */
export async function runPkceFlow(options: {
  clientId: string;
  scopes: string[];
  interactive: boolean;
}): Promise<PkceResult> {
  if (!options.clientId) {
    throw new AppError(options.interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', {
      details: 'No OAuth client id configured for this browser',
      userMessage:
        'SnapDock has not been set up for Google sign-in yet. Add your OAuth client ID to .env and rebuild. See docs/GOOGLE_OAUTH_SETUP.md.',
    });
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  // Binds the redirect back to this request, so a response from anywhere else is ignored.
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', options.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', options.scopes.join(' '));
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  if (!options.interactive) authUrl.searchParams.set('prompt', 'none');

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: options.interactive,
    });
  } catch (cause) {
    throw classifyFlowError(cause, options.interactive);
  }

  if (!redirect) {
    throw new AppError(options.interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', {
      details: 'Authorization flow returned no redirect',
    });
  }

  const returned = new URL(redirect);
  // Google may answer on either the query string or the fragment.
  const params = new URLSearchParams(returned.search || returned.hash.replace(/^#/, ''));

  const error = params.get('error');
  if (error) {
    throw classifyAuthorizationError(error, options.interactive);
  }

  if (params.get('state') !== state) {
    throw new AppError('AUTH_FAILED', { details: 'Authorization state did not match' });
  }

  const code = params.get('code');
  if (!code) {
    throw new AppError('AUTH_FAILED', { details: 'Authorization response contained no code' });
  }

  return exchangeCode({ code, verifier, redirectUri, clientId: options.clientId });
}

async function exchangeCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<PkceResult> {
  // No client_secret: PKCE replaces it, which is the entire reason this is usable here.
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new AppError('NETWORK_ERROR', { cause });
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    const detail =
      typeof payload === 'object' && payload !== null
        ? String((payload as { error?: unknown }).error ?? response.status)
        : String(response.status);
    throw new AppError('AUTH_FAILED', { details: `Token exchange failed: ${detail}` });
  }

  const token = payload as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new AppError('AUTH_FAILED', { details: 'Token response contained no access token' });
  }

  const lifetime = typeof token.expires_in === 'number' ? token.expires_in : 3600;

  return {
    accessToken: token.access_token,
    grantedScopes: typeof token.scope === 'string' ? token.scope.split(' ').filter(Boolean) : [],
    // Expire a minute early so a request is never sent with a token about to lapse.
    expiresAt: Date.now() + Math.max(0, lifetime - 60) * 1000,
  };
}

function classifyFlowError(cause: unknown, interactive: boolean): AppError {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/user (cancel|denied)|canceled|cancelled|closed/i.test(message)) {
    return new AppError('AUTH_CANCELLED', { cause, details: message });
  }
  // Non-interactive attempts fail routinely when there is no live session; that is a
  // "not connected" answer, not an error worth showing.
  if (!interactive) {
    return new AppError('NOT_CONNECTED', { cause, details: message });
  }
  return new AppError('AUTH_FAILED', { cause, details: message });
}

function classifyAuthorizationError(error: string, interactive: boolean): AppError {
  if (/access_denied/i.test(error)) {
    return new AppError('AUTH_CANCELLED', { details: error });
  }
  if (/interaction_required|login_required|consent_required/i.test(error)) {
    return new AppError(interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', { details: error });
  }
  if (/invalid_client|unauthorized_client|redirect_uri_mismatch/i.test(error)) {
    return new AppError('AUTH_FAILED', {
      details: error,
      userMessage:
        'SnapDock’s Google sign-in is not configured correctly for this browser. Check the OAuth client ID and its redirect URL. See docs/GOOGLE_OAUTH_SETUP.md.',
    });
  }
  return new AppError('AUTH_FAILED', { details: error });
}

export const __testing = { base64Url, createVerifier, challengeFor };
