/**
 * Functions injected into the target page by chrome.scripting.executeScript.
 *
 * IMPORTANT: each function is serialised with Function.prototype.toString and
 * re-evaluated inside the page, so it must be completely self-contained: no imports,
 * no module-scope references, no shared helpers. Anything they need is passed as an
 * argument, and anything they need to remember between calls is stashed on `window`
 * in the extension's isolated world (never on the page's own globals).
 */

export interface PageMetrics {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  title: string;
  url: string;
}

/** Reads everything the capture planner needs in a single round-trip. */
export function measurePage(): PageMetrics {
  const de = document.documentElement;
  const body = document.body;
  return {
    scrollWidth: Math.max(de.scrollWidth, body ? body.scrollWidth : 0, de.clientWidth),
    scrollHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0, de.clientHeight),
    clientWidth: de.clientWidth || window.innerWidth,
    clientHeight: de.clientHeight || window.innerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio || 1,
    title: document.title,
    url: location.href,
  };
}

/**
 * Freezes the page so successive viewport captures are consistent with each other:
 * animations paused, transitions off, smooth scrolling disabled (otherwise
 * scrollTo returns before the page has actually moved), and scrollbars hidden.
 */
export function beginCaptureMode(): void {
  const w = window as unknown as { __snapdockState?: { hidden: Array<[HTMLElement, string]> } };
  w.__snapdockState = { hidden: [] };

  const style = document.createElement('style');
  style.id = '__snapdock-capture-style';
  style.textContent =
    '*,*::before,*::after{animation-play-state:paused!important;' +
    'transition-property:none!important;scroll-behavior:auto!important;}' +
    'html{scroll-behavior:auto!important;}' +
    'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;}';
  (document.head || document.documentElement).appendChild(style);
}

/**
 * Hides elements that stay put while the page scrolls.
 *
 * Called after the first segment so a sticky header or floating chat widget is
 * captured once, at the top, instead of being stamped onto every band below it.
 * Elements are hidden with `visibility` rather than `display` so the layout (and
 * therefore the total page height already measured) does not shift underneath us.
 */
export function hidePinnedElements(maxElementsToScan: number): number {
  const w = window as unknown as { __snapdockState?: { hidden: Array<[HTMLElement, string]> } };
  const state = w.__snapdockState;
  if (!state) return 0;

  const all = document.body ? document.body.querySelectorAll<HTMLElement>('*') : [];
  const limit = Math.min(all.length, maxElementsToScan);
  let hidden = 0;

  for (let i = 0; i < limit; i += 1) {
    const el = all[i];
    if (!el) continue;
    const position = getComputedStyle(el).position;
    if (position !== 'fixed' && position !== 'sticky') continue;

    // A pinned element covering nearly the whole viewport is a modal or an overlay
    // backdrop, not furniture, and hiding it would blank most of the capture.
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.9) continue;
    if (rect.width === 0 || rect.height === 0) continue;

    state.hidden.push([el, el.style.getPropertyValue('visibility')]);
    el.style.setProperty('visibility', 'hidden', 'important');
    hidden += 1;
  }

  return hidden;
}

/**
 * Scrolls to an absolute offset and reports where the page actually landed.
 *
 * The returned value is what matters: near the bottom of the document, or on pages
 * with scroll snapping, the browser lands somewhere other than the requested offset.
 * Compositing each band at its real position is what keeps the stitched image free
 * of both seams and duplicated strips.
 */
export function scrollToOffset(y: number): { scrollY: number; scrollHeight: number } {
  window.scrollTo(0, y);
  const de = document.documentElement;
  const body = document.body;
  return {
    scrollY: window.scrollY,
    scrollHeight: Math.max(de.scrollHeight, body ? body.scrollHeight : 0, de.clientHeight),
  };
}

/** Undoes beginCaptureMode/hidePinnedElements and returns the user to where they were. */
export function endCaptureMode(scrollX: number, scrollY: number): void {
  const w = window as unknown as { __snapdockState?: { hidden: Array<[HTMLElement, string]> } };
  const state = w.__snapdockState;

  if (state) {
    for (const [el, previous] of state.hidden) {
      if (previous) el.style.setProperty('visibility', previous);
      else el.style.removeProperty('visibility');
    }
    delete w.__snapdockState;
  }

  const style = document.getElementById('__snapdock-capture-style');
  if (style && style.parentNode) style.parentNode.removeChild(style);

  window.scrollTo(scrollX, scrollY);
}
