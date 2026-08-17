import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteFolder, Settings } from '@/types';
import { send, type AppState } from '@/utils/messaging';
import { toAppError } from '@/utils/errors';
import type { DeepPartial } from '@/settings/SettingsStore';
import { Banner, Button } from '@/ui/components';
import { Logo } from '@/ui/Logo';
import { ExternalLinks } from '@/ui/ExternalLinks';
import { FolderPicker } from '@/popup/components/FolderPicker';
import { GeneralSection } from './sections/GeneralSection';
import { DestinationSection } from './sections/DestinationSection';
import { FilenameSection } from './sections/FilenameSection';
import { PdfSection } from './sections/PdfSection';
import { PresetsSection } from './sections/PresetsSection';
import { AdvancedSection } from './sections/AdvancedSection';

/**
 * Settings page.
 *
 * Changes save as you make them. There is no Save button, because a settings page
 * with one invites the user to lose work by closing the tab. Writes are debounced so
 * dragging a slider is one storage write rather than forty.
 */

const SAVE_DEBOUNCE_MS = 250;

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const pending = useRef<DeepPartial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await send('state/get'));
      setError(null);
    } catch (cause) {
      setError(toAppError(cause).userMessage);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  /**
   * Applies a settings patch optimistically, then persists it after a short pause.
   * The local state updates immediately so controls stay responsive under a drag.
   */
  const updateSettings = useCallback(
    (patch: DeepPartial<Settings>) => {
      setState((previous) =>
        previous ? { ...previous, settings: mergeLocal(previous.settings, patch) } : previous,
      );
      pending.current = mergeLocal(pending.current as Settings, patch) as DeepPartial<Settings>;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const queued = pending.current;
        pending.current = {};
        void send('settings/update', { patch: queued })
          .then((settings) => {
            setState((previous) => (previous ? { ...previous, settings } : previous));
            showToast('Saved');
          })
          .catch((cause: unknown) => setError(toAppError(cause).userMessage));
      }, SAVE_DEBOUNCE_MS);
    },
    [showToast],
  );

  const reset = useCallback(async () => {
    const settings = await send('settings/reset');
    setState((previous) => (previous ? { ...previous, settings } : previous));
    showToast('Settings reset');
  }, [showToast]);

  const chooseFolder = useCallback(
    async (folder: RemoteFolder) => {
      await send('drive/setDestination', {
        destination: {
          providerId: 'google-drive',
          folderId: folder.id,
          folderName: folder.name,
          folderPath: folder.path,
        },
      });
      await load();
      setPicking(false);
      showToast('Destination updated');
    },
    [load, showToast],
  );

  if (!state) {
    return (
      <div className="sd-options">
        {error ? (
          <Banner tone="error" action={<Button onClick={() => void load()}>Try again</Button>}>
            {error}
          </Banner>
        ) : (
          <div className="sd-empty">
            <span className="sd-spinner" style={{ color: 'var(--sd-text-subtle)' }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sd-options">
      <header className="sd-options__header">
        <Logo size={40} />
        <div>
          <h1 className="sd-options__title">SnapDock</h1>
          <span className="sd-options__tagline">Capture. Configure. Save.</span>
        </div>
      </header>

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      <GeneralSection settings={state.settings} onChange={updateSettings} />

      {picking ? (
        <section className="sd-panel">
          <div className="sd-panel__body" style={{ padding: 18 }}>
            <FolderPicker
              connection={state.connection}
              onSelect={chooseFolder}
              onClose={() => setPicking(false)}
              onConnectionChange={(connection) =>
                setState((previous) => (previous ? { ...previous, connection } : previous))
              }
            />
          </div>
        </section>
      ) : (
        <DestinationSection
          settings={state.settings}
          connection={state.connection}
          driveDestination={state.driveDestination}
          localDirectory={state.localDirectory}
          onChange={updateSettings}
          onChanged={load}
          onChangeFolder={() => setPicking(true)}
        />
      )}

      <FilenameSection settings={state.settings} onChange={updateSettings} />

      <PdfSection settings={state.settings} onChange={updateSettings} />

      <PresetsSection
        presets={state.presets}
        settings={state.settings}
        driveDestination={state.driveDestination}
        onChanged={(presets) => setState((previous) => (previous ? { ...previous, presets } : previous))}
      />

      <AdvancedSection settings={state.settings} onChange={updateSettings} onReset={() => void reset()} />

      <div className="sd-options__footer">
        <ExternalLinks />
        <p className="sd-footer-note">
          Captures go straight from this browser to the destination you choose.
          <br />
          SnapDock collects no analytics and sends your screenshots nowhere else.
        </p>
      </div>

      {toast ? (
        <div className="sd-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/** Local mirror of the store's merge, so the UI updates before the round-trip. */
function mergeLocal<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    const bothObjects =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing);
    out[key] = bothObjects
      ? mergeLocal(existing as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out as T;
}
