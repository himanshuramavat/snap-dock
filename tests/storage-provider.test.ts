import { describe, expect, it } from 'vitest';
import type { RemoteFolder } from '@/types';
import { GoogleDriveProvider } from '@/storage/google-drive/GoogleDriveProvider';
import { toDestination, type StorageProvider } from '@/storage/StorageProvider';
import { DestinationStore } from '@/storage/DestinationStore';
import { STORAGE_KEYS, memoryArea } from '@/utils/storageArea';

/**
 * The storage abstraction is what makes a second provider cheap to add later, so it
 * is worth testing as a contract rather than only testing Google Drive's behaviour.
 * These checks are written against the interface and would run unchanged against a
 * DropboxProvider or S3Provider.
 */

const METHODS: readonly (keyof StorageProvider)[] = [
  'connect',
  'disconnect',
  'isConnected',
  'getStatus',
  'getFolders',
  'createFolder',
  'resolveFolder',
  'uploadFile',
  'getFileUrl',
];

describe('StorageProvider contract', () => {
  const provider: StorageProvider = new GoogleDriveProvider();

  it('implements every method in the interface', () => {
    for (const method of METHODS) {
      expect(typeof provider[method], `${String(method)} should be a function`).toBe('function');
    }
  });

  it('identifies itself with a stable id and a display name', () => {
    expect(provider.id).toBe('google-drive');
    expect(provider.displayName).toBe('Google Drive');
  });

  it('declares its capabilities so the UI does not have to special-case providers', () => {
    expect(provider.capabilities).toMatchObject({
      canCreateFolders: true,
      reportsUploadProgress: true,
    });
    // Browsing pre-existing folders is off until the user grants the wider scope.
    expect(provider.capabilities.canBrowseExisting).toBe(false);
  });

  it('returns a usable file URL without a network round-trip', () => {
    expect(provider.getFileUrl('abc123')).toBe('https://drive.google.com/file/d/abc123/view');
  });

  it('escapes file ids in generated URLs', () => {
    expect(provider.getFileUrl('a/b?c')).toBe('https://drive.google.com/file/d/a%2Fb%3Fc/view');
  });

  it('resolves the Drive root without calling the API', async () => {
    const root = await provider.resolveFolder('root');
    expect(root).toEqual({ id: 'root', name: 'My Drive', path: 'My Drive', parentId: null });
  });
});

describe('toDestination', () => {
  it('converts a browsed folder into a persistable destination', () => {
    const folder: RemoteFolder = {
      id: 'f1',
      name: 'Screenshots',
      path: 'My Drive / Screenshots',
      parentId: 'root',
    };
    expect(toDestination('google-drive', folder)).toEqual({
      providerId: 'google-drive',
      folderId: 'f1',
      folderName: 'Screenshots',
      folderPath: 'My Drive / Screenshots',
    });
  });
});

describe('DestinationStore', () => {
  it('returns null when nothing has been chosen', async () => {
    expect(await new DestinationStore(memoryArea()).get()).toBeNull();
  });

  it('persists a destination across store instances, which is what survives a restart', async () => {
    const area = memoryArea();
    const destination = {
      providerId: 'google-drive' as const,
      folderId: 'f1',
      folderName: 'Screenshots',
      folderPath: 'My Drive / Screenshots',
    };

    await new DestinationStore(area).set(destination);
    expect(await new DestinationStore(area).get()).toEqual(destination);
  });

  it('rejects malformed stored values rather than returning a broken destination', async () => {
    const cases = [
      { folderId: 'f1' },
      { providerId: 'google-drive', folderName: 'x' },
      { providerId: 'google-drive', folderId: '', folderName: 'x' },
      { providerId: 'dropbox', folderId: 'f1', folderName: 'x' },
      'not an object',
      null,
    ];

    for (const value of cases) {
      const area = memoryArea({ [STORAGE_KEYS.destination]: value });
      expect(await new DestinationStore(area).get()).toBeNull();
    }
  });

  it('clears the destination on disconnect', async () => {
    const area = memoryArea();
    const store = new DestinationStore(area);
    await store.set({
      providerId: 'google-drive',
      folderId: 'f1',
      folderName: 'x',
      folderPath: 'x',
    });
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
