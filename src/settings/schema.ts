import type {
  AdvancedSettings,
  CaptureMode,
  DestinationMode,
  LocalSettings,
  ImageConfig,
  ImageFormat,
  Orientation,
  OutputType,
  PaperSizeId,
  PdfConfig,
  Settings,
} from '@/types';
import { DEFAULT_SETTINGS } from './defaults';

/**
 * Hand-rolled validation rather than a schema library.
 *
 * The shape is small and fixed, the rules are mostly numeric clamping, and a
 * validator dependency would be pure bundle cost in a popup that must open instantly.
 */

const CAPTURE_MODES: readonly CaptureMode[] = ['visible', 'region', 'fullpage'];
const IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'webp'];
const OUTPUT_TYPES: readonly OutputType[] = ['png', 'jpeg', 'webp', 'pdf'];
const PAPER_SIZES: readonly PaperSizeId[] = ['a4', 'a3', 'letter', 'legal', 'fit', 'custom'];
const DESTINATION_MODES: readonly DestinationMode[] = ['local', 'google-drive', 'both'];
const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'];

export const LIMITS = {
  quality: { min: 1, max: 100 },
  imageScale: { min: 0.25, max: 4 },
  pdfScale: { min: 0.1, max: 1 },
  marginMm: { min: 0, max: 50 },
  customPaperMm: { min: 10, max: 2000 },
  scrollSettleMs: { min: 0, max: 2000 },
  subfolderLength: { min: 0, max: 120 },
  maxFullPageHeight: { min: 2000, max: 100000 },
} as const;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeImageConfig(input: unknown, base: ImageConfig): ImageConfig {
  const raw = isRecord(input) ? input : {};
  return {
    format: pick(raw.format, IMAGE_FORMATS, base.format),
    quality: Math.round(clamp(num(raw.quality, base.quality), LIMITS.quality.min, LIMITS.quality.max)),
    scale: clamp(num(raw.scale, base.scale), LIMITS.imageScale.min, LIMITS.imageScale.max),
  };
}

export function normalizePdfConfig(input: unknown, base: PdfConfig): PdfConfig {
  const raw = isRecord(input) ? input : {};
  const paperSize = pick(raw.paperSize, PAPER_SIZES, base.paperSize);

  const config: PdfConfig = {
    paperSize,
    orientation: pick(raw.orientation, ORIENTATIONS, base.orientation),
    marginMm: clamp(num(raw.marginMm, base.marginMm), LIMITS.marginMm.min, LIMITS.marginMm.max),
    scale: clamp(num(raw.scale, base.scale), LIMITS.pdfScale.min, LIMITS.pdfScale.max),
    fitToPage: bool(raw.fitToPage, base.fitToPage),
    multiPage: bool(raw.multiPage, base.multiPage),
  };

  if (paperSize === 'custom') {
    const { min, max } = LIMITS.customPaperMm;
    config.customWidthMm = clamp(num(raw.customWidthMm, base.customWidthMm ?? 210), min, max);
    config.customHeightMm = clamp(num(raw.customHeightMm, base.customHeightMm ?? 297), min, max);
  }

  return config;
}

function normalizeLocal(input: unknown, base: LocalSettings): LocalSettings {
  const raw = isRecord(input) ? input : {};
  const subfolder = typeof raw.subfolder === 'string' ? raw.subfolder : base.subfolder;
  return {
    // Path safety is enforced again at save time by sanitizeSubfolder; this only
    // keeps obviously unusable values out of storage and out of the settings UI.
    subfolder: subfolder.slice(0, LIMITS.subfolderLength.max),
    askEveryTime: bool(raw.askEveryTime, base.askEveryTime),
  };
}

function normalizeAdvanced(input: unknown, base: AdvancedSettings): AdvancedSettings {
  const raw = isRecord(input) ? input : {};
  return {
    scrollSettleMs: Math.round(
      clamp(num(raw.scrollSettleMs, base.scrollSettleMs), LIMITS.scrollSettleMs.min, LIMITS.scrollSettleMs.max),
    ),
    maxFullPageHeight: Math.round(
      clamp(
        num(raw.maxFullPageHeight, base.maxFullPageHeight),
        LIMITS.maxFullPageHeight.min,
        LIMITS.maxFullPageHeight.max,
      ),
    ),
    hideStickyElements: bool(raw.hideStickyElements, base.hideStickyElements),
    openAfterUpload: bool(raw.openAfterUpload, base.openAfterUpload),
    previewBeforeSave: bool(raw.previewBeforeSave, base.previewBeforeSave),
  };
}

/**
 * Coerces anything read out of chrome.storage into a complete, valid Settings object.
 * Unknown or corrupted fields fall back to defaults rather than throwing, so a bad
 * write can never lock the user out of the extension.
 */
export function normalizeSettings(input: unknown): Settings {
  const raw = isRecord(input) ? input : {};
  const base = DEFAULT_SETTINGS;
  const filename = isRecord(raw.filename) ? raw.filename : {};

  return {
    version: base.version,
    defaultCaptureMode: pick(raw.defaultCaptureMode, CAPTURE_MODES, base.defaultCaptureMode),
    defaultOutputType: pick(raw.defaultOutputType, OUTPUT_TYPES, base.defaultOutputType),
    image: normalizeImageConfig(raw.image, base.image),
    pdf: normalizePdfConfig(raw.pdf, base.pdf),
    filename: {
      template:
        typeof filename.template === 'string' && filename.template.trim()
          ? filename.template
          : base.filename.template,
    },
    local: normalizeLocal(raw.local, base.local),
    advanced: normalizeAdvanced(raw.advanced, base.advanced),
    destinationMode: pick(raw.destinationMode, DESTINATION_MODES, base.destinationMode),
  };
}
