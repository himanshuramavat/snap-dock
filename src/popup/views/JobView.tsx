import { useState } from 'react';
import type { JobPhase } from '@/types';
import type { JobState } from '@/utils/messaging';
import { send } from '@/utils/messaging';
import { toAppError } from '@/utils/errors';
import { Banner, Button, formatBytes, ProgressBar } from '@/ui/components';
import { IconCheckCircle, IconExternal, IconFolder } from '@/ui/icons';
import { PROVIDER_LABELS } from '@/storage/destination';

/**
 * Everything that happens after "Capture & Save" is pressed: progress, the optional
 * preview step, the success state, and failures.
 *
 * Progress is reported per phase with an honest ratio, and indeterminate phases say so
 * with a travelling bar instead of inventing a percentage.
 */

/**
 * Stable heading per phase, so the line above the bar does not flicker as the
 * worker's detailed status changes underneath it.
 */
const PHASE_TITLES: Partial<Record<JobPhase, string>> = {
  preparing: 'Getting ready',
  capturing: 'Capturing',
  stitching: 'Capturing full page',
  processing: 'Processing image',
  'generating-pdf': 'Building PDF',
  uploading: 'Saving',
};

export function JobView({
  job,
  onDone,
  onRetry,
}: {
  job: JobState;
  onDone: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (action: () => void | Promise<unknown>): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(toAppError(cause).userMessage);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- success */

  if (job.progress.phase === 'done' && job.result) {
    const { result } = job;
    const saved = result.outcomes.filter((outcome) => outcome.status === 'saved');
    const problems = result.outcomes.filter((outcome) => outcome.status !== 'saved');
    const partial = saved.length > 0 && problems.length > 0;

    return (
      <div className="sd-job">
        <div className="sd-result">
          <IconCheckCircle
            size={34}
            className="sd-result__icon"
            style={partial ? { color: 'var(--sd-warning)' } : undefined}
          />
          <span className="sd-result__name">{result.filename}</span>
          <span className="sd-result__meta">
            {saved.map((outcome) => PROVIDER_LABELS[outcome.providerId]).join(' and ')} ·{' '}
            {formatBytes(result.bytes)}
            {job.pageCount ? ` · ${job.pageCount} page${job.pageCount === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        {/*
          Partial success is reported plainly. The capture reached at least one
          destination, and saying so is more useful than a bare error, but hiding the
          failure would leave the user believing a copy exists where it does not.
        */}
        {problems.map((outcome) => (
          <Banner key={outcome.providerId} tone="warning">
            {PROVIDER_LABELS[outcome.providerId]}: {outcome.message ?? 'Not saved.'}
          </Banner>
        ))}

        {job.truncated ? (
          <Banner tone="warning">
            This page was longer than the capture limit, so only the top part was captured. You can
            raise the limit in Settings.
          </Banner>
        ) : null}

        <div className="sd-stack" style={{ gap: 7 }}>
          {saved.map((outcome, index) =>
            outcome.providerId === 'local' ? (
              <Button
                key={outcome.providerId}
                variant={index === 0 ? 'primary' : 'default'}
                block
                icon={<IconFolder size={14} />}
                onClick={() => {
                  // A local file has no URL, so reveal it in the OS file manager.
                  if (outcome.file?.downloadId !== undefined) {
                    chrome.downloads.show(outcome.file.downloadId);
                  }
                }}
              >
                Show in folder
              </Button>
            ) : (
              <Button
                key={outcome.providerId}
                variant={index === 0 ? 'primary' : 'default'}
                block
                icon={<IconExternal size={14} />}
                onClick={() => {
                  if (outcome.file?.webUrl) void chrome.tabs.create({ url: outcome.file.webUrl });
                }}
              >
                Open in Google Drive
              </Button>
            ),
          )}

          {problems.some((outcome) => outcome.retryable) ? (
            <Button block loading={busy} onClick={() => void act(onRetry)}>
              Try the failed destination again
            </Button>
          ) : null}

          <Button block onClick={() => void onDone()}>
            Capture another
          </Button>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- error */

  if (job.progress.phase === 'error') {
    const cancelled = job.error?.code === 'CAPTURE_CANCELLED';
    return (
      <div className="sd-job">
        {cancelled ? (
          <Banner tone="info">Capture cancelled.</Banner>
        ) : (
          <Banner tone="error">{job.error?.userMessage ?? 'Something went wrong.'}</Banner>
        )}
        <div className="sd-stack" style={{ gap: 7 }}>
          {job.error?.retryable !== false && !cancelled ? (
            <Button variant="primary" block loading={busy} onClick={() => void act(onRetry)}>
              Try again
            </Button>
          ) : null}
          <Button block onClick={() => void onDone()}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- preview */

  if (job.progress.phase === 'awaiting-preview') {
    return (
      <div className="sd-job">
        {job.previewDataUrl ? (
          <div className="sd-preview">
            <img src={job.previewDataUrl} alt="Preview of the capture" />
          </div>
        ) : null}

        <dl className="sd-meta-grid">
          <dt>File</dt>
          <dd>{job.filename}</dd>
          <dt>Size</dt>
          <dd>
            {job.outputBytes ? formatBytes(job.outputBytes) : 'Unknown'}
            {job.pageCount ? ` · ${job.pageCount} page${job.pageCount === 1 ? '' : 's'}` : ''}
          </dd>
        </dl>

        {job.truncated ? (
          <Banner tone="warning">
            This page was longer than the capture limit, so only the top part was captured.
          </Banner>
        ) : null}

        {actionError ? <Banner tone="error">{actionError}</Banner> : null}

        <div className="sd-stack" style={{ gap: 7 }}>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={() => void act(() => send('capture/confirm', { jobId: job.id, action: 'save' }))}
          >
            Save to Google Drive
          </Button>
          <Button
            block
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await send('capture/confirm', { jobId: job.id, action: 'discard' });
                await onDone();
              })
            }
          >
            Discard
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ progress */

  const selecting = job.progress.label.startsWith('Select an area');
  const title = selecting
    ? 'Waiting for your selection'
    : (PHASE_TITLES[job.progress.phase] ?? 'Working…');
  // Only show the detail line when it says something the heading does not.
  const detail = job.progress.label && job.progress.label !== title ? job.progress.label : '';

  return (
    <div className="sd-job">
      <div className="sd-job__phase">
        <span className="sd-spinner" style={{ color: 'var(--sd-accent)' }} />
        <span>{title}</span>
      </div>

      {selecting ? (
        <p className="sd-hint" style={{ margin: 0 }}>
          Drag on the page to choose an area. Press <kbd>Esc</kbd> to cancel. You can close this
          popup. SnapDock will keep going.
        </p>
      ) : (
        <>
          <ProgressBar ratio={job.progress.ratio} />
          <span className="sd-job__label">{detail}</span>
        </>
      )}

      {actionError ? <Banner tone="error">{actionError}</Banner> : null}

      <Button
        block
        disabled={busy}
        onClick={() => void act(() => send('capture/cancel', { jobId: job.id }))}
      >
        Cancel
      </Button>
    </div>
  );
}
