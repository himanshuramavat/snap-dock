import type { ProviderId } from '@/types';
import { AppError } from '@/utils/errors';
import type { StorageProvider } from './StorageProvider';
import { GoogleDriveProvider } from './google-drive/GoogleDriveProvider';
import { LocalProvider } from './local/LocalProvider';

/**
 * Provider registry.
 *
 * Two providers ship today: the device's own Downloads folder (the default, needing
 * no setup) and Google Drive (opt-in). The rest of the app asks for "the provider for
 * this destination" rather than importing either directly, which is what let local
 * saving be added without touching the capture, image, PDF or filename layers.
 *
 * Adding Dropbox, OneDrive or S3 later is one `register()` call plus a class.
 */

const providers = new Map<ProviderId, StorageProvider>();

export function register(provider: StorageProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: ProviderId): StorageProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new AppError('NOT_CONNECTED', { details: `No provider registered for "${id}"` });
  }
  return provider;
}

export function listProviders(): StorageProvider[] {
  return [...providers.values()];
}

register(new LocalProvider());
register(new GoogleDriveProvider());

/** Named exports for the few call sites that need provider-specific helpers. */
export const googleDrive = getProvider('google-drive') as GoogleDriveProvider;
export const localDisk = getProvider('local') as LocalProvider;

/** The destination used when the user has expressed no preference. */
export const DEFAULT_PROVIDER_ID = 'local' as const;
