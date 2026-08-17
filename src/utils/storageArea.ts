/**
 * A minimal slice of chrome.storage.StorageArea.
 *
 * Stores depend on this instead of the global `chrome` object so business logic
 * stays unit-testable in plain Node without a browser mock framework.
 */
export interface KeyValueArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type StorageChangeListener = (changes: Record<string, chrome.storage.StorageChange>) => void;

/** chrome.storage.local: survives browser restarts. */
export function localArea(): KeyValueArea {
  return chrome.storage.local as unknown as KeyValueArea;
}

/** chrome.storage.session: in-memory, cleared on browser restart, never on disk. */
export function sessionArea(): KeyValueArea {
  return chrome.storage.session as unknown as KeyValueArea;
}

/** In-memory implementation used by tests. */
export function memoryArea(seed: Record<string, unknown> = {}): KeyValueArea {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    async get(keys) {
      if (keys === null) return Object.fromEntries(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (data.has(key)) out[key] = data.get(key);
      }
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        // Round-trip through JSON to mirror the structured-clone boundary chrome
        // enforces, so tests catch accidentally storing non-serializable values.
        data.set(key, JSON.parse(JSON.stringify(value)));
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
  };
}

export const STORAGE_KEYS = {
  settings: 'snapdock.settings',
  presets: 'snapdock.presets',
  destination: 'snapdock.destination',
  /** Absolute directory of the last local save, learned from the download item. */
  localDirectory: 'snapdock.localDirectory',
  connection: 'snapdock.connection',
  /** Session-scoped: the in-flight capture job, so the popup can reattach. */
  activeJob: 'snapdock.activeJob',
  /**
   * Session-scoped: short-lived OAuth access token, Firefox only. Memory only, cleared
   * on browser restart, never written to disk. Chromium keeps its own token cache and
   * never uses this key.
   */
  authToken: 'snapdock.authToken',
  /** Session-scoped: the last capture awaiting preview confirmation. */
  pendingCapture: 'snapdock.pendingCapture',
} as const;
