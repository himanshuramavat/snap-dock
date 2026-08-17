# Contributing

Thanks for taking an interest in SnapDock. Bug reports, ideas and pull requests are
all welcome.

If you are reporting a capture bug, the single most useful thing you can include is
**the URL of a page that reproduces it**, plus your browser and OS. Full-page
capture in particular succeeds or fails based on how a specific site is built.

## Getting set up

```bash
git clone https://github.com/himanshuramavat/snap-dock.git
cd snap-dock
npm install
npm run build
```

SnapDock is TypeScript and React, built with Vite, so unlike a plain-JS extension
it has a build step, which produces **two targets**, both git-ignored:

```
dist/          Chrome, Edge, Brave, Opera, Vivaldi
dist-firefox/  Firefox
```

Firefox is a sibling folder rather than a subfolder of `dist/`, because a nested second
`manifest.json` would be swept into the Chromium package.

They are the same bundle; only `manifest.json` differs. Chromium rejects
`background.scripts` under Manifest V3 and Firefox ignores
`background.service_worker`, so there is no single manifest both engines accept.

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/` |
| `npm run dev` | Rebuild the pages on change (see the note below) |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | typecheck, then tests, then a production build |
| `npm run icons` | Re-render `public/icons/` from the logo mark (needs Chrome on PATH) |
| `npm run keygen` | Generate the key that pins a stable Chromium extension ID |
| `npm run package` | Zip both targets into store-ready archives |
| `npm run lint:firefox` | Validate the Firefox target with `web-ext` |

> `npm run dev` watches the extension pages. The background and content scripts are
> built by separate passes, so re-run `npm run build:background` or
> `npm run build:content` after changing those. Neither browser hot-reloads an
> extension: use the reload control described below.

## Loading the extension

### Chrome, Edge, Brave, Opera, Vivaldi

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select **`dist`**.
   The repository root has no `manifest.json`; it is generated per target by the build.

> After a rebuild, click the **↻ reload** icon on the extension card, then reopen
> the popup.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `dist-firefox/manifest.json`.
3. Click **Reload** on the card after each rebuild.

Or let `web-ext` do it, which reloads automatically:

```bash
npx web-ext run --source-dir=dist-firefox
```

Before opening a pull request that touches the manifest or any browser API, check
Firefox is still happy:

```bash
npm run lint:firefox
```

That should report **0 errors**. It reports two expected warnings: the Chromium-only
`identity.getAuthToken` calls, which sit behind a capability guard and never run on
Firefox, and React's internal `innerHTML` in the vendor chunk. See *Cross-browser
notes* below.

> Temporary add-ons are removed when Firefox restarts. For a permanent install,
> publish to [AMO](https://addons.mozilla.org/developers/).

### Google Drive (optional)

The Drive destination needs a one-time OAuth setup, and each browser needs its own
client. Saving to your device works without any of it.
See [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md).

## Project structure

```
snap-dock/
├── src/
│   ├── manifest.config.ts   # Manifest V3, generated at build time (Chrome + Firefox)
│   ├── background/           # Service worker / event page: owns all business logic
│   ├── content/              # Region-select overlay, injected on demand
│   ├── popup/                # Capture UI (popup.html)
│   ├── options/              # Settings UI (options.html)
│   ├── ui/                   # Shared design system: tokens, primitives, icons
│   ├── capture/              # Tabs, scrolling, stitching
│   ├── image/                # Canvas, scaling, encoding
│   ├── pdf/                  # PDF writer and layout engine
│   ├── auth/                 # OAuth: managed tokens (Chromium) and PKCE (Firefox)
│   ├── storage/              # StorageProvider interface, Local + GoogleDrive
│   ├── settings/             # Schema, validation, migrations
│   ├── presets/              # Reusable capture configurations
│   ├── filename/             # Template expansion and sanitisation
│   └── utils/                # Errors, messaging, storage areas, browser shim
├── public/                   # Copied verbatim into dist/
│   ├── icons/                # icon16 / icon48 / icon128
│   ├── _locales/en/          # i18n strings
│   └── changelog/            # "What's New" page, opens on update
├── scripts/                  # Icon generation, keygen, build targets, packaging
├── store-assets/             # Store listing copy, images and promo video
├── docs/                     # Architecture, OAuth setup, publishing, testing
├── tests/                    # Unit tests
├── PRIVACY.md
├── LICENSE
├── README.md
└── CONTRIBUTING.md
```

## How it works

| Concern | Approach |
| --- | --- |
| Where logic lives | The background owns everything. The popup is a view that can be closed mid-capture without consequence, which matters because it *is* closed the moment you drag a region selection. |
| Progress | Job state is mirrored into `storage.session`, so reopening the popup reattaches to a capture already in flight. |
| Full-page capture | Driven by where the page *actually* scrolled to, not where it was asked to go. That one decision handles short final segments, clamped scrolling, and pages that grow while being captured. |
| Image work | `OffscreenCanvas` in the background, so a 40 MB capture is never serialised across a context boundary and the popup never blocks. |
| PDF | A small hand-written PDF writer, so a JPEG band is embedded byte-for-byte and compressed exactly once. |
| Destinations | Everything goes through `StorageProvider`. The capture, image, PDF and filename layers never import a provider, which is how local saving was added without touching any of them. |
| Errors | A closed set of codes with human-facing copy. `code` is for logic, `message` is for humans, and raw exception text never reaches the UI. |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the long version, including the
reasoning behind the choices that look unusual.

## Cross-browser notes

One manifest serves both engines, and where they disagree both keys are present:

- **Background.** Chromium runs `background.service_worker` and hard-errors on
  `background.scripts` under MV3; Firefox needs `scripts` and ignores
  `service_worker`. No single manifest satisfies both, so the build emits one per
  target from `src/manifest.config.ts`. See `scripts/targets.mjs`.
- **Promises.** Firefox puts promise-based APIs on `browser` and keeps `chrome`
  callback-based; Chromium's `chrome` returns promises. `src/utils/browser.ts`
  aliases the two so the codebase is written once against promises. Every entry
  point imports it first.
- **OAuth.** `identity.getAuthToken` is Chromium-only. Firefox uses
  `identity.launchWebAuthFlow` with PKCE. The choice is made by feature detection,
  not by sniffing the engine, and the Chromium-only calls are all behind that guard,
  which is why lint flags them but they never run on Firefox.
- **The Firefox add-on ID is load-bearing.** `identity.getRedirectURL()` derives the
  OAuth redirect from it, so `browser_specific_settings.gecko.id` must stay stable
  or Google sign-in on Firefox breaks.

## Guidelines

- **Match the surrounding style.** Comments explain *why*, not *what*. If a line
  looks odd, the comment should say what forced it.
- **No em dashes** in code, comments, UI copy or docs.
- **No `innerHTML`.** Build DOM nodes explicitly, especially in the content script,
  which runs inside somebody else's page.
- **Business logic stays testable.** Anything worth a test should not need a browser:
  inject the dependency instead. See `tests/` for the pattern.
- **Add a test when you fix a bug.** Every test in `tests/filename.test.ts` and
  `tests/local-provider.test.ts` exists because something was actually wrong.
- **Keep dependencies out.** Check whether the platform already does it. The PDF
  writer and the icon generator both exist because the alternative was a large
  dependency for a small need.
- **Do not add analytics, telemetry, or any third-party endpoint.** This is not
  negotiable; it is the product's main promise.
- **Never commit secrets.** `.env`, `key.pem` and `*.crx` are git-ignored.

## Submitting changes

1. Fork and branch from `main`.
2. Make your change, and add or update tests.
3. Run `npm run verify`. It must pass.
4. If you touched the manifest or a browser API, run `npm run lint:firefox` and
   confirm 0 errors, and load `dist` in Chrome to confirm no manifest error.
5. Walk the relevant part of [docs/TESTING.md](docs/TESTING.md). Capture behaviour
   cannot be fully covered by unit tests, so the manual checklist matters.
6. Add a `changelog/changelog.js` entry if the change is user-visible.
7. Open a pull request describing what changed and why, and how you verified it.

Small, focused pull requests get reviewed faster than large ones.
