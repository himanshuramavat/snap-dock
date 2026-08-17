/**
 * One promise-based extension API across Chromium and Firefox.
 *
 * Firefox exposes promise-returning APIs on `browser`, and provides a `chrome`
 * namespace that is callback-based for Chrome compatibility. Chromium's `chrome`
 * namespace returns promises in Manifest V3. So the whole codebase can be written
 * against promises if `chrome` points at `browser` when `browser` exists.
 *
 * This module does exactly that, as its import side effect, and every entry point
 * imports it first. It is a shim rather than an abstraction on purpose: an
 * `api.storage.local` wrapper would have to be threaded through several dozen call
 * sites and would obscure which real API is being used, for no behavioural gain.
 */

interface GeckoGlobal {
  browser?: typeof chrome;
  chrome?: typeof chrome;
}

const scope = globalThis as unknown as GeckoGlobal;

/*
 * Recorded before the alias is installed, since afterwards the two are identical.
 *
 * The `!==` comparison is load-bearing: recent Chromium versions also define a `browser`
 * global, but as the *same object* as `chrome`. Testing for existence alone would
 * therefore report every Chromium as Gecko. Only Firefox exposes two distinct namespaces.
 */
const IS_GECKO = Boolean(scope.browser) && scope.browser !== scope.chrome;

if (IS_GECKO && scope.browser) {
  scope.chrome = scope.browser;
}

/** The engine, for the few places where setup instructions genuinely differ. */
export function engine(): 'chromium' | 'gecko' {
  return IS_GECKO ? 'gecko' : 'chromium';
}

/**
 * Whether the browser offers Chromium's managed-token OAuth.
 *
 * Detected by capability rather than by engine: `identity.getAuthToken` is the specific
 * thing Firefox lacks, and asking about the capability is both more honest and more
 * durable than asking about the brand.
 */
export function hasManagedIdentity(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.identity?.getAuthToken === 'function';
}
