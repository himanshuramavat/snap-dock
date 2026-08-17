/**
 * Filename sanitisation.
 *
 * Names produced here have to survive three different consumers: the Google Drive
 * API, the Chrome downloads API, and whatever filesystem the user eventually saves
 * to. The rules below are the union of their restrictions, so a name that passes is
 * safe everywhere rather than merely safe on the machine that generated it.
 */

/** Characters illegal on Windows, plus the separators that break Drive paths. */
const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;
/**
 * C0 and C1 control characters, excluding the whitespace ones (tab, newline,
 * vertical tab, form feed, carriage return). Those are handled by the whitespace
 * collapse below so that a two-line page title becomes "Line one Line two" rather
 * than "Line oneLine two".
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;
/** Zero-width and bidi-override characters: invisible, and a name-spoofing vector. */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Device names Windows refuses regardless of extension. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Leaves room for the extension and a de-duplication suffix within the 255-byte limit. */
export const MAX_BASENAME_LENGTH = 180;

export const FALLBACK_BASENAME = 'Screenshot';

/**
 * Cleans a single filename component (no extension, no directory separators).
 * Always returns a non-empty, non-reserved string.
 */
export function sanitizeBasename(input: string): string {
  let name = input
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(ILLEGAL_CHARS, '-')
    // Collapse any run of whitespace (including the newlines and tabs left above).
    .replace(/\s+/g, ' ')
    // Collapse runs of the separators we may have just introduced.
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_');

  // Trim leading and trailing separators. This does more than tidy the result:
  // Windows silently drops trailing dots and spaces (turning "report." into
  // "report", which can then collide with an existing file), and a name made
  // entirely of separators, such as "///" becoming "-", is not a name at all.
  name = trimSeparators(name);

  if (name.length > MAX_BASENAME_LENGTH) {
    name = trimSeparators(name.slice(0, MAX_BASENAME_LENGTH));
  }

  if (!name) return FALLBACK_BASENAME;

  if (RESERVED_NAMES.has(name.toLowerCase())) return `${name}_file`;

  return name;
}

function trimSeparators(value: string): string {
  return value.replace(/^[-_. ]+/, '').replace(/[-_. ]+$/, '');
}

/** Joins a sanitised basename with an extension, avoiding a duplicated suffix. */
export function withExtension(basename: string, extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (!ext) return basename;
  if (basename.toLowerCase().endsWith(`.${ext}`)) return basename;
  return `${basename}.${ext}`;
}
