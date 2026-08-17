import { AppError, toAppError } from '@/utils/errors';

/**
 * Guarded access to the two Chrome APIs the capture engine depends on.
 *
 * Both fail in ways that are meaningless to a user ("Cannot access contents of the
 * page"), so the mapping to SnapDock's error vocabulary lives here rather than being
 * repeated at every call site.
 */

/**
 * chrome.tabs.captureVisibleTab is quota'd at 2 calls per second. Full-page capture
 * would blow straight through that, so calls are serialised behind a minimum
 * interval. 550 ms leaves headroom for timer jitter without being noticeably slower
 * than the quota allows.
 */
const MIN_CAPTURE_INTERVAL_MS = 550;

let lastCaptureAt = 0;
let captureChain: Promise<unknown> = Promise.resolve();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for pages Chrome refuses to let extensions read, regardless of permissions. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com/i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore/i.test(url)
  );
}

/**
 * Captures the visible viewport as a lossless PNG data URL.
 *
 * PNG is not negotiable here: this is an intermediate that will be cropped, stitched
 * and only then encoded to the user's chosen format. Capturing as JPEG would bake
 * compression artefacts in before any of that happens.
 */
export async function captureVisibleTab(windowId: number): Promise<string> {
  // Serialise through a single chain so concurrent callers cannot both slip past
  // the interval check and trip the quota.
  const run = captureChain.then(async () => {
    const wait = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
    if (wait > 0) await sleep(wait);

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCaptureAt = Date.now();
      if (!dataUrl) throw new AppError('CAPTURE_FAILED', { details: 'Empty capture result' });
      return dataUrl;
    } catch (error) {
      lastCaptureAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);

      if (/quota|per second/i.test(message)) {
        // Back off once and retry; the quota window is one second.
        await sleep(MIN_CAPTURE_INTERVAL_MS * 2);
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        lastCaptureAt = Date.now();
        if (dataUrl) return dataUrl;
      }

      if (/cannot be edited|activeTab|permission|access/i.test(message)) {
        throw new AppError('PAGE_NOT_CAPTURABLE', { cause: error, details: message });
      }
      throw new AppError('CAPTURE_FAILED', { cause: error, details: message });
    }
  });

  // Keep the chain alive even when this call rejects, so one failure does not
  // permanently poison every later capture.
  captureChain = run.catch(() => undefined);
  return run;
}

/** Runs a self-contained function inside the page and returns its value. */
export async function inject<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args,
): Promise<Result> {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: func as (...injected: unknown[]) => unknown,
      args: args as unknown[],
      world: 'ISOLATED',
    });

    if (!frame) {
      throw new AppError('PAGE_NOT_CAPTURABLE', { details: 'Script injection returned no frame' });
    }
    return frame.result as Result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cannot access|chrome:\/\/|extension|showing error page|blocked/i.test(message)) {
      throw new AppError('PAGE_NOT_CAPTURABLE', { cause: error, details: message });
    }
    throw toAppError(error, 'CAPTURE_FAILED');
  }
}

/** Resolves the tab a capture should act on, rejecting pages Chrome won't expose. */
export async function resolveTargetTab(tabId?: number): Promise<chrome.tabs.Tab> {
  const tab = tabId
    ? await chrome.tabs.get(tabId).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!tab?.id) throw new AppError('NO_ACTIVE_TAB');
  if (isRestrictedUrl(tab.url)) {
    throw new AppError('PAGE_NOT_CAPTURABLE', { details: `Restricted URL: ${tab.url ?? 'unknown'}` });
  }
  return tab;
}
