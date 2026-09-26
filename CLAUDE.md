# CLAUDE.md — SnapDock

This file is the entry point for any AI agent (Claude or otherwise) working in this
repository. Read it end-to-end before touching the code; the conventions below are
load-bearing for the build, the test suite, and the cross-browser architecture.

## What this project is

**SnapDock** is a Manifest V3 browser extension that captures the visible viewport,
a user-dragged region, or a full scrolling page and saves the result as PNG, JPEG,
WebP, or PDF. Two destinations are supported out of the box:

- **This device** — the default. Saves into a sub-folder of the browser's
  `Downloads` directory using `chrome.downloads`. Needs no account, no OAuth, no
  setup.
- **Google Drive** — opt-in. Uses a single `drive.file` scope so SnapDock only ever
  sees files and folders it created itself.

It targets every Chromium-based browser (Chrome, Edge, Brave, Opera, Vivaldi) plus
Firefox. One source tree, two build outputs.

## Repository layout

```
snap-dock/
├── src/
│   ├── background/        # Service-worker / event-page entry (one for both engines)
│   ├── content/           # Content script: region-select overlay (IIFE, single file)
│   ├── offscreen/         # Chromium-only hidden page that mints blob: URLs for downloads
│   ├── popup/             # Toolbar popup UI (React)
│   ├── options/           # Full-page settings UI (React)
│   ├── capture/           # captureVisibleTab, page probe, region selection plumbing
│   ├── image/             # canvas → PNG/JPEG/WebP rendering
│   ├── pdf/               # PDF document builder
│   ├── filename/          # Template expansion, basename sanitisation
│   ├── storage/
│   │   ├── local/         # LocalProvider — chrome.downloads wrapper
│   │   │                  #   downloadUrl.ts: blob → URL strategy chain
│   │   │                  #   blobHandoff.ts: IndexedDB handoff to the offscreen page
│   │   ├── google-drive/  # GoogleDriveProvider — Drive REST + PKCE/managed token
│   │   ├── destination.ts # resolveDestinations, mode semantics
│   │   ├── registry.ts    # Provider registry; register() / getProvider()
│   │   └── StorageProvider.ts # Contract every provider implements
│   ├── settings/          # SettingsStore, schema validation, defaults
│   ├── presets/           # PresetStore — named capture configurations
│   ├── auth/              # OAuth scopes, PKCE helpers, Google sign-in
│   ├── ui/                # Shared components, design tokens, logo/icons
│   ├── utils/             # errors, browser shim, storage area, messaging
│   └── manifest.config.ts # Builds manifest.json per target (Chromium or Firefox)
├── public/                # Static assets copied into dist/ unchanged
│   ├── icons/             # Toolbar icons
│   ├── changelog/         # In-extension "What's new" page
│   └── _locales/en/       # __MSG_* keys referenced from the manifest
├── scripts/               # Node build helpers (target split, icon gen, packaging)
├── tests/                 # Vitest specs for the business logic
├── vite.config.ts         # Pages (popup + options)
├── vite.background.config.ts  # Background ES module
├── vite.content.config.ts     # Content script IIFE
├── vitest.config.ts       # Node environment, alias `@` → src
└── package.json
```

## Architecture in one diagram

```
   ┌──────────────────────┐
   │ Popup (React)        │  ── messages ──▶  ┌────────────────────────┐
   │ Options (React)      │                    │ Service worker          │
   │ Content script       │  ◀── state ──────  │  - capture pipeline     │
   │ (region overlay)     │                    │  - JobRunner            │
   └──────────────────────┘                    │  - settings / presets   │
                                               │  - storage providers    │
                                               └──────┬─────────┬────────┘
                                                      │         │
                                          LocalProvider         GoogleDriveProvider
                                          chrome.downloads       Drive REST API
                                          → Downloads/SnapDock   → chosen folder
```

The popup, options page, and content script are thin views; **all business logic
runs in the background service worker**. That keeps the popup disposable: closing it
during a capture or region selection changes nothing.

## Build, test, and verify

```bash
npm install                # one-time
npm run build              # produces dist/ and dist-firefox/
npm run typecheck          # tsc --noEmit
npm test                   # vitest run
npm run verify             # typecheck + test + build (use before pushing)
npm run lint:firefox       # web-ext lint over dist-firefox/
npm run package            # builds + zips per browser
npm run dev                # watch mode for the popup/options
```

| Browser | Load this folder |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi | `dist` |
| Firefox | `dist-firefox` |

See `AGENT.md` for the full per-browser manual-test flow.

## How a capture reaches chrome.downloads

`chrome.downloads.download` needs a URL. **Manifest V3 service workers have no
`URL.createObjectURL`** (the URL spec exposes it to Window and dedicated/shared
workers only), so calling it in Chromium's background throws
`URL.createObjectURL is not a function` and every local save fails. This shipped
once and was caught by Chrome Web Store review; do not reintroduce it.

`LocalProvider` therefore never mints a URL itself. It asks a `LeaseDownloadUrl`
(`src/storage/local/downloadUrl.ts`) and releases the lease once the download has
reached a terminal state. The default chain, in order:

1. **Object URL in this context** — Firefox's event page has `URL.createObjectURL`.
2. **Offscreen document** — Chromium: `chrome.offscreen.createDocument` (reason
   `BLOBS`) opens `offscreen/offscreen.html`; the worker parks the blob in
   IndexedDB (`blobHandoff.ts`), the page collects it, mints a same-origin
   `blob:chrome-extension://…` URL and revokes it on request. The page is closed
   when the last lease is released. Needs the `offscreen` permission, which the
   Chromium manifest adds and the Firefox manifest does not.
3. **Base64 data URL** — last resort only. Chromium caps URLs at 2 MB
   (`url::kMaxURLChars`), which full-page captures exceed, so this exists to keep
   small saves working in a context with neither of the above.

Every strategy takes its dependencies as arguments; `tests/download-url.test.ts`
drives the chain, the offscreen lifecycle and the IndexedDB handoff (via
`fake-indexeddb`), and `tests/local-provider.test.ts` runs a full save in a
simulated service worker with no `URL.createObjectURL`.

## Cross-platform path handling

Captures always save into a *relative* path under Downloads (`Downloads/SnapDock`
by default). The relative path is sanitised, length-capped, and uses forward
slashes on every OS — Chromium parses them into the platform's native separator.

`chrome.downloads` rules enforced by `LocalProvider`:

- No absolute paths, no `..`, no empty paths. (API rejects all of these.)
- Sub-folder creation behaviour is **platform-dependent**:
  - **Windows / Linux**: missing sub-folders are created implicitly as a side
    effect of opening the destination file.
  - **macOS**: Chromium's path reservation does *not* materialise intermediate
    directories; a missing or unreachable sub-folder surfaces as a generic
    `FILE_FAILED` interruption. `LocalProvider.classifyInterruption` reclassifies
    this case so the user is told the sub-folder is the problem rather than
    "your Downloads folder is unavailable".

`MAX_RELATIVE_PATH = 150` characters (sub-folder + filename) leaves headroom under
Windows' 260-character MAX_PATH. The filename is the part that gets truncated, not
the folder the user chose.

## Conventions

- **No `chrome` global in business logic.** Anything you'd want to unit-test takes
  its dependencies as arguments or via the storage-area shims in `utils/storageArea.ts`.
  Tests run in pure Node (`tests/setup.ts` stubs only the bare minimum).
- **One promise-based API across engines.** `utils/browser.ts` aliases Firefox's
  `browser` onto `chrome` so the rest of the codebase is written against promises.
- **`@/` alias for imports.** All source files import siblings and modules via
  `@/...`; `tsconfig.json`, `vite.config.ts`, `vite.background.config.ts`,
  `vite.content.config.ts`, and `vitest.config.ts` all agree.
- **Error handling is centralised in `utils/errors.ts`.** Every failure surfaces
  as an `AppError` with `code` (for logic), `userMessage` (for humans), and
  optional `details` (for the console). Raw exception text never reaches the UI.
- **Capabilities are declared, not assumed.** Providers advertise
  `canBrowseExisting`, `canCreateFolders`, `reportsUploadProgress` so the UI
  adapts instead of the provider faking behaviour.
- **Destinations are resolved as a list, not a single value.** "Both" is a
  first-class choice. Local is always first, so a partial failure still leaves the
  file on disk.
- **No `notifications`, no `<all_urls>`, no `tabs`, no analytics.** The
  permissions list in `src/manifest.config.ts` is intentionally minimal. The
  Chromium manifest additionally carries `offscreen` (no install-time warning),
  which exists solely so local saves can obtain a `blob:` URL.
- **Never assume a Window API exists in the background.** The service worker has
  no `URL.createObjectURL`, `document`, `FileReader`-backed DOM helpers, or
  `Image`. Anything that needs them goes through `src/offscreen/` or
  `OffscreenCanvas`.

## Files most likely to need editing

| You want to… | Touch |
| --- | --- |
| Change how a capture is taken | `src/capture/CaptureEngine.ts`, `src/capture/tabCapture.ts` |
| Add a new output format | `src/image/ImageProcessor.ts`, `src/pdf/PdfBuilder.ts`, `src/filename/template.ts` (`OUTPUT_FILE_INFO`) |
| Change local saving behaviour | `src/storage/local/LocalProvider.ts` |
| Change how the download URL is obtained | `src/storage/local/downloadUrl.ts`, `src/storage/local/blobHandoff.ts`, `src/offscreen/main.ts` |
| Add a new destination | implement `StorageProvider`, register in `src/storage/registry.ts`, add to `DESTINATION_MODES` in `src/storage/destination.ts`, surface in `src/options/sections/DestinationSection.tsx` |
| Add a setting | `src/settings/schema.ts`, `src/settings/defaults.ts`, the relevant section component under `src/options/sections/` |
| Tweak manifest keys | `src/manifest.config.ts` |
| Change build target split | `scripts/targets.mjs`, `vite.*.config.ts` |

## Tests

Vitest, Node environment. Specs live in `tests/` and mirror the layer they cover
(`errors.test.ts`, `filename.test.ts`, `local-provider.test.ts`,
`download-url.test.ts`, `pdf.test.ts`, `presets.test.ts`, `settings.test.ts`,
`storage-provider.test.ts`, `capture-config.test.ts`, `drive.test.ts`).

Conventions:

- One `describe` per exported unit. Test names read like sentences: `it('treats
  FILE_NO_SPACE as a disk-full error, not a save failure')`.
- The chrome global is stubbed at `tests/setup.ts`; tests that need richer
  behaviour pass in their own fakes rather than reaching for a framework.
- Tests assert on **observable behaviour**, not internals — a refactor that
  preserves public contracts should not need a test change.

## Privacy posture

SnapDock collects nothing. No analytics, no telemetry, no third-party endpoints.
Local saving keeps the capture on the user's device; Drive uses a single
`drive.file` scope that grants per-file access to files SnapDock itself created.
See `PRIVACY.md` for the human-readable version.
