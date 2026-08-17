import type { PdfConfig } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import { context2d, createCanvas, deflate, extractRgb } from '@/image/canvas';
import { PdfDocument, type PdfImage } from './PdfDocument';
import { planPages, resolvePageGeometry } from './paper';

/**
 * Turns a rendered capture into a PDF.
 *
 * Kept separate from PdfDocument so the layout policy (paper size, slicing,
 * compression choice) can evolve without touching the file-format writer.
 */

export type PdfImageSource = OffscreenCanvas | ImageBitmap;

export interface PdfBuildOptions {
  config: PdfConfig;
  /** 1-100. 100 selects lossless compression; anything lower embeds JPEG. */
  quality: number;
  title?: string;
  createdAt: number;
  onProgress?: (completedPages: number, totalPages: number) => void;
}

export interface PdfBuildResult {
  blob: Blob;
  pageCount: number;
}

function sourceSize(source: PdfImageSource): { width: number; height: number } {
  return { width: source.width, height: source.height };
}

/**
 * Renders each page band and embeds it.
 *
 * Quality 100 takes the lossless route: raw RGB, zlib-compressed, embedded as
 * /FlateDecode. Below 100 the band is JPEG-encoded and its bytes are embedded
 * verbatim as /DCTDecode, so the image is compressed exactly once on its way into
 * the document rather than being decoded and re-encoded by a PDF library.
 */
export async function buildPdf(
  source: PdfImageSource,
  options: PdfBuildOptions,
): Promise<PdfBuildResult> {
  const { config, quality } = options;
  const image = sourceSize(source);

  if (image.width < 1 || image.height < 1) {
    throw new AppError('PDF_GENERATION_FAILED', { details: 'Empty capture' });
  }

  const geometry = resolvePageGeometry(config, image);
  const placements = planPages(config, image, geometry);

  const document = new PdfDocument({
    ...(options.title ? { title: options.title } : {}),
    createdAt: options.createdAt,
  });

  // One reusable canvas per distinct band height keeps allocation churn down on
  // long documents, where every band but the last has identical dimensions.
  let bandCanvas: OffscreenCanvas | null = null;

  try {
    for (const [index, placement] of placements.entries()) {
      const bandWidth = image.width;
      const bandHeight = placement.sourceHeight;

      if (!bandCanvas || bandCanvas.width !== bandWidth || bandCanvas.height !== bandHeight) {
        bandCanvas = createCanvas(bandWidth, bandHeight);
      }

      const ctx = context2d(bandCanvas);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, bandWidth, bandHeight);
      ctx.drawImage(
        source as CanvasImageSource,
        0,
        placement.sourceY,
        bandWidth,
        bandHeight,
        0,
        0,
        bandWidth,
        bandHeight,
      );

      const embedded = await encodeBand(bandCanvas, ctx, quality);
      document.addImagePage(
        embedded,
        { widthPt: geometry.widthPt, heightPt: geometry.heightPt },
        placement,
      );

      options.onProgress?.(index + 1, placements.length);

      // Yield between pages so a long document cannot starve the service worker's
      // message loop (which would stall progress updates to the popup).
      if (index % 4 === 3) await Promise.resolve();
    }

    return { blob: document.build(), pageCount: document.pageCount };
  } catch (error) {
    throw toAppError(error, 'PDF_GENERATION_FAILED');
  }
}

async function encodeBand(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  quality: number,
): Promise<PdfImage> {
  if (quality >= 100) {
    const rgb = extractRgb(ctx, 0, 0, canvas.width, canvas.height);
    return {
      data: await deflate(rgb),
      width: canvas.width,
      height: canvas.height,
      filter: 'FlateDecode',
    };
  }

  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: Math.min(1, Math.max(0.01, quality / 100)),
  });
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
    filter: 'DCTDecode',
  };
}
