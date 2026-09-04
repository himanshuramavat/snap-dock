/**
 * Manifest V3 definition, generated at build time so the OAuth client ids can come
 * from the environment instead of source control.
 *
 * One codebase, one bundle, but **two manifests**, because the engines disagree on keys
 * that neither will tolerate from the other:
 *
 *  - Chromium runs a module service worker and *rejects* `background.scripts` outright
 *    ("requires manifest version of 2 or lower"). Firefox's MV3 background is a
 *    non-persistent event page and ignores `background.service_worker`. There is no
 *    single spelling that satisfies both, so each target gets only its own key.
 *  - `browser_specific_settings.gecko.id` pins the Firefox add-on ID. That is not
 *    cosmetic: `identity.getRedirectURL()` derives the OAuth redirect from the ID, so
 *    without a fixed ID the redirect URL changes on every temporary install and Google
 *    sign-in cannot be registered at all. Chromium has no use for it.
 *  - `oauth2` and `key` are Chromium-only, read by `identity.getAuthToken`. Firefox
 *    takes the PKCE path instead (see src/auth/) and would only warn about them.
 *
 * The build therefore emits dist/chrome/ and dist/firefox/, differing only in
 * manifest.json. See docs/GOOGLE_OAUTH_SETUP.md for the OAuth values.
 */

/** Which engine a manifest is being generated for. */
export type BuildTarget = 'chromium' | 'firefox';

export interface ManifestBuildOptions {
  target: BuildTarget;
  /** OAuth 2.0 client id of type "Chrome Extension", used by Chromium. */
  googleClientId: string;
  /** Base64 public key that pins the unpacked Chromium extension to a stable ID. */
  extensionKey?: string;
  version: string;
}

/**
 * Scopes requested at install time: exactly one.
 *
 * `drive.file` grants per-file access limited to files and folders SnapDock itself
 * creates, so connecting the extension exposes none of the user's existing Drive.
 * The connected account's email is read from Drive's own `about.get`, which
 * `drive.file` already covers, so no profile scope is needed either.
 *
 * Full-Drive browsing is an explicit, user-initiated upgrade requested at runtime
 * (see src/auth/scopes.ts); a user who never asks for it never grants it.
 */
export const BASE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

/** Firefox add-on ID. The OAuth redirect URL derives from this, so it must stay stable. */
export const GECKO_ID = 'snap-dock@himanshuramavat';

export const HOMEPAGE_URL = 'https://github.com/himanshuramavat/snap-dock';

export function buildManifest(options: ManifestBuildOptions): Record<string, unknown> {
  const forFirefox = options.target === 'firefox';

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: '__MSG_extensionName__',
    short_name: 'SnapDock',
    version: options.version,
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    author: 'Himanshu Ramavat',
    homepage_url: HOMEPAGE_URL,

    icons: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },

    action: {
      default_popup: 'popup/popup.html',
      default_title: '__MSG_extensionTitle__',
      default_icon: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },

    /*
     * The one key that cannot be shared. Chromium hard-errors on `scripts` under MV3,
     * and Firefox ignores `service_worker`, so each target declares only its own.
     */
    background: forFirefox
      ? { scripts: ['assets/background.js'], type: 'module' }
      : { service_worker: 'assets/background.js', type: 'module' },

    options_ui: {
      page: 'options/options.html',
      open_in_tab: true,
    },

    /**
     * Minimum viable permission set.
     * - activeTab  : grants tab url/title + captureVisibleTab for the tab the user
     *                acted on, without any broad host permission.
     * - scripting  : injects the page-metrics probe and the region-select overlay.
     * - storage    : persists settings, presets and the chosen destination.
     * - downloads  : saves captures to the user's device, the default destination.
     * - identity   : Google sign-in for the optional Google Drive destination.
     *
     * Deliberately absent: 'tabs' (activeTab already yields url/title for the tab
     * the user acted on), 'notifications', and any host wildcard.
     */
    permissions: ['activeTab', 'scripting', 'storage', 'downloads', 'identity'],

    /**
     * Only Google's own endpoints. accounts.google.com is needed by Firefox's PKCE
     * flow, which loads the consent screen through identity.launchWebAuthFlow.
     */
    host_permissions: [
      'https://www.googleapis.com/*',
      'https://oauth2.googleapis.com/*',
      'https://accounts.google.com/*',
    ],

    commands: {
      'capture-visible': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: '__MSG_commandCaptureVisible__',
      },
      'capture-fullpage': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: '__MSG_commandCaptureFullPage__',
      },
      'capture-region': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '__MSG_commandCaptureRegion__',
      },
    },

    /*
     * Matches Manifest V3's own default. Stated explicitly so that weakening it
     * later has to be a deliberate edit. Remote code of any kind is disallowed;
     * everything the extension runs ships inside the package.
     */
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };

  if (forFirefox) {
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        /* 140 for MV3 event pages with ES module background scripts. */
        strict_min_version: '140.0',
        /* SnapDock collects nothing. This is the machine-readable version of that. */
        data_collection_permissions: {
          required: ['none'],
        },
      },
      /*
       * `data_collection_permissions` only exists from Firefox for Android 142, so the
       * Android floor is raised separately. Without this the desktop minimum of 140
       * would advertise support for an Android version that cannot read the key.
       */
      gecko_android: {
        strict_min_version: '142.0',
      },
    };

    return manifest;
  }

  /* Chromium 116 for chrome.storage.session and stable MV3 scripting. */
  manifest.minimum_chrome_version = '116';

  /*
   * `oauth2` is omitted entirely when no client id is configured. An empty string
   * is not a valid client id and Chromium refuses to load a manifest containing one,
   * which would turn "you haven't set up OAuth yet" into "the extension won't
   * install", a much more confusing first run.
   */
  if (options.googleClientId) {
    manifest.oauth2 = {
      client_id: options.googleClientId,
      scopes: [...BASE_OAUTH_SCOPES],
    };
  }

  if (options.extensionKey) {
    manifest.key = options.extensionKey;
  }

  return manifest;
}
