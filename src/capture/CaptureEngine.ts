import type { AdvancedSettings, CaptureMode, PageContext, Rect } from '@/types';
import { AppError } from '@/utils/errors';
import { context2d, createCanvas, dataUrlToBitmap } from '@/image/canvas';
import { extractDomain } from '@/filename/template';
import {
  beginCaptureMode,
  endCaptureMode,
  hidePinnedElements,
  measurePage,
  scrollToOffset,
  type PageMetrics,
} from './pageProbe';
import { captureVisibleTab, inject, resolveTargetTab, sleep } from './tabCapture';

/**
 * The capture engine.
 *
 * It knows about tabs, scrolling and pixels, and nothing about output formats,
 * filenames or where the result is going. Everything it returns is a canvas plus the
 * page context that produced it.
 */

export interface CaptureOutput {
  canvas: OffscreenCanvas;
  page: PageContext;
  /** Set when a page exceeded the height limit and only its top was captured. */
  truncated: boolean;
}

export interface CaptureOptions {
  mode: CaptureMode;
  tabId?: number;
  region?: Rect;
  advanced: AdvancedSettings;
  onProgress?: (ratio: number, label: string) => void;
  signal?: AbortSignal;
}

/** Elements scanned when looking for sticky furniture; bounded for very large DOMs. */
const MAX_PINNED_SCAN = 8000;

function pageContext(metrics: PageMetrics): PageContext {
  return {
    url: metrics.url,
    title: metrics.title,
    domain: extractDomain(metrics.url),
    capturedAt: Date.now(),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('CAPTURE_CANCELLED');
}

export async function capture(options: CaptureOptions): Promise<CaptureOutput> {
  const tab = await resolveTargetTab(options.tabId);
  const tabId = tab.id!;
  const metrics = await inject(tabId, measurePage, []);

  switch (options.mode) {
    case 'visible':
      return captureViewport(tabId, tab.windowId, metrics, null, options);
    case 'region': {
      if (!options.region) throw new AppError('CAPTURE_CANCELLED');
      return captureViewport(tabId, tab.windowId, metrics, options.region, options);
    }
    case 'fullpage':
      return captureFullPage(tabId, tab.windowId, metrics, options);
    default:
      throw new AppError('CAPTURE_FAILED', { details: `Unknown mode ${String(options.mode)}` });
  }
}

/**
 * Single-shot capture of what is on screen, optionally cropped to a region.
 *
 * The pixel ratio is derived from the returned bitmap rather than from
 * window.devicePixelRatio, because browser zoom changes the relationship between CSS
 * pixels and captured pixels and only the bitmap knows the truth.
 */
async function captureViewport(
  tabId: number,
  windowId: number,
  metrics: PageMetrics,
  region: Rect | null,
  options: CaptureOptions,
): Promise<CaptureOutput> {
  options.onProgress?.(0.2, 'Capturing');
  throwIfAborted(options.signal);

  const dataUrl = await captureVisibleTab(windowId);
  const bitmap = await dataUrlToBitmap(dataUrl);

  try {
    const ratio = bitmap.width / metrics.innerWidth;

    const source = region
      ? {
          x: Math.round(region.x * ratio),
          y: Math.round(region.y * ratio),
          width: Math.round(region.width * ratio),
          height: Math.round(region.height * ratio),
        }
      : {
          x: 0,
          y: 0,
          // Crop the scrollbar gutter so it never shows up as a grey stripe.
          width: Math.round(metrics.clientWidth * ratio),
          height: Math.round(metrics.clientHeight * ratio),
        };

    // Clamp to the bitmap so a stale region (page resized mid-flow) cannot produce
    // an empty or out-of-bounds draw.
    source.width = Math.max(1, Math.min(source.width, bitmap.width - source.x));
    source.height = Math.max(1, Math.min(source.height, bitmap.height - source.y));

    if (source.x >= bitmap.width || source.y >= bitmap.height) {
      throw new AppError('CAPTURE_FAILED', { details: 'Selected region is outside the page' });
    }

    const canvas = createCanvas(source.width, source.height);
    context2d(canvas).drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      source.width,
      source.height,
    );

    options.onProgress?.(1, 'Captured');
    return { canvas, page: pageContext(metrics), truncated: false };
  } finally {
    bitmap.close();
  }
}

/**
 * Scroll-and-stitch capture of the whole document.
 *
 * The loop is driven by the scroll position the page actually reaches, not by the
 * position requested. That single decision handles most of the awkward cases at
 * once: short final segments, pages that clamp scrolling, and documents that grow
 * while being captured. Bands are composited at their true offsets, so any overlap
 * simply overwrites identical pixels instead of producing a visible seam.
 */
async function captureFullPage(
  tabId: number,
  windowId: number,
  metrics: PageMetrics,
  options: CaptureOptions,
): Promise<CaptureOutput> {
  const { advanced } = options;
  const viewportHeight = metrics.clientHeight;

  if (viewportHeight < 1) {
    throw new AppError('CAPTURE_FAILED', { details: 'Viewport has no height' });
  }

  let totalHeight = metrics.scrollHeight;
  let truncated = false;
  if (totalHeight > advanced.maxFullPageHeight) {
    totalHeight = advanced.maxFullPageHeight;
    truncated = true;
  }

  await inject(tabId, beginCaptureMode, []);

  let canvas: OffscreenCanvas | null = null;

  try {
    // Pre-pass: walk the page once without capturing so lazy-loaded images and
    // virtualised lists have rendered before the real pass starts. Skipped on short
    // pages, where it would just add latency.
    if (totalHeight > viewportHeight * 2) {
      options.onProgress?.(0.05, 'Loading page content');
      for (let y = 0; y < totalHeight; y += viewportHeight) {
        throwIfAborted(options.signal);
        const result = await inject(tabId, scrollToOffset, [y]);
        // The page may grow as content loads in; follow it, within the cap.
        if (result.scrollHeight > totalHeight && result.scrollHeight <= advanced.maxFullPageHeight) {
          totalHeight = result.scrollHeight;
        } else if (result.scrollHeight > advanced.maxFullPageHeight) {
          totalHeight = advanced.maxFullPageHeight;
          truncated = true;
        }
        await sleep(60);
      }
      await inject(tabId, scrollToOffset, [0]);
      await sleep(advanced.scrollSettleMs);
    }

    let ratio = 0;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let previousScrollY = -1;
    let segmentIndex = 0;
    const estimatedSegments = Math.max(1, Math.ceil(totalHeight / viewportHeight));

    for (let target = 0; ; target += viewportHeight) {
      throwIfAborted(options.signal);

      const { scrollY } = await inject(tabId, scrollToOffset, [target]);

      // The page refused to scroll any further: we are at the bottom, or the
      // document is not the scrolling element. Either way, stop cleanly.
      if (segmentIndex > 0 && scrollY <= previousScrollY) break;
      previousScrollY = scrollY;

      await sleep(advanced.scrollSettleMs);
      throwIfAborted(options.signal);

      options.onProgress?.(
        0.1 + 0.75 * Math.min(1, segmentIndex / estimatedSegments),
        `Capturing section ${segmentIndex + 1} of ~${estimatedSegments}`,
      );

      const dataUrl = await captureVisibleTab(windowId);
      const bitmap = await dataUrlToBitmap(dataUrl);

      try {
        if (!canvas) {
          ratio = bitmap.width / metrics.innerWidth;
          canvas = createCanvas(
            Math.round(metrics.clientWidth * ratio),
            Math.round(totalHeight * ratio),
          );
          ctx = context2d(canvas);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const sourceWidth = Math.min(bitmap.width, Math.round(metrics.clientWidth * ratio));
        const destY = Math.round(scrollY * ratio);
        // drawImage clips at the canvas edge, so an over-tall final band is fine.
        ctx!.drawImage(
          bitmap,
          0,
          0,
          sourceWidth,
          bitmap.height,
          0,
          destY,
          sourceWidth,
          bitmap.height,
        );
      } finally {
        bitmap.close();
      }

      // Sticky furniture is captured once, in the first band, and hidden thereafter.
      if (segmentIndex === 0 && advanced.hideStickyElements) {
        await inject(tabId, hidePinnedElements, [MAX_PINNED_SCAN]);
        await sleep(50);
      }

      segmentIndex += 1;

      const reachedBottom = scrollY + viewportHeight >= totalHeight - 1;
      if (reachedBottom) break;

      // Backstop against a page that keeps growing (infinite scroll).
      if (segmentIndex > Math.ceil(advanced.maxFullPageHeight / viewportHeight) + 2) {
        truncated = true;
        break;
      }
    }

    if (!canvas) throw new AppError('CAPTURE_FAILED', { details: 'No segments captured' });

    options.onProgress?.(1, 'Stitched');
    return { canvas, page: pageContext(metrics), truncated };
  } finally {
    // Always put the page back the way we found it, even on failure or cancellation.
    await inject(tabId, endCaptureMode, [metrics.scrollX, metrics.scrollY]).catch(() => undefined);
  }
}
