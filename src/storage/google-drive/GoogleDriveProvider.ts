import type { ConnectionStatus, ProviderId, RemoteFolder, UploadedFile } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import { googleAuth, GoogleAuth } from '@/auth/GoogleAuth';
import type { AccessLevel } from '@/auth/scopes';
import type {
  ConnectOptions,
  ProviderCapabilities,
  StorageProvider,
  UploadRequest,
} from '../StorageProvider';
import {
  DRIVE_UPLOAD_API,
  DriveClient,
  FOLDER_MIME,
  MULTIPART_THRESHOLD,
  UPLOAD_CHUNK_SIZE,
  escapeQueryValue,
  mapDriveError,
  validateAbout,
  validateDriveFile,
  validateFileList,
  type DriveFile,
} from './driveApi';

/** Drive's alias for "My Drive". Valid as a parent and as a list query target. */
const ROOT_ID = 'root';
const ROOT_LABEL = 'My Drive';

const FILE_FIELDS = 'id,name,mimeType,parents,webViewLink,size,trashed';

export class GoogleDriveProvider implements StorageProvider {
  readonly id: ProviderId = 'google-drive';
  readonly displayName = 'Google Drive';

  readonly capabilities: ProviderCapabilities = {
    // True only after the user grants full access; see `getStatus`.
    canBrowseExisting: false,
    canCreateFolders: true,
    reportsUploadProgress: true,
  };

  private readonly client = new DriveClient('app-folders');

  /* ----------------------------------------------------------- connection */

  async connect(options: ConnectOptions = {}): Promise<ConnectionStatus> {
    const level: AccessLevel = options.requestFullAccess ? 'full-drive' : 'app-folders';
    this.client.setAccessLevel(level);

    const token = await googleAuth.getToken({
      interactive: options.interactive ?? true,
      level,
    });

    const fullAccess = GoogleAuth.isFullAccess(token);
    this.capabilities.canBrowseExisting = fullAccess;

    return {
      providerId: this.id,
      connected: true,
      fullAccess,
      ...(await this.accountLabel()),
    };
  }

  async disconnect(): Promise<void> {
    await googleAuth.disconnect();
    this.client.setAccessLevel('app-folders');
    this.capabilities.canBrowseExisting = false;
  }

  async isConnected(): Promise<boolean> {
    return (await googleAuth.peekToken(this.client.getAccessLevel())) !== null;
  }

  /**
   * Determines the connection state without ever prompting.
   *
   * Full access is probed first: if the broader grant already exists, Chrome hands
   * back a token silently and SnapDock can offer full browsing without a second
   * consent screen. Failing that, it falls back to the narrow grant.
   */
  async getStatus(): Promise<ConnectionStatus> {
    const full = await googleAuth.peekToken('full-drive');
    if (full) {
      this.client.setAccessLevel('full-drive');
      this.capabilities.canBrowseExisting = true;
      return {
        providerId: this.id,
        connected: true,
        fullAccess: true,
        ...(await this.accountLabel()),
      };
    }

    const narrow = await googleAuth.peekToken('app-folders');
    if (narrow) {
      this.client.setAccessLevel('app-folders');
      this.capabilities.canBrowseExisting = false;
      return {
        providerId: this.id,
        connected: true,
        fullAccess: false,
        ...(await this.accountLabel()),
      };
    }

    this.capabilities.canBrowseExisting = false;
    return { providerId: this.id, connected: false };
  }

  private async accountLabel(): Promise<{ account?: string }> {
    try {
      const about = await this.client.getJson('/about?fields=user(emailAddress,displayName)', (value) =>
        validateAbout(value),
      );
      return about.emailAddress ? { account: about.emailAddress } : {};
    } catch {
      // The account label is decoration. A failure here must not make a working
      // connection look broken.
      return {};
    }
  }

  /* -------------------------------------------------------------- folders */

  /**
   * Lists child folders.
   *
   * Under the default `drive.file` scope Drive only returns folders SnapDock itself
   * created. That is the scope working as intended, not a bug, and the UI explains
   * it. With full access granted, the same query walks the user's whole Drive.
   */
  async getFolders(parentId: string | null): Promise<RemoteFolder[]> {
    const parent = parentId ?? ROOT_ID;
    const query = [
      `mimeType = '${FOLDER_MIME}'`,
      'trashed = false',
      `'${escapeQueryValue(parent)}' in parents`,
    ].join(' and ');

    const params = new URLSearchParams({
      q: query,
      fields: `files(${FILE_FIELDS})`,
      orderBy: 'name',
      pageSize: '200',
      spaces: 'drive',
      supportsAllDrives: 'false',
    });

    const files = await this.client.getJson(`/files?${params.toString()}`, (value) =>
      validateFileList(value, 'list folders'),
    );

    const parentPath = parent === ROOT_ID ? ROOT_LABEL : '';
    return files.map((file) => this.toFolder(file, parent, parentPath));
  }

  async createFolder(name: string, parentId: string | null): Promise<RemoteFolder> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new AppError('UPLOAD_FAILED', {
        details: 'Empty folder name',
        userMessage: 'Give the folder a name.',
      });
    }

    const body: Record<string, unknown> = { name: trimmed, mimeType: FOLDER_MIME };
    // A folder created with no explicit parent lands in My Drive, which is the one
    // top-level write `drive.file` reliably permits.
    if (parentId && parentId !== ROOT_ID) body.parents = [parentId];

    const file = await this.client.postJson(`/files?fields=${FILE_FIELDS}`, body, (value) =>
      validateDriveFile(value, 'create folder'),
    );

    return this.toFolder(file, parentId ?? ROOT_ID, parentId ? '' : ROOT_LABEL);
  }

  async resolveFolder(folderId: string): Promise<RemoteFolder> {
    if (folderId === ROOT_ID) {
      return { id: ROOT_ID, name: ROOT_LABEL, path: ROOT_LABEL, parentId: null };
    }

    try {
      const file = await this.client.getJson(
        `/files/${encodeURIComponent(folderId)}?fields=${FILE_FIELDS}`,
        (value) => validateDriveFile(value, 'resolve folder'),
      );

      if (file.trashed) {
        throw new AppError('FOLDER_UNAVAILABLE', { details: 'Folder is in the trash' });
      }
      if (file.mimeType !== FOLDER_MIME) {
        throw new AppError('FOLDER_UNAVAILABLE', { details: 'Destination is not a folder' });
      }

      return this.toFolder(file, file.parents?.[0] ?? null, '');
    } catch (error) {
      const appError = toAppError(error, 'FOLDER_UNAVAILABLE');
      // A 404 under drive.file also means "SnapDock can no longer reach this",
      // which is the same thing to the user as the folder being gone.
      if (appError.code === 'PERMISSION_DENIED') {
        throw new AppError('FOLDER_UNAVAILABLE', { cause: error, details: appError.details ?? '' });
      }
      throw appError;
    }
  }

  /** Builds a human-readable path without an extra request per ancestor. */
  private toFolder(file: DriveFile, parentId: string | null, parentPath: string): RemoteFolder {
    return {
      id: file.id,
      name: file.name,
      path: parentPath ? `${parentPath} / ${file.name}` : file.name,
      parentId,
    };
  }

  /* --------------------------------------------------------------- upload */

  async uploadFile(request: UploadRequest): Promise<UploadedFile> {
    const metadata: Record<string, unknown> = { name: request.filename };
    if (request.folderId && request.folderId !== ROOT_ID) {
      metadata.parents = [request.folderId];
    }

    const file =
      request.blob.size <= MULTIPART_THRESHOLD
        ? await this.uploadMultipart(request, metadata)
        : await this.uploadResumable(request, metadata);

    return {
      id: file.id,
      name: file.name,
      webUrl: file.webViewLink ?? this.getFileUrl(file.id),
      size: file.size ? Number(file.size) : request.blob.size,
      mimeType: file.mimeType,
    };
  }

  /** Single request: metadata and bytes in one multipart body. */
  private async uploadMultipart(
    request: UploadRequest,
    metadata: Record<string, unknown>,
  ): Promise<DriveFile> {
    const boundary = `snapdock-${crypto.randomUUID()}`;
    const body = new Blob(
      [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: ${request.mimeType}\r\n\r\n`,
        request.blob,
        `\r\n--${boundary}--\r\n`,
      ],
      { type: `multipart/related; boundary=${boundary}` },
    );

    request.onProgress?.(0, request.blob.size);

    const response = await this.client.request('', {
      absoluteUrl: `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      ...(request.signal ? { signal: request.signal } : {}),
    });

    request.onProgress?.(request.blob.size, request.blob.size);
    return validateDriveFile(await response.json(), 'multipart upload');
  }

  /**
   * Resumable session for larger files.
   *
   * Chunking is what makes the progress bar meaningful, because `fetch` exposes no upload
   * progress event, so the only honest source of progress is how many chunks have
   * been acknowledged. It also means a dropped connection loses one chunk rather
   * than a 40 MB full-page capture.
   */
  private async uploadResumable(
    request: UploadRequest,
    metadata: Record<string, unknown>,
  ): Promise<DriveFile> {
    const total = request.blob.size;

    const initiate = await this.client.request('', {
      absoluteUrl: `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${FILE_FIELDS}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': request.mimeType,
        'X-Upload-Content-Length': String(total),
      },
      body: JSON.stringify(metadata),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const sessionUrl = initiate.headers.get('Location');
    if (!sessionUrl) {
      throw new AppError('UPLOAD_FAILED', { details: 'Drive did not return an upload session' });
    }

    let offset = 0;
    request.onProgress?.(0, total);

    while (offset < total) {
      if (request.signal?.aborted) throw new AppError('CAPTURE_CANCELLED');

      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
      const chunk = request.blob.slice(offset, end);

      // The session URL carries its own upload_id and does not need the bearer
      // token, but sending it is harmless and keeps one code path for retries.
      const response = await this.client.request('', {
        absoluteUrl: sessionUrl,
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        },
        body: chunk,
        ...(request.signal ? { signal: request.signal } : {}),
      });

      if (response.status === 308) {
        // Drive reports how much it actually stored; trust it over our own counter.
        const range = response.headers.get('Range');
        const match = range ? /bytes=0-(\d+)/.exec(range) : null;
        offset = match ? Number(match[1]) + 1 : end;
        request.onProgress?.(offset, total);
        continue;
      }

      if (response.ok) {
        request.onProgress?.(total, total);
        return validateDriveFile(await response.json(), 'resumable upload');
      }

      throw mapDriveError(response.status, await response.json().catch(() => null), 'resumable upload');
    }

    throw new AppError('UPLOAD_FAILED', { details: 'Upload finished without a final response' });
  }

  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  }

  /** Deep link to a folder in the Drive web UI, used by the destination card. */
  getFolderUrl(folderId: string): string {
    return folderId === ROOT_ID
      ? 'https://drive.google.com/drive/my-drive'
      : `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
  }

  static rootFolder(): RemoteFolder {
    return { id: ROOT_ID, name: ROOT_LABEL, path: ROOT_LABEL, parentId: null };
  }
}
