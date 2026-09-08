# AGENT.md — Operating instructions for AI agents

This file is the runbook. `CLAUDE.md` is the project overview; this file is what
you actually do when you change something and need to verify it on every target.

## Ground rules

- **Never commit or push unless explicitly asked.** Make the change, run the
  checks, then stop and report.
- **Keep changes scoped.** Don't refactor unrelated capture / UI code while
  fixing a download bug. Don't reformat files you didn't touch.
- **Match the surrounding code's style.** Comment density, naming, and idioms
  are deliberate; preserve them.
- **Use the existing `@/` import alias.** Don't add `../../../` chains.
- **No new dependencies without discussion.** The dependency list in
  `package.json` is intentionally small.

## Required pre-flight

Before you start writing code:

1. `node --version` — must be ≥ 20 (Vite 8 needs modern Node).
2. `npm --version` — must be ≥ 10.
3. `npm install` if `node_modules/` is missing or stale.
4. Skim `CLAUDE.md` if this is your first session in this repo.

## Build

```bash
# Chromium + Firefox in one shot
npm run build

# Watch mode for popup / options while iterating on UI
npm run dev

# Chromium only (skips the Firefox mirror in scripts/targets.mjs)
npm run build:pages && npm run build:background && npm run build:content
```

Build outputs:

| Folder | Load in |
| --- | --- |
| `dist/` | Chrome, Edge, Brave, Opera, Vivaldi |
| `dist-firefox/` | Firefox |

The two are byte-identical except for `manifest.json`. Anything you change in
shared source must produce identical bundles for both; any difference is a bug
in the build split.

### Where each piece lands

| Source entry | Output file | Why |
| --- | --- | --- |
| `src/popup/popup.html` (+ React entry) | `dist/popup/popup.html`, `dist/assets/popup.js` | Standard Vite page |
| `src/options/options.html` (+ React entry) | `dist/options/options.html`, `dist/assets/options.js` | Standard Vite page |
| `src/background/index.ts` | `dist/assets/background.js` (ES module) | Service worker (Chromium) / event page (Firefox) |
| `src/content/region-select.ts` | `dist/content/region-select.js` (IIFE) | Content scripts can't be ES modules in either engine |
| `src/manifest.config.ts` | `dist/manifest.json`, `dist-firefox/manifest.json` | One source, two targets |

The manifest plugin in `vite.config.ts` emits `dist/manifest.json` for
Chromium. `scripts/targets.mjs` then mirrors `dist/` → `dist-firefox/` and
overwrites the manifest with the Firefox variant.

### Per-environment variables

Loaded by Vite from `.env` / `.env.local` via `loadEnv` (no `VITE_` prefix):

| Variable | Used by | Notes |
| --- | --- | --- |
| `SNAPDOCK_GOOGLE_CLIENT_ID` | Chromium manifest (`oauth2.client_id`) | Required for the extension to load on Chromium. Without it the build warns but still succeeds; sign-in will fail until you fill it in. |
| `SNAPDOCK_GOOGLE_CLIENT_ID_FIREFOX` | Compiled into the bundle for Firefox's PKCE flow | Optional but recommended for Firefox development. |
| `SNAPDOCK_EXTENSION_KEY` | Chromium manifest (`key`) | Optional. Pins the unpacked Chromium extension to a stable ID so OAuth redirect URLs stay constant across reloads. |

Copy `.env.example` → `.env` and fill these in before testing Drive flows.

## Tests

```bash
npm test              # one-shot
npm run test:watch    # interactive
npm run typecheck     # tsc --noEmit
npm run verify        # typecheck + test + build (gating command)
```

Tests live in `tests/`, one file per layer. Conventions:

- Pure Node environment, no browser. The `chrome` global is stubbed in
  `tests/setup.ts`; tests that need richer behaviour pass in their own fakes.
- New behaviour needs new tests. If you add a function, add a `describe` for it
  in the existing file when there is one, or in a new file named after the
  module.
- Mirror existing test naming: `it('treats FILE_NO_SPACE as a disk-full error,
  not a save failure')` — sentences, not keywords.

## Linting and packaging

```bash
npm run lint:firefox       # web-ext lint over dist-firefox/
npm run package            # full build + per-browser zip in dist-packages/
```

`npm run package` is what CI uses; the resulting zips are what you ship to the
stores.

## Loading unpacked for manual testing

### Chromium (Chrome / Edge / Brave / Opera / Vivaldi)

1. `npm run build`
2. Open `chrome://extensions` (or the browser's equivalent).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select `dist/`.
5. Make sure **Allow access to file URLs** is off (it is, by default) and that
   the extension is allowed on the sites you want to test.
6. After every rebuild: hit the reload icon on the extensions page, then close
   and reopen the popup (popups cache state across reloads).

### Firefox

1. `npm run build`
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `dist-firefox/manifest.json`.
4. Temporary add-ons are gone when Firefox restarts. To keep a stable ID across
   restarts (needed for Drive OAuth), set `SNAPDOCK_GOOGLE_CLIENT_ID_FIREFOX`
   and a fixed `extensionKey`, then re-load.

### Smoke test

1. Click the toolbar icon. The popup opens.
2. Pick **Visible** + **PNG** + **Capture & Save**.
3. The file lands in `Downloads/SnapDock`. On Chromium this exercises the
   offscreen document path (`chrome://extensions` → SnapDock → *Inspect views*
   briefly lists `offscreen/offscreen.html` during the save and it disappears
   after). On Firefox the event page mints the blob URL directly.
4. Open the popup again → the previous capture shows in **Saved to this device**.
5. Click **Reveal in Finder/Explorer** to confirm the path.
6. Run a second capture with the same filename: it should be uniquified
   (`shot (1).png`), not clobbered.

### Drive smoke test (optional)

1. Open Settings → Destination.
2. Switch to **Google Drive**.
3. Click **Connect**. The Google consent screen appears with `drive.file` scope.
4. Browse folders, pick one, **Save**.
5. Run a capture. The file appears in the chosen Drive folder.
6. Disconnect from Settings — the popup shows Drive as not configured.

## Verifying cross-platform saves

`chrome.downloads` is the same API on every desktop OS, but the OSes disagree
about what counts as a valid target. Verify on:

| OS | Watch for |
| --- | --- |
| Windows | Long filenames approaching MAX_PATH; reserved names (`CON`, `PRN`); trailing dots in sub-folder names. |
| macOS | Sub-folder write failures surfacing as `FILE_FAILED` interruptions. See "macOS regression" below. |
| Linux | Default download directory permissions; the `xdg-user-dirs` setup. |
| ChromeOS | Downloads lives under `MyFiles/Downloads`; same POSIX rules as Linux. |

If you don't have a Mac available, exercise the macOS-specific code path with
the unit tests in `tests/local-provider.test.ts` — the `classifyInterruption`
describe block covers the regression directly.

### macOS regression: "the file couldn't be saved to this device"

When `Downloads/SnapDock` exists but a save still fails, Chrome surfaces a
generic `FILE_FAILED` interruption that the *default* error copy translates as
"the Downloads folder is unavailable". The fix lives in
`src/storage/local/LocalProvider.ts` — `classifyInterruption` reclassifies the
case and points the user at the actual sub-folder that could not be reached.
Reproducing locally:

1. On macOS, set the sub-folder to a name that does not yet exist (e.g.
   `SnapDock-Demo`).
2. Run a capture. The download fails immediately with `FILE_FAILED`.
3. The popup should show the *sub-folder specific* message, not the generic
   "Downloads folder unavailable" copy.

If you cannot repro, run the suite — the relevant unit test is
`'points the user at the configured sub-folder when FILE_FAILED occurs with one'`.

## Pre-commit checklist

Before you stop and report a change:

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — all green.
- [ ] `npm run verify` — passes end to end.
- [ ] Manual smoke test on at least one Chromium browser.
- [ ] If you touched download / save code, also run the smoke test in Firefox
      (`dist-firefox`) and confirm the file lands in `Downloads/SnapDock`.
- [ ] If you added a setting, check it round-trips through `SettingsStore` and
      survives a popup close + reopen.

## What to do when you get stuck

- **A test fails and you can't see why** — read the diff in the test file, not
  the implementation. The tests document intended behaviour; the bug is usually
  in the implementation.
- **`chrome.downloads.download` rejects with an opaque error** — `console.error`
  in `LocalProvider.classify` already preserves `cause`. Check the browser's
  extension service-worker console (chrome://extensions → service worker link).
- **`URL.createObjectURL is not a function` in the background** — the service
  worker has no such API; never call it there. Local saves obtain their URL via
  `src/storage/local/downloadUrl.ts` (offscreen document on Chromium). If you see
  this, something bypassed the leaser. See "How a capture reaches
  chrome.downloads" in CLAUDE.md.
- **`Only a single offscreen document may be created`** — a previous save left
  the document open (worker restarted mid-save). `chromeOffscreenApi` treats it
  as success and reuses the document; if it still fails, reload the extension.
- **The build splits wrong** — check `scripts/targets.mjs` and
  `vite.config.ts`'s manifest plugin. The two manifests are the only place
  the targets should differ.
- **Something works in dev but not in a packaged zip** — Drive OAuth in
  particular needs the stable `key`/`id` for the redirect URL to match. Set
  `SNAPDOCK_EXTENSION_KEY` and re-package.
