import type { DestinationRef } from '@/types';
import { STORAGE_KEYS, localArea, type KeyValueArea } from '@/utils/storageArea';

/**
 * The chosen save location, persisted across sessions and browser restarts.
 *
 * Kept separate from Settings because it is provider-scoped state rather than a
 * preference: when a second provider is added, this becomes a map keyed by provider
 * id without disturbing the settings schema.
 */

function isValid(value: unknown): value is DestinationRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.providerId === 'google-drive' &&
    typeof candidate.folderId === 'string' &&
    candidate.folderId.length > 0 &&
    typeof candidate.folderName === 'string'
  );
}

export class DestinationStore {
  constructor(private readonly area: KeyValueArea = localArea()) {}

  async get(): Promise<DestinationRef | null> {
    const stored = await this.area.get(STORAGE_KEYS.destination);
    const value = stored[STORAGE_KEYS.destination];
    return isValid(value) ? value : null;
  }

  async set(destination: DestinationRef): Promise<void> {
    await this.area.set({ [STORAGE_KEYS.destination]: destination });
  }

  async clear(): Promise<void> {
    await this.area.remove(STORAGE_KEYS.destination);
  }
}
