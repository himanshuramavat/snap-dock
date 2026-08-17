// Must come first: aliases Firefox's promise-based `browser` onto `chrome`.
import '@/utils/browser';

/**
 * Region-selection overlay.
 *
 * Injected on demand. SnapDock declares no persistent content scripts, so a page
 * the user never captures never runs SnapDock code.
 *
 * Everything lives inside a closed shadow root attached to a single fixed-position
 * host. That keeps the page's stylesheets from reaching the overlay, keeps the
 * overlay's styles from reaching the page, and means teardown is one removeChild.
 */

const RESULT_MESSAGE = 'snapdock/region-result';
const GUARD = '__snapdockRegionSelectActive';
/** Smaller than this and it was a stray click, not a selection. */
const MIN_SELECTION_PX = 6;

/** Overlay styles. Scoped by the closed shadow root, so no page styles reach them. */
const OVERLAY_CSS = `
  :host, * { box-sizing: border-box; }
  .veil {
    position: fixed; inset: 0;
    background: rgba(9, 13, 24, 0.42);
    transition: opacity 90ms ease-out;
  }
  .veil.armed { background: transparent; }
  .sel {
    position: fixed;
    border: 1.5px solid #ef4444;
    border-radius: 2px;
    /* One huge spread shadow dims everything outside the selection, so there is no
       second overlay to keep in sync with the rectangle. */
    box-shadow: 0 0 0 100vmax rgba(9, 13, 24, 0.42);
    display: none;
  }
  .size {
    position: fixed;
    padding: 4px 8px;
    font: 500 12px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color: #f8fafc;
    background: #0f172a;
    border-radius: 6px;
    white-space: nowrap;
    display: none;
    box-shadow: 0 4px 12px rgba(0,0,0,.3);
  }
  .hint {
    position: fixed;
    top: 20px; left: 50%;
    transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    padding: 9px 16px;
    font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #f8fafc;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,.28);
  }
  .hint kbd {
    font: inherit; font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(148,163,184,.22);
    border: 1px solid rgba(148,163,184,.3);
  }
  .hint .sep { width:1px; height:14px; background: rgba(148,163,184,.28); }
  @media (prefers-reduced-motion: reduce) { .veil { transition: none; } }
`;

interface Point {
  x: number;
  y: number;
}

(function main(): void {
  const globalScope = window as unknown as Record<string, boolean>;
  if (globalScope[GUARD]) return;
  globalScope[GUARD] = true;

  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'cursor:crosshair',
    // The overlay itself must never appear in the screenshot, so it is removed
    // before capture; until then it swallows every interaction with the page.
    'pointer-events:auto',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });

  /*
   * Built node by node rather than with innerHTML.
   *
   * The markup here is entirely static, so innerHTML would be safe in fact, but this
   * script runs inside somebody else's page and an add-on reviewer should not have to
   * take that on trust. Explicit nodes also keep the CSP conversation short.
   */
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;

  const veil = document.createElement('div');
  veil.className = 'veil';

  const selection = document.createElement('div');
  selection.className = 'sel';

  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'size';

  const hint = document.createElement('div');
  hint.className = 'hint';

  const hintDrag = document.createElement('span');
  hintDrag.textContent = 'Drag to select an area';

  const hintSeparator = document.createElement('span');
  hintSeparator.className = 'sep';

  const hintCancel = document.createElement('span');
  const cancelKey = document.createElement('kbd');
  cancelKey.textContent = 'Esc';
  hintCancel.append(cancelKey, document.createTextNode(' to cancel'));

  hint.append(hintDrag, hintSeparator, hintCancel);
  shadow.append(style, veil, selection, sizeLabel, hint);

  let origin: Point | null = null;
  let current: Point | null = null;
  let settled = false;

  document.documentElement.appendChild(host);

  /** Normalises a drag in any direction into a positive-area rectangle. */
  function rectFrom(a: Point, b: Point) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
      x,
      y,
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function render(): void {
    if (!origin || !current) return;
    const rect = rectFrom(origin, current);

    veil.classList.add('armed');
    selection.style.display = 'block';
    selection.style.left = `${rect.x}px`;
    selection.style.top = `${rect.y}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;

    sizeLabel.style.display = 'block';
    sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    // Prefer a label below the selection; flip above when it would leave the screen.
    const below = rect.y + rect.height + 8;
    const fitsBelow = below + 26 < window.innerHeight;
    sizeLabel.style.top = `${fitsBelow ? below : Math.max(8, rect.y - 30)}px`;
    sizeLabel.style.left = `${Math.min(Math.max(8, rect.x), window.innerWidth - 96)}px`;
  }

  function finish(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (settled) return;
    settled = true;
    teardown();
    // Report device-independent CSS pixels relative to the viewport; the background
    // converts to captured pixels using the ratio it measures from the bitmap.
    chrome.runtime.sendMessage({ type: RESULT_MESSAGE, rect }).catch(() => undefined);
  }

  function teardown(): void {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('wheel', onScrollAttempt, { capture: true });
    window.removeEventListener('contextmenu', onContextMenu, true);
    host.remove();
    delete globalScope[GUARD];
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    origin = { x: event.clientX, y: event.clientY };
    current = origin;
    hint.style.display = 'none';
    render();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!origin) return;
    event.preventDefault();
    event.stopPropagation();
    current = { x: event.clientX, y: event.clientY };
    render();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!origin) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = rectFrom(origin, { x: event.clientX, y: event.clientY });
    origin = null;

    if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
      finish(null);
      return;
    }

    // Hide the overlay before reporting: the capture happens milliseconds later and
    // must not include SnapDock's own chrome.
    host.style.display = 'none';
    finish(rect);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    }
  }

  /** Scrolling mid-selection would invalidate the viewport-relative coordinates. */
  function onScrollAttempt(event: Event): void {
    event.preventDefault();
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
    finish(null);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('wheel', onScrollAttempt, { capture: true, passive: false });
  window.addEventListener('contextmenu', onContextMenu, true);

  // If the tab navigates away mid-selection, report a cancel so the background job
  // does not sit waiting for a message that will never arrive.
  window.addEventListener('beforeunload', () => finish(null), { once: true });
})();
