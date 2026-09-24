import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { refreshInbox, snapshot, subscribe, visible, type InboxPage } from './inboxStore';

export type InboxState = {
  /** The queue without items acted on here; null until the first load. */
  data: InboxPage | null;
  loading: boolean;
  error?: Error;
  updatedAt: number | null;
  reload: () => void;
};

/**
 * The one inbox, from the shared store. A screen that mounts after an action
 * renders the cached queue at once and refreshes behind it. Polls every `ms`
 * while the tab is visible.
 */
export function useInbox(ms: number): InboxState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer) return;
      void refreshInbox();
      timer = setInterval(() => void refreshInbox(), ms);
    };
    const stop = (): void => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = (): void => (document.visibilityState === 'hidden' ? stop() : start());
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);

  const reload = useCallback(() => void refreshInbox(), []);
  return {
    data: visible(s.response),
    loading: !s.response && !s.error,
    error: s.error,
    updatedAt: s.updatedAt,
    reload,
  };
}
