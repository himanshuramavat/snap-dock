import type { Orientation, PaperSizeId, PdfConfig } from '@/types';

/** PDF user-space units are points: 72 per inch. */
export const MM_TO_PT = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

export interface PaperDefinition {
  id: PaperSizeId;
  label: string;
  /** Portrait dimensions in millimetres. */
  widthMm: number;
  heightMm: number;
}

export const PAPER_SIZES: readonly PaperDefinition[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal', label: 'Legal', widthMm: 215.9, heightMm: 355.6 },
  { id: 'fit', label: 'Fit to image', widthMm: 0, heightMm: 0 },
  { id: 'custom', label: 'Custom', widthMm: 0, heightMm: 0 },
];

export interface PageGeometry {
  /** Page box in points. */
  widthPt: number;
  heightPt: number;
  /** Printable area in points, after margins. */
  contentWidthPt: number;
  contentHeightPt: number;
  marginPt: number;
}

/**
 * Resolves the configured paper size into concrete point dimensions.
 *
 * `fit` sizes the page to the image itself (at 96 CSS px per inch, matching how the
 * page was rendered), which produces a single-page PDF with no letterboxing: the
 * right choice for a long screenshot that should not be chopped up.
 */
export function resolvePageGeometry(
  config: PdfConfig,
  image: { width: number; height: number },
): PageGeometry {
  const marginPt = mmToPt(config.marginMm);

  let widthPt: number;
  let heightPt: number;

  if (config.paperSize === 'fit') {
    // 96 px per inch is the CSS reference pixel density.
    const pxToPt = 72 / 96;
    widthPt = image.width * pxToPt + marginPt * 2;
    heightPt = image.height * pxToPt + marginPt * 2;
  } else {
    const definition =
      config.paperSize === 'custom'
        ? {
            widthMm: config.customWidthMm ?? 210,
            heightMm: config.customHeightMm ?? 297,
          }
        : (PAPER_SIZES.find((paper) => paper.id === config.paperSize) ?? PAPER_SIZES[0]!);

    widthPt = mmToPt(definition.widthMm);
    heightPt = mmToPt(definition.heightMm);

    if (config.orientation === 'landscape') {
      [widthPt, heightPt] = [heightPt, widthPt];
    }
  }

  // Guard against margins larger than the page, which would produce a negative box.
  const contentWidthPt = Math.max(1, widthPt - marginPt * 2);
  const contentHeightPt = Math.max(1, heightPt - marginPt * 2);

  return { widthPt, heightPt, contentWidthPt, contentHeightPt, marginPt };
}

export interface PagePlacement {
  /** Source pixel row this page starts at. */
  sourceY: number;
  /** Source pixel rows covered by this page. */
  sourceHeight: number;
  /** Destination rectangle in points, origin at the page's bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Works out how the captured image maps onto one or more pages.
 *
 * The image is scaled to the content width (times the user's scale factor) and then,
 * if it is taller than the page and multi-page output is enabled, sliced into
 * page-height bands. Slicing happens in source pixels so no page boundary falls
 * inside a resampled row.
 */
export function planPages(
  config: PdfConfig,
  image: { width: number; height: number },
  geometry: PageGeometry,
): PagePlacement[] {
  const scale = Math.max(0.1, Math.min(1, config.scale));
  const targetWidthPt = geometry.contentWidthPt * scale;
  const ptPerSourcePx = targetWidthPt / image.width;
  const fullHeightPt = image.height * ptPerSourcePx;

  const centreX = geometry.marginPt + (geometry.contentWidthPt - targetWidthPt) / 2;

  // Single page: either it already fits, or the user asked us not to split it.
  if (!config.multiPage || fullHeightPt <= geometry.contentHeightPt + 0.5) {
    let width = targetWidthPt;
    let height = fullHeightPt;

    if (config.fitToPage && height > geometry.contentHeightPt) {
      // Shrink uniformly so the whole image fits within the printable area.
      const shrink = geometry.contentHeightPt / height;
      width *= shrink;
      height *= shrink;
    }

    return [
      {
        sourceY: 0,
        sourceHeight: image.height,
        x: geometry.marginPt + (geometry.contentWidthPt - width) / 2,
        // PDF origin is bottom-left, so the top margin is measured from the top edge.
        y: geometry.heightPt - geometry.marginPt - height,
        width,
        height,
      },
    ];
  }

  const sourcePxPerPage = Math.max(1, Math.floor(geometry.contentHeightPt / ptPerSourcePx));
  const pages: PagePlacement[] = [];

  for (let sourceY = 0; sourceY < image.height; sourceY += sourcePxPerPage) {
    const sourceHeight = Math.min(sourcePxPerPage, image.height - sourceY);
    const height = sourceHeight * ptPerSourcePx;
    pages.push({
      sourceY,
      sourceHeight,
      x: centreX,
      y: geometry.heightPt - geometry.marginPt - height,
      width: targetWidthPt,
      height,
    });
  }

  return pages;
}
