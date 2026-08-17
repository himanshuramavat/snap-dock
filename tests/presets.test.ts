import { describe, expect, it } from 'vitest';
import type { Preset } from '@/types';
import {
  PRESET_LIMIT,
  PresetStore,
  deserializePreset,
  deserializePresets,
  seedPresets,
} from '@/presets/PresetStore';
import { DEFAULT_PDF_CONFIG } from '@/settings/defaults';
import { STORAGE_KEYS, memoryArea } from '@/utils/storageArea';

const preset: Preset = {
  id: 'p1',
  name: 'Bug report',
  captureMode: 'fullpage',
  outputType: 'png',
  image: { format: 'png', quality: 100, scale: 1 },
  pdf: DEFAULT_PDF_CONFIG,
  filenameTemplate: '{date}_{domain}_{title}',
  destination: {
    providerId: 'google-drive',
    folderId: 'folder-1',
    folderName: 'Bug Reports',
    folderPath: 'My Drive / Bug Reports',
  },
  destinationMode: null,
  createdAt: 1_000,
  updatedAt: 2_000,
};

describe('preset serialization', () => {
  it('round-trips a valid preset unchanged', () => {
    expect(deserializePreset(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
  });

  it('rejects entries without an id or a name', () => {
    expect(deserializePreset({ ...preset, id: '' })).toBeNull();
    expect(deserializePreset({ ...preset, name: '   ' })).toBeNull();
    expect(deserializePreset(null)).toBeNull();
    expect(deserializePreset('nonsense')).toBeNull();
  });

  it('repairs unrecognised enum values rather than dropping the preset', () => {
    const repaired = deserializePreset({ ...preset, captureMode: 'telepathy', outputType: 'gif' });
    expect(repaired?.captureMode).toBe('visible');
    expect(repaired?.outputType).toBe('png');
  });

  it('re-validates nested image and pdf config', () => {
    const repaired = deserializePreset({
      ...preset,
      image: { format: 'bmp', quality: 900, scale: 99 },
    });
    expect(repaired?.image.format).toBe('png');
    expect(repaired?.image.quality).toBe(100);
    expect(repaired?.image.scale).toBe(4);
  });

  it('keeps a valid destination mode override and rejects nonsense', () => {
    expect(deserializePreset({ ...preset, destinationMode: 'both' })?.destinationMode).toBe('both');
    expect(deserializePreset({ ...preset, destinationMode: 'ftp' })?.destinationMode).toBeNull();
    expect(deserializePreset({ ...preset, destinationMode: undefined })?.destinationMode).toBeNull();
  });

  it('drops a destination that is missing its folder id', () => {
    const repaired = deserializePreset({ ...preset, destination: { providerId: 'google-drive' } });
    expect(repaired?.destination).toBeNull();
  });

  it('backfills a missing folder path from the folder name', () => {
    const repaired = deserializePreset({
      ...preset,
      destination: { providerId: 'google-drive', folderId: 'f', folderName: 'Shots' },
    });
    expect(repaired?.destination?.folderPath).toBe('Shots');
  });

  it('trims and caps over-long names', () => {
    const repaired = deserializePreset({ ...preset, name: `  ${'n'.repeat(200)}  ` });
    expect(repaired?.name).toHaveLength(60);
  });

  it('skips invalid entries in a list without losing the valid ones', () => {
    const list = deserializePresets([preset, null, { id: 'x' }, { ...preset, id: 'p2' }]);
    expect(list.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('returns an empty list for non-array input', () => {
    expect(deserializePresets(undefined)).toEqual([]);
    expect(deserializePresets({ presets: [] })).toEqual([]);
  });

  it('enforces the preset limit when reading', () => {
    const many = Array.from({ length: PRESET_LIMIT + 10 }, (_, index) => ({
      ...preset,
      id: `p${index}`,
    }));
    expect(deserializePresets(many)).toHaveLength(PRESET_LIMIT);
  });
});

describe('seedPresets', () => {
  it('ships the two documented starter presets', () => {
    const seeded = seedPresets(5_000);
    expect(seeded.map((entry) => entry.name)).toEqual(['Bug report', 'Documentation']);

    const [bug, docs] = seeded;
    expect(bug?.captureMode).toBe('fullpage');
    expect(bug?.outputType).toBe('png');
    expect(docs?.outputType).toBe('pdf');
    expect(docs?.pdf.paperSize).toBe('a4');
    expect(docs?.pdf.orientation).toBe('portrait');
  });

  it('leaves destinations unset so starter presets follow the user default', () => {
    expect(seedPresets(0).every((entry) => entry.destination === null)).toBe(true);
    expect(seedPresets(0).every((entry) => entry.destinationMode === null)).toBe(true);
  });

  it('survives its own round-trip through the deserializer', () => {
    const seeded = seedPresets(5_000);
    expect(deserializePresets(JSON.parse(JSON.stringify(seeded)))).toEqual(seeded);
  });
});

describe('PresetStore', () => {
  it('starts empty', async () => {
    expect(await new PresetStore(memoryArea()).list()).toEqual([]);
  });

  it('saves, updates in place, and deletes', async () => {
    const store = new PresetStore(memoryArea());

    await store.save(preset);
    expect(await store.list()).toHaveLength(1);

    await store.save({ ...preset, name: 'Renamed' });
    const afterUpdate = await store.list();
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]?.name).toBe('Renamed');

    await store.remove(preset.id);
    expect(await store.list()).toEqual([]);
  });

  it('stamps updatedAt on save', async () => {
    const store = new PresetStore(memoryArea());
    const saved = await store.save({ ...preset, updatedAt: 0 });
    expect(saved[0]!.updatedAt).toBeGreaterThan(0);
  });

  it('refuses to grow past the preset limit', async () => {
    const store = new PresetStore(memoryArea());
    for (let index = 0; index < PRESET_LIMIT + 5; index += 1) {
      await store.save({ ...preset, id: `p${index}`, name: `Preset ${index}` });
    }
    expect(await store.list()).toHaveLength(PRESET_LIMIT);
  });

  it('seeds starter presets exactly once', async () => {
    const area = memoryArea();
    const store = new PresetStore(area);

    await store.seedIfEmpty(1);
    const seeded = await store.list();
    expect(seeded).toHaveLength(2);

    await store.remove(seeded[0]!.id);
    // A second install event must not resurrect a preset the user deleted.
    await store.seedIfEmpty(2);
    expect(await store.list()).toHaveLength(1);
  });

  it('does not overwrite existing presets when seeding', async () => {
    const area = memoryArea({ [STORAGE_KEYS.presets]: [preset] });
    const store = new PresetStore(area);
    await store.seedIfEmpty(1);
    expect(await store.list()).toHaveLength(1);
  });
});
