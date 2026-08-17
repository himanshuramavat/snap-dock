import { AppError, toAppError } from '@/utils/errors';
import { googleAuth, type AuthToken } from '@/auth/GoogleAuth';
import type { AccessLevel } from '@/auth/scopes';

/**
 * Thin transport layer over the Drive v3 REST API.
 *
 * Everything that is fiddly about talking to Google lives here: attaching the
 * token, retrying once on a stale token, backing off on rate limits, and turning
 * Google's error payloads into SnapDock error codes. The provider above it deals
 * only in folders and files.
 */

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Resumable upload chunks must be a multiple of 256 KiB, except the final one. */
export const UPLOAD_CHUNK_SIZE = 4 * 256 * 1024; // 1 MiB
/** Below this, a single multipart request is faster than a resumable session. */
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

const MAX_RETRIES = 3;

interface GoogleErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    status?: string;
  };
}

/** Maps an HTTP status plus Google's reason string onto a SnapDock error. */
export function mapDriveError(status: number, payload: unknown, context: string): AppError {
  const body = (payload ?? {}) as GoogleErrorPayload;
  const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  const details = `${context}: ${status} ${body.error?.message ?? reason ?? 'no detail'}`;

  if (status === 401) return new AppError('AUTH_EXPIRED', { details });
  if (status === 403) {
    if (/storageQuotaExceeded|quotaExceeded/i.test(reason)) return new AppError('QUOTA_EXCEEDED', { details });
    if (/rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(reason)) {
      return new AppError('RATE_LIMITED', { details });
    }
    if (/insufficientPermissions|insufficientFilePermissions|PERMISSION_DENIED/i.test(reason)) {
      return new AppError('PERMISSION_DENIED', { details });
    }
    if (/appNotAuthorizedToFile/i.test(reason)) return new AppError('INSUFFICIENT_SCOPE', { details });
    return new AppError('PERMISSION_DENIED', { details });
  }
  if (status === 404) return new AppError('FOLDER_UNAVAILABLE', { details });
  if (status === 429) return new AppError('RATE_LIMITED', { details });
  if (status >= 500) return new AppError('UPLOAD_FAILED', { details });
  return new AppError('UPLOAD_FAILED', { details });
}

function isRetryable(error: AppError): boolean {
  return error.code === 'RATE_LIMITED' || error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
}

function backoffMs(attempt: number): number {
  // Exponential with jitter, so a burst of extensions retrying does not synchronise.
  return Math.min(8000, 2 ** attempt * 400) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

export class DriveClient {
  constructor(private level: AccessLevel = 'app-folders') {}

  setAccessLevel(level: AccessLevel): void {
    this.level = level;
  }

  getAccessLevel(): AccessLevel {
    return this.level;
  }

  async token(interactive = false): Promise<AuthToken> {
    return googleAuth.getToken({ interactive, level: this.level });
  }

  /**
   * Performs an authenticated request.
   *
   * A 401 is treated as a stale cached token rather than a hard failure: the token
   * is evicted from Chrome's cache and the request is retried once with a fresh one.
   * If that also fails, the grant really is gone and the user is told to reconnect.
   */
  async request(path: string, init: RequestInit & { absoluteUrl?: string } = {}): Promise<Response> {
    const url = init.absoluteUrl ?? `${DRIVE_API}${path}`;
    let lastError: AppError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const auth = await this.token(false);

      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${auth.token}`,
          },
        });
      } catch (cause) {
        lastError = toAppError(cause, 'NETWORK_ERROR');
        if (attempt === MAX_RETRIES) throw lastError;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok || response.status === 308) return response;

      const payload = await parseJsonSafely(response.clone());
      const error = mapDriveError(response.status, payload, `${init.method ?? 'GET'} ${path}`);

      if (error.code === 'AUTH_EXPIRED' && attempt === 0) {
        await googleAuth.invalidate(auth.token);
        continue;
      }

      if (isRetryable(error) && attempt < MAX_RETRIES) {
        lastError = error;
        await sleep(backoffMs(attempt));
        continue;
      }

      throw error;
    }

    throw lastError ?? new AppError('UPLOAD_FAILED', { details: 'Request exhausted retries' });
  }

  async getJson<T>(path: string, validate: (value: unknown) => T): Promise<T> {
    const response = await this.request(path);
    const payload = await parseJsonSafely(response);
    return validate(payload);
  }

  async postJson<T>(path: string, body: unknown, validate: (value: unknown) => T): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafely(response);
    return validate(payload);
  }
}

/* ------------------------------------------------------- response validation */

/**
 * Drive responses are validated rather than cast.
 *
 * The API is not hostile, but it is remote and versioned independently of this
 * extension: a missing `id` should surface as a clear SnapDock error, not as
 * `undefined` propagating into a stored destination that silently never works.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || !value) {
    throw new AppError('UPLOAD_FAILED', {
      details: `${context}: missing or invalid "${field}" in Drive response`,
    });
  }
  return value;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  size?: string;
  trashed?: boolean;
}

export function validateDriveFile(value: unknown, context: string): DriveFile {
  if (!isRecord(value)) {
    throw new AppError('UPLOAD_FAILED', { details: `${context}: expected an object` });
  }
  const file: DriveFile = {
    id: requireString(value.id, 'id', context),
    name: typeof value.name === 'string' ? value.name : 'Untitled',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'application/octet-stream',
  };
  if (Array.isArray(value.parents)) {
    file.parents = value.parents.filter((p): p is string => typeof p === 'string');
  }
  if (typeof value.webViewLink === 'string') file.webViewLink = value.webViewLink;
  if (typeof value.size === 'string') file.size = value.size;
  if (typeof value.trashed === 'boolean') file.trashed = value.trashed;
  return file;
}

export function validateFileList(value: unknown, context: string): DriveFile[] {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new AppError('UPLOAD_FAILED', { details: `${context}: expected a "files" array` });
  }
  return value.files.map((entry) => validateDriveFile(entry, context));
}

export interface DriveAbout {
  emailAddress?: string;
  displayName?: string;
}

export function validateAbout(value: unknown): DriveAbout {
  if (!isRecord(value) || !isRecord(value.user)) return {};
  const user = value.user;
  const about: DriveAbout = {};
  if (typeof user.emailAddress === 'string') about.emailAddress = user.emailAddress;
  if (typeof user.displayName === 'string') about.displayName = user.displayName;
  return about;
}

/** Escapes a value for use inside a Drive `q` search expression. */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
