/**
 * Hands a Blob from the service worker to the offscreen document.
 *
 * `chrome.runtime.sendMessage` serialises to JSON, so a Blob cannot travel through it
 * and a base64 copy of a 40 MB full-page capture would sit uncomfortably close to the
 * messaging size limit while doubling memory use. IndexedDB is shared by every context
 * of the extension origin and stores Blobs natively, so the worker parks the bytes
 * there, sends only a small id across, and the offscreen document collects them.
 *
 * Records are removed as soon as they are collected. A stale-record sweep on every
 * `put` covers the case where the worker was torn down between parking a blob and
 * asking for it, so a crash never leaves captures accumulating on disk.
 */

const DB_NAME = 'snapdock-handoff';
const DB_VERSION = 1;
const STORE = 'blobs';

/** Anything older than this was abandoned by a worker that no longer exists. */
export const HANDOFF_STALE_MS = 10 * 60 * 1000;

interface HandoffRecord {
  blob: Blob;
  createdAt: number;
}

export interface BlobHandoff {
  /** Parks a blob and returns the id the other side should collect it with. */
  put(blob: Blob): Promise<string>;
  /** Collects and removes a parked blob. Rejects when the id is unknown. */
  take(id: string): Promise<Blob>;
}

/** Promise wrapper for a single IndexedDB request. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves when a transaction commits, rejects if it aborts or errors. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function createIndexedDbHandoff(
  factory: IDBFactory,
  now: () => number = () => Date.now(),
  newId: () => string = () => crypto.randomUUID(),
): BlobHandoff {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another context upgrading the schema must not be blocked by this handle.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((error: unknown) => {
      // Let the next caller retry rather than caching a failure for good.
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };

  return {
    async put(blob) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const id = newId();
      const record: HandoffRecord = { blob, createdAt: now() };
      store.put(record, id);
      sweepStale(store, now() - HANDOFF_STALE_MS);
      await committed(tx);
      return id;
    },

    async take(id) {
      const db = await open();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record = (await request(store.get(id))) as HandoffRecord | undefined;
      if (record) store.delete(id);
      await committed(tx);
      if (!record) throw new Error(`No parked blob with id ${id}`);
      return record.blob;
    },
  };
}

/** Deletes every record created before `cutoff`, within the caller's transaction. */
function sweepStale(store: IDBObjectStore, cutoff: number): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const record = cursor.value as Partial<HandoffRecord>;
    if (typeof record.createdAt !== 'number' || record.createdAt < cutoff) {
      cursor.delete();
    }
    cursor.continue();
  };
  // A failed sweep must not fail the put; the next put will try again.
  cursorReq.onerror = (event) => event.preventDefault();
}
