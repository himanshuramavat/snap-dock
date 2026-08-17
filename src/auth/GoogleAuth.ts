import { AppError, toAppError } from '@/utils/errors';
import { hasManagedIdentity } from '@/utils/browser';
import { STORAGE_KEYS, sessionArea } from '@/utils/storageArea';
import { runPkceFlow } from './pkce';
import { hasFullAccess, scopesFor, type AccessLevel } from './scopes';

/**
 * Google OAuth, with one strategy per engine.
 *
 * | Engine   | Mechanism                          | Where the token lives          |
 * | -------- | ---------------------------------- | ------------------------------ |
 * | Chromium | `identity.getAuthToken`            | The browser's own token cache  |
 * | Firefox  | `identity.launchWebAuthFlow` + PKCE| `storage.session`, memory only |
 *
 * Chromium's route is preferred wherever it exists because the browser holds the token
 * and never hands the extension a refresh token, so there is no long-lived credential to
 * store or leak. Firefox has no equivalent, so the PKCE flow is used and deliberately
 * declines offline access: no refresh token is requested, the access token is kept in
 * session storage (memory, cleared on browser restart, never written to disk), and
 * renewal is a silent re-run of the flow.
 *
 * Either way, nothing here writes a token to `storage.local`, and no token is ever
 * passed to a content script or into a page.
 */

export interface AuthToken {
  token: string;
  grantedScopes: string[];
}

interface CachedToken extends AuthToken {
  expiresAt: number;
  level: AccessLevel;
}

/** Chromium returns either a bare string or a result object depending on version. */
function normalizeTokenResult(result: unknown): AuthToken | null {
  if (typeof result === 'string' && result) return { token: result, grantedScopes: [] };
  if (result && typeof result === 'object') {
    const candidate = result as { token?: string; grantedScopes?: string[] };
    if (candidate.token) {
      return { token: candidate.token, grantedScopes: candidate.grantedScopes ?? [] };
    }
  }
  return null;
}

function classifyAuthError(message: string, interactive: boolean): AppError {
  if (/canceled|cancelled|closed by the user|user did not approve/i.test(message)) {
    return new AppError('AUTH_CANCELLED', { details: message });
  }
  if (/not signed in|no.*account|user is not signed in/i.test(message)) {
    return new AppError('AUTH_FAILED', {
      details: message,
      userMessage: 'Sign in to your browser with the Google account you want to use, then connect again.',
    });
  }
  if (/revoked|invalid_grant/i.test(message)) {
    return new AppError('AUTH_REVOKED', { details: message });
  }
  if (/OAuth2 not granted or revoked|user interaction required/i.test(message)) {
    // A non-interactive probe found no usable token. That is a normal "signed out"
    // result, not a failure worth showing an error for.
    return new AppError(interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', { details: message });
  }
  if (/bad client id|invalid client|OAuth2 request failed/i.test(message)) {
    return new AppError('AUTH_FAILED', {
      details: message,
      userMessage:
        'SnapDock is not configured for Google sign-in yet. Check the OAuth client ID in the build configuration.',
    });
  }
  return new AppError('AUTH_FAILED', { details: message });
}

/**
 * True when this build has an OAuth client id available for the current engine.
 *
 * Checked before every sign-in attempt so an unconfigured build produces a precise setup
 * message instead of an opaque platform error, which is by far the most common thing to
 * go wrong on a first local build.
 */
export function isOAuthConfigured(): boolean {
  return Boolean(oauthClientId());
}

/**
 * The client id to use, chosen by the same capability check that selects the flow.
 *
 * Keyed on `hasManagedIdentity()` rather than on the engine so this and `getToken` can
 * never disagree: whichever flow runs, it gets the id registered for it.
 *
 * Chromium reads the id from the manifest, where `getAuthToken` needs it anyway. Firefox
 * has no `oauth2` manifest key, so its id is compiled in, and it must belong to a
 * separate OAuth client of type "Web application" with the redirect URL registered.
 */
export function oauthClientId(): string {
  if (hasManagedIdentity()) {
    const manifest = chrome.runtime.getManifest() as { oauth2?: { client_id?: string } };
    return manifest.oauth2?.client_id ?? '';
  }
  return __SNAPDOCK_FIREFOX_CLIENT_ID__;
}

export class GoogleAuth {
  /** Firefox only: the in-memory token cache. Chromium delegates caching to the browser. */
  private async readCached(level: AccessLevel): Promise<AuthToken | null> {
    const stored = await sessionArea().get(STORAGE_KEYS.authToken);
    const cached = stored[STORAGE_KEYS.authToken] as CachedToken | undefined;

    if (!cached || cached.level !== level) return null;
    if (cached.expiresAt <= Date.now()) return null;

    return { token: cached.token, grantedScopes: cached.grantedScopes };
  }

  private async writeCached(level: AccessLevel, result: CachedToken): Promise<void> {
    await sessionArea()
      .set({ [STORAGE_KEYS.authToken]: { ...result, level } })
      .catch(() => undefined);
  }

  private async clearCached(): Promise<void> {
    await sessionArea().remove(STORAGE_KEYS.authToken).catch(() => undefined);
  }

  /**
   * Acquires an access token.
   *
   * `interactive: false` is used for silent status checks on popup open. It must never
   * pop a consent window just because the user opened the extension.
   */
  async getToken(options: { interactive: boolean; level: AccessLevel }): Promise<AuthToken> {
    const scopes = scopesFor(options.level);

    if (!isOAuthConfigured()) {
      throw new AppError(options.interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', {
        details: 'No OAuth client id was set at build time',
        userMessage:
          'SnapDock has not been set up for Google sign-in yet. Add your OAuth client ID to .env and rebuild. See docs/GOOGLE_OAUTH_SETUP.md.',
      });
    }

    return hasManagedIdentity()
      ? this.getManagedToken(options.interactive, scopes)
      : this.getPkceToken(options.interactive, options.level, scopes);
  }

  /** Chromium: the browser owns the token. */
  private async getManagedToken(interactive: boolean, scopes: string[]): Promise<AuthToken> {
    try {
      const result = await chrome.identity.getAuthToken({ interactive, scopes });
      const token = normalizeTokenResult(result);
      if (!token) {
        throw new AppError(interactive ? 'AUTH_FAILED' : 'NOT_CONNECTED', {
          details: 'No token returned',
        });
      }
      // Older versions omit grantedScopes; assume what we asked for and let a later
      // 403 from Drive correct us.
      if (token.grantedScopes.length === 0) token.grantedScopes = scopes;
      return token;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message =
        error instanceof Error ? error.message : (chrome.runtime.lastError?.message ?? String(error));
      throw classifyAuthError(message, interactive);
    }
  }

  /** Firefox: SnapDock owns a short-lived token, cached in memory only. */
  private async getPkceToken(
    interactive: boolean,
    level: AccessLevel,
    scopes: string[],
  ): Promise<AuthToken> {
    const cached = await this.readCached(level);
    if (cached) return cached;

    const result = await runPkceFlow({ clientId: oauthClientId(), scopes, interactive });

    const token: AuthToken = {
      token: result.accessToken,
      // Google echoes the granted scopes; fall back to what was asked for if it does not.
      grantedScopes: result.grantedScopes.length > 0 ? result.grantedScopes : scopes,
    };

    await this.writeCached(level, { ...token, expiresAt: result.expiresAt, level });
    return token;
  }

  /** Silent probe. Returns null instead of throwing when simply not connected. */
  async peekToken(level: AccessLevel): Promise<AuthToken | null> {
    try {
      return await this.getToken({ interactive: false, level });
    } catch {
      return null;
    }
  }

  /**
   * Drops a token the browser believes is valid but Google has rejected.
   * The caller is expected to immediately re-request, forcing a fresh token.
   */
  async invalidate(token: string): Promise<void> {
    if (hasManagedIdentity()) {
      try {
        await chrome.identity.removeCachedAuthToken({ token });
      } catch {
        // A token that cannot be removed is already gone; nothing to recover from.
      }
      return;
    }
    await this.clearCached();
  }

  /**
   * Full disconnect: revoke the grant with Google, then clear any cache.
   *
   * Revoking first matters. Clearing the local cache alone would leave SnapDock listed
   * under the user's third-party app access, which is not what "Disconnect" means to
   * anyone reading it.
   */
  async disconnect(): Promise<void> {
    const existing = await this.peekToken('app-folders');

    if (existing) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(existing.token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch {
        // Offline revocation failure must not block the local disconnect; the user asked
        // to disconnect and the local state is what the UI reflects.
      }
      await this.invalidate(existing.token);
    }

    await this.clearCached();

    if (hasManagedIdentity()) {
      try {
        await chrome.identity.clearAllCachedAuthTokens();
      } catch (error) {
        throw toAppError(error, 'AUTH_FAILED');
      }
    }
  }

  /** Requests the broader scope. Always interactive: it needs a consent screen. */
  async upgradeToFullAccess(): Promise<AuthToken> {
    // The narrow token would otherwise be returned from cache and satisfy the request
    // without ever asking for the wider scope.
    await this.clearCached();
    return this.getToken({ interactive: true, level: 'full-drive' });
  }

  static isFullAccess(token: AuthToken): boolean {
    return hasFullAccess(token.grantedScopes);
  }
}

export const googleAuth = new GoogleAuth();
