<p align="center">
  <img src="public/icons/icon128.png" width="96" height="96" alt="SnapDock icon" />
</p>

<h1 align="center">SnapDock</h1>

<p align="center">Capture. Configure. Save. High-quality screenshots and PDFs, saved where you want them.</p>

<!-- TODO: replace # with the real store listing URLs after publishing. -->
<p align="center">
  <a href="#" title="Chrome Web Store">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/chrome/chrome.svg" width="56" alt="Add to Chrome" valign="middle" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#" title="Brave">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/brave/brave.svg" width="56" alt="Add to Brave" valign="middle" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#" title="Mozilla Add-ons">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/firefox/firefox.svg" width="56" alt="Add to Firefox" valign="middle" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#" title="Microsoft Edge Add-ons">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/edge/edge.svg" width="56" alt="Add to Edge" valign="middle" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#" title="Opera Add-ons">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/opera/opera.svg" width="56" alt="Add to Opera" valign="middle" />
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="#" title="Vivaldi">
    <img src="https://raw.githubusercontent.com/alrra/browser-logos/90fdf03c/src/vivaldi/vivaldi.svg" width="56" alt="Add to Vivaldi" valign="middle" />
  </a>
</p>

## What is this?

Browser screenshot tools usually make you choose: quick but low quality, or good
but a five-step download-and-re-upload dance. **SnapDock** captures the visible
area, a region you drag, or an entire scrolling page, lets you set the format and
quality, and saves the result straight to your device, to a Google Drive folder,
or to both at once.

It works the second you install it. Saving to your device needs no account, no
sign-in and no setup. Google Drive is optional, for when you want a capture synced
or shareable.

No servers, no analytics, no telemetry. Captures go from your browser to the
destination you picked and nowhere else.

## How to use

1. Click the SnapDock icon in your toolbar.
2. Pick **Visible**, **Area**, or **Full page**.
3. Pick **PNG**, **JPEG**, **WebP**, or **PDF**.
4. Press **Capture & Save**.

The file lands in `Downloads/SnapDock`. Four clicks the first time, one click
every time after, because your choices are remembered.

Prefer the keyboard? <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> captures the
visible area, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> the full page, and
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> starts a region selection, all
without opening the popup.

## Features

**Capture**

- Visible viewport, a dragged region, or the full scrolling page
- Full-page capture scrolls, stitches, hides sticky headers so they do not repeat,
  waits for lazy-loaded images, and restores your scroll position afterwards
- The region overlay shows live dimensions and cancels on <kbd>Esc</kbd>

**Output**

- PNG, JPEG and WebP with configurable quality and resolution
- PDF with paper size (A4, A3, Letter, Legal, fit-to-image, custom), orientation,
  margins, scale, fit-to-page, and multi-page splitting for long captures
- Quality-first defaults: lossless PNG at native capture resolution

**Destinations**

- **This device** (default): a folder inside your browser download location, with
  the folder name configurable
- **Google Drive** (optional): connect, browse folders, and save into one
- **Both**: one capture, written to your disk and your Drive
- Partial failures are reported honestly. If Drive is unreachable you are told the
  file is safe on disk, with a retry for just that destination

**Workflow**

- Filename templates: `{date}`, `{time}`, `{domain}`, `{title}` and more, with a
  live preview
- Presets, so one click runs a whole configuration
- Optional preview step before saving

## Install from source

```bash
git clone https://github.com/himanshuramavat/snap-dock.git
cd snap-dock
npm install
npm run build
```

The build produces two targets. Load the one for your browser:

| Browser | Load this folder |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi | `dist` |
| Firefox | `dist-firefox` |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the per-browser steps.

Only the Google Drive destination needs extra setup, and it is optional:
[docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md).

## Browser support

One codebase and one bundle, built into a target per engine.

| Browser | Minimum | Google sign-in |
| --- | --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi | 116 | The browser's own token store |
| Firefox | 140 desktop, 142 Android | OAuth authorization code flow with PKCE |

Windows, macOS and Linux are all supported. Filenames are sanitised against the
union of all three platforms' rules, paths are length-capped for Windows, and the
save location shown in Settings is read back from the real download rather than
guessed.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Capture and read the title/URL of the tab you acted on, with no broad host access |
| `scripting` | Inject the page-measurement probe and the region-select overlay |
| `storage` | Persist your settings, presets and chosen destination |
| `downloads` | Save captures to your device, the default destination |
| `identity` | Google sign-in, only for the optional Drive destination |
| `googleapis.com`, `accounts.google.com` | The Drive API and its consent screen |

Deliberately **not** requested: `tabs`, `notifications`, `<all_urls>`, or any host
wildcard. There are no persistent content scripts, so a page you never capture
never runs SnapDock code.

Google Drive uses a single scope, `drive.file`, which grants access only to files
and folders SnapDock itself creates. Nothing is requested at all until you connect.

## Privacy

SnapDock collects nothing. No analytics, no telemetry, no third-party endpoints, no
server component. With the default local destination your captures never leave your
machine. Full detail in [PRIVACY.md](PRIVACY.md).

## Contributing

Bug reports, ideas and pull requests are all welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for local setup, the project layout, and how the
capture pipeline fits together. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) goes
deeper on why the design is shaped the way it is.

## License

[MIT](LICENSE)

## Author

**Himanshu Ramavat**

- Website: [himanshuramavat.in](https://himanshuramavat.in/)
- LinkedIn: [himanshu-ramavat](https://www.linkedin.com/in/himanshu-ramavat)
- GitHub: [himanshuramavat](https://github.com/himanshuramavat)
- X: [@iamhimanshu_7](https://x.com/iamhimanshu_7)

## Disclaimer

SnapDock is an independent project and is not affiliated with, endorsed by, or
sponsored by Google. Google Drive and Google are trademarks of Google LLC.
