import { describe, expect, it } from 'vitest';
import { AppError } from '@/utils/errors';
import {
  MULTIPART_THRESHOLD,
  UPLOAD_CHUNK_SIZE,
  escapeQueryValue,
  mapDriveError,
  validateAbout,
  validateDriveFile,
  validateFileList,
} from '@/storage/google-drive/driveApi';

/**
 * Everything about talking to Drive that can be checked without a network:
 * how responses are validated, how errors are classified, and how the pieces of an
 * upload request are assembled.
 */

describe('mapDriveError', () => {
  const withReason = (reason: string) => ({ error: { errors: [{ reason }] } });

  it('treats 401 as an expired session, which triggers a token refresh', () => {
    expect(mapDriveError(401, {}, 'ctx').code).toBe('AUTH_EXPIRED');
  });

  it('distinguishes the several meanings of 403', () => {
    expect(mapDriveError(403, withReason('storageQuotaExceeded'), 'ctx').code).toBe('QUOTA_EXCEEDED');
    expect(mapDriveError(403, withReason('rateLimitExceeded'), 'ctx').code).toBe('RATE_LIMITED');
    expect(mapDriveError(403, withReason('userRateLimitExceeded'), 'ctx').code).toBe('RATE_LIMITED');
    expect(mapDriveError(403, withReason('insufficientFilePermissions'), 'ctx').code).toBe(
      'PERMISSION_DENIED',
    );
    expect(mapDriveError(403, withReason('appNotAuthorizedToFile'), 'ctx').code).toBe(
      'INSUFFICIENT_SCOPE',
    );
    // An unrecognised 403 still lands somewhere sensible.
    expect(mapDriveError(403, withReason('mystery'), 'ctx').code).toBe('PERMISSION_DENIED');
  });

  it('maps 404 to a missing folder, the only 404 SnapDock can cause', () => {
    expect(mapDriveError(404, {}, 'ctx').code).toBe('FOLDER_UNAVAILABLE');
  });

  it('maps 429 and 5xx to retryable failures', () => {
    expect(mapDriveError(429, {}, 'ctx').retryable).toBe(true);
    expect(mapDriveError(500, {}, 'ctx').retryable).toBe(true);
    expect(mapDriveError(503, {}, 'ctx').retryable).toBe(true);
  });

  it('reads the newer top-level status field as well as the legacy errors array', () => {
    expect(mapDriveError(403, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'ctx').code).toBe(
      'RATE_LIMITED',
    );
    expect(mapDriveError(403, { error: { status: 'PERMISSION_DENIED' } }, 'ctx').code).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('survives a malformed or empty error body', () => {
    expect(mapDriveError(500, null, 'ctx')).toBeInstanceOf(AppError);
    expect(mapDriveError(500, 'plain text', 'ctx')).toBeInstanceOf(AppError);
  });

  it('keeps the technical detail out of the user-facing message', () => {
    const error = mapDriveError(403, withReason('storageQuotaExceeded'), 'upload');
    expect(error.userMessage).not.toContain('403');
    expect(error.userMessage).not.toContain('storageQuotaExceeded');
    expect(error.details).toContain('403');
  });
});

describe('response validation', () => {
  it('accepts a well-formed file', () => {
    const file = validateDriveFile(
      {
        id: 'abc',
        name: 'shot.png',
        mimeType: 'image/png',
        parents: ['root'],
        webViewLink: 'https://drive.google.com/file/d/abc/view',
        size: '2048',
      },
      'ctx',
    );
    expect(file.id).toBe('abc');
    expect(file.size).toBe('2048');
    expect(file.parents).toEqual(['root']);
  });

  it('rejects a response with no id, rather than storing undefined', () => {
    expect(() => validateDriveFile({ name: 'x' }, 'ctx')).toThrow(AppError);
    expect(() => validateDriveFile({ id: '' }, 'ctx')).toThrow(AppError);
    expect(() => validateDriveFile(null, 'ctx')).toThrow(AppError);
    expect(() => validateDriveFile('a string', 'ctx')).toThrow(AppError);
  });

  it('fills in safe defaults for optional fields', () => {
    const file = validateDriveFile({ id: 'abc' }, 'ctx');
    expect(file.name).toBe('Untitled');
    expect(file.mimeType).toBe('application/octet-stream');
    expect(file.webViewLink).toBeUndefined();
  });

  it('ignores non-string entries in the parents array', () => {
    const file = validateDriveFile({ id: 'a', parents: ['root', 42, null] }, 'ctx');
    expect(file.parents).toEqual(['root']);
  });

  it('requires a files array on a list response', () => {
    expect(validateFileList({ files: [] }, 'ctx')).toEqual([]);
    expect(() => validateFileList({}, 'ctx')).toThrow(AppError);
    expect(() => validateFileList({ files: 'nope' }, 'ctx')).toThrow(AppError);
  });

  it('reads the account email from about.get, and tolerates its absence', () => {
    expect(validateAbout({ user: { emailAddress: 'a@b.com', displayName: 'A' } })).toEqual({
      emailAddress: 'a@b.com',
      displayName: 'A',
    });
    expect(validateAbout({})).toEqual({});
    expect(validateAbout(null)).toEqual({});
    expect(validateAbout({ user: { emailAddress: 42 } })).toEqual({});
  });
});

describe('escapeQueryValue', () => {
  it('escapes quotes and backslashes so a folder name cannot break the query', () => {
    expect(escapeQueryValue("Bob's folder")).toBe("Bob\\'s folder");
    expect(escapeQueryValue('back\\slash')).toBe('back\\\\slash');
  });

  it('escapes the backslash before the quote, so the escape itself is not escapable', () => {
    // A naive implementation turns \' into \\' and breaks out of the string literal.
    expect(escapeQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it('leaves ordinary names untouched', () => {
    expect(escapeQueryValue('Screenshots 2026')).toBe('Screenshots 2026');
  });
});

describe('upload strategy', () => {
  it('uses a resumable chunk size that Drive accepts', () => {
    // Drive requires every chunk but the last to be a multiple of 256 KiB.
    expect(UPLOAD_CHUNK_SIZE % (256 * 1024)).toBe(0);
    expect(UPLOAD_CHUNK_SIZE).toBeGreaterThan(0);
  });

  it('switches to a resumable session above the multipart threshold', () => {
    expect(MULTIPART_THRESHOLD).toBeGreaterThan(UPLOAD_CHUNK_SIZE);
    // A typical viewport PNG stays on the single-request path.
    expect(1.5 * 1024 * 1024).toBeLessThan(MULTIPART_THRESHOLD);
    // A long full-page capture goes resumable, so progress is reportable.
    expect(30 * 1024 * 1024).toBeGreaterThan(MULTIPART_THRESHOLD);
  });

  it('splits a payload into chunks that cover it exactly', () => {
    const total = 10 * 1024 * 1024 + 7;
    const ranges: [number, number][] = [];
    for (let offset = 0; offset < total; offset += UPLOAD_CHUNK_SIZE) {
      ranges.push([offset, Math.min(offset + UPLOAD_CHUNK_SIZE, total) - 1]);
    }

    expect(ranges[0]![0]).toBe(0);
    expect(ranges[ranges.length - 1]![1]).toBe(total - 1);
    // Contiguous, no gaps or overlaps.
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1);
    }
  });
});
