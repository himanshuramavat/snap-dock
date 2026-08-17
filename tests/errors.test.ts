import { describe, expect, it } from 'vitest';
import { AppError, ERROR_MESSAGES, errorMessage, toAppError, type ErrorCode } from '@/utils/errors';

describe('AppError', () => {
  it('carries a user-facing message for its code', () => {
    const error = new AppError('UPLOAD_FAILED');
    expect(error.code).toBe('UPLOAD_FAILED');
    expect(error.userMessage).toBe(ERROR_MESSAGES.UPLOAD_FAILED);
    expect(error).toBeInstanceOf(Error);
  });

  it('allows a more specific message to override the default', () => {
    const error = new AppError('AUTH_FAILED', { userMessage: 'Sign in to Chrome first.' });
    expect(error.userMessage).toBe('Sign in to Chrome first.');
  });

  it('marks transient failures as retryable and permanent ones as not', () => {
    expect(new AppError('NETWORK_ERROR').retryable).toBe(true);
    expect(new AppError('UPLOAD_FAILED').retryable).toBe(true);
    expect(new AppError('RATE_LIMITED').retryable).toBe(true);

    expect(new AppError('PAGE_NOT_CAPTURABLE').retryable).toBe(false);
    expect(new AppError('NOT_CONNECTED').retryable).toBe(false);
    expect(new AppError('CAPTURE_CANCELLED').retryable).toBe(false);
  });

  it('keeps the original cause for the console without exposing it to the UI', () => {
    const cause = new Error('TypeError: cannot read properties of undefined');
    const error = new AppError('CAPTURE_FAILED', { cause, details: cause.message });

    expect(error.cause).toBe(cause);
    expect(error.userMessage).not.toContain('undefined');
    expect(error.details).toContain('undefined');
  });

  it('serialises to a structured-clone-safe object for the messaging boundary', () => {
    const json = new AppError('QUOTA_EXCEEDED', { details: 'internal' }).toJSON();
    expect(json).toEqual({
      code: 'QUOTA_EXCEEDED',
      userMessage: ERROR_MESSAGES.QUOTA_EXCEEDED,
      retryable: false,
      details: 'internal',
    });
    // Survives the round-trip chrome.runtime.sendMessage performs.
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('omits details from the payload when there are none', () => {
    expect(new AppError('NOT_CONNECTED').toJSON()).not.toHaveProperty('details');
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError('AUTH_REVOKED');
    expect(toAppError(original)).toBe(original);
  });

  it('recognises an aborted operation as a timeout rather than an unknown failure', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    expect(toAppError(abort).code).toBe('TIMEOUT');
  });

  it('recognises the bare TypeError fetch throws when the network is unreachable', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('NETWORK_ERROR');
    expect(toAppError(new TypeError('NetworkError when attempting to fetch')).code).toBe(
      'NETWORK_ERROR',
    );
  });

  it('does not misclassify an unrelated TypeError as a network failure', () => {
    expect(toAppError(new TypeError('x is not a function')).code).toBe('UNKNOWN');
  });

  it('uses the supplied fallback code for anything unrecognised', () => {
    expect(toAppError(new Error('boom'), 'PDF_GENERATION_FAILED').code).toBe('PDF_GENERATION_FAILED');
    expect(toAppError('a string', 'CAPTURE_FAILED').code).toBe('CAPTURE_FAILED');
    expect(toAppError(undefined).code).toBe('UNKNOWN');
  });

  it('preserves the original message as details', () => {
    expect(toAppError(new Error('boom')).details).toBe('boom');
  });
});

describe('error copy', () => {
  const codes = Object.keys(ERROR_MESSAGES) as ErrorCode[];

  it('defines a message for every error code', () => {
    for (const code of codes) {
      expect(ERROR_MESSAGES[code].length, `${code} needs a message`).toBeGreaterThan(0);
    }
  });

  it('never leaks technical vocabulary into user-facing copy', () => {
    // These are the words that make an error message feel like a stack trace.
    const jargon =
      /\b(null|undefined|exception|stack trace|HTTP \d{3}|OAuth2|API|JSON|promise|token|status code)\b/i;
    for (const code of codes) {
      expect(ERROR_MESSAGES[code], `${code} reads too technical`).not.toMatch(jargon);
    }
  });

  it('writes messages as complete sentences', () => {
    for (const code of codes) {
      const message = ERROR_MESSAGES[code];
      expect(message[0], `${code} should start with a capital`).toBe(message[0]?.toUpperCase());
      expect(/[.!?]$/.test(message), `${code} should end with punctuation`).toBe(true);
    }
  });

  it('falls back to a generic message for a missing error', () => {
    expect(errorMessage(null)).toBe(ERROR_MESSAGES.UNKNOWN);
    expect(errorMessage(undefined)).toBe(ERROR_MESSAGES.UNKNOWN);
    expect(errorMessage(new AppError('TIMEOUT'))).toBe(ERROR_MESSAGES.TIMEOUT);
  });
});
