# Privacy Policy - SnapDock

**Last updated:** 17 August 2026

The short version: **SnapDock collects nothing.** There is no server, no analytics,
no telemetry, and no third party involved. Your captures go from your browser to the
destination you chose and nowhere else.

## What the extension does

SnapDock takes a screenshot of a page you ask it to capture, converts it to the
image or PDF format you selected, and saves it to your device, to a Google Drive
folder you picked, or to both.

All capture and processing happens locally, inside your browser.

## Data collection

**SnapDock collects, stores and transmits no personal data to its author or to
anyone else.** There is no backend service to send anything to.

What SnapDock stores, and where:

| Data | Where it is stored | Leaves your machine? |
| --- | --- | --- |
| Your settings, presets, filename template | `storage.local`, in your browser profile | No |
| Your chosen Google Drive folder (id and name) | `storage.local` | No |
| The download folder of your last local save | `storage.local` | No |
| In-progress capture state | `storage.session`, memory only, cleared on restart | No |
| The captured image or PDF | In memory while processing, then written to your chosen destination | Only to your chosen destination |

None of this is readable by web pages, and none of it is sent anywhere.

**Captured images are never uploaded to any server operated by the author.** With
the default "This device" destination, a capture never leaves your computer at all.

## Page access

SnapDock reads a page only when you ask it to capture that page. It uses the
`activeTab` permission, which grants access to a single tab, only in response to
your click or keyboard shortcut, and only until you navigate away. It requests no
site-wide or wildcard host access.

There are no persistent content scripts. The region-selection overlay is injected
only when you choose the region capture mode, so a page you never capture never runs
SnapDock code.

From the page being captured, SnapDock reads its title, its URL, and its dimensions.
Title and URL are used solely to fill in the filename template you configured, and
they are never transmitted.

## Google Drive

The Google Drive destination is **optional and off by default**. If you never
connect it, no Google service is ever contacted and no permission is ever requested.

If you do connect it:

- SnapDock requests a **single OAuth scope**, `drive.file`, which grants access only
  to files and folders SnapDock itself creates. Your existing Drive files remain
  invisible to it.
- You may separately choose to grant broader access, in order to save into folders
  that already exist. That is always an explicit action taken by you, with its own
  consent screen, and it is never requested up front.
- Uploads go directly from your browser to Google's API. Nothing is proxied.
- **Access tokens are never written to disk by SnapDock.** On Chromium the browser
  holds the token in its own store and SnapDock never receives a refresh token. On
  Firefox, where no equivalent exists, a short-lived access token is held in
  session storage (memory only, cleared when the browser closes) and no refresh
  token is requested at all.
- Disconnecting revokes the grant with Google and clears the token. Files already
  uploaded stay in your Drive; SnapDock never deletes anything.

Your use of Google Drive is also governed by
[Google's Privacy Policy](https://policies.google.com/privacy).

## Data shared with third parties

**None.** No data is sold, rented, shared or transferred to anyone.

The only network requests SnapDock ever makes are to Google's own endpoints
(`googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`), and only when
you have connected the Google Drive destination and are saving to it.

## Children's privacy

SnapDock collects no data from anyone, of any age.

## Changes to this policy

Any change will be published in this file and noted in the extension's changelog.
The "last updated" date above will change accordingly.

## Contact

Questions, or a privacy concern? Open an issue at
[github.com/himanshuramavat/snap-dock/issues](https://github.com/himanshuramavat/snap-dock/issues).
