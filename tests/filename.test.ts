import { describe, expect, it } from 'vitest';
import {
  FALLBACK_BASENAME,
  MAX_BASENAME_LENGTH,
  sanitizeBasename,
  withExtension,
} from '@/filename/sanitize';
import {
  extractDomain,
  findUnknownTokens,
  generateFilename,
  previewFilename,
  OUTPUT_FILE_INFO,
} from '@/filename/template';
import type { PageContext } from '@/types';

const page: PageContext = {
  url: 'https://www.example.com/docs/intro?q=1',
  title: 'Getting started',
  domain: 'example.com',
  capturedAt: new Date(2026, 7, 17, 11, 30, 25).getTime(),
};

describe('sanitizeBasename', () => {
  it('replaces characters that are illegal on Windows or break Drive paths', () => {
    expect(sanitizeBasename('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('collapses whitespace from multi-line page titles into single spaces', () => {
    expect(sanitizeBasename('Quarterly\n\treport   2026')).toBe('Quarterly report 2026');
  });

  it('strips control characters', () => {
    expect(sanitizeBasename('re\u0000po\u001Frt\u007F')).toBe('report');
  });

  it('strips zero-width and bidi-override characters used for name spoofing', () => {
    // U+202E reverses the displayed text, the classic "invoice.exe shown as
    // invoice.txt" trick; U+200B is an invisible separator.
    expect(sanitizeBasename('inv\u202Egpj.exe\u200B')).toBe('invgpj.exe');
  });

  it('removes leading and trailing dots and spaces, which Windows silently drops', () => {
    expect(sanitizeBasename('  ..report..  ')).toBe('report');
  });

  it('never returns an empty name', () => {
    expect(sanitizeBasename('')).toBe(FALLBACK_BASENAME);
    expect(sanitizeBasename('///')).toBe(FALLBACK_BASENAME);
    expect(sanitizeBasename('   ...   ')).toBe(FALLBACK_BASENAME);
  });

  it('escapes reserved Windows device names', () => {
    expect(sanitizeBasename('CON')).toBe('CON_file');
    expect(sanitizeBasename('lpt1')).toBe('lpt1_file');
    // Only exact matches are reserved.
    expect(sanitizeBasename('console')).toBe('console');
  });

  it('truncates over-long names without leaving a trailing separator', () => {
    const result = sanitizeBasename('x'.repeat(400));
    expect(result).toHaveLength(MAX_BASENAME_LENGTH);

    const trailing = sanitizeBasename(`${'y'.repeat(MAX_BASENAME_LENGTH - 1)}-zzzz`);
    expect(trailing.endsWith('-')).toBe(false);
  });

  it('preserves non-Latin scripts, which are legal everywhere SnapDock writes', () => {
    expect(sanitizeBasename('スクリーンショット')).toBe('スクリーンショット');
    expect(sanitizeBasename('Отчёт 2026')).toBe('Отчёт 2026');
  });
});

describe('withExtension', () => {
  it('appends the extension', () => {
    expect(withExtension('shot', 'png')).toBe('shot.png');
  });

  it('does not double up an extension that is already present', () => {
    expect(withExtension('shot.png', 'png')).toBe('shot.png');
    expect(withExtension('shot.PNG', 'png')).toBe('shot.PNG');
  });

  it('tolerates a leading dot on the extension', () => {
    expect(withExtension('shot', '.jpg')).toBe('shot.jpg');
  });
});

describe('generateFilename', () => {
  it('produces the documented default name', () => {
    expect(
      generateFilename({ template: 'Screenshot_{date}_{time}', page, outputType: 'png' }),
    ).toBe('Screenshot_2026-08-17_11-30-25.png');
  });

  it('expands every documented placeholder', () => {
    const name = generateFilename({
      template: '{date}~{time}~{datetime}~{timestamp}~{domain}~{host}~{title}~{path}~{ext}',
      page,
      outputType: 'jpeg',
    });
    expect(name).toBe(
      `2026-08-17~11-30-25~2026-08-17_11-30-25~${page.capturedAt}~example.com~www.example.com~Getting started~docs-intro~jpg.jpg`,
    );
  });

  it('is case-insensitive about placeholder names', () => {
    expect(generateFilename({ template: '{DATE}_{Domain}', page, outputType: 'png' })).toBe(
      '2026-08-17_example.com.png',
    );
  });

  it('leaves unknown placeholders visible rather than silently deleting them', () => {
    expect(generateFilename({ template: 'a_{nope}_b', page, outputType: 'png' })).toBe(
      'a_{nope}_b.png',
    );
  });

  it('sanitises each token before substitution, so a hostile title cannot inject separators', () => {
    const hostile: PageContext = {
      ...page,
      title: '../../etc/passwd',
    };
    const name = generateFilename({ template: '{title}', page: hostile, outputType: 'png' });
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toBe('etc-passwd.png');
  });

  it('falls back to a usable name when the template expands to nothing', () => {
    expect(generateFilename({ template: '{ext}', page: { ...page, title: '' }, outputType: 'png' }))
      .toBe('png.png');
    expect(generateFilename({ template: '///', page, outputType: 'png' })).toBe('Screenshot.png');
  });

  it('uses .jpg for JPEG and .pdf for PDF', () => {
    expect(generateFilename({ template: 'x', page, outputType: 'jpeg' })).toBe('x.jpg');
    expect(generateFilename({ template: 'x', page, outputType: 'pdf' })).toBe('x.pdf');
    expect(generateFilename({ template: 'x', page, outputType: 'webp' })).toBe('x.webp');
  });

  it('handles an untitled page and an unparseable URL', () => {
    const odd: PageContext = { url: 'about:blank', title: '', domain: '', capturedAt: page.capturedAt };
    expect(generateFilename({ template: '{domain}_{title}', page: odd, outputType: 'png' })).toBe(
      'page_Untitled.png',
    );
  });

  it('pads single-digit date and time components', () => {
    const early: PageContext = { ...page, capturedAt: new Date(2026, 0, 5, 9, 8, 7).getTime() };
    expect(generateFilename({ template: '{date}_{time}', page: early, outputType: 'png' })).toBe(
      '2026-01-05_09-08-07.png',
    );
  });
});

describe('extractDomain', () => {
  it('drops a leading www.', () => {
    expect(extractDomain('https://www.example.com/a')).toBe('example.com');
    expect(extractDomain('https://docs.example.com/a')).toBe('docs.example.com');
  });

  it('falls back for URLs it cannot parse', () => {
    expect(extractDomain('not a url')).toBe('page');
  });
});

describe('findUnknownTokens', () => {
  it('reports only placeholders SnapDock does not implement', () => {
    expect(findUnknownTokens('{date}_{nope}_{title}_{alsonope}')).toEqual(['nope', 'alsonope']);
    expect(findUnknownTokens('{date}_{time}')).toEqual([]);
  });

  it('de-duplicates repeated unknown placeholders', () => {
    expect(findUnknownTokens('{x}_{x}')).toEqual(['x']);
  });
});

describe('previewFilename', () => {
  it('renders a stable sample for the settings preview', () => {
    expect(previewFilename('{date}_{domain}_{title}')).toBe(
      '2026-08-17_example.com_Getting started with SnapDock.png',
    );
  });

  it('reflects the chosen output type', () => {
    expect(previewFilename('doc', 'pdf')).toBe('doc.pdf');
  });
});

describe('OUTPUT_FILE_INFO', () => {
  it('maps every output type to a MIME type Drive will accept', () => {
    expect(OUTPUT_FILE_INFO.png.mime).toBe('image/png');
    expect(OUTPUT_FILE_INFO.jpeg.mime).toBe('image/jpeg');
    expect(OUTPUT_FILE_INFO.webp.mime).toBe('image/webp');
    expect(OUTPUT_FILE_INFO.pdf.mime).toBe('application/pdf');
  });
});
