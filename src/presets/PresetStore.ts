import type { Preset } from '@/types';
import { DEFAULT_IMAGE_CONFIG, DEFAULT_PDF_CONFIG } from '@/settings/defaults';
import { normalizeImageConfig, normalizePdfConfig } from '@/settings/schema';
import { STORAGE_KEYS, localArea, type KeyValueArea } from '@/utils/storageArea';

/**
 * Reusable capture configurations.
 *
 * A preset is a complete snapshot of the capture pipeline's inputs, so applying one
 * is a single assignment rather than a series of UI toggles. Destination is nullable
 * on purpose: most presets should follow the user's default folder, and only ones
 * that genuinely belong somewhere else (a Bug Reports folder) pin their own.
 */

export const PRESET_LIMIT = 20;

/** Ships with two presets so the feature is discoverable rather than an empty list. */
export function seedPresets(now: number): Preset[] {
  return [
    {
      id: 'preset-bug-report',
      name: 'Bug report',
      captureMode: 'fullpage',
      outputType: 'png',
      image: { format: 'png', quality: 100, scale: 1 },
      pdf: DEFAULT_PDF_CONFIG,
      filenameTemplate: '{date}_{domain}_{title}',
      destination: null,
      destinationMode: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset-documentation',
      name: 'Documentation',
      captureMode: 'fullpage',
      outputType: 'pdf',
      image: { format: 'png', quality: 92, scale: 1 },
      pdf: { ...DEFAULT_PDF_CONFIG, paperSize: 'a4', orientation: 'portrait', multiPage: true },
      filenameTemplate: '{title}_{date}',
      destination: null,
      destinationMode: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Round-trips a stored preset back into a valid one.
 *
 * Presets are the most likely thing to be hand-edited or carried across an upgrade,
 * so every field is re-validated and anything unrecognisable falls back to a default
 * rather than producing a preset that fails at capture time.
 */
export function deserializePreset(raw: unknown): Preset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  if (!id || !name) return null;

  const captureMode =
    raw.captureMode === 'visible' || raw.captureMode === 'region' || raw.captureMode === 'fullpage'
      ? raw.captureMode
      : 'visible';

  const outputType =
    raw.outputType === 'png' ||
    raw.outputType === 'jpeg' ||
    raw.outputType === 'webp' ||
    raw.outputType === 'pdf'
      ? raw.outputType
      : 'png';

  const destination =
    isRecord(raw.destination) &&
    typeof raw.destination.folderId === 'string' &&
    typeof raw.destination.folderName === 'string'
      ? {
          providerId: 'google-drive' as const,
          folderId: raw.destination.folderId,
          folderName: raw.destination.folderName,
          folderPath:
            typeof raw.destination.folderPath === 'string'
              ? raw.destination.folderPath
              : raw.destination.folderName,
        }
      : null;

  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : 0;

  // null means "follow whatever the user's global destination setting says", which is
  // what almost every preset should do.
  const destinationMode =
    raw.destinationMode === 'local' ||
    raw.destinationMode === 'google-drive' ||
    raw.destinationMode === 'both'
      ? raw.destinationMode
      : null;

  return {
    id,
    name: name.slice(0, 60),
    captureMode,
    outputType,
    image: normalizeImageConfig(raw.image, DEFAULT_IMAGE_CONFIG),
    pdf: normalizePdfConfig(raw.pdf, DEFAULT_PDF_CONFIG),
    filenameTemplate:
      typeof raw.filenameTemplate === 'string' && raw.filenameTemplate.trim()
        ? raw.filenameTemplate
        : '{date}_{domain}',
    destination,
    destinationMode,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
  };
}

export function deserializePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(deserializePreset)
    .filter((preset): preset is Preset => preset !== null)
    .slice(0, PRESET_LIMIT);
}

export class PresetStore {
  constructor(private readonly area: KeyValueArea = localArea()) {}

  async list(): Promise<Preset[]> {
    const stored = await this.area.get(STORAGE_KEYS.presets);
    return deserializePresets(stored[STORAGE_KEYS.presets]);
  }

  async get(id: string): Promise<Preset | null> {
    return (await this.list()).find((preset) => preset.id === id) ?? null;
  }

  async save(preset: Preset): Promise<Preset[]> {
    const presets = await this.list();
    const index = presets.findIndex((existing) => existing.id === preset.id);
    const normalized = deserializePreset({ ...preset, updatedAt: Date.now() });
    if (!normalized) return presets;

    if (index >= 0) presets[index] = normalized;
    else if (presets.length < PRESET_LIMIT) presets.push(normalized);

    await this.area.set({ [STORAGE_KEYS.presets]: presets });
    return presets;
  }

  async remove(id: string): Promise<Preset[]> {
    const presets = (await this.list()).filter((preset) => preset.id !== id);
    await this.area.set({ [STORAGE_KEYS.presets]: presets });
    return presets;
  }

  /** Called once on install. Never overwrites presets the user already has. */
  async seedIfEmpty(now: number = Date.now()): Promise<void> {
    const existing = await this.area.get(STORAGE_KEYS.presets);
    if (existing[STORAGE_KEYS.presets] !== undefined) return;
    await this.area.set({ [STORAGE_KEYS.presets]: seedPresets(now) });
  }
}
