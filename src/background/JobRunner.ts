import type { CaptureRequest, DestinationRef, JobPhase, SaveOutcome, Settings } from '@/types';
import { AppError, toAppError } from '@/utils/errors';
import type { JobState } from '@/utils/messaging';
import { STORAGE_KEYS, localArea, sessionArea } from '@/utils/storageArea';
import { capture } from '@/capture/CaptureEngine';
import { resolveTargetTab } from '@/capture/tabCapture';
import { assertRenderable, renderImage, renderPreview } from '@/image/ImageProcessor';
import { buildPdf } from '@/pdf/PdfBuilder';
import { generateFilename, OUTPUT_FILE_INFO } from '@/filename/template';
import { DestinationStore } from '@/storage/DestinationStore';
import { getProvider, localDisk } from '@/storage/registry';
import { PROVIDER_LABELS } from '@/storage/destination';
import { formatBytes } from '@/utils/format';
import { acquireKeepAlive } from './keepAlive';
import { selectRegion } from './regionSelection';

/**
 * Owns the capture → configure → save pipeline.
 *
 * One job runs at a time. That is a product decision as much as a technical one:
 * two concurrent captures would fight over the same tab's scroll position and blow
 * through the captureVisibleTab quota, and no user has asked for it.
 *
 * Job state is mirrored into chrome.storage.session on every phase change, which is
 * what lets the popup close during region selection and reattach to a job already in
 * flight when the user opens it again.
 */

interface ActiveJob {
  state: JobState;
  controller: AbortController;
  /** Snapshot taken when the job started, so mid-flight settings edits can't alter it. */
  settings: Settings;
  /** Held in memory, never in storage: this can be tens of megabytes. */
  output?: { blob: Blob; filename: string };
  releaseKeepAlive: () => void;
}

const PROGRESS_WRITE_INTERVAL_MS = 120;

const PHASE_LABELS: Record<JobPhase, string> = {
  idle: '',
  preparing: 'Getting ready',
  capturing: 'Capturing',
  stitching: 'Stitching sections',
  processing: 'Processing image',
  'generating-pdf': 'Building PDF',
  'awaiting-preview': 'Ready to save',
  uploading: 'Saving',
  done: 'Saved',
  error: '',
};

export class JobRunner {
  private active: ActiveJob | null = null;
  /**
   * State recovered from session storage after the worker restarted. The job itself
   * is gone (its pixels lived in memory), but the outcome is still worth showing,
   * whether that is a completed upload or an honest "interrupted".
   */
  private restored: JobState | null = null;
  private lastWriteAt = 0;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly destinations = new DestinationStore()) {}

  getState(): JobState | null {
    return this.active?.state ?? this.restored;
  }

  /** Restores job state after a service-worker restart so the popup isn't left blank. */
  async hydrate(): Promise<void> {
    if (this.active || this.restored) return;

    const stored = await sessionArea().get(STORAGE_KEYS.activeJob);
    const state = stored[STORAGE_KEYS.activeJob] as JobState | undefined;
    if (!state) return;

    // A job that was mid-flight when the worker was torn down cannot be resumed:
    // its pixels lived in memory that is now gone. Surface that honestly rather
    // than showing a progress bar that will never move.
    if (state.progress.phase !== 'done' && state.progress.phase !== 'error') {
      state.progress = { phase: 'error', ratio: null, label: '' };
      state.error = new AppError('CAPTURE_FAILED', {
        userMessage: 'That capture was interrupted. Try again.',
      }).toJSON();
      await this.persist(state, true);
    }

    this.restored = state;
  }

  async start(request: CaptureRequest, settings: Settings): Promise<{ jobId: string }> {
    if (this.active && isRunning(this.active.state.progress.phase)) {
      throw new AppError('CAPTURE_FAILED', {
        userMessage: 'A capture is already in progress. Wait for it to finish or cancel it.',
      });
    }

    const controller = new AbortController();
    const state: JobState = {
      id: crypto.randomUUID(),
      request,
      progress: { phase: 'preparing', ratio: null, label: PHASE_LABELS.preparing },
      startedAt: Date.now(),
    };

    this.restored = null;
    this.active = { state, controller, settings, releaseKeepAlive: acquireKeepAlive() };
    await this.persist(state, true);
    void this.setBadge('');

    // Deliberately not awaited: the popup gets its job id immediately and follows
    // progress through storage, which keeps working after it closes.
    void this.run(this.active, settings);

    return { jobId: state.id };
  }

  cancel(jobId: string): void {
    if (this.active?.state.id !== jobId) return;
    this.active.controller.abort();
  }

  /** Resolves the preview step. */
  async confirm(jobId: string, action: 'save' | 'discard'): Promise<void> {
    const job = this.active;
    if (!job || job.state.id !== jobId) {
      throw new AppError('CAPTURE_FAILED', {
        userMessage: 'That capture is no longer available. Take a new one.',
      });
    }
    if (job.state.progress.phase !== 'awaiting-preview') return;

    if (action === 'discard') {
      job.output = undefined;
      await this.finish(job, {
        phase: 'idle',
        ratio: null,
        label: '',
      });
      await sessionArea().remove(STORAGE_KEYS.activeJob);
      this.active = null;
      return;
    }

    if (!job.output) {
      throw new AppError('CAPTURE_FAILED', {
        userMessage: 'That capture is no longer available. Take a new one.',
      });
    }

    try {
      await this.upload(job, job.output.blob, job.output.filename);
    } catch (error) {
      await this.fail(job, error);
    }
  }

  async dismiss(): Promise<void> {
    if (this.active && isRunning(this.active.state.progress.phase)) return;
    this.active = null;
    this.restored = null;
    await sessionArea().remove(STORAGE_KEYS.activeJob);
    await this.setBadge('');
  }

  /* ------------------------------------------------------------- pipeline */

  private async run(job: ActiveJob, settings: Settings): Promise<void> {
    const { state, controller } = job;
    const { request } = state;

    try {
      const tab = await resolveTargetTab(request.tabId);
      const tabId = tab.id!;

      let region = request.region;
      if (request.captureMode === 'region' && !region) {
        await this.update(state, { phase: 'capturing', ratio: null, label: 'Select an area on the page' });
        region = await selectRegion(tabId, controller.signal);
        // Let the page repaint without the overlay before the shutter fires,
        // otherwise SnapDock's own selection chrome can land in the screenshot.
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      await this.update(state, { phase: 'capturing', ratio: 0, label: PHASE_LABELS.capturing });

      const captured = await capture({
        mode: request.captureMode,
        tabId,
        advanced: settings.advanced,
        signal: controller.signal,
        ...(region ? { region } : {}),
        onProgress: (ratio, label) => {
          void this.update(state, {
            phase: request.captureMode === 'fullpage' ? 'stitching' : 'capturing',
            ratio,
            label,
          });
        },
      });

      state.truncated = captured.truncated;

      const filename = generateFilename({
        template: request.filenameTemplate,
        page: captured.page,
        outputType: request.outputType,
      });
      state.filename = filename;

      let blob: Blob;

      if (request.outputType === 'pdf') {
        await this.update(state, { phase: 'generating-pdf', ratio: 0, label: PHASE_LABELS['generating-pdf'] });
        const pdf = await buildPdf(captured.canvas, {
          config: request.pdf,
          quality: request.image.quality,
          title: captured.page.title,
          createdAt: captured.page.capturedAt,
          onProgress: (done, total) => {
            void this.update(state, {
              phase: 'generating-pdf',
              ratio: total ? done / total : null,
              label: `Building PDF, page ${done} of ${total}`,
            });
          },
        });
        blob = pdf.blob;
        state.pageCount = pdf.pageCount;
      } else {
        await this.update(state, { phase: 'processing', ratio: null, label: PHASE_LABELS.processing });
        assertRenderable(captured.canvas, request.image);
        const rendered = await renderImage(captured.canvas, {
          ...request.image,
          format: request.outputType,
        });
        blob = rendered.blob;
      }

      state.outputBytes = blob.size;
      job.output = { blob, filename };

      const wantsPreview = settings.advanced.previewBeforeSave && !request.skipPreview;
      if (wantsPreview) {
        const preview = await renderPreview(captured.canvas);
        state.previewDataUrl = preview.dataUrl;
        state.previewWidth = preview.width;
        state.previewHeight = preview.height;
        await this.update(
          state,
          { phase: 'awaiting-preview', ratio: null, label: PHASE_LABELS['awaiting-preview'] },
          true,
        );
        return;
      }

      await this.upload(job, blob, filename);
    } catch (error) {
      await this.fail(job, error);
    }
  }

  /**
   * Writes the capture to every requested destination.
   *
   * Destinations are saved **sequentially, in the order resolveDestinations returned
   * them**, which puts the local disk first. That ordering is the whole partial-failure
   * strategy: if the Drive upload then fails, the capture is already safe on disk
   * rather than lost, and the user is told exactly that.
   *
   * A failure on one destination never aborts the others, and the job only fails
   * outright when *nothing* was saved. Anything else is a success with a caveat.
   */
  private async upload(job: ActiveJob, blob: Blob, filename: string): Promise<void> {
    const { state } = job;
    const destinations = state.request.destinations;

    if (destinations.length === 0) throw new AppError('NO_DESTINATION');

    const outcomes: SaveOutcome[] = [];

    for (const [index, destination] of destinations.entries()) {
      if (job.controller.signal.aborted) {
        // Remaining destinations are reported as skipped rather than silently dropped.
        outcomes.push({
          providerId: destination.providerId,
          status: 'skipped',
          message: 'Cancelled before this destination was reached.',
        });
        continue;
      }

      outcomes.push(await this.saveTo(job, destination, blob, filename, index, destinations.length));
    }

    state.result = { filename, bytes: blob.size, outcomes };
    job.output = undefined;

    const saved = outcomes.filter((outcome) => outcome.status === 'saved');

    if (saved.length === 0) {
      // Every destination failed, so this is a genuine failure, not a partial one.
      const first = outcomes.find((outcome) => outcome.message);
      throw new AppError('UPLOAD_FAILED', {
        details: outcomes.map((o) => `${o.providerId}: ${o.message ?? o.status}`).join('; '),
        ...(first?.message ? { userMessage: first.message } : {}),
      });
    }

    await this.finish(job, { phase: 'done', ratio: 1, label: PHASE_LABELS.done });
    await this.setBadge(
      saved.length === outcomes.length ? '\u2713' : '!',
      saved.length === outcomes.length ? '#16a34a' : '#b45309',
    );

    const cloud = saved.find((outcome) => outcome.file?.webUrl);
    if (job.settings.advanced.openAfterUpload && cloud?.file?.webUrl) {
      // Opened in the background so the user is not yanked away from the page they
      // were capturing, which is the whole point of saving straight to the cloud.
      await chrome.tabs.create({ url: cloud.file.webUrl, active: false }).catch(() => undefined);
    }
  }

  /** Saves to one destination, converting any failure into an outcome rather than a throw. */
  private async saveTo(
    job: ActiveJob,
    destination: DestinationRef,
    blob: Blob,
    filename: string,
    index: number,
    total: number,
  ): Promise<SaveOutcome> {
    const { state } = job;
    const name = PROVIDER_LABELS[destination.providerId];
    const prefix = total > 1 ? `Saving to ${name} (${index + 1} of ${total})` : `Saving to ${name}`;

    try {
      await this.update(state, { phase: 'uploading', ratio: 0, label: prefix });

      const provider = getProvider(destination.providerId);

      // Honour the "ask where to save" preference without the provider needing to
      // know anything about settings.
      if (destination.providerId === 'local') {
        localDisk.askEveryTime = job.settings.local.askEveryTime;
      }

      // Fail fast and clearly if the folder vanished, rather than after uploading.
      await provider.resolveFolder(destination.folderId);

      const file = await provider.uploadFile({
        blob,
        filename,
        mimeType: OUTPUT_FILE_INFO[state.request.outputType].mime,
        folderId: destination.folderId,
        signal: job.controller.signal,
        onProgress: (uploaded, totalBytes) => {
          void this.update(state, {
            phase: 'uploading',
            ratio: totalBytes ? uploaded / totalBytes : null,
            // A local save is atomic, so a byte counter would be theatre.
            label: provider.capabilities.reportsUploadProgress
              ? `${prefix}: ${formatBytes(uploaded)} of ${formatBytes(totalBytes)}`
              : prefix,
          });
        },
      });

      // Remember where the file actually landed. There is no API to read the
      // configured download directory, so a completed save is the only way to learn
      // it, and showing the real path beats guessing at "Downloads".
      if (destination.providerId === 'local' && localDisk.downloadRoot) {
        await localArea()
          .set({ [STORAGE_KEYS.localDirectory]: localDisk.downloadRoot })
          .catch(() => undefined);
      }

      return { providerId: destination.providerId, status: 'saved', file };
    } catch (error) {
      const appError = toAppError(error, 'UPLOAD_FAILED');
      console.error(`[SnapDock] save to ${destination.providerId} failed`, appError.code, appError.details);

      return {
        providerId: destination.providerId,
        status: appError.code === 'CAPTURE_CANCELLED' ? 'skipped' : 'failed',
        message: appError.userMessage,
        retryable: appError.retryable,
      };
    }
  }

  private async fail(job: ActiveJob, error: unknown): Promise<void> {
    const appError = toAppError(error, 'CAPTURE_FAILED');
    console.error('[SnapDock] job failed', appError.code, appError.details, appError.cause);

    job.state.error = appError.toJSON();
    await this.finish(job, { phase: 'error', ratio: null, label: '' });

    if (appError.code !== 'CAPTURE_CANCELLED') await this.setBadge('!', '#9f1239');
  }

  private async finish(job: ActiveJob, progress: JobState['progress']): Promise<void> {
    job.state.finishedAt = Date.now();
    job.releaseKeepAlive();
    await this.update(job.state, progress, true);
  }

  /* ---------------------------------------------------------- persistence */

  /**
   * Writes job state to session storage, throttled.
   *
   * Upload progress fires once per chunk, and each write wakes every listener in
   * every open extension page. Throttling keeps the progress bar smooth without
   * turning a large upload into a storm of storage events; terminal states always
   * write immediately.
   */
  private async update(
    state: JobState,
    progress: JobState['progress'],
    immediate = false,
  ): Promise<void> {
    state.progress = progress;
    const terminal = progress.phase === 'done' || progress.phase === 'error';
    await this.persist(state, immediate || terminal);
  }

  private async persist(state: JobState, immediate: boolean): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    const write = async (): Promise<void> => {
      this.lastWriteAt = Date.now();
      // Structured-clone the state so a later mutation cannot race the write.
      await sessionArea()
        .set({ [STORAGE_KEYS.activeJob]: { ...state } })
        .catch(() => undefined);
    };

    if (immediate || Date.now() - this.lastWriteAt >= PROGRESS_WRITE_INTERVAL_MS) {
      await write();
      return;
    }

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void write();
    }, PROGRESS_WRITE_INTERVAL_MS);
  }

  private async setBadge(text: string, color = '#dc2626'): Promise<void> {
    try {
      await chrome.action.setBadgeText({ text });
      if (text) await chrome.action.setBadgeBackgroundColor({ color });
    } catch {
      // Badge state is cosmetic; never let it break a capture.
    }
  }
}

function isRunning(phase: JobPhase): boolean {
  return phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'awaiting-preview';
}
