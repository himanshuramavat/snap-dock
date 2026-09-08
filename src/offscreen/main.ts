// Must come first, for parity with the other entry points. Only Chromium ever opens
// this page (Firefox's event page can mint blob URLs itself), but the shim is harmless.
import '@/utils/browser';
import { createIndexedDbHandoff } from '@/storage/local/blobHandoff';
import {
  isOffscreenRequest,
  type OffscreenRequest,
  type OffscreenResponse,
} from '@/storage/local/downloadUrl';

/**
 * Offscreen document: a blob-URL factory for the service worker.
 *
 * Manifest V3 service workers cannot call `URL.createObjectURL`, and
 * `chrome.downloads.download` needs a URL. This hidden page has a full Window, so it
 * collects the blob the worker parked in IndexedDB, mints a same-origin `blob:` URL
 * for it and hands the URL back. The worker revokes the URL through this page once
 * the download has settled, then closes the page.
 *
 * Nothing here is rendered, nothing persists between opens, and the page holds no
 * state beyond the live blob URLs it has handed out.
 */

const handoff = createIndexedDbHandoff(indexedDB);

/** URLs this page has minted, so a revoke for an unknown URL is a no-op, not a throw. */
const live = new Set<string>();

async function handle(message: OffscreenRequest): Promise<OffscreenResponse> {
  switch (message.type) {
    case 'blob-url/create': {
      const blob = await handoff.take(message.handoffId);
      const url = URL.createObjectURL(blob);
      live.add(url);
      return { ok: true, url };
    }
    case 'blob-url/revoke': {
      if (live.delete(message.url)) URL.revokeObjectURL(message.url);
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  // Every extension context receives every runtime message; only ours are answered.
  if (!isOffscreenRequest(message)) return false;

  handle(message).then(sendResponse, (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[SnapDock] offscreen request failed', message.type, reason);
    sendResponse({ ok: false, error: reason } satisfies OffscreenResponse);
  });
  // Keep the response channel open for the async handler.
  return true;
});
