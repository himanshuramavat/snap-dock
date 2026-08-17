import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CaptureMode,
  CaptureRequest,
  DestinationMode,
  OutputType,
  Preset,
  RemoteFolder,
} from '@/types';
import { send } from '@/utils/messaging';
import { toAppError, type SerializedError } from '@/utils/errors';
import { Banner, Button, IconButton } from '@/ui/components';
import { IconSettings } from '@/ui/icons';
import { Logo, Wordmark } from '@/ui/Logo';
import { ExternalLinks } from '@/ui/ExternalLinks';
import { useAppState } from './useAppState';
import { CaptureView } from './views/CaptureView';
import { SavedNotice } from './components/SavedNotice';
import { JobView } from './views/JobView';
import { FolderPicker } from './components/FolderPicker';

/**
 * Popup shell and routing.
 *
 * The popup holds exactly one piece of state of its own: the draft capture choices
 * before they are submitted. Everything else is read from the service worker, which
 * is what lets this window be closed at any point without consequence.
 */

type Screen = 'capture' | 'picker';

/**
 * How long a "saved" confirmation stays on screen.
 *
 * Measured from when the save actually finished, not from when the popup opened.
 * That distinction is the whole point: a finished job lives in session storage until it
 * is cleared, so timing from popup-open would re-show the same confirmation every time
 * the popup was reopened, turning it into a history log.
 */
const SAVED_NOTICE_MS = 5000;
/** Length of the fade-out, so the confirmation leaves rather than vanishing. */
const SAVED_NOTICE_FADE_MS = 260;

export function App() {
  const { state, loading, error, refresh, patch } = useAppState();
  const [screen, setScreen] = useState<Screen>('capture');
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [outputType, setOutputType] = useState<OutputType | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<SerializedError | null>(null);
  const lastRequest = useRef<Partial<CaptureRequest> | null>(null);
  const [noticeState, setNoticeState] = useState<'hidden' | 'shown' | 'leaving'>('hidden');
  /** Guards against re-requesting a clear for a job already cleared. */
  const clearedJobId = useRef<string | null>(null);

  // Seed the draft from saved defaults once state arrives, then leave it alone so a
  // settings change in another window cannot yank the user's choice out from under them.
  useEffect(() => {
    if (!state) return;
    setCaptureMode((previous) => previous ?? state.settings.defaultCaptureMode);
    setOutputType((previous) => previous ?? state.settings.defaultOutputType);
  }, [state]);

  const job = state?.job ?? null;

  /*
   * A clean success needs no screen of its own.
   *
   * The file is saved; making the user dismiss a confirmation before they can capture
   * again is a click that buys nothing, and the browser already surfaces its own
   * download notification. So a fully successful save drops straight back to the
   * capture view with a short confirmation line, and clears itself.
   *
   * Anything that needs a decision still gets the full view: a failure, a partial save
   * where one destination worked and another did not, and the preview step.
   */
  const cleanSuccess =
    job !== null &&
    job.progress.phase === 'done' &&
    job.result !== undefined &&
    job.result.outcomes.every((outcome) => outcome.status === 'saved')
      ? job
      : null;

  const jobIsLive = job !== null && job.progress.phase !== 'idle' && cleanSuccess === null;

  const buildRequest = useCallback((): Partial<CaptureRequest> => {
    if (!state) return {};
    const mode = captureMode ?? state.settings.defaultCaptureMode;
    const output = outputType ?? state.settings.defaultOutputType;

    return {
      captureMode: mode,
      outputType: output,
      image: {
        ...(preset?.image ?? state.settings.image),
        // For image output the chosen format *is* the output type; the format field
        // on ImageConfig only carries its own meaning when producing a PDF.
        format: output === 'pdf' ? (preset?.image ?? state.settings.image).format : output,
      },
      pdf: preset?.pdf ?? state.settings.pdf,
      filenameTemplate: preset?.filenameTemplate ?? state.settings.filename.template,
    };
  }, [state, captureMode, outputType, preset]);

  const startCapture = useCallback(
    async (request?: Partial<CaptureRequest>) => {
      const payload = request ?? buildRequest();
      lastRequest.current = payload;
      setStarting(true);
      setStartError(null);
      try {
        await send('capture/start', payload);
        // The worker writes job state to session storage; useAppState picks it up.
        await refresh();
      } catch (cause) {
        setStartError(toAppError(cause).toJSON());
      } finally {
        setStarting(false);
      }
    },
    [buildRequest, refresh],
  );

  const applyPreset = useCallback(
    (next: Preset) => {
      setPreset(next);
      setCaptureMode(next.captureMode);
      setOutputType(next.outputType);
      void startCapture({
        captureMode: next.captureMode,
        outputType: next.outputType,
        image: next.image,
        pdf: next.pdf,
        filenameTemplate: next.filenameTemplate,
      });
    },
    [startCapture],
  );

  const selectFolder = useCallback(
    async (folder: RemoteFolder) => {
      await send('drive/setDestination', {
        destination: {
          providerId: 'google-drive',
          folderId: folder.id,
          folderName: folder.name,
          folderPath: folder.path,
        },
      });
      await refresh();
      setScreen('capture');
    },
    [refresh],
  );

  const showCaptureFooter = Boolean(state) && screen === 'capture' && !jobIsLive && !loading && !error;
  // Local saving needs no account, so a destination is the only requirement. Drive
  // additionally needs a live connection, which resolveDestination already accounts
  // for by returning null when the folder is not set.
  // Local saving needs no account, so having at least one resolved destination is the
  // only requirement. Only Drive-alone-without-a-folder produces an empty list.
  const canCapture = (state?.destinations.length ?? 0) > 0;

  const changeMode = useCallback(
    async (destinationMode: DestinationMode) => {
      await send('settings/update', { patch: { destinationMode } });
      await refresh();
    },
    [refresh],
  );

  const dismissJob = useCallback(async () => {
    await send('capture/dismiss');
    await refresh();
  }, [refresh]);

  /*
   * Shows the confirmation only while it is still news, then clears it for good.
   *
   * A save that finished longer ago than the window is not displayed at all, so
   * reopening the popup later goes straight to a ready capture screen. The stale job is
   * cleared from session storage at the same time, guarded by id so a failed clear
   * cannot turn into a request loop.
   */
  useEffect(() => {
    if (!cleanSuccess) {
      setNoticeState('hidden');
      return;
    }

    const finishedAt = cleanSuccess.finishedAt ?? cleanSuccess.startedAt;
    const remaining = SAVED_NOTICE_MS - (Date.now() - finishedAt);

    const clearOnce = (): void => {
      if (clearedJobId.current === cleanSuccess.id) return;
      clearedJobId.current = cleanSuccess.id;
      void dismissJob();
    };

    if (remaining <= 0) {
      setNoticeState('hidden');
      clearOnce();
      return;
    }

    setNoticeState('shown');
    const fade = setTimeout(
      () => setNoticeState('leaving'),
      Math.max(0, remaining - SAVED_NOTICE_FADE_MS),
    );
    const remove = setTimeout(() => {
      setNoticeState('hidden');
      clearOnce();
    }, remaining);

    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [cleanSuccess, dismissJob]);

  return (
    <div className="sd-popup">
      <header className="sd-popup__header">
        <Logo size={32} />
        <div className="sd-popup__title">
          <span className="sd-popup__name">
            <Wordmark />
          </span>
          <span className="sd-popup__tagline">Capture. Configure. Save.</span>
        </div>
        <IconButton label="Settings" onClick={() => void send('ui/openOptions')}>
          <IconSettings size={16} />
        </IconButton>
      </header>

      <main className="sd-popup__body">
        {loading ? (
          <div className="sd-empty">
            <span className="sd-spinner" style={{ color: 'var(--sd-text-subtle)' }} />
          </div>
        ) : error ? (
          <>
            <Banner tone="error">{error.userMessage}</Banner>
            <Button block onClick={() => void refresh()}>
              Try again
            </Button>
          </>
        ) : !state ? null : screen === 'picker' ? (
          <FolderPicker
            connection={state.connection}
            onSelect={selectFolder}
            onClose={() => setScreen('capture')}
            onConnectionChange={(connection) => patch({ connection })}
          />
        ) : jobIsLive && job ? (
          <JobView
            job={job}
            onDone={dismissJob}
            onRetry={async () => {
              await dismissJob();
              await startCapture(lastRequest.current ?? undefined);
            }}
          />
        ) : (
          <>
            {noticeState !== 'hidden' && cleanSuccess?.result ? (
              <SavedNotice result={cleanSuccess.result} leaving={noticeState === 'leaving'} />
            ) : null}
            <CaptureView
            captureMode={captureMode ?? state.settings.defaultCaptureMode}
            outputType={outputType ?? state.settings.defaultOutputType}
            mode={state.settings.destinationMode}
            connection={state.connection}
            destinations={state.destinations}
            presets={state.presets}
            onCaptureModeChange={(mode) => {
              setCaptureMode(mode);
              setPreset(null);
            }}
            onOutputTypeChange={(type) => {
              setOutputType(type);
              setPreset(null);
            }}
            onModeChange={(destinationMode) => void changeMode(destinationMode)}
            onApplyPreset={applyPreset}
            onChangeFolder={() => setScreen('picker')}
            onRefresh={refresh}
            />
          </>
        )}
      </main>

      {/*
        The primary action is pinned rather than sitting at the end of the scrolling
        body: on a short window the capture sections alone can fill the popup, and a
        "Capture & Save" button you have to scroll to find defeats the point.
      */}
      {showCaptureFooter ? (
        <footer className="sd-popup__footer">
          {startError ? <Banner tone="error">{startError.userMessage}</Banner> : null}
          <Button
            variant="primary"
            size="lg"
            loading={starting}
            disabled={!canCapture}
            onClick={() => void startCapture()}
          >
            Capture &amp; Save
          </Button>
        </footer>
      ) : null}

      {/*
        Outside the conditional footer on purpose: these are reachable from every
        screen, including while a capture is running or after one failed.
      */}
      <div className="sd-popup__links">
        <ExternalLinks />
      </div>
    </div>
  );
}
