import type { ImageConfig, PdfConfig, Settings } from '@/types';

/**
 * Bumped whenever a migration is needed. See migrate() in SettingsStore.
 * v2 replaced `activeProviderId` with `destinationMode`, which added "Both".
 */
export const SETTINGS_VERSION = 2;

export const DEFAULT_FILENAME_TEMPLATE = 'Screenshot_{date}_{time}';

/** Quality-first defaults: lossless PNG at native capture resolution. */
export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  format: 'png',
  quality: 95,
  scale: 1,
};

export const DEFAULT_PDF_CONFIG: PdfConfig = {
  paperSize: 'a4',
  orientation: 'portrait',
  marginMm: 10,
  scale: 1,
  fitToPage: true,
  multiPage: true,
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  defaultCaptureMode: 'visible',
  defaultOutputType: 'png',
  image: DEFAULT_IMAGE_CONFIG,
  pdf: DEFAULT_PDF_CONFIG,
  filename: { template: DEFAULT_FILENAME_TEMPLATE },
  local: {
    // A named sub-folder keeps captures out of the general Downloads clutter.
    subfolder: 'SnapDock',
    askEveryTime: false,
  },
  advanced: {
    scrollSettleMs: 220,
    maxFullPageHeight: 32000,
    hideStickyElements: true,
    openAfterUpload: false,
    previewBeforeSave: false,
  },
  /*
   * Local saving is the default so the extension works the moment it is installed.
   * Requiring a Google Cloud project before the first screenshot would be a strange
   * thing to ask of someone who just wants a screenshot. Configurable in Settings.
   */
  destinationMode: 'local',
};
