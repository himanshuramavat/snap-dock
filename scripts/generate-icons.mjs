#!/usr/bin/env node
/**
 * Renders the toolbar icons in public/icons/ from SnapDock's logo mark.
 *
 * Usage:  npm run icons
 * Needs:  Chrome or Chromium on PATH (already required to develop the extension).
 *
 * Why render with a browser rather than draw with an image library: these icons must
 * be the *same* mark the popup header shows, and the header draws SVG. Rasterising
 * that same SVG with the same engine is the only way to guarantee they never drift
 * apart stylistically.
 *
 * Each size is rasterised directly at its target dimensions rather than rendered
 * large and downsampled. Vector rasterisation antialiases against the real pixel
 * grid, which is visibly sharper at 32px than any downscale of a 512px render.
 *
 * ── Optical sizing ────────────────────────────────────────────────────────────
 * Two artworks, not one, because 16px is what Chrome shows on a standard-DPI
 * toolbar and the full mark's strokes land there at roughly one pixel: the capture
 * frame collides with the arrow and the whole thing turns to mush.
 *
 * SMALL_MARK keeps every element of the full mark (both corner brackets, the arrow, the
 * dock rail) and the same 24-unit geometry, so it reads as the same logo. What changes is
 * weight and spacing: strokes are thickened, bracket arms lengthened, and the three
 * elements pushed apart so none of them merge once rasterised at 16px. This is ordinary
 * optical sizing, the same reason a typeface ships a caption cut.
 *
 * IMPORTANT: FULL_MARK below mirrors src/ui/Logo.tsx. If you change the logo there,
 * change it here too and re-run `npm run icons`.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** SnapDock's accent colour, matching --sd-accent in src/ui/tokens.css. */
const ACCENT = '#dc2626';

/** The full mark: capture frame, arrow, dock rail. Mirrors src/ui/Logo.tsx. */
const FULL_MARK = `
<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 24 24">
  <rect x="2" y="2" width="20" height="20" rx="6" fill="${ACCENT}"/>
  <path d="M8 7.5h1.6M14.4 7.5H16a.5.5 0 0 1 .5.5v1.6M7.5 9.6V8a.5.5 0 0 1 .5-.5"
        stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.9"/>
  <path d="M12 9.5v4.2m0 0 2-2m-2 2-2-2"
        stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M8 16.5h8" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity="0.75"/>
</svg>`;

/**
 * 16px variant: the same mark, re-weighted so it survives rasterisation at 16px.
 * Compare against FULL_MARK above; the structure is deliberately identical.
 */
const SMALL_MARK = `
<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 24 24">
  <rect x="1" y="1" width="22" height="22" rx="6.5" fill="${ACCENT}"/>
  <path d="M6.6 6.4h2.6M14.8 6.4h2.6M6.6 9V6.4M17.4 9V6.4"
        stroke="#fff" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.95"/>
  <path d="M12 9v4.6m0 0 2.4-2.4m-2.4 2.4-2.4-2.4"
        stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M7.6 17.4h8.8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/>
</svg>`;

const TARGETS = [
  { size: 16, art: SMALL_MARK },
  { size: 48, art: FULL_MARK },
  { size: 128, art: FULL_MARK },
];

/** Checked in order. Covers Linux, macOS and Windows so one command works anywhere. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux (snap)
  '/snap/bin/chromium',
  // Windows
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
].filter((candidate) => candidate && !candidate.startsWith('/Google/Chrome'));

async function findChrome() {
  const onWindows = process.platform === 'win32';

  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      // `which` does not exist on Windows; `where` is the equivalent.
      await run(onWindows ? 'where' : 'which', [candidate]);
      return candidate;
    } catch {
      // Not on PATH; try the next candidate.
    }
  }
  throw new Error(
    'Could not find Chrome or Chromium. Install it, or set CHROME_PATH to the binary.',
  );
}

async function main() {
  const chrome = await findChrome();
  const outDir = resolve(import.meta.dirname, '..', 'public', 'icons');
  await mkdir(outDir, { recursive: true });

  const work = await mkdtemp(join(tmpdir(), 'snapdock-icons-'));

  try {
    for (const { size, art } of TARGETS) {
      const svg = art.replaceAll('{SIZE}', String(size));
      const page = join(work, `icon-${size}.html`);
      const out = join(outDir, `icon${size}.png`);

      await writeFile(
        page,
        '<!doctype html><html><head><meta charset="utf-8">' +
          '<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>' +
          `</head><body>${svg}</body></html>`,
        'utf8',
      );

      await run(chrome, [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        // Without this the PNG gets an opaque white backdrop.
        '--default-background-color=00000000',
        // Guards against a hi-dpi host silently rendering at 2x.
        '--force-device-scale-factor=1',
        `--window-size=${size},${size}`,
        `--screenshot=${out}`,
        `file://${page}`,
      ]);

      console.log(`wrote public/icons/icon${size}.png  (${size}x${size})`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  console.log('\nRebuild to copy them into dist/:  npm run build');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
