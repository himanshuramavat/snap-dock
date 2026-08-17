/**
 * Every failure surfaced to the user goes through AppError.
 *
 * The rule: `code` is for logic, `message` is for humans. Raw exception text and
 * stack traces are kept in `cause` and only ever written to the console, never
 * rendered in the UI.
 */

export type ErrorCode =
  // Capture
  | 'CAPTURE_FAILED'
  | 'PAGE_NOT_CAPTURABLE'
  | 'PAGE_TOO_LARGE'
  | 'CAPTURE_CANCELLED'
  | 'NO_ACTIVE_TAB'
  // Processing
  | 'IMAGE_PROCESSING_FAILED'
  | 'PDF_GENERATION_FAILED'
  // Auth
  | 'AUTH_FAILED'
  | 'AUTH_CANCELLED'
  | 'AUTH_REVOKED'
  | 'AUTH_EXPIRED'
  | 'NOT_CONNECTED'
  | 'INSUFFICIENT_SCOPE'
  // Storage / Drive
  | 'FOLDER_UNAVAILABLE'
  | 'NO_DESTINATION'
  | 'SAVE_FAILED'
  | 'SAVE_CANCELLED'
  | 'DISK_FULL'
  | 'UPLOAD_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  // Transport
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  // Fallback
  | 'UNKNOWN';

/** Whether offering the user a "Try again" button makes sense for this failure. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'CAPTURE_FAILED',
  'IMAGE_PROCESSING_FAILED',
  'PDF_GENERATION_FAILED',
  'UPLOAD_FAILED',
  'SAVE_FAILED',
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'AUTH_EXPIRED',
]);

/** Human-facing copy. No jargon, no error numbers, and a hint at the way forward. */
const MESSAGES: Record<ErrorCode, string> = {
  CAPTURE_FAILED: "The screenshot couldn't be taken. Reload the page and try again.",
  PAGE_NOT_CAPTURABLE:
    'This page cannot be captured. Chrome blocks screenshots of its own pages, the Web Store, and other extensions. Open a regular website and try again.',
  PAGE_TOO_LARGE:
    'This page is too tall to capture in one image. Try capturing the visible area or a selected region instead.',
  CAPTURE_CANCELLED: 'Capture cancelled.',
  NO_ACTIVE_TAB: 'No active tab found. Click on the page you want to capture, then try again.',

  IMAGE_PROCESSING_FAILED:
    "The screenshot couldn't be processed. Try a smaller capture area or a lower scale.",
  PDF_GENERATION_FAILED: "The PDF couldn't be created. Try a different paper size or scale.",

  AUTH_FAILED: "Google sign-in didn't complete. Check your connection and try again.",
  AUTH_CANCELLED: 'Google sign-in was cancelled.',
  AUTH_REVOKED: 'SnapDock’s access to your Google account was removed. Reconnect to continue.',
  AUTH_EXPIRED: 'Your Google session expired. Reconnect to continue.',
  NOT_CONNECTED: 'Connect your Google account to save captures.',
  INSUFFICIENT_SCOPE:
    'SnapDock needs additional Google Drive permission for this action. Grant it in Settings.',

  FOLDER_UNAVAILABLE:
    "The destination folder is no longer available. It may have been renamed, moved, or deleted. Choose another folder.",
  NO_DESTINATION: 'Choose a Google Drive folder before saving.',
  UPLOAD_FAILED: "The upload didn't finish. Your capture is safe. Try again.",
  SAVE_FAILED: "The file couldn't be saved to this device. Check that your Downloads folder is available and try again.",
  SAVE_CANCELLED: 'Save cancelled.',
  DISK_FULL: 'There is not enough free space to save this capture.',
  QUOTA_EXCEEDED: 'Your Google Drive is full. Free up space and try again.',
  PERMISSION_DENIED: "You don't have permission to save to that folder. Choose another folder.",
  RATE_LIMITED: 'Google Drive is busy right now. Waiting a moment and retrying.',

  NETWORK_ERROR: 'No connection to Google Drive. Check your internet and try again.',
  TIMEOUT: 'That took longer than expected and was stopped. Try again.',

  UNKNOWN: 'Something went wrong. Try again.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Message safe to render in the UI. */
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly details?: string;

  constructor(code: ErrorCode, options: { cause?: unknown; details?: string; userMessage?: string } = {}) {
    const userMessage = options.userMessage ?? MESSAGES[code];
    super(`${code}: ${options.details ?? userMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = RETRYABLE.has(code);
    this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** Structured-clone-safe shape for crossing the extension messaging boundary. */
  toJSON(): SerializedError {
    return {
      code: this.code,
      userMessage: this.userMessage,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export interface SerializedError {
  code: ErrorCode;
  userMessage: string;
  retryable: boolean;
  details?: string;
}

/** Narrows anything thrown into an AppError without losing the original cause. */
export function toAppError(error: unknown, fallback: ErrorCode = 'UNKNOWN'): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AppError('TIMEOUT', { cause: error });
  }

  // fetch() rejects with a bare TypeError when the network is unreachable.
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError('NETWORK_ERROR', { cause: error, details: error.message });
  }

  const details = error instanceof Error ? error.message : String(error);
  return new AppError(fallback, { cause: error, details });
}

export function errorMessage(error: SerializedError | AppError | null | undefined): string {
  return error?.userMessage ?? MESSAGES.UNKNOWN;
}

export { MESSAGES as ERROR_MESSAGES };
