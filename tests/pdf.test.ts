import { describe, expect, it } from 'vitest';
import type { PdfConfig } from '@/types';
import { DEFAULT_PDF_CONFIG } from '@/settings/defaults';
import { MM_TO_PT, mmToPt, planPages, resolvePageGeometry } from '@/pdf/paper';
import { PdfDocument, type PdfImage } from '@/pdf/PdfDocument';

const config = (overrides: Partial<PdfConfig> = {}): PdfConfig => ({
  ...DEFAULT_PDF_CONFIG,
  ...overrides,
});

/** A4 at 72 dpi, to three decimal places. */
const A4_WIDTH_PT = 210 * MM_TO_PT;
const A4_HEIGHT_PT = 297 * MM_TO_PT;

describe('resolvePageGeometry', () => {
  it('produces A4 in points', () => {
    const geometry = resolvePageGeometry(config({ marginMm: 0 }), { width: 1000, height: 1000 });
    expect(geometry.widthPt).toBeCloseTo(A4_WIDTH_PT, 3);
    expect(geometry.heightPt).toBeCloseTo(A4_HEIGHT_PT, 3);
  });

  it('swaps the axes for landscape', () => {
    const geometry = resolvePageGeometry(config({ orientation: 'landscape' }), {
      width: 100,
      height: 100,
    });
    expect(geometry.widthPt).toBeCloseTo(A4_HEIGHT_PT, 3);
    expect(geometry.heightPt).toBeCloseTo(A4_WIDTH_PT, 3);
  });

  it('subtracts the margin from both edges', () => {
    const geometry = resolvePageGeometry(config({ marginMm: 10 }), { width: 100, height: 100 });
    expect(geometry.contentWidthPt).toBeCloseTo(A4_WIDTH_PT - 2 * mmToPt(10), 3);
    expect(geometry.contentHeightPt).toBeCloseTo(A4_HEIGHT_PT - 2 * mmToPt(10), 3);
  });

  it('never produces a negative content box, even with absurd margins', () => {
    const geometry = resolvePageGeometry(config({ marginMm: 50 }), { width: 100, height: 100 });
    expect(geometry.contentWidthPt).toBeGreaterThan(0);
    expect(geometry.contentHeightPt).toBeGreaterThan(0);
  });

  it('sizes the page to the image when paperSize is "fit"', () => {
    const geometry = resolvePageGeometry(config({ paperSize: 'fit', marginMm: 0 }), {
      width: 960,
      height: 480,
    });
    // 96 CSS px per inch, 72 pt per inch.
    expect(geometry.widthPt).toBeCloseTo(960 * (72 / 96), 3);
    expect(geometry.heightPt).toBeCloseTo(480 * (72 / 96), 3);
  });

  it('honours custom dimensions', () => {
    const geometry = resolvePageGeometry(
      config({ paperSize: 'custom', customWidthMm: 100, customHeightMm: 150, marginMm: 0 }),
      { width: 10, height: 10 },
    );
    expect(geometry.widthPt).toBeCloseTo(mmToPt(100), 3);
    expect(geometry.heightPt).toBeCloseTo(mmToPt(150), 3);
  });

  it('falls back to A4 dimensions when custom values are missing', () => {
    const geometry = resolvePageGeometry(config({ paperSize: 'custom', marginMm: 0 }), {
      width: 10,
      height: 10,
    });
    expect(geometry.widthPt).toBeCloseTo(A4_WIDTH_PT, 3);
  });
});

describe('planPages', () => {
  it('places a short capture on a single page', () => {
    const image = { width: 1000, height: 400 };
    const geometry = resolvePageGeometry(config(), image);
    const pages = planPages(config(), image, geometry);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.sourceY).toBe(0);
    expect(pages[0]!.sourceHeight).toBe(400);
  });

  it('splits a tall capture into contiguous, non-overlapping bands', () => {
    const image = { width: 1000, height: 9000 };
    const geometry = resolvePageGeometry(config(), image);
    const pages = planPages(config(), image, geometry);

    expect(pages.length).toBeGreaterThan(1);

    // Every source row appears on exactly one page: no gaps, no duplication.
    let cursor = 0;
    for (const page of pages) {
      expect(page.sourceY).toBe(cursor);
      cursor += page.sourceHeight;
    }
    expect(cursor).toBe(image.height);
  });

  it('keeps every band inside the printable area', () => {
    const image = { width: 1000, height: 9000 };
    const cfg = config({ marginMm: 12 });
    const geometry = resolvePageGeometry(cfg, image);

    for (const page of planPages(cfg, image, geometry)) {
      expect(page.y).toBeGreaterThanOrEqual(-0.001);
      expect(page.x).toBeGreaterThanOrEqual(geometry.marginPt - 0.001);
      expect(page.height).toBeLessThanOrEqual(geometry.contentHeightPt + 0.001);
      expect(page.width).toBeLessThanOrEqual(geometry.contentWidthPt + 0.001);
      // Top edge sits at or below the top margin.
      expect(page.y + page.height).toBeLessThanOrEqual(geometry.heightPt - geometry.marginPt + 0.001);
    }
  });

  it('produces one page when multi-page output is disabled', () => {
    const image = { width: 1000, height: 20000 };
    const cfg = config({ multiPage: false });
    const geometry = resolvePageGeometry(cfg, image);
    const pages = planPages(cfg, image, geometry);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.sourceHeight).toBe(image.height);
  });

  it('shrinks an over-tall single page to fit when fitToPage is on', () => {
    const image = { width: 1000, height: 20000 };
    const cfg = config({ multiPage: false, fitToPage: true });
    const geometry = resolvePageGeometry(cfg, image);
    const [page] = planPages(cfg, image, geometry);

    expect(page!.height).toBeLessThanOrEqual(geometry.contentHeightPt + 0.001);
    // Aspect ratio is preserved.
    expect(page!.width / page!.height).toBeCloseTo(image.width / image.height, 3);
  });

  it('applies the scale factor and keeps the result centred', () => {
    const image = { width: 1000, height: 500 };
    const cfg = config({ scale: 0.5 });
    const geometry = resolvePageGeometry(cfg, image);
    const [page] = planPages(cfg, image, geometry);

    expect(page!.width).toBeCloseTo(geometry.contentWidthPt * 0.5, 3);
    const leftGap = page!.x - geometry.marginPt;
    const rightGap = geometry.widthPt - geometry.marginPt - (page!.x + page!.width);
    expect(leftGap).toBeCloseTo(rightGap, 3);
  });

  it('handles a single-pixel-tall capture without producing zero pages', () => {
    const image = { width: 100, height: 1 };
    const geometry = resolvePageGeometry(config(), image);
    expect(planPages(config(), image, geometry)).toHaveLength(1);
  });

  it('does not loop forever on an extremely tall capture', () => {
    const image = { width: 100, height: 100_000 };
    const geometry = resolvePageGeometry(config(), image);
    const pages = planPages(config(), image, geometry);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThan(10_000);
  });
});

/* ------------------------------------------------------------ file format */

const jpegImage: PdfImage = {
  data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
  width: 100,
  height: 50,
  filter: 'DCTDecode',
};

async function buildBytes(document: PdfDocument): Promise<{ bytes: Uint8Array; text: string }> {
  const blob = document.build();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // latin1 keeps byte offsets equal to string indices, which the xref check needs.
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return { bytes, text };
}

describe('PdfDocument', () => {
  it('refuses to build an empty document', () => {
    expect(() => new PdfDocument().build()).toThrow(/no pages/i);
  });

  it('writes a well-formed single-page PDF', async () => {
    const document = new PdfDocument({ title: 'Report', createdAt: Date.UTC(2026, 7, 17, 9, 30, 25) });
    document.addImagePage(jpegImage, { widthPt: 595, heightPt: 842 }, {
      x: 28,
      y: 500,
      width: 200,
      height: 100,
    });

    const { bytes, text } = await buildBytes(document);

    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages /Count 1');
    expect(text).toContain('/MediaBox [0 0 595 842]');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 100 /Height 50');
    // The placement matrix maps the unit square onto the destination rectangle.
    expect(text).toContain('200 0 0 100 28 500 cm');
    expect(bytes.length).toBeGreaterThan(200);
  });

  it('embeds the image bytes verbatim, with the declared length', async () => {
    const document = new PdfDocument();
    document.addImagePage(jpegImage, { widthPt: 100, heightPt: 100 }, {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    const { bytes, text } = await buildBytes(document);
    expect(text).toContain(`/Length ${jpegImage.data.length} >>`);

    // The original JPEG magic bytes survive unaltered.
    const marker = text.indexOf('￿') >= 0 ? -1 : text.indexOf(String.fromCharCode(0xff, 0xd8, 0xff));
    expect(marker).toBeGreaterThan(0);
    expect(bytes.slice(marker, marker + 4)).toEqual(jpegImage.data.slice(0, 4));
  });

  it('records byte-accurate xref offsets for every object', async () => {
    const document = new PdfDocument({ title: 'Multi' });
    for (let page = 0; page < 3; page += 1) {
      document.addImagePage(jpegImage, { widthPt: 595, heightPt: 842 }, {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
    }

    const { text } = await buildBytes(document);

    // Match the table itself, not the "startxref" pointer that follows it.
    const table = /\nxref\n0 (\d+)\n/.exec(text);
    expect(table).not.toBeNull();

    const xrefStart = table!.index + 1;
    const objectCount = Number(table![1]);
    // 3 shared objects (catalog, pages, info) + 3 objects per page, plus the free entry.
    expect(objectCount).toBe(1 + 3 + 3 * 3);

    // Skip the "xref", the subsection header, and the free-list entry.
    const entries = text
      .slice(table!.index + table![0].length)
      .split('\n')
      .slice(1, objectCount);

    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      const objectNumber = index + 1;
      // Each recorded offset must point at that object's own header.
      expect(text.slice(offset, offset + `${objectNumber} 0 obj`.length)).toBe(
        `${objectNumber} 0 obj`,
      );
    });

    const startxref = /startxref\n(\d+)\n%%EOF/.exec(text);
    expect(startxref).not.toBeNull();
    expect(Number(startxref![1])).toBe(xrefStart);
    expect(document.pageCount).toBe(3);
  });

  it('encodes non-ASCII titles as UTF-16BE hex strings', async () => {
    const document = new PdfDocument({ title: 'Отчёт' });
    document.addImagePage(jpegImage, { widthPt: 10, heightPt: 10 }, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    const { text } = await buildBytes(document);
    // FEFF byte-order mark followed by the code points, all inside a hex string.
    expect(text).toMatch(/\/Title <FEFF[0-9A-F]+>/);
  });

  it('omits the title entry when none is supplied', async () => {
    const document = new PdfDocument();
    document.addImagePage(jpegImage, { widthPt: 10, heightPt: 10 }, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const { text } = await buildBytes(document);
    expect(text).not.toContain('/Title');
    expect(text).toContain('/Producer (SnapDock)');
  });
});
