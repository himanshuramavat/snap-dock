import { AppError } from '@/utils/errors';
import type { BlobHandoff } from './blobHandoff';

/**
 * Turning a Blob into a URL that `chrome.downloads.download` will accept.
 *
 * This is the one part of local saving that differs by engine, and the part that
 * broke in the field: Manifest V3 service workers have **no** `URL.createObjectURL`
 * (the URL spec exposes it to Window, dedicated and shared workers only), so calling
 * it in Chromium's background throws `URL.createObjectURL is not a function` and
 * every local save fails. Firefox's MV3 background is an event page, which does have
 * it. One code path cannot serve both, so the provider asks for a *lease* on a URL
 * and a small strategy chain decides how to mint one:
 *
 *  1. **Object URL in this context.** Available in Firefox's event page. Zero copies,
 *     no extra permission. Revoked when the lease is released.
 *  2. **Offscreen document.** Chromium 109+ can open a hidden extension page whose
 *     sole job is to own blob URLs (`chrome.offscreen`, reason `BLOBS`). The worker
 *     parks the blob in IndexedDB, the document collects it and mints a
 *     `blob:chrome-extension://…` URL that the downloads API accepts because it is
 *     same-origin. The document is closed once no lease needs it, so it never sits in
 *     memory between captures.
 *  3. **Base64 data URL.** Needs no capability at all, but Chromium caps any URL at
 *     2 MB (`url::kMaxURLChars`), which a full-page PNG or a multi-page PDF exceeds
 *     routinely. Kept strictly as the last resort so that a browser lacking both
 *     earlier options still saves small captures rather than nothing.
 *
 * Each strategy is a plain function of its dependencies so the chain can be exercised
 * in Node without a browser; only the default wiring in `defaultDownloadUrlLeaser`
 * touches globals.
 */

export interface DownloadUrlLease {
  /** URL to hand to `chrome.downloads.download`. */
  readonly url: string;
  /** Frees the URL and whatever backs it. Safe to call more than once. */
  release(): Promise<void>;
}

export type LeaseDownloadUrl = (blob: Blob) => Promise<DownloadUrlLease>;

/* ------------------------------------------------- 1. object URL in this context */

export interface ObjectUrlApi {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export function hasObjectUrls(api: ObjectUrlApi): boolean {
  return typeof api.createObjectURL === 'function' && typeof api.revokeObjectURL === 'function';
}

export function objectUrlLeaser(api: ObjectUrlApi): LeaseDownloadUrl {
  return async (blob) => {
    // Read at call time, not at wiring time, so a context that gains or loses the
    // capability is observed correctly.
    if (!hasObjectUrls(api)) {
      throw new Error('URL.createObjectURL is not available in this context');
    }
    const url = api.createObjectURL!(blob);
    let released = false;
    return {
      url,
      async release() {
        if (released) return;
        released = true;
        api.revokeObjectURL!(url);
      },
    };
  };
}

/* ------------------------------------------------------- 2. offscreen document */

/** Discriminator so the offscreen page ignores every other extension message. */
export const OFFSCREEN_TARGET = 'snapdock-offscreen';

/** Extension-relative path of the offscreen page; must match the Vite input. */
export const OFFSCREEN_PAGE = 'offscreen/offscreen.html';

export type OffscreenRequest =
  | { target: typeof OFFSCREEN_TARGET; type: 'blob-url/create'; handoffId: string }
  | { target: typeof OFFSCREEN_TARGET; type: 'blob-url/revoke'; url: string };

export type OffscreenResponse =
  | { ok: true; url?: string }
  | { ok: false; error: string };

export function isOffscreenRequest(message: unknown): message is OffscreenRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { target?: unknown }).target === OFFSCREEN_TARGET &&
    typeof (message as { type?: unknown }).type === 'string'
  );
}

/** The slice of `chrome.offscreen` / `chrome.runtime` the strategy needs, for testing. */
export interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  sendMessage(message: OffscreenRequest): Promise<OffscreenResponse | undefined>;
}

/**
 * Owns the offscreen document's lifetime on behalf of every outstanding lease.
 *
 * Chromium allows exactly one offscreen document per extension, so creation is
 * serialised, and the document is only closed once the last lease is released. A
 * lease arriving while a close is in flight waits for it and then reopens, rather
 * than racing `createDocument` against `closeDocument`.
 */
export class OffscreenBlobUrls {
  private leases = 0;
  private ready: Promise<void> | null = null;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly api: OffscreenApi,
    private readonly handoff: BlobHandoff,
  ) {}

  readonly lease: LeaseDownloadUrl = async (blob) => {
    this.leases += 1;
    try {
      await this.ensureDocument();
      const handoffId = await this.handoff.put(blob);
      const reply = await this.api.sendMessage({
        target: OFFSCREEN_TARGET,
        type: 'blob-url/create',
        handoffId,
      });
      if (!reply) throw new Error('The offscreen document did not reply');
      if (!reply.ok) throw new Error(reply.error);
      if (!reply.url) throw new Error('The offscreen document returned no URL');

      const { url } = reply;
      let released = false;
      return {
        url,
        release: async () => {
          if (released) return;
          released = true;
          // Best effort: the document is about to be closed anyway when this was the
          // last lease, and a revoke on an already-closed page is not an error.
          await this.api
            .sendMessage({ target: OFFSCREEN_TARGET, type: 'blob-url/revoke', url })
            .catch(() => undefined);
          await this.releaseOne();
        },
      };
    } catch (error) {
      await this.releaseOne();
      throw error;
    }
  };

  private async ensureDocument(): Promise<void> {
    if (this.closing) await this.closing;
    if (!this.ready) {
      this.ready = (async () => {
        if (!(await this.api.hasDocument())) await this.api.createDocument();
      })().catch((error: unknown) => {
        this.ready = null;
        throw error;
      });
    }
    await this.ready;
  }

  private async releaseOne(): Promise<void> {
    this.leases = Math.max(0, this.leases - 1);
    if (this.leases > 0) return;
    this.ready = null;
    this.closing = this.api
      .closeDocument()
      .catch(() => undefined)
      .finally(() => {
        this.closing = null;
      });
    await this.closing;
  }
}

/** Wires `OffscreenApi` to the real `chrome.offscreen` and `chrome.runtime`. */
export function chromeOffscreenApi(): OffscreenApi {
  return {
    async hasDocument() {
      // runtime.getContexts exists from Chromium 116, the manifest's floor.
      if (typeof chrome.runtime.getContexts !== 'function') return false;
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      return contexts.length > 0;
    },
    async createDocument() {
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_PAGE,
          reasons: ['BLOBS'],
          justification:
            'Create a blob: URL for the captured image so chrome.downloads can save it; service workers cannot create blob URLs.',
        });
      } catch (error) {
        // Lost a race with a document created since hasDocument() ran. Reusing it is
        // exactly what we want.
        if (error instanceof Error && /single offscreen document/i.test(error.message)) return;
        throw error;
      }
    },
    async closeDocument() {
      await chrome.offscreen.closeDocument();
    },
    async sendMessage(message) {
      return (await chrome.runtime.sendMessage(message)) as OffscreenResponse | undefined;
    },
  };
}

export function hasOffscreenApi(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.offscreen?.createDocument === 'function' &&
    typeof indexedDB !== 'undefined'
  );
}

/* ------------------------------------------------------------ 3. data URL */

/** Chromium refuses to parse any URL longer than this (`url::kMaxURLChars`). */
export const MAX_DATA_URL_LENGTH = 2 * 1024 * 1024;

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so the spread never exceeds the engine's argument-count limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function dataUrlLeaser(maxLength: number = MAX_DATA_URL_LENGTH): LeaseDownloadUrl {
  return async (blob) => {
    // 4/3 expansion plus the header; checked before encoding so a hopeless size does
    // not burn memory on its way to a guaranteed "Invalid URL" from the API.
    const encodedLength = Math.ceil(blob.size / 3) * 4 + 40;
    if (encodedLength > maxLength) {
      throw new AppError('SAVE_FAILED', {
        details: `Capture of ${blob.size} bytes exceeds the ${maxLength}-character data URL limit`,
        userMessage:
          'This capture is too large to save on this browser. Try the visible area or a smaller region, or save to Google Drive instead.',
      });
    }
    const url = await blobToDataUrl(blob);
    return { url, release: async () => undefined };
  };
}

/* ------------------------------------------------------------------ chain */

/**
 * Tries each strategy in order, moving on when one fails to produce a URL. A failure
 * *after* a URL was handed out (the download itself) is the provider's business and
 * is never retried here.
 */
export function chainDownloadUrlLeasers(
  strategies: ReadonlyArray<{ name: string; lease: LeaseDownloadUrl }>,
  warn: (message: string) => void = (message) => console.warn(`[SnapDock] ${message}`),
): LeaseDownloadUrl {
  if (strategies.length === 0) {
    throw new Error('At least one download URL strategy is required');
  }
  return async (blob) => {
    let lastError: unknown;
    for (const [index, strategy] of strategies.entries()) {
      try {
        return await strategy.lease(blob);
      } catch (error) {
        lastError = error;
        const next = strategies[index + 1];
        if (next) {
          const reason = error instanceof Error ? error.message : String(error);
          warn(`${strategy.name} could not provide a download URL (${reason}); trying ${next.name}`);
        }
      }
    }
    throw lastError;
  };
}

/**
 * The production chain, built from whatever this context offers.
 *
 * Capability checks happen here, once, but each strategy re-validates at call time so
 * the ordering is a preference rather than a promise.
 */
export function defaultDownloadUrlLeaser(
  handoffFactory: () => BlobHandoff,
  env: { urlApi?: ObjectUrlApi; offscreen?: boolean } = {},
): LeaseDownloadUrl {
  const urlApi = env.urlApi ?? (URL as unknown as ObjectUrlApi);
  const offscreen = env.offscreen ?? hasOffscreenApi();

  const strategies: Array<{ name: string; lease: LeaseDownloadUrl }> = [];
  if (hasObjectUrls(urlApi)) {
    strategies.push({ name: 'object URL', lease: objectUrlLeaser(urlApi) });
  }
  if (offscreen) {
    strategies.push({
      name: 'offscreen document',
      lease: new OffscreenBlobUrls(chromeOffscreenApi(), handoffFactory()).lease,
    });
  }
  strategies.push({ name: 'data URL', lease: dataUrlLeaser() });

  return chainDownloadUrlLeasers(strategies);
}
