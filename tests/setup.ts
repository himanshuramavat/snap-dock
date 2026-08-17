/**
 * Test environment setup.
 *
 * Tests target the business logic (filenames, settings, presets, PDF layout,
 * Drive request preparation), all of which is written against injected
 * dependencies rather than the `chrome` global. The stub below exists only so that
 * modules which reference `chrome` at import time can be loaded at all; any test
 * that actually needs browser behaviour passes in its own fake.
 */

const notImplemented = (name: string) => () => {
  throw new Error(`chrome.${name} was called in a test without being stubbed`);
};

const chromeStub = {
  storage: {
    local: { get: notImplemented('storage.local.get'), set: notImplemented('storage.local.set') },
    session: { get: notImplemented('storage.session.get'), set: notImplemented('storage.session.set') },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
  runtime: {
    id: 'snapdock-test',
    lastError: undefined,
    onMessage: { addListener: () => undefined, removeListener: () => undefined },
    sendMessage: notImplemented('runtime.sendMessage'),
  },
  identity: {
    getAuthToken: notImplemented('identity.getAuthToken'),
    removeCachedAuthToken: notImplemented('identity.removeCachedAuthToken'),
    clearAllCachedAuthTokens: notImplemented('identity.clearAllCachedAuthTokens'),
  },
  action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  tabs: { query: notImplemented('tabs.query'), get: notImplemented('tabs.get') },
  scripting: { executeScript: notImplemented('scripting.executeScript') },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
