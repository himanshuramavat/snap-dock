/**
 * Keeps the service worker resident for the duration of a capture.
 *
 * Chrome resets an extension service worker's idle timer whenever an extension API
 * is called. During capture the pipeline calls APIs constantly, but an upload is
 * pure `fetch`, and a slow upload of a large full-page PNG can otherwise sit long
 * enough for the worker to be torn down mid-flight. A cheap periodic API call keeps
 * the timer fresh; it is started when a job begins and stopped the moment it ends,
 * so there is no idle wake-up cost.
 */

const PING_INTERVAL_MS = 20_000;

let timer: ReturnType<typeof setInterval> | null = null;
let holders = 0;

export function acquireKeepAlive(): () => void {
  holders += 1;

  if (!timer) {
    timer = setInterval(() => {
      // Any extension API call resets the timer; this one has no side effects.
      void chrome.runtime.getPlatformInfo().catch(() => undefined);
    }, PING_INTERVAL_MS);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
