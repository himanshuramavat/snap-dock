import type { ConnectionStatus, DestinationRef, ProviderId, RemoteFolder, UploadedFile } from '@/types';

/**
 * The contract every storage destination implements.
 *
 * The capture, image and PDF engines never import a provider. They hand a Blob to
 * whatever satisfies this interface. Adding Dropbox, OneDrive, S3 or a local-disk
 * destination later means writing one class against this file and registering it;
 * no part of the capture pipeline changes.
 *
 * Two design notes that keep that promise honest:
 *  - Folders are addressed by opaque provider-scoped ids, never by path strings, so
 *    providers with no real hierarchy (S3 prefixes) can still implement it.
 *  - Capabilities are declared rather than assumed, so the UI adapts instead of the
 *    provider having to fake behaviour it does not support.
 */

export interface ProviderCapabilities {
  /** The provider can enumerate folders the user already had. */
  canBrowseExisting: boolean;
  /** The provider can create new folders. */
  canCreateFolders: boolean;
  /** Uploads report byte-level progress rather than being all-or-nothing. */
  reportsUploadProgress: boolean;
}

export interface UploadRequest {
  blob: Blob;
  filename: string;
  mimeType: string;
  /** Provider folder id. Null means the provider's default location. */
  folderId: string | null;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

export interface ConnectOptions {
  /** Ask for whatever elevated access the provider supports. */
  requestFullAccess?: boolean;
  /** False for silent status checks that must not show a consent prompt. */
  interactive?: boolean;
}

export interface StorageProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /** Establishes access. Interactive by default. */
  connect(options?: ConnectOptions): Promise<ConnectionStatus>;

  /** Revokes access and clears any locally cached credentials. */
  disconnect(): Promise<void>;

  /** Silent check. Must never prompt. */
  isConnected(): Promise<boolean>;

  /** Current connection state, including the account label when connected. */
  getStatus(): Promise<ConnectionStatus>;

  /** Lists child folders. `null` lists the top level. */
  getFolders(parentId: string | null): Promise<RemoteFolder[]>;

  /** Creates a folder and returns it. */
  createFolder(name: string, parentId: string | null): Promise<RemoteFolder>;

  /**
   * Verifies a stored destination is still usable, refreshing its display name.
   * Throws FOLDER_UNAVAILABLE when the folder was deleted or is no longer reachable.
   */
  resolveFolder(folderId: string): Promise<RemoteFolder>;

  /** Uploads a file and returns a reference including a shareable web URL. */
  uploadFile(request: UploadRequest): Promise<UploadedFile>;

  /** Web URL for a previously uploaded file id. */
  getFileUrl(fileId: string): string;
}

/** Convenience for turning a browsed folder into a persisted destination. */
export function toDestination(providerId: ProviderId, folder: RemoteFolder): DestinationRef {
  return {
    providerId,
    folderId: folder.id,
    folderName: folder.name,
    folderPath: folder.path,
  };
}
