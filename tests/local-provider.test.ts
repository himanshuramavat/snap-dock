import { describe, expect, it } from 'vitest';
import type { Settings } from '@/types';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { normalizeSettings } from '@/settings/schema';
import {
  LocalProvider,
  MAX_RELATIVE_PATH,
  buildRelativePath,
  deriveDownloadRoot,
  sanitizeSubfolder,
} from '@/storage/local/LocalProvider';
import {
  LOCAL_ROOT_LABEL,
  describeShortfall,
  formatLocalPath,
  isAlwaysReady,
  localDestination,
  modeIncludes,
  resolveDestinations,
} from '@/storage/destination';
import type { StorageProvider } from '@/storage/StorageProvider';

/**
 * Local saving is the default destination, so its path handling and its
 * destination-resolution rules are the most load-bearing logic in the storage layer.
 */

describe('sanitizeSubfolder', () => {
  it('accepts a simple folder name', () => {
    expect(sanitizeSubfolder('SnapDock')).toBe('SnapDock');
  });

  it('allows one level of nesting', () => {
    expect(sanitizeSubfolder('SnapDock/Bugs')).toBe('SnapDock/Bugs');
  });

  it('rejects path traversal outright rather than rewriting it', () => {
    // Chrome refuses any download path containing '..', and it is also the obvious
    // escape attempt, so the segments are dropped entirely.
    expect(sanitizeSubfolder('../../etc')).toBe('etc');
    expect(sanitizeSubfolder('a/../../b')).toBe('a/b');
    expect(sanitizeSubfolder('..')).toBe('');
  });

  it('strips absolute paths down to relative segments', () => {
    expect(sanitizeSubfolder('/home/user/shots')).toBe('home/user');
    expect(sanitizeSubfolder('C:/Users')).toBe('C/Users');
  });

  it('normalises Windows separators', () => {
    expect(sanitizeSubfolder('SnapDock\\Bugs')).toBe('SnapDock/Bugs');
  });

  it('drops empty and dot segments', () => {
    expect(sanitizeSubfolder('a//b')).toBe('a/b');
    expect(sanitizeSubfolder('./a')).toBe('a');
    expect(sanitizeSubfolder('   ')).toBe('');
  });

  it('caps nesting at two levels so paths stay well short of any limit', () => {
    expect(sanitizeSubfolder('a/b/c/d/e')).toBe('a/b');
  });

  it('sanitises each segment with the filename rules', () => {
    expect(sanitizeSubfolder('Bug: reports?')).toBe('Bug- reports');
    expect(sanitizeSubfolder('trailing.')).toBe('trailing');
  });

  it('returns an empty string for input that cannot yield a usable path', () => {
    expect(sanitizeSubfolder('')).toBe('');
    expect(sanitizeSubfolder('///')).toBe('');
  });
});

describe('localDestination', () => {
  it('describes a sub-folder under Downloads', () => {
    expect(localDestination('SnapDock')).toEqual({
      providerId: 'local',
      folderId: 'SnapDock',
      folderName: 'SnapDock',
      folderPath: `${LOCAL_ROOT_LABEL}/SnapDock`,
    });
  });

  it('describes the Downloads root when no sub-folder is set', () => {
    expect(localDestination('')).toEqual({
      providerId: 'local',
      folderId: '',
      folderName: LOCAL_ROOT_LABEL,
      folderPath: LOCAL_ROOT_LABEL,
    });
  });

  it('sanitises before building the reference, so a hostile value never reaches disk', () => {
    expect(localDestination('../../etc').folderId).toBe('etc');
  });
});

describe('resolveDestinations', () => {
  const drive = {
    providerId: 'google-drive' as const,
    folderId: 'f1',
    folderName: 'Screenshots',
    folderPath: 'My Drive / Screenshots',
  };

  const withMode = (mode: Settings['destinationMode'], subfolder = 'SnapDock'): Settings => ({
    ...DEFAULT_SETTINGS,
    destinationMode: mode,
    local: { subfolder, askEveryTime: false },
  });

  it('is always resolvable for local saving, even with no Drive connection', () => {
    const resolved = resolveDestinations(withMode('local'), null);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.providerId).toBe('local');
  });

  it('ignores the stored Drive folder when only local is selected', () => {
    const resolved = resolveDestinations(withMode('local'), drive);
    expect(resolved.map((d) => d.providerId)).toEqual(['local']);
  });

  it('uses the stored Drive folder when only Drive is selected', () => {
    expect(resolveDestinations(withMode('google-drive'), drive)).toEqual([drive]);
  });

  it('returns an empty list when Drive is selected alone but no folder is chosen', () => {
    // This is the only way to get an empty list, and it is what disables capture.
    expect(resolveDestinations(withMode('google-drive'), null)).toEqual([]);
  });

  it('returns both destinations for "both", with local first', () => {
    const resolved = resolveDestinations(withMode('both'), drive);
    expect(resolved.map((d) => d.providerId)).toEqual(['local', 'google-drive']);
  });

  it('degrades "both" to local when Drive has no folder, rather than failing', () => {
    // Refusing to capture because the optional destination is unconfigured would be
    // the wrong trade: a file on disk beats no file at all.
    const resolved = resolveDestinations(withMode('both'), null);
    expect(resolved.map((d) => d.providerId)).toEqual(['local']);
  });

  it('tracks the sub-folder setting', () => {
    expect(resolveDestinations(withMode('local', 'Bugs'), null)[0]?.folderPath).toBe(
      `${LOCAL_ROOT_LABEL}/Bugs`,
    );
  });

  it('accepts an explicit mode override, as a preset supplies', () => {
    const settings = withMode('local');
    expect(resolveDestinations(settings, drive, 'both').map((d) => d.providerId)).toEqual([
      'local',
      'google-drive',
    ]);
    expect(resolveDestinations(settings, drive, 'google-drive').map((d) => d.providerId)).toEqual([
      'google-drive',
    ]);
  });
});

describe('modeIncludes', () => {
  it('reports which providers each mode covers', () => {
    expect(modeIncludes('local', 'local')).toBe(true);
    expect(modeIncludes('local', 'google-drive')).toBe(false);
    expect(modeIncludes('google-drive', 'local')).toBe(false);
    expect(modeIncludes('both', 'local')).toBe(true);
    expect(modeIncludes('both', 'google-drive')).toBe(true);
  });
});

describe('describeShortfall', () => {
  it('says nothing when the chosen mode can be honoured', () => {
    expect(describeShortfall('local', false)).toBeNull();
    expect(describeShortfall('google-drive', true)).toBeNull();
    expect(describeShortfall('both', true)).toBeNull();
  });

  it('blocks when Drive alone is chosen but not ready', () => {
    const shortfall = describeShortfall('google-drive', false);
    expect(shortfall?.blocking).toBe(true);
    expect(shortfall?.message).toMatch(/connect google drive/i);
  });

  it('warns without blocking when "both" is chosen but Drive is not ready', () => {
    // "Both" must never silently become "device only"; the user is told up front.
    const shortfall = describeShortfall('both', false);
    expect(shortfall?.blocking).toBe(false);
    expect(shortfall?.message).toMatch(/this device only/i);
  });
});

describe('isAlwaysReady', () => {
  it('marks local as needing no setup and Drive as needing some', () => {
    expect(isAlwaysReady('local')).toBe(true);
    expect(isAlwaysReady('google-drive')).toBe(false);
  });
});

describe('LocalProvider contract', () => {
  const provider: StorageProvider = new LocalProvider();

  it('satisfies the same interface as the Drive provider', () => {
    for (const method of [
      'connect',
      'disconnect',
      'isConnected',
      'getStatus',
      'getFolders',
      'createFolder',
      'resolveFolder',
      'uploadFile',
      'getFileUrl',
    ] as const) {
      expect(typeof provider[method], `${method} should be a function`).toBe('function');
    }
  });

  it('needs no authentication', async () => {
    expect(await provider.isConnected()).toBe(true);
    const status = await provider.getStatus();
    expect(status.connected).toBe(true);
    expect(status.providerId).toBe('local');
  });

  it('declares honestly that it cannot browse or report progress', () => {
    expect(provider.capabilities.canBrowseExisting).toBe(false);
    expect(provider.capabilities.reportsUploadProgress).toBe(false);
  });

  it('returns no folders, because Chrome will not enumerate the filesystem', async () => {
    expect(await provider.getFolders(null)).toEqual([]);
  });

  it('resolves a folder without touching the disk', async () => {
    const folder = await provider.resolveFolder('SnapDock');
    expect(folder.id).toBe('SnapDock');
    expect(folder.path).toBe(`${LOCAL_ROOT_LABEL}/SnapDock`);
  });

  it('sanitises a folder it is asked to create', async () => {
    expect((await provider.createFolder('../evil', null)).id).toBe('evil');
  });

  it('exposes no web URL, since a local file has none', () => {
    expect(provider.getFileUrl('7')).toBe('');
  });

  it('disconnect is a harmless no-op', async () => {
    await expect(provider.disconnect()).resolves.toBeUndefined();
  });
});

describe('settings schema for destinations', () => {
  it('defaults to local saving, so the extension works with no setup', () => {
    expect(DEFAULT_SETTINGS.destinationMode).toBe('local');
  });

  it('accepts every mode and rejects anything else', () => {
    expect(normalizeSettings({ destinationMode: 'google-drive' }).destinationMode).toBe(
      'google-drive',
    );
    expect(normalizeSettings({ destinationMode: 'both' }).destinationMode).toBe('both');
    expect(normalizeSettings({ destinationMode: 'local' }).destinationMode).toBe('local');
    expect(normalizeSettings({ destinationMode: 'dropbox' }).destinationMode).toBe('local');
  });

  it('repairs a corrupted local block', () => {
    const local = normalizeSettings({ local: 'nonsense' }).local;
    expect(local).toEqual(DEFAULT_SETTINGS.local);
  });

  it('keeps a valid sub-folder and caps an absurd one', () => {
    expect(normalizeSettings({ local: { subfolder: 'Shots' } }).local.subfolder).toBe('Shots');
    expect(normalizeSettings({ local: { subfolder: 'x'.repeat(500) } }).local.subfolder).toHaveLength(
      120,
    );
  });

  it('allows an empty sub-folder, meaning the Downloads root', () => {
    expect(normalizeSettings({ local: { subfolder: '' } }).local.subfolder).toBe('');
  });
});

describe('cross-platform path handling', () => {
  it('caps the combined relative path so Windows MAX_PATH is not blown', () => {
    const long = `${'n'.repeat(300)}.png`;
    const path = buildRelativePath('SnapDock', long);
    expect(path.length).toBeLessThanOrEqual(MAX_RELATIVE_PATH);
    expect(path.startsWith('SnapDock/')).toBe(true);
  });

  it('always preserves the extension when truncating', () => {
    // A truncated name is a nuisance; a file the OS cannot open is a bug.
    expect(buildRelativePath('', `${'n'.repeat(300)}.png`).endsWith('.png')).toBe(true);
    expect(buildRelativePath('a/b', `${'n'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
    expect(buildRelativePath('', `${'n'.repeat(300)}.jpg`).endsWith('.jpg')).toBe(true);
  });

  it('shortens the generated name rather than the folder the user chose', () => {
    const folder = 'MyVeryDeliberatelyChosenFolderName/AndASubfolderToo';
    const path = buildRelativePath(folder, `${'n'.repeat(300)}.png`);
    expect(path.startsWith(`${folder}/`)).toBe(true);
  });

  it('leaves realistic names untouched', () => {
    expect(buildRelativePath('SnapDock', 'Screenshot_2026-08-17_11-30-25.png')).toBe(
      'SnapDock/Screenshot_2026-08-17_11-30-25.png',
    );
    expect(buildRelativePath('', 'Screenshot_2026-08-17_11-30-25.png')).toBe(
      'Screenshot_2026-08-17_11-30-25.png',
    );
  });

  it('always uses forward slashes, which Chrome accepts on every platform', () => {
    expect(buildRelativePath('a\\b', 'x.png')).toBe('a/b/x.png');
    expect(buildRelativePath('a/b', 'x.png')).not.toContain('\\');
  });

  it('never emits a path chrome.downloads would reject', () => {
    // Absolute paths, empty paths and '..' are documented API errors.
    for (const folder of ['../../etc', '/absolute', 'C:/Windows', '..', './x']) {
      const path = buildRelativePath(folder, 'shot.png');
      expect(path.startsWith('/')).toBe(false);
      expect(path).not.toContain('..');
      expect(path.length).toBeGreaterThan(0);
      expect(/^[A-Za-z]:/.test(path)).toBe(false);
    }
  });
});

describe('deriveDownloadRoot', () => {
  it('strips the relative path from a POSIX absolute path', () => {
    expect(deriveDownloadRoot('/home/ana/Downloads/SnapDock/shot.png', 'SnapDock/shot.png')).toBe(
      '/home/ana/Downloads',
    );
  });

  it('strips the relative path from a Windows absolute path', () => {
    expect(
      deriveDownloadRoot('C:\\Users\\Ana\\Downloads\\SnapDock\\shot.png', 'SnapDock/shot.png'),
    ).toBe('C:\\Users\\Ana\\Downloads');
  });

  it('handles a macOS path', () => {
    expect(deriveDownloadRoot('/Users/ana/Downloads/shot.png', 'shot.png')).toBe(
      '/Users/ana/Downloads',
    );
  });

  it('falls back to the containing folder when the file was renamed', () => {
    // conflictAction: 'uniquify' turns shot.png into shot (1).png.
    expect(deriveDownloadRoot('/home/ana/Downloads/SnapDock/shot (1).png', 'SnapDock/shot.png')).toBe(
      '/home/ana/Downloads/SnapDock',
    );
  });

  it('falls back sanely when the user saved somewhere else entirely via the dialog', () => {
    expect(deriveDownloadRoot('/home/ana/Desktop/elsewhere.png', 'SnapDock/shot.png')).toBe(
      '/home/ana/Desktop',
    );
  });
});

describe('formatLocalPath', () => {
  it('uses the generic label before any save has revealed the real root', () => {
    expect(formatLocalPath(null, 'SnapDock')).toBe(`${LOCAL_ROOT_LABEL}/SnapDock`);
    expect(formatLocalPath(null, '')).toBe(LOCAL_ROOT_LABEL);
  });

  it('uses the real root once known', () => {
    expect(formatLocalPath('/home/ana/Downloads', 'SnapDock')).toBe('/home/ana/Downloads/SnapDock');
    expect(formatLocalPath('/home/ana/Downloads', '')).toBe('/home/ana/Downloads');
  });

  it('renders Windows paths with backslashes, taken from the root itself', () => {
    expect(formatLocalPath('C:\\Users\\Ana\\Downloads', 'SnapDock')).toBe(
      'C:\\Users\\Ana\\Downloads\\SnapDock',
    );
    expect(formatLocalPath('C:\\Users\\Ana\\Downloads', 'Shots/Bugs')).toBe(
      'C:\\Users\\Ana\\Downloads\\Shots\\Bugs',
    );
  });

  it('does not double up separators on a trailing slash', () => {
    expect(formatLocalPath('/home/ana/Downloads/', 'SnapDock')).toBe('/home/ana/Downloads/SnapDock');
  });

  it('sanitises the sub-folder before displaying it', () => {
    expect(formatLocalPath('/home/ana/Downloads', '../etc')).toBe('/home/ana/Downloads/etc');
  });
});
