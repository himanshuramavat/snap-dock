import type { ConnectionStatus, ProviderId, RemoteFolder, UploadedFile } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import { base64FromBytes } from '@/image/canvas';
import { sanitizeBasename } from '@/filename/sanitize';
import type {
  ConnectOptions,
  ProviderCapabilities,
  StorageProvider,
  UploadRequest,
} from '../StorageProvider';

/**
 * Saves captures to the user's own device via chrome.downloads.
 *
 * This is SnapDock's default destination, and the reason the extension is useful the
 * moment it is installed: no account, no OAuth, no Google Cloud project, nothing to
 * configure. Google Drive is the opt-in upgrade, not the entry fee.
 *
 * Two platform constraints shape everything here:
 *
 *  1. `URL.createObjectURL` does not exist in a service worker, so the blob cannot be
 *     handed to the downloads API as a blob URL. It is base64-encoded into a data URL
 *     instead. That costs ~37% extra memory transiently, which measures at roughly
 *     5 ms per megabyte, so it is not worth adding an offscreen document to avoid.
 *
 *  2. Chrome can only write inside the user's download directory, and only via a
 *     *relative* path: absolute paths, empty paths and paths containing '..' are
 *     rejected by the API. There is therefore no folder tree to browse, and the
 *     destination is a sub-folder name that Chrome creates on first write. The provider
 *     reports `canBrowseExisting: false` so the UI offers a text field rather than a
 *     picker, instead of faking a hierarchy that does not exist.
 *
 *     Saving somewhere else entirely is still possible, but only the user can choose
 *     it: `saveAs` opens the platform's own file dialog. That is exposed as the
 *     "Ask where to save each time" setting.
 *
 * Cross-platform notes, since one build has to be correct on Windows, macOS and Linux:
 *
 *  - Forward slashes are used for the relative path on every platform. Chromium parses
 *    it into a native path, so no separator translation belongs here.
 *  - Every path segment goes through the filename sanitiser, which already handles the
 *    union of the three platforms' rules: characters Windows forbids, reserved device
 *    names, and trailing dots or spaces that Windows silently strips.
 *  - The combined relative path is length-capped, because Windows still enforces a
 *    260-character limit on the full path for many APIs and the download directory
 *    itself consumes part of that budget.
 */

/** Chrome's own ceiling for a download URL is generous but not unlimited. */
const MAX_DATA_URL_BYTES = 200 * 1024 * 1024;

const DOWNLOADS_LABEL = 'Downloads';

/**
 * Budget for the sub-folder plus filename, in characters.
 *
 * Windows caps a full path at 260 characters for many APIs, and the user's download
 * directory (`C:\\Users\\SomeLongName\\Downloads\\`) already eats into that. 150 leaves
 * comfortable room on a deeply nested profile while never truncating a realistic name.
 */
export const MAX_RELATIVE_PATH = 150;

export class LocalProvider implements StorageProvider {
  readonly id: ProviderId = 'local';
  readonly displayName = 'This device';

  readonly capabilities: ProviderCapabilities = {
    // Chrome exposes no way to enumerate the filesystem, by design.
    canBrowseExisting: false,
    // Sub-folders are created implicitly by the download itself.
    canCreateFolders: false,
    // A download either completes or fails; there is no byte-level progress to read.
    reportsUploadProgress: false,
  };

  /** Set by the job runner so the save dialog preference can be honoured. */
  askEveryTime = false;

  /**
   * Absolute path of the user's download *root*, learned from the last completed save.
   *
   * The root rather than the final folder, so the displayed path stays correct when the
   * user later changes the sub-folder setting. There is no API to read the configured
   * download directory up front, so this stays undefined until the first save.
   */
  downloadRoot: string | undefined;

  /* ----------------------------------------------------------- connection */

  /** Nothing to connect to. Local saving is always available. */
  async connect(_options: ConnectOptions = {}): Promise<ConnectionStatus> {
    return this.getStatus();
  }

  /** Nothing to disconnect from; kept so the contract holds for every provider. */
  async disconnect(): Promise<void> {
    // Intentionally empty.
  }

  async isConnected(): Promise<boolean> {
    return true;
  }

  async getStatus(): Promise<ConnectionStatus> {
    return { providerId: this.id, connected: true, account: `${DOWNLOADS_LABEL} folder` };
  }

  /* -------------------------------------------------------------- folders */

  /**
   * Always empty: Chrome will not tell an extension what is inside Downloads, and
   * inventing entries would be worse than admitting there is nothing to show.
   */
  async getFolders(_parentId: string | null): Promise<RemoteFolder[]> {
    return [];
  }

  /**
   * Returns a folder reference without touching the disk. The directory is created
   * by Chrome when the first file is written into it.
   */
  async createFolder(name: string, _parentId: string | null): Promise<RemoteFolder> {
    return this.folderFor(sanitizeSubfolder(name));
  }

  async resolveFolder(folderId: string): Promise<RemoteFolder> {
    return this.folderFor(sanitizeSubfolder(folderId));
  }

  private folderFor(subfolder: string): RemoteFolder {
    return {
      id: subfolder,
      name: subfolder || DOWNLOADS_LABEL,
      path: subfolder ? `${DOWNLOADS_LABEL}/${subfolder}` : DOWNLOADS_LABEL,
      parentId: subfolder ? '' : null,
    };
  }

  /* ----------------------------------------------------------------- save */

  async uploadFile(request: UploadRequest): Promise<UploadedFile> {
    if (request.blob.size > MAX_DATA_URL_BYTES) {
      throw new AppError('PAGE_TOO_LARGE', {
        details: `${request.blob.size} bytes exceeds the local save limit`,
        userMessage:
          'That capture is too large to save in one file. Try a lower scale or the JPEG format.',
      });
    }

    // Chrome requires a relative path and rejects absolute paths, empty paths and
    // anything containing '..'. Forward slashes are correct on every platform.
    const filename = buildRelativePath(request.folderId ?? '', request.filename);

    request.onProgress?.(0, request.blob.size);

    const dataUrl = await this.toDataUrl(request.blob, request.mimeType);

    let downloadId: number;
    try {
      downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: this.askEveryTime,
        // Never silently clobber an existing capture.
        conflictAction: 'uniquify',
      });
    } catch (cause) {
      throw this.classify(cause);
    }

    const completed = await this.waitForCompletion(downloadId, request.signal);
    request.onProgress?.(request.blob.size, request.blob.size);

    // DownloadItem.filename is the absolute local path, and it is the only way to
    // learn where the user's download directory actually is on this machine.
    if (completed.filename) {
      this.downloadRoot = deriveDownloadRoot(completed.filename, filename);
    }

    return {
      id: String(downloadId),
      name: request.filename,
      // A local file has no web address; the UI reveals it in the file manager instead.
      webUrl: '',
      size: completed.fileSize > 0 ? completed.fileSize : request.blob.size,
      mimeType: request.mimeType,
      downloadId,
      ...(completed.filename ? { localPath: completed.filename } : {}),
    };
  }

  private async toDataUrl(blob: Blob, mimeType: string): Promise<string> {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return `data:${mimeType};base64,${base64FromBytes(bytes)}`;
    } catch (cause) {
      throw toAppError(cause, 'SAVE_FAILED');
    }
  }

  /**
   * Waits for Chrome to finish writing the file.
   *
   * Reporting success the moment `download()` resolves would be a lie: it resolves as
   * soon as the download is *queued*. Waiting for the terminal state means a full
   * disk or a cancelled save dialog surfaces as a real error instead of a success
   * message with no file behind it.
   */
  private waitForCompletion(
    downloadId: number,
    signal?: AbortSignal,
  ): Promise<{ fileSize: number; filename: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        fn();
      };

      const inspect = async (): Promise<void> => {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (!item) return;

        if (item.state === 'complete') {
          finish(() => resolve({ fileSize: item.fileSize ?? 0, filename: item.filename ?? '' }));
        } else if (item.state === 'interrupted') {
          const reason = item.error ?? 'unknown';
          finish(() => reject(this.classifyInterruption(reason)));
        }
      };

      const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
          void inspect();
        }
      };

      const onAbort = (): void => {
        void chrome.downloads.cancel(downloadId).catch(() => undefined);
        finish(() => reject(new AppError('CAPTURE_CANCELLED')));
      };

      // A save dialog can sit open indefinitely, so this is generous rather than tight.
      const timer = setTimeout(() => finish(() => reject(new AppError('TIMEOUT'))), 10 * 60 * 1000);

      chrome.downloads.onChanged.addListener(onChanged);
      signal?.addEventListener('abort', onAbort, { once: true });

      // The download may already have finished before the listener was attached.
      void inspect();
    });
  }

  /** Chrome's interruption reasons, translated into something a person can act on. */
  private classifyInterruption(reason: string): AppError {
    if (/USER_CANCELED|USER_SHUTDOWN/i.test(reason)) {
      return new AppError('SAVE_CANCELLED', { details: reason });
    }
    if (/FILE_NO_SPACE/i.test(reason)) {
      return new AppError('DISK_FULL', { details: reason });
    }
    if (/FILE_ACCESS_DENIED|FILE_NAME_TOO_LONG|FILE_TOO_LARGE|FILE_FAILED/i.test(reason)) {
      return new AppError('SAVE_FAILED', { details: reason });
    }
    return new AppError('SAVE_FAILED', { details: reason });
  }

  private classify(cause: unknown): AppError {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/invalid filename|filename/i.test(message)) {
      return new AppError('SAVE_FAILED', {
        cause,
        details: message,
        userMessage:
          "That file name can't be used on this device. Try a simpler name template in Settings.",
      });
    }
    return new AppError('SAVE_FAILED', { cause, details: message });
  }

  /** Local files have no URL. Callers should use `downloadId` with revealFile(). */
  getFileUrl(_fileId: string): string {
    return '';
  }

  /** Opens the OS file manager with the saved file selected. */
  static revealFile(downloadId: number): void {
    try {
      chrome.downloads.show(downloadId);
    } catch {
      // Showing a file is a convenience; never let it surface as a failure.
    }
  }
}

/**
 * Works out the download root by removing the relative path we asked for from the
 * absolute path Chrome reported.
 *
 * Handles both separator styles, because the relative path we submit always uses
 * forward slashes while the absolute path Chrome returns uses the platform's own.
 *
 * Falls back to the containing directory when the two do not line up, which happens
 * legitimately: `conflictAction: 'uniquify'` may rename the file, and `saveAs` lets
 * the user save somewhere entirely different.
 */
export function deriveDownloadRoot(absolutePath: string, relativePath: string): string {
  const separator = absolutePath.includes('\\') ? '\\' : '/';
  const relativeSegments = relativePath.split('/').filter(Boolean);
  const absoluteSegments = absolutePath.split(/[\\/]/).filter(Boolean);

  // Drop as many trailing segments as the relative path contributed, but only where
  // they genuinely match, so a renamed or relocated file does not corrupt the root.
  let keep = absoluteSegments.length;
  for (let i = relativeSegments.length - 1; i >= 0; i -= 1) {
    if (absoluteSegments[keep - 1] !== relativeSegments[i]) break;
    keep -= 1;
  }
  if (keep === absoluteSegments.length) keep = absoluteSegments.length - 1;

  const root = absoluteSegments.slice(0, keep).join(separator);
  // A POSIX path loses its leading slash when split, so put it back.
  return separator === '/' && absolutePath.startsWith('/') ? `/${root}` : root;
}

/**
 * Joins a sub-folder and a filename into the relative path chrome.downloads expects,
 * keeping the result within the cross-platform length budget.
 *
 * When the budget is tight the *filename* is shortened rather than the folder, because
 * the folder is a deliberate choice the user made and the filename is generated. The
 * extension is always preserved: a truncated name is a nuisance, but a file with no
 * extension is one the operating system no longer knows how to open.
 */
export function buildRelativePath(subfolder: string, filename: string): string {
  const clean = sanitizeSubfolder(subfolder);
  const prefix = clean ? `${clean}/` : '';
  // Always leave a usable amount of room for the name, even after a long folder.
  const budget = Math.max(24, MAX_RELATIVE_PATH - prefix.length);
  return prefix + truncateKeepingExtension(filename, budget);
}

function truncateKeepingExtension(filename: string, max: number): string {
  if (filename.length <= max) return filename;

  const dot = filename.lastIndexOf('.');
  const hasExtension = dot > 0 && filename.length - dot <= 6;
  const extension = hasExtension ? filename.slice(dot) : '';
  const stem = hasExtension ? filename.slice(0, dot) : filename;

  return stem.slice(0, Math.max(1, max - extension.length)) + extension;
}

/**
 * Cleans a sub-folder path so it is safe to hand to chrome.downloads.
 *
 * Chrome rejects absolute paths and any path containing '..', which is also the
 * obvious escape attempt, so each segment is sanitised individually and traversal
 * segments are dropped entirely rather than rewritten.
 */
export function sanitizeSubfolder(input: string): string {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeBasename(segment))
    // Two levels is plenty of organisation and keeps paths well short of any limit.
    .slice(0, 2)
    .join('/');
}
