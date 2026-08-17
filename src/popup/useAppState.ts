import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, JobState } from '@/utils/messaging';
import { send } from '@/utils/messaging';
import { STORAGE_KEYS } from '@/utils/storageArea';
import { toAppError, type SerializedError } from '@/utils/errors';

/**
 * The popup's single source of truth.
 *
 * State is owned by the service worker; this hook fetches a snapshot on open and
 * then follows chrome.storage change events. Using storage as the change channel
 * (rather than runtime broadcasts) means the popup can be closed and reopened
 * mid-capture and simply pick up wherever the job actually is.
 */

export interface AppStateHook {
  state: AppState | null;
  loading: boolean;
  error: SerializedError | null;
  refresh: () => Promise<void>;
  patch: (next: Partial<AppState>) => void;
}

export function useAppState(): AppStateHook {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SerializedError | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await send('state/get');
      if (mounted.current) {
        setState(next);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current) setError(toAppError(cause).toJSON());
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName === 'session' && STORAGE_KEYS.activeJob in changes) {
        const job = (changes[STORAGE_KEYS.activeJob]?.newValue ?? null) as JobState | null;
        setState((previous) => (previous ? { ...previous, job } : previous));
        return;
      }
      // Settings, presets or destination changed elsewhere (options page).
      if (
        areaName === 'local' &&
        (STORAGE_KEYS.settings in changes ||
          STORAGE_KEYS.presets in changes ||
          STORAGE_KEYS.destination in changes)
      ) {
        void refresh();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const patch = useCallback((next: Partial<AppState>) => {
    setState((previous) => (previous ? { ...previous, ...next } : previous));
  }, []);

  return { state, loading, error, refresh, patch };
}
