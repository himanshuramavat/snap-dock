/**
 * A deliberately small PDF 1.7 writer, limited to what SnapDock actually emits:
 * one image per page, no text, no fonts, no interactivity.
 *
 * Why not a PDF library?
 *  - Embedding a JPEG means copying its bytes verbatim as a /DCTDecode stream, so
 *    the capture is never decoded and re-encoded. That is a real quality win over
 *    the usual canvas -> library -> re-encode path.
 *  - It has no DOM dependencies, so PDF generation runs in the service worker
 *    alongside the rest of the pipeline instead of needing an offscreen document.
 *  - The whole writer is ~200 lines against ~400 kB of dependency.
 *
 * The surface is intentionally narrow so it can be replaced or extended (text
 * layers, outlines, metadata) without touching the capture or upload code.
 */

export type PdfImageFilter = 'DCTDecode' | 'FlateDecode';

export interface PdfImage {
  /** Encoded stream bytes: raw JPEG for DCTDecode, zlib-deflated RGB for FlateDecode. */
  data: Uint8Array;
  width: number;
  height: number;
  filter: PdfImageFilter;
}

export interface PdfPageSpec {
  widthPt: number;
  heightPt: number;
}

export interface PdfImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfMetadata {
  title?: string;
  /** Epoch milliseconds; injected rather than read from the clock so output is testable. */
  createdAt?: number;
}

interface PendingPage {
  spec: PdfPageSpec;
  image: PdfImage;
  placement: PdfImagePlacement;
}

const PDF_PRODUCER = 'SnapDock';

export class PdfDocument {
  private readonly pages: PendingPage[] = [];

  constructor(private readonly metadata: PdfMetadata = {}) {}

  get pageCount(): number {
    return this.pages.length;
  }

  addImagePage(image: PdfImage, spec: PdfPageSpec, placement: PdfImagePlacement): void {
    this.pages.push({ image, spec, placement });
  }

  /** Serialises the document. Throws if no pages were added. */
  build(): Blob {
    if (this.pages.length === 0) {
      throw new Error('Cannot build a PDF with no pages');
    }

    const writer = new ByteWriter();
    // Object numbers are 1-based; index 0 of this array is the free head entry.
    const offsets: number[] = [0];
    const allocate = (): number => offsets.push(0) - 1;

    const catalogRef = allocate();
    const pagesRef = allocate();
    const infoRef = allocate();

    const pageRefs = this.pages.map(() => ({
      page: allocate(),
      contents: allocate(),
      image: allocate(),
    }));

    const beginObject = (ref: number): void => {
      offsets[ref] = writer.length;
      writer.text(`${ref} 0 obj\n`);
    };
    const endObject = (): void => writer.text('endobj\n');

    writer.text('%PDF-1.7\n');
    // A comment of high-bit bytes marks the file as binary for transfer tools.
    writer.bytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    beginObject(catalogRef);
    writer.text(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>\n`);
    endObject();

    beginObject(pagesRef);
    const kids = pageRefs.map((refs) => `${refs.page} 0 R`).join(' ');
    writer.text(`<< /Type /Pages /Count ${this.pages.length} /Kids [${kids}] >>\n`);
    endObject();

    beginObject(infoRef);
    writer.text('<< ');
    if (this.metadata.title) {
      writer.text(`/Title ${hexString(this.metadata.title)} `);
    }
    writer.text(`/Producer (${PDF_PRODUCER}) /Creator (${PDF_PRODUCER}) `);
    if (this.metadata.createdAt !== undefined) {
      writer.text(`/CreationDate (${pdfDate(this.metadata.createdAt)}) `);
    }
    writer.text('>>\n');
    endObject();

    this.pages.forEach((page, index) => {
      const refs = pageRefs[index]!;
      const { widthPt, heightPt } = page.spec;
      const imageName = 'Im0';

      beginObject(refs.page);
      writer.text(
        `<< /Type /Page /Parent ${pagesRef} 0 R ` +
          `/MediaBox [0 0 ${fixed(widthPt)} ${fixed(heightPt)}] ` +
          `/Resources << /XObject << /${imageName} ${refs.image} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
          `/Contents ${refs.contents} 0 R >>\n`,
      );
      endObject();

      // `cm` maps the unit square onto the destination rectangle; PDF's origin is
      // the bottom-left corner, which is why placement.y is measured from the bottom.
      const { x, y, width, height } = page.placement;
      const content = `q\n${fixed(width)} 0 0 ${fixed(height)} ${fixed(x)} ${fixed(y)} cm\n/${imageName} Do\nQ\n`;
      const contentBytes = latin1(content);

      beginObject(refs.contents);
      writer.text(`<< /Length ${contentBytes.length} >>\nstream\n`);
      writer.bytes(contentBytes);
      writer.text('\nendstream\n');
      endObject();

      beginObject(refs.image);
      writer.text(
        `<< /Type /XObject /Subtype /Image ` +
          `/Width ${page.image.width} /Height ${page.image.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
          `/Filter /${page.image.filter} /Length ${page.image.data.length} >>\nstream\n`,
      );
      writer.bytes(page.image.data);
      writer.text('\nendstream\n');
      endObject();
    });

    const xrefOffset = writer.length;
    const objectCount = offsets.length;
    writer.text(`xref\n0 ${objectCount}\n`);
    writer.text('0000000000 65535 f \n');
    for (let ref = 1; ref < objectCount; ref += 1) {
      writer.text(`${String(offsets[ref]).padStart(10, '0')} 00000 n \n`);
    }

    writer.text(
      `trailer\n<< /Size ${objectCount} /Root ${catalogRef} 0 R /Info ${infoRef} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    );

    return writer.toBlob('application/pdf');
  }
}

/* --------------------------------------------------------------- primitives */

/** Appends byte chunks while tracking the running offset needed by the xref table. */
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  bytes(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  text(value: string): void {
    this.bytes(latin1(value));
  }

  toBlob(type: string): Blob {
    return new Blob(this.chunks as BlobPart[], { type });
  }
}

/**
 * PDF syntax is byte-oriented, not UTF-8. Encoding per code unit keeps offsets
 * exact; non-ASCII text only ever reaches the file through hexString().
 */
function latin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff;
  }
  return out;
}

/** UTF-16BE hex string with a byte-order mark: the portable way to carry any text. */
function hexString(value: string): string {
  let hex = 'FEFF';
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point > 0xffff) {
      const adjusted = point - 0x10000;
      hex += (0xd800 + (adjusted >> 10)).toString(16).padStart(4, '0').toUpperCase();
      hex += (0xdc00 + (adjusted & 0x3ff)).toString(16).padStart(4, '0').toUpperCase();
    } else {
      hex += point.toString(16).padStart(4, '0').toUpperCase();
    }
  }
  return `<${hex}>`;
}

/** PDF date syntax: D:YYYYMMDDHHmmSS. */
function pdfDate(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Trims float noise; PDF readers do not need more than sub-micrometre precision. */
function fixed(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

export const __testing = { latin1, hexString, fixed, pdfDate };
