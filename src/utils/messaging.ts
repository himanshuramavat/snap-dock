import type {
  CaptureRequest,
  ConnectionStatus,
  DestinationRef,
  JobProgress,
  JobResult,
  Preset,
  RemoteFolder,
  Settings,
} from '@/types';
import type { SerializedError } from './errors';
import { AppError, toAppError } from './errors';
import type { DeepPartial } from '@/settings/SettingsStore';

/**
 * Typed request/response bus between the extension pages and the service worker.
 *
 * All business logic runs in the service worker, so the popup is free to close at
 * any moment, which it does the instant the user drags a region selection on the
 * page. The popup is a view over state the worker owns, never the owner of a job.
 */

export interface JobState {
  id: string;
  progress: JobProgress;
  request: CaptureRequest;
  /** Downscaled preview shown while awaiting confirmation. */
  previewDataUrl?: string;
  previewWidth?: number;
  previewHeight?: number;
  /** Bytes of the final encoded output, once known. */
  outputBytes?: number;
  filename?: string;
  pageCount?: number;
  truncated?: boolean;
  result?: JobResult;
  error?: SerializedError;
  startedAt: number;
  finishedAt?: number;
}

export interface AppState {
  settings: Settings;
  presets: Preset[];
  /** Every place the next capture will be saved. Empty means capture is blocked. */
  destinations: DestinationRef[];
  /** The chosen Drive folder, kept separately so it survives switching providers. */
  driveDestination: DestinationRef | null;
  /**
   * Absolute directory of the last local save, or null before the first one. Chrome
   * exposes no way to read the configured download directory up front.
   */
  localDirectory: string | null;
  connection: ConnectionStatus;
  job: JobState | null;
}

/** Request payload and response type for each message, keyed by message type. */
export interface MessageMap {
  'state/get': { request: void; response: AppState };
  'state/connection': { request: void; response: ConnectionStatus };

  // Partial by design: the caller supplies what it knows and the worker fills the
  // rest from saved defaults. A keyboard shortcut sends almost nothing.
  'capture/start': { request: Partial<CaptureRequest>; response: { jobId: string } };
  'capture/cancel': { request: { jobId: string }; response: void };
  'capture/confirm': { request: { jobId: string; action: 'save' | 'discard' }; response: void };
  'capture/job': { request: void; response: JobState | null };
  'capture/dismiss': { request: void; response: void };

  'drive/connect': { request: { fullAccess?: boolean }; response: ConnectionStatus };
  'drive/disconnect': { request: void; response: void };
  'drive/folders': { request: { parentId: string | null }; response: RemoteFolder[] };
  'drive/createFolder': { request: { name: string; parentId: string | null }; response: RemoteFolder };
  'drive/setDestination': { request: { destination: DestinationRef }; response: void };

  'settings/update': { request: { patch: DeepPartial<Settings> }; response: Settings };
  'settings/reset': { request: void; response: Settings };

  'presets/list': { request: void; response: Preset[] };
  'presets/save': { request: { preset: Preset }; response: Preset[] };
  'presets/delete': { request: { id: string }; response: Preset[] };

  'ui/openOptions': { request: void; response: void };
}

export type MessageType = keyof MessageMap;

interface Envelope<T extends MessageType> {
  type: T;
  payload: MessageMap[T]['request'];
}

type Reply<T extends MessageType> =
  | { ok: true; data: MessageMap[T]['response'] }
  | { ok: false; error: SerializedError };

/**
 * Sends a message and unwraps the reply, re-throwing failures as AppError.
 *
 * Errors cross the boundary as plain objects because chrome's messaging serialises
 * with structured clone and would otherwise flatten an Error to `{}`, losing exactly
 * the user-facing message the UI needs.
 */
export async function send<T extends MessageType>(
  type: T,
  ...args: MessageMap[T]['request'] extends void ? [] : [MessageMap[T]['request']]
): Promise<MessageMap[T]['response']> {
  const envelope: Envelope<T> = { type, payload: args[0] as MessageMap[T]['request'] };

  let reply: Reply<T> | undefined;
  try {
    reply = (await chrome.runtime.sendMessage(envelope)) as Reply<T> | undefined;
  } catch (cause) {
    // The worker was asleep and the port closed, or the extension was reloaded.
    throw toAppError(cause, 'UNKNOWN');
  }

  if (!reply) {
    throw new AppError('UNKNOWN', { details: `No reply for ${type}` });
  }
  if (!reply.ok) {
    throw new AppError(reply.error.code, {
      userMessage: reply.error.userMessage,
      ...(reply.error.details ? { details: reply.error.details } : {}),
    });
  }
  return reply.data;
}

export type Handlers = {
  [T in MessageType]: (
    payload: MessageMap[T]['request'],
    sender: chrome.runtime.MessageSender,
  ) => Promise<MessageMap[T]['response']>;
};

/**
 * Installs the message router in the service worker.
 *
 * Returning `true` from the listener keeps the response channel open for the async
 * handler; every path must eventually call sendResponse or the caller hangs, so the
 * handler is wrapped rather than trusted to behave.
 */
export function registerHandlers(handlers: Partial<Handlers>): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false;

    const { type, payload } = message as Envelope<MessageType>;
    const handler = handlers[type] as
      | ((payload: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown>)
      | undefined;

    if (!handler) return false;

    handler(payload, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const appError = toAppError(error);
        // Full detail to the console for developers; only userMessage crosses to the UI.
        console.error(`[SnapDock] ${type} failed`, appError.code, appError.details, appError.cause);
        sendResponse({ ok: false, error: appError.toJSON() });
      });

    return true;
  });
}
