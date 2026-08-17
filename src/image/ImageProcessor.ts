import type { ImageConfig, ImageFormat } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import { blobToDataUrl, context2d, createCanvas, encodeCanvas } from './canvas';

/**
 * Applies the user's output configuration to a captured canvas.
 *
 * The capture engine always produces lossless pixels; this is the single place
 * where anything lossy happens, so an image is compressed exactly once no matter how
 * many stages it passed through on the way here.
 */

export interface RenderedImage {
  blob: Blob;
  width: number;
  height: number;
  format: ImageFormat;
}

/** Longest edge of the preview shown in the popup. */
const PREVIEW_MAX_EDGE = 900;

export async function renderImage(
  source: OffscreenCanvas,
  config: ImageConfig,
): Promise<RenderedImage> {
  try {
    const scaled = config.scale === 1 ? source : resample(source, config.scale);
    const blob = await encodeCanvas(scaled, config.format, config.quality);
    return { blob, width: scaled.width, height: scaled.height, format: config.format };
  } catch (error) {
    throw toAppError(error, 'IMAGE_PROCESSING_FAILED');
  }
}

/**
 * Resizes in one step.
 *
 * Chrome's `high` image-smoothing quality already applies a proper filter kernel for
 * both up- and downscaling, so the usual "halve repeatedly" trick would cost extra
 * allocations and passes without improving the result.
 */
function resample(source: OffscreenCanvas, scale: number): OffscreenCanvas {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const target = createCanvas(width, height);
  const ctx = context2d(target);
  ctx.drawImage(source, 0, 0, width, height);
  return target;
}

/**
 * Builds the small image shown in the preview step.
 *
 * Deliberately lossy and small: it crosses into session storage, which has a hard
 * quota, and a 40 MB full-page capture must not be duplicated there just to be
 * looked at. The full-resolution result stays in the worker's memory.
 */
export async function renderPreview(
  source: OffscreenCanvas,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const longest = Math.max(source.width, source.height);
  const scale = longest > PREVIEW_MAX_EDGE ? PREVIEW_MAX_EDGE / longest : 1;
  const preview = scale === 1 ? source : resample(source, scale);
  const blob = await encodeCanvas(preview, 'jpeg', 78);
  return { dataUrl: await blobToDataUrl(blob), width: preview.width, height: preview.height };
}

/** Guards against configurations that would produce an unusably large output. */
export function assertRenderable(source: OffscreenCanvas, config: ImageConfig): void {
  const pixels = source.width * config.scale * source.height * config.scale;
  if (pixels > 268_435_456) {
    throw new AppError('PAGE_TOO_LARGE', {
      details: `Scaled output would be ${Math.round(pixels / 1e6)} megapixels`,
      userMessage:
        'That capture is too large at this scale. Lower the scale in Settings, or capture a smaller area.',
    });
  }
}
