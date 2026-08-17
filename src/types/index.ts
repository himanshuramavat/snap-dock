/**
 * Domain types shared by every layer.
 *
 * These are deliberately free of Chrome, React and Google Drive specifics so the
 * capture/image/pdf engines can be unit-tested and reused independently of the UI
 * and of whichever storage provider is active.
 */

/* ------------------------------------------------------------------ capture */

export type CaptureMode =
  /** What is on screen right now. */
  | 'visible'
  /** A user-dragged rectangle within the viewport. */
  | 'region'
  /** The whole document, scrolled and stitched. */
  | 'fullpage';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Raw output of the capture engine, before format/scale is applied. */
export interface CapturedImage {
  /** PNG data URL: a lossless intermediate, never re-encoded more than once. */
  dataUrl: string;
  width: number;
  height: number;
  /** Device pixel ratio the capture was taken at. */
  devicePixelRatio: number;
}

export interface PageContext {
  url: string;
  title: string;
  domain: string;
  capturedAt: number;
}

/* ------------------------------------------------------------------- output */

export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type OutputType = ImageFormat | 'pdf';

export interface ImageConfig {
  format: ImageFormat;
  /** 1-100. Ignored for PNG, which is always lossless. */
  quality: number;
  /** Multiplier applied to the captured pixels. 1 = native capture resolution. */
  scale: number;
}

/* ---------------------------------------------------------------------- pdf */

export type PaperSizeId = 'a4' | 'a3' | 'letter' | 'legal' | 'fit' | 'custom';
export type Orientation = 'portrait' | 'landscape';

export interface PdfConfig {
  paperSize: PaperSizeId;
  orientation: Orientation;
  /** Margin in millimetres, applied to all four edges. */
  marginMm: number;
  /** Content scale within the page, 0.1-1. */
  scale: number;
  /** Shrink the image so a page's worth fits entirely; otherwise fill the width. */
  fitToPage: boolean;
  /** Split tall captures across multiple pages instead of squeezing onto one. */
  multiPage: boolean;
  /** Only used when paperSize is 'custom'. Millimetres. */
  customWidthMm?: number;
  customHeightMm?: number;
}

/* ----------------------------------------------------------------- settings */

export interface FilenameConfig {
  /** Placeholder template, e.g. `Screenshot_{date}_{time}`. Extension is appended. */
  template: string;
}

/** Local-disk destination settings. Chrome can only write inside Downloads. */
export interface LocalSettings {
  /** Sub-folder under Downloads. Empty saves directly into Downloads. */
  subfolder: string;
  /** Show Chrome's save dialog for every capture instead of saving silently. */
  askEveryTime: boolean;
}

export interface AdvancedSettings {
  /** Milliseconds to wait after each scroll step so lazy content and animations settle. */
  scrollSettleMs: number;
  /** Hard cap on full-page height in CSS pixels; protects against runaway/infinite pages. */
  maxFullPageHeight: number;
  /** Hide position:fixed elements after the first segment so headers aren't repeated. */
  hideStickyElements: boolean;
  /** Open the uploaded file in a new tab as soon as the upload succeeds. */
  openAfterUpload: boolean;
  /** Show the preview step instead of uploading immediately. */
  previewBeforeSave: boolean;
}

export interface Settings {
  version: number;
  defaultCaptureMode: CaptureMode;
  defaultOutputType: OutputType;
  image: ImageConfig;
  pdf: PdfConfig;
  filename: FilenameConfig;
  local: LocalSettings;
  advanced: AdvancedSettings;
  /** Which destination or destinations captures are saved to. */
  destinationMode: DestinationMode;
}

/* ------------------------------------------------------------------ presets */

export interface Preset {
  id: string;
  name: string;
  captureMode: CaptureMode;
  outputType: OutputType;
  image: ImageConfig;
  pdf: PdfConfig;
  filenameTemplate: string;
  /** Pinned Drive folder, or null to use the global default. */
  destination: DestinationRef | null;
  /** Overrides the global destination mode, or null to follow it. */
  destinationMode: DestinationMode | null;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ storage */

/**
 * Where captures can be saved. `local` is the default because it needs no setup at
 * all; Google Drive is an opt-in upgrade for people who want their captures synced
 * and shareable.
 */
export type ProviderId = 'local' | 'google-drive';

/**
 * Where a capture is sent. `both` writes the same file to each destination, which is
 * the reason destinations are resolved as a list everywhere rather than as a single
 * value: one capture can legitimately have more than one home.
 */
export type DestinationMode = 'local' | 'google-drive' | 'both';

/** A folder within a storage provider. */
export interface RemoteFolder {
  id: string;
  name: string;
  /** Human-readable path for display, e.g. `My Drive / Screenshots`. */
  path: string;
  parentId: string | null;
}

/** A persisted pointer to where captures should be saved. */
export interface DestinationRef {
  providerId: ProviderId;
  folderId: string;
  folderName: string;
  folderPath: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  /**
   * Link that opens the file in the provider's web UI. Empty for local saves, which
   * have no web address; those carry `downloadId` instead.
   */
  webUrl: string;
  size: number;
  mimeType: string;
  /** Local saves only: lets the UI reveal the file in the OS file manager. */
  downloadId?: number;
  /** Local saves only: the path the file was written to, for display. */
  localPath?: string;
}

export interface ConnectionStatus {
  providerId: ProviderId;
  /** Always true for providers that need no authentication, such as local saving. */
  connected: boolean;
  /** Account label, e.g. an email address. Undefined when disconnected. */
  account?: string;
  /** True when the provider has been granted browse-anywhere access. */
  fullAccess?: boolean;
}

/* --------------------------------------------------------------------- jobs */

export type JobPhase =
  | 'idle'
  | 'preparing'
  | 'capturing'
  | 'stitching'
  | 'processing'
  | 'generating-pdf'
  | 'awaiting-preview'
  | 'uploading'
  | 'done'
  | 'error';

export interface JobProgress {
  phase: JobPhase;
  /** 0-1 within the current phase, or null when indeterminate. */
  ratio: number | null;
  /** Short status line shown under the progress bar. */
  label: string;
}

export interface CaptureRequest {
  captureMode: CaptureMode;
  outputType: OutputType;
  image: ImageConfig;
  pdf: PdfConfig;
  filenameTemplate: string;
  /** Every destination this capture should be written to. Never empty in practice. */
  destinations: DestinationRef[];
  tabId?: number;
  /** Skip the preview step regardless of the user's advanced setting. */
  skipPreview?: boolean;
  /** Region rectangle in CSS pixels, supplied when captureMode is 'region'. */
  region?: Rect;
}

/**
 * The outcome of writing to a single destination.
 *
 * Saving to two places can partly succeed, and pretending otherwise would be the
 * worst possible behaviour: the user needs to know their capture reached the disk even
 * when the Drive upload failed, and needs to be able to retry only the part that
 * failed.
 */
export interface SaveOutcome {
  providerId: ProviderId;
  status: 'saved' | 'failed' | 'skipped';
  file?: UploadedFile;
  /** Present for 'failed' and 'skipped'; already user-facing text. */
  message?: string;
  /** Whether retrying this destination alone is worth offering. */
  retryable?: boolean;
}

export interface JobResult {
  filename: string;
  bytes: number;
  outcomes: SaveOutcome[];
}
