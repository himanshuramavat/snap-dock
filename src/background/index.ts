// Must come first: aliases Firefox's promise-based `browser` onto `chrome` so the
// rest of the codebase can be written once against promises. See utils/browser.ts.
import '@/utils/browser';
import type { CaptureMode, CaptureRequest, ConnectionStatus } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import { registerHandlers, type AppState } from '@/utils/messaging';
import { SettingsStore } from '@/settings/SettingsStore';
import { PresetStore } from '@/presets/PresetStore';
import { DestinationStore } from '@/storage/DestinationStore';
import { googleDrive } from '@/storage/registry';
import { resolveDestinations } from '@/storage/destination';
import { STORAGE_KEYS } from '@/utils/storageArea';
import { toDestination } from '@/storage/StorageProvider';
import { resolveCaptureRequest } from '@/capture/requestConfig';
import { JobRunner } from './JobRunner';

/**
 * Service worker entry point.
 *
 * The worker is the only place business logic runs. Extension pages are thin views
 * that send messages and render state, which is what makes the popup disposable:
 * closing it during a region selection or a long upload changes nothing.
 *
 * Listeners are registered synchronously at the top level. Registering them inside
 * an async callback would miss events that woke the worker in the first place.
 */

const settingsStore = new SettingsStore();
const presetStore = new PresetStore();
const destinationStore = new DestinationStore();
const jobRunner = new JobRunner(destinationStore);

settingsStore.watch();

/** Connection status is polled on every popup open; cache it briefly. */
let connectionCache: { value: ConnectionStatus; at: number } | null = null;
const CONNECTION_TTL_MS = 30_000;

async function getConnection(force = false): Promise<ConnectionStatus> {
  if (!force && connectionCache && Date.now() - connectionCache.at < CONNECTION_TTL_MS) {
    return connectionCache.value;
  }
  const value = await googleDrive.getStatus();
  connectionCache = { value, at: Date.now() };
  return value;
}

function invalidateConnection(): void {
  connectionCache = null;
}

async function buildState(): Promise<AppState> {
  await jobRunner.hydrate();
  const [settings, presets, driveDestination, connection, stored] = await Promise.all([
    settingsStore.get(),
    presetStore.list(),
    destinationStore.get(),
    getConnection(),
    chrome.storage.local.get(STORAGE_KEYS.localDirectory),
  ]);
  const recorded = stored[STORAGE_KEYS.localDirectory];
  return {
    settings,
    presets,
    // What the UI shows and what a capture will use are the same thing.
    destinations: resolveDestinations(settings, driveDestination),
    driveDestination,
    localDirectory: typeof recorded === 'string' ? recorded : null,
    connection,
    job: jobRunner.getState(),
  };
}

/** Fills in whatever the caller left out from the user's saved defaults. */
async function resolveRequest(partial: Partial<CaptureRequest>): Promise<CaptureRequest> {
  const [settings, driveDestination] = await Promise.all([
    settingsStore.get(),
    destinationStore.get(),
  ]);
  // A preset may override the mode; otherwise the user's global setting applies.
  const mode = partial.destinations ? undefined : settings.destinationMode;
  return resolveCaptureRequest(
    partial,
    settings,
    resolveDestinations(settings, driveDestination, mode ?? settings.destinationMode),
  );
}

registerHandlers({
  'state/get': async () => {
    // Opening the popup is the user acknowledging whatever the badge was reporting.
    // (action.onClicked never fires while a default_popup is set, so this is the
    // only reliable place to clear it.)
    void chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
    return buildState();
  },

  'state/connection': async () => getConnection(true),

  'capture/start': async (request) => {
    const settings = await settingsStore.get();
    const resolved = await resolveRequest(request);
    if (resolved.destinations.length === 0) throw new AppError('NO_DESTINATION');
    return jobRunner.start(resolved, settings);
  },

  'capture/cancel': async ({ jobId }) => {
    jobRunner.cancel(jobId);
  },

  'capture/confirm': async ({ jobId, action }) => {
    await jobRunner.confirm(jobId, action);
  },

  'capture/job': async () => {
    await jobRunner.hydrate();
    return jobRunner.getState();
  },

  'capture/dismiss': async () => {
    await jobRunner.dismiss();
  },

  'drive/connect': async ({ fullAccess }) => {
    const status = await googleDrive.connect({
      interactive: true,
      ...(fullAccess ? { requestFullAccess: true } : {}),
    });
    connectionCache = { value: status, at: Date.now() };
    return status;
  },

  'drive/disconnect': async () => {
    await googleDrive.disconnect();
    await destinationStore.clear();
    invalidateConnection();
  },

  'drive/folders': async ({ parentId }) => googleDrive.getFolders(parentId),

  'drive/createFolder': async ({ name, parentId }) => googleDrive.createFolder(name, parentId),

  'drive/setDestination': async ({ destination }) => {
    // Confirm the folder is reachable before persisting it, so a bad choice fails
    // in the folder picker rather than at the end of the next capture.
    const folder = await googleDrive.resolveFolder(destination.folderId);
    await destinationStore.set(toDestination('google-drive', folder));
  },

  'settings/update': async ({ patch }) => settingsStore.update(patch),

  'settings/reset': async () => settingsStore.reset(),

  'presets/list': async () => presetStore.list(),

  'presets/save': async ({ preset }) => presetStore.save(preset),

  'presets/delete': async ({ id }) => presetStore.remove(id),

  'ui/openOptions': async () => {
    await chrome.runtime.openOptionsPage();
  },
});

/* ------------------------------------------------------------- lifecycle */

/**
 * On a fresh install the options page opens so the destination and defaults are
 * visible immediately. On an update the "What's New" page opens instead, which is
 * the only moment a changelog is actually worth showing anyone.
 */
chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await presetStore.seedIfEmpty();
    await settingsStore.ensureInitialized();

    if (details.reason === 'install') {
      await chrome.runtime.openOptionsPage().catch(() => undefined);
      return;
    }

    if (details.reason === 'update' && details.previousVersion !== currentVersion()) {
      await chrome.tabs
        .create({ url: chrome.runtime.getURL('changelog/changelog.html'), active: true })
        .catch(() => undefined);
    }
  })();
});

function currentVersion(): string {
  return chrome.runtime.getManifest().version;
}

chrome.runtime.onStartup.addListener(() => {
  invalidateConnection();
  void chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
});

/**
 * Keyboard shortcuts.
 *
 * Commands grant activeTab for the focused tab, exactly like a toolbar click, so
 * these paths need no extra permission. They intentionally bypass the preview step:
 * a shortcut is a request to capture now, not to open a dialog.
 */
const COMMAND_MODES: Record<string, CaptureMode> = {
  'capture-visible': 'visible',
  'capture-fullpage': 'fullpage',
  'capture-region': 'region',
};

chrome.commands.onCommand.addListener((command, tab) => {
  const captureMode = COMMAND_MODES[command];
  if (!captureMode) return;

  void (async () => {
    try {
      const settings = await settingsStore.get();
      const request = await resolveRequest({
        captureMode,
        skipPreview: true,
        ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
      });

      if (request.destinations.length === 0) {
        // Nothing to save into: send the user somewhere they can fix it rather than
        // failing silently on a keystroke with no UI open.
        await chrome.runtime.openOptionsPage();
        return;
      }

      await jobRunner.start(request, settings);
    } catch (error) {
      const appError = toAppError(error);
      console.error('[SnapDock] shortcut failed', appError.code, appError.details);
      await chrome.action.setBadgeText({ text: '!' }).catch(() => undefined);
      await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }).catch(() => undefined);
    }
  })();
});
