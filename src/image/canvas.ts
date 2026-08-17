import type { ImageFormat } from '@/types';
import { AppError } from '@/utils/errors';

/**
 * Canvas primitives, written against OffscreenCanvas so every pixel operation runs
 * in the service worker. Nothing here touches the DOM, which is what lets SnapDock
 * capture, stitch, encode and build PDFs without an offscreen document and without
 * ever blocking the popup.
 */

/** Chrome refuses canvases beyond these bounds; hitting them must be a clean error. */
export const MAX_CANVAS_SIDE = 65535;
export const MAX_CANVAS_AREA = 268_435_456; // 2^28 pixels

export const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function assertCanvasSize(width: number, height: number): void {
  if (width < 1 || height < 1) {
    throw new AppError('IMAGE_PROCESSING_FAILED', {
      details: `Invalid canvas size ${width}x${height}`,
    });
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_AREA) {
    throw new AppError('PAGE_TOO_LARGE', {
      details: `Canvas ${width}x${height} exceeds the browser limit`,
    });
  }
}

export function createCanvas(width: number, height: number): OffscreenCanvas {
  assertCanvasSize(width, height);
  return new OffscreenCanvas(Math.round(width), Math.round(height));
}

export function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', {
    // Captures are opaque; skipping alpha lets the compositor take a faster path.
    alpha: false,
    willReadFrequently: false,
  });
  if (!ctx) {
    throw new AppError('IMAGE_PROCESSING_FAILED', { details: 'No 2D context available' });
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Encodes a canvas. PNG ignores the quality argument by definition; for JPEG and
 * WebP the 1-100 setting maps onto the 0-1 the platform expects.
 */
export async function encodeCanvas(
  canvas: OffscreenCanvas,
  format: ImageFormat,
  quality: number,
): Promise<Blob> {
  const options: ImageEncodeOptions = { type: MIME_BY_FORMAT[format] };
  if (format !== 'png') {
    options.quality = Math.min(1, Math.max(0.01, quality / 100));
  }
  try {
    return await canvas.convertToBlob(options);
  } catch (cause) {
    throw new AppError('IMAGE_PROCESSING_FAILED', {
      cause,
      details: `convertToBlob failed for ${format}`,
    });
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return `data:${blob.type};base64,${base64FromBytes(new Uint8Array(buffer))}`;
}

export async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = dataUrlToBlob(dataUrl);
  try {
    return await createImageBitmap(blob);
  } catch (cause) {
    throw new AppError('IMAGE_PROCESSING_FAILED', { cause, details: 'Could not decode capture' });
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new AppError('IMAGE_PROCESSING_FAILED', { details: 'Malformed data URL' });
  }
  const [, mime, isBase64, payload] = match;
  if (!isBase64) {
    return new Blob([decodeURIComponent(payload!)], { type: mime });
  }
  const binary = atob(payload!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Chunked so a multi-megabyte capture doesn't blow the argument limit of apply(). */
export function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * zlib-compresses bytes using the platform's CompressionStream.
 *
 * 'deflate' produces the zlib container (RFC 1950), which is exactly what a PDF
 * /FlateDecode stream expects, so lossless PDF pages need no compression library.
 */
export async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const compressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(compressed);
}

/**
 * Flattens a canvas region to packed 24-bit RGB, compositing any transparency onto
 * white. PDF image XObjects have no alpha channel without a separate soft mask, and
 * a white backdrop matches how the page was rendered on screen.
 */
export function extractRgb(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const { data } = ctx.getImageData(x, y, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    const alpha = data[i + 3]!;
    if (alpha === 255) {
      rgb[o] = data[i]!;
      rgb[o + 1] = data[i + 1]!;
      rgb[o + 2] = data[i + 2]!;
    } else {
      const a = alpha / 255;
      rgb[o] = Math.round(data[i]! * a + 255 * (1 - a));
      rgb[o + 1] = Math.round(data[i + 1]! * a + 255 * (1 - a));
      rgb[o + 2] = Math.round(data[i + 2]! * a + 255 * (1 - a));
    }
  }
  return rgb;
}
