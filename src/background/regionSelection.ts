import type { Rect } from '@/types';
import { AppError } from '@/utils/errors';

/**
 * Drives the on-page region selector.
 *
 * The overlay is injected on demand and reports its result as a one-off runtime
 * message. Waiting for that message is wrapped here so the job runner sees a plain
 * promise that always settles: a selection, a cancellation, a closed tab, or a
 * timeout.
 */

const RESULT_MESSAGE = 'snapdock/region-result';
const SELECTION_TIMEOUT_MS = 2 * 60 * 1000;

interface RegionResultMessage {
  type: typeof RESULT_MESSAGE;
  rect: Rect | null;
}

function isResultMessage(value: unknown): value is RegionResultMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === RESULT_MESSAGE
  );
}

export async function selectRegion(tabId: number, signal?: AbortSignal): Promise<Rect> {
  const waiter = waitForSelection(tabId, signal);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/region-select.js'],
    });
  } catch (cause) {
    waiter.cancel();
    throw new AppError('PAGE_NOT_CAPTURABLE', {
      cause,
      details: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const rect = await waiter.promise;
  if (!rect) throw new AppError('CAPTURE_CANCELLED');
  return rect;
}

function waitForSelection(
  tabId: number,
  signal?: AbortSignal,
): { promise: Promise<Rect | null>; cancel: () => void } {
  let settle: ((rect: Rect | null) => void) | null = null;
  let cleanup = (): void => undefined;

  const promise = new Promise<Rect | null>((resolve) => {
    settle = (rect) => {
      cleanup();
      resolve(rect);
    };

    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender): undefined => {
      // Only accept a result from the exact tab we asked, so a selection running in
      // another tab cannot complete this job.
      if (sender.tab?.id !== tabId || !isResultMessage(message)) return;
      settle?.(message.rect);
      return;
    };

    const onTabRemoved = (closedTabId: number): void => {
      if (closedTabId === tabId) settle?.(null);
    };

    const onNavigated = (navigatedTabId: number, info: { status?: string }): void => {
      if (navigatedTabId === tabId && info.status === 'loading') settle?.(null);
    };

    const onAbort = (): void => settle?.(null);

    const timeout = setTimeout(() => settle?.(null), SELECTION_TIMEOUT_MS);

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.tabs.onUpdated.addListener(onNavigated);
    signal?.addEventListener('abort', onAbort, { once: true });

    cleanup = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      chrome.tabs.onUpdated.removeListener(onNavigated);
      signal?.removeEventListener('abort', onAbort);
    };
  });

  return { promise, cancel: () => settle?.(null) };
}
