import type { OutputType, PageContext } from '@/types';
import { sanitizeBasename, withExtension } from './sanitize';

/**
 * Filename template expansion.
 *
 * Placeholders are `{name}` and are case-insensitive. Unknown placeholders are left
 * untouched rather than silently deleted, so a typo is visible in the result instead
 * of quietly producing a shorter name.
 */

export interface TemplateTokenDef {
  key: string;
  label: string;
  description: string;
  example: string;
}

/** Drives both expansion and the "insert placeholder" UI in settings. */
export const TEMPLATE_TOKENS: readonly TemplateTokenDef[] = [
  { key: 'date', label: 'Date', description: 'Capture date', example: '2026-08-17' },
  { key: 'time', label: 'Time', description: 'Capture time', example: '11-30-25' },
  { key: 'datetime', label: 'Date & time', description: 'Combined date and time', example: '2026-08-17_11-30-25' },
  { key: 'timestamp', label: 'Timestamp', description: 'Unix timestamp in milliseconds', example: '1786000225000' },
  { key: 'domain', label: 'Domain', description: 'Site domain, without "www."', example: 'example.com' },
  { key: 'host', label: 'Host', description: 'Full hostname', example: 'www.example.com' },
  { key: 'title', label: 'Page title', description: 'Title of the captured page', example: 'Pricing' },
  { key: 'path', label: 'Path', description: 'URL path with slashes replaced', example: 'docs-intro' },
  { key: 'ext', label: 'Extension', description: 'Output file extension', example: 'png' },
];

export interface FilenameInput {
  template: string;
  page: PageContext;
  outputType: OutputType;
  /** Injected for deterministic tests; defaults to page.capturedAt. */
  now?: Date;
}

/** Maps the chosen output to its file extension and MIME type. */
export const OUTPUT_FILE_INFO: Record<OutputType, { ext: string; mime: string }> = {
  png: { ext: 'png', mime: 'image/png' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  webp: { ext: 'webp', mime: 'image/webp' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Strips "www." and returns the registrable-looking domain. Falls back to the raw
 * string when the URL is not parseable (e.g. `about:blank` or a malformed href).
 */
export function extractDomain(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./i, '') || 'page';
  } catch {
    return 'page';
  }
}

export function extractHost(url: string): string {
  try {
    return new URL(url).hostname || 'page';
  } catch {
    return 'page';
  }
}

function extractPath(url: string): string {
  try {
    const { pathname } = new URL(url);
    const cleaned = pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
    return cleaned || 'home';
  } catch {
    return 'home';
  }
}

export function buildTokenValues(input: FilenameInput): Record<string, string> {
  const { page, outputType } = input;
  const date = input.now ?? new Date(page.capturedAt);

  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

  return {
    date: ymd,
    time: hms,
    datetime: `${ymd}_${hms}`,
    timestamp: String(page.capturedAt),
    domain: extractDomain(page.url),
    host: extractHost(page.url),
    title: page.title?.trim() || 'Untitled',
    path: extractPath(page.url),
    ext: OUTPUT_FILE_INFO[outputType].ext,
  };
}

/**
 * Expands a template into a final, sanitised filename including its extension.
 *
 * Each token value is sanitised individually before substitution so that a hostile
 * or merely awkward page title (`Reports / Q3: "final"`) cannot inject separators
 * into the name, and the whole result is sanitised again as a backstop.
 */
export function generateFilename(input: FilenameInput): string {
  const values = buildTokenValues(input);
  const { ext } = OUTPUT_FILE_INFO[input.outputType];

  const expanded = input.template.replace(/\{(\w+)\}/g, (match, rawKey: string) => {
    const value = values[rawKey.toLowerCase()];
    return value === undefined ? match : sanitizeBasename(value);
  });

  const basename = sanitizeBasename(expanded);
  return withExtension(basename, ext);
}

/** Renders a template against representative sample data for the settings preview. */
export function previewFilename(template: string, outputType: OutputType = 'png'): string {
  return generateFilename({
    template,
    outputType,
    page: {
      url: 'https://www.example.com/docs/intro',
      title: 'Getting started with SnapDock',
      domain: 'example.com',
      capturedAt: new Date(2026, 7, 17, 11, 30, 25).getTime(),
    },
  });
}

/** Returns the placeholders used by a template that SnapDock does not understand. */
export function findUnknownTokens(template: string): string[] {
  const known = new Set(TEMPLATE_TOKENS.map((token) => token.key));
  const found = template.match(/\{(\w+)\}/g) ?? [];
  return [...new Set(found.map((raw) => raw.slice(1, -1)).filter((key) => !known.has(key.toLowerCase())))];
}
