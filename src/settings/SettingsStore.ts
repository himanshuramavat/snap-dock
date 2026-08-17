import type { Settings } from '@/types';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './defaults';
import { normalizeSettings } from './schema';
import { STORAGE_KEYS, localArea, type KeyValueArea } from '@/utils/storageArea';

/**
 * Single source of truth for user preferences.
 *
 * Reads are cached in memory because the popup asks for settings on every open and
 * the extra storage round-trip is visible at that timescale. The cache is invalidated
 * by chrome.storage change events, so a change made in the options page is picked up
 * by an already-open popup and by the service worker.
 */
export class SettingsStore {
  private cache: Settings | null = null;

  constructor(private readonly area: KeyValueArea = localArea()) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const raw = await this.area.get(STORAGE_KEYS.settings);
    const settings = migrate(raw[STORAGE_KEYS.settings]);
    this.cache = settings;
    return settings;
  }

  /** Shallow-merges a partial update, validates the result, and persists it. */
  async update(patch: DeepPartial<Settings>): Promise<Settings> {
    const current = await this.get();
    const merged = normalizeSettings(deepMerge(current, patch));
    await this.area.set({ [STORAGE_KEYS.settings]: merged });
    this.cache = merged;
    return merged;
  }

  /**
   * Writes defaults if nothing is stored yet. Called once on install.
   *
   * Reading alone would work, since every read normalises undefined into defaults, but
   * persisting them means the stored state is explicit and inspectable, and gives a
   * future migration a concrete `version` to step forward from rather than having to
   * guess at an absent record.
   */
  async ensureInitialized(): Promise<Settings> {
    const stored = await this.area.get(STORAGE_KEYS.settings);
    if (stored[STORAGE_KEYS.settings] !== undefined) return this.get();
    await this.area.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    this.cache = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }

  async reset(): Promise<Settings> {
    await this.area.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    this.cache = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }

  /** Drops the memory cache; the next get() re-reads from storage. */
  invalidate(): void {
    this.cache = null;
  }

  /** Wires cache invalidation to storage events. Safe to call once per context. */
  watch(onChange?: (settings: Settings) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !(STORAGE_KEYS.settings in changes)) return;
      this.cache = null;
      if (onChange) void this.get().then(onChange);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}

/**
 * Applies forward migrations, then normalises.
 *
 * Migrations run in order and each one only reshapes fields; validation and defaulting
 * is left entirely to normalizeSettings, so a migration can be a small honest rename
 * rather than a second place that has to know every rule.
 */
function migrate(raw: unknown): Settings {
  if (raw === undefined) return DEFAULT_SETTINGS;

  let value: unknown = raw;
  const version =
    typeof value === 'object' && value !== null && typeof (value as { version?: unknown }).version === 'number'
      ? (value as { version: number }).version
      : 0;

  if (version < 2) value = migrateV1ToV2(value);

  void SETTINGS_VERSION;
  return normalizeSettings(value);
}

/**
 * v1 stored a single `activeProviderId`; v2 stores a `destinationMode` that can also
 * be "both". The old values map one-to-one, so nobody's choice is lost on upgrade.
 */
function migrateV1ToV2(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;

  const previous = raw as Record<string, unknown> & { activeProviderId?: unknown };
  if (previous.destinationMode !== undefined) return raw;

  const legacy = previous.activeProviderId;
  const destinationMode =
    legacy === 'google-drive' ? 'google-drive' : legacy === 'local' ? 'local' : undefined;

  const rest: Record<string, unknown> = { ...previous };
  delete rest.activeProviderId;
  return destinationMode ? { ...rest, destinationMode } : rest;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    const bothPlainObjects =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing);
    out[key] = bothPlainObjects
      ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out as T;
}

export { deepMerge };
