import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { LIMITS, clamp, normalizePdfConfig, normalizeSettings } from '@/settings/schema';
import { SettingsStore, deepMerge } from '@/settings/SettingsStore';
import { STORAGE_KEYS, memoryArea } from '@/utils/storageArea';

describe('normalizeSettings', () => {
  it('returns complete defaults for empty or nonsense input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('corrupted')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const result = normalizeSettings({
      defaultCaptureMode: 'fullpage',
      defaultOutputType: 'not-a-format',
      image: { format: 'webp', quality: 80, scale: 2 },
    });

    expect(result.defaultCaptureMode).toBe('fullpage');
    expect(result.defaultOutputType).toBe(DEFAULT_SETTINGS.defaultOutputType);
    expect(result.image).toEqual({ format: 'webp', quality: 80, scale: 2 });
  });

  it('clamps numbers into their supported range instead of rejecting them', () => {
    const result = normalizeSettings({
      image: { quality: 5000, scale: -3 },
      pdf: { marginMm: 999, scale: 42 },
      advanced: { scrollSettleMs: -100, maxFullPageHeight: 10 ** 9 },
    });

    expect(result.image.quality).toBe(LIMITS.quality.max);
    expect(result.image.scale).toBe(LIMITS.imageScale.min);
    expect(result.pdf.marginMm).toBe(LIMITS.marginMm.max);
    expect(result.pdf.scale).toBe(LIMITS.pdfScale.max);
    expect(result.advanced.scrollSettleMs).toBe(LIMITS.scrollSettleMs.min);
    expect(result.advanced.maxFullPageHeight).toBe(LIMITS.maxFullPageHeight.max);
  });

  it('rejects NaN and Infinity, which would otherwise poison the capture pipeline', () => {
    const result = normalizeSettings({ image: { quality: Number.NaN, scale: Number.POSITIVE_INFINITY } });
    expect(Number.isFinite(result.image.quality)).toBe(true);
    expect(Number.isFinite(result.image.scale)).toBe(true);
  });

  it('falls back to the default template when the stored one is blank', () => {
    expect(normalizeSettings({ filename: { template: '   ' } }).filename.template).toBe(
      DEFAULT_SETTINGS.filename.template,
    );
  });

  it('always reports the current schema version', () => {
    expect(normalizeSettings({ version: 99 }).version).toBe(DEFAULT_SETTINGS.version);
  });

  it('falls back to the default destination for an unknown mode', () => {
    // Mode validation itself is covered in tests/local-provider.test.ts.
    expect(normalizeSettings({ destinationMode: 'dropbox' }).destinationMode).toBe(
      DEFAULT_SETTINGS.destinationMode,
    );
  });
});

describe('normalizePdfConfig', () => {
  it('only carries custom dimensions when the custom paper size is selected', () => {
    const a4 = normalizePdfConfig({ paperSize: 'a4', customWidthMm: 500 }, DEFAULT_SETTINGS.pdf);
    expect(a4.customWidthMm).toBeUndefined();

    const custom = normalizePdfConfig(
      { paperSize: 'custom', customWidthMm: 500, customHeightMm: 700 },
      DEFAULT_SETTINGS.pdf,
    );
    expect(custom.customWidthMm).toBe(500);
    expect(custom.customHeightMm).toBe(700);
  });

  it('supplies A4 dimensions when custom is selected without values', () => {
    const custom = normalizePdfConfig({ paperSize: 'custom' }, DEFAULT_SETTINGS.pdf);
    expect(custom.customWidthMm).toBe(210);
    expect(custom.customHeightMm).toBe(297);
  });
});

describe('clamp', () => {
  it('bounds a value and treats non-finite input as the minimum', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(Number.NaN, 2, 10)).toBe(2);
  });
});

describe('deepMerge', () => {
  it('merges nested objects without discarding sibling keys', () => {
    const merged = deepMerge(
      { a: 1, nested: { x: 1, y: 2 } },
      { nested: { y: 9 } } as never,
    );
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 9 } });
  });

  it('ignores undefined values so a partial patch cannot erase a setting', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: undefined } as never)).toEqual({ a: 1, b: 2 });
  });

  it('replaces arrays rather than merging them element-wise', () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] } as never)).toEqual({ list: [9] });
  });
});

describe('SettingsStore', () => {
  it('returns defaults on first read', async () => {
    const store = new SettingsStore(memoryArea());
    expect(await store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists an update and reads it back through a fresh store', async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);

    await store.update({ defaultCaptureMode: 'fullpage', image: { quality: 70 } });

    const reloaded = await new SettingsStore(area).get();
    expect(reloaded.defaultCaptureMode).toBe('fullpage');
    expect(reloaded.image.quality).toBe(70);
    // Unrelated fields survive a partial update.
    expect(reloaded.image.format).toBe(DEFAULT_SETTINGS.image.format);
    expect(reloaded.pdf).toEqual(DEFAULT_SETTINGS.pdf);
  });

  it('validates on write, so an out-of-range update is stored clamped', async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);

    await store.update({ image: { quality: 10_000 } });

    const raw = (await area.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings] as {
      image: { quality: number };
    };
    expect(raw.image.quality).toBe(LIMITS.quality.max);
  });

  it('repairs corrupted stored settings instead of throwing', async () => {
    const area = memoryArea({ [STORAGE_KEYS.settings]: { image: 'not an object', pdf: 7 } });
    const settings = await new SettingsStore(area).get();
    expect(settings.image).toEqual(DEFAULT_SETTINGS.image);
    expect(settings.pdf).toEqual(DEFAULT_SETTINGS.pdf);
  });

  it('reset restores every default', async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);
    await store.update({ defaultOutputType: 'pdf' });
    expect(await store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(await new SettingsStore(area).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('serves later reads from cache until invalidated', async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);
    await store.get();

    // Write behind the store's back; the cache should still be returned.
    await area.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, defaultOutputType: 'pdf' } });
    expect((await store.get()).defaultOutputType).toBe(DEFAULT_SETTINGS.defaultOutputType);

    store.invalidate();
    expect((await store.get()).defaultOutputType).toBe('pdf');
  });

  it('stores only structured-clone-safe values', async () => {
    const area = memoryArea();
    // memoryArea round-trips through JSON, which throws on anything chrome.storage
    // would also refuse. Reaching this assertion is the test.
    await expect(new SettingsStore(area).update({ image: { quality: 60 } })).resolves.toBeDefined();
  });
});

describe('SettingsStore.ensureInitialized', () => {
  it('writes defaults when nothing is stored yet', async () => {
    const area = memoryArea();
    await new SettingsStore(area).ensureInitialized();

    const raw = (await area.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
    expect(raw).toEqual(DEFAULT_SETTINGS);
  });

  it('never overwrites settings the user has already changed', async () => {
    const area = memoryArea();
    const store = new SettingsStore(area);
    await store.update({ defaultOutputType: 'pdf' });

    // A second install/update event must not reset the user's preferences.
    const settings = await new SettingsStore(area).ensureInitialized();
    expect(settings.defaultOutputType).toBe('pdf');
  });
});

describe('settings migration v1 to v2', () => {
  it('carries a v1 Google Drive choice forward as the Drive mode', async () => {
    const area = memoryArea({
      [STORAGE_KEYS.settings]: { version: 1, activeProviderId: 'google-drive' },
    });
    const settings = await new SettingsStore(area).get();
    expect(settings.destinationMode).toBe('google-drive');
    expect(settings.version).toBe(DEFAULT_SETTINGS.version);
  });

  it('carries a v1 local choice forward', async () => {
    const area = memoryArea({
      [STORAGE_KEYS.settings]: { version: 1, activeProviderId: 'local' },
    });
    expect((await new SettingsStore(area).get()).destinationMode).toBe('local');
  });

  it('drops the obsolete field rather than leaving it behind', async () => {
    const area = memoryArea({
      [STORAGE_KEYS.settings]: { version: 1, activeProviderId: 'google-drive' },
    });
    const store = new SettingsStore(area);
    await store.get();
    await store.update({ image: { quality: 80 } });

    const raw = (await area.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings] as Record<
      string,
      unknown
    >;
    expect('activeProviderId' in raw).toBe(false);
    expect(raw.destinationMode).toBe('google-drive');
  });

  it('preserves unrelated v1 settings across the migration', async () => {
    const area = memoryArea({
      [STORAGE_KEYS.settings]: {
        version: 1,
        activeProviderId: 'local',
        defaultCaptureMode: 'fullpage',
        image: { format: 'webp', quality: 70, scale: 2 },
      },
    });
    const settings = await new SettingsStore(area).get();
    expect(settings.defaultCaptureMode).toBe('fullpage');
    expect(settings.image).toEqual({ format: 'webp', quality: 70, scale: 2 });
  });

  it('leaves an already-migrated record alone', async () => {
    const area = memoryArea({
      [STORAGE_KEYS.settings]: { version: 2, destinationMode: 'both' },
    });
    expect((await new SettingsStore(area).get()).destinationMode).toBe('both');
  });
});
