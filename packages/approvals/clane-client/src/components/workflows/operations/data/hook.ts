// Async state for the Workflow screens, in the platform's hand-rolled style
// (src/hr/data/hook.ts): no query library, plain effects.
//
// Every result is stamped with the dependencies it was loaded for. When the
// dependencies change (another item, another run), the old result is not
// shown under the new key: the screen goes back to loading until its own
// data arrives. Results of superseded loads are dropped.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DependencyList } from 'react';

export type AsyncState<T> = {
  data: T | undefined;
  loading: boolean;
  error?: Error;
  reload: () => void;
};

type Box<T> = { epoch: object; data?: T; error?: Error; at?: number };

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** A new object whenever `deps` change; results carry it so stale ones are never shown. */
function useEpoch(deps: DependencyList): object {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({}), deps);
}

/** Load once per change of `deps`. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const epoch = useEpoch(deps);
  const [box, setBox] = useState<Box<T> | null>(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setBusy(true);
    loadRef.current().then(
      (data) => {
        if (!live) return;
        setBox({ epoch, data });
        setBusy(false);
      },
      (e: unknown) => {
        if (!live) return;
        setBox((prev) => ({ epoch, data: prev?.epoch === epoch ? prev.data : undefined, error: asError(e) }));
        setBusy(false);
      },
    );
    return () => {
      live = false;
    };
  }, [epoch, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const mine = box?.epoch === epoch ? box : null;
  return { data: mine?.data, loading: busy || !mine, error: mine?.error, reload };
}

export type PollState<T> = AsyncState<T> & { updatedAt: number | null };

/**
 * Load now and every `ms`, pausing while the tab is hidden and loading again
 * as soon as it is visible. A tick is skipped while a load is still out, so a
 * slow engine is waited for rather than cancelled. Keeps the last good data
 * across a failed load, so a network blip shows a notice instead of emptying
 * the page.
 */
export function usePoll<T>(load: () => Promise<T>, deps: DependencyList, ms: number): PollState<T> {
  const epoch = useEpoch(deps);
  const [box, setBox] = useState<Box<T> | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  /** The epoch whose load is out, if any. */
  const inflight = useRef<object | null>(null);
  const current = useRef(epoch);
  current.current = epoch;

  const once = useCallback(() => {
    const mine = current.current;
    if (inflight.current === mine) return;
    inflight.current = mine;
    loadRef.current().then(
      (data) => {
        if (inflight.current === mine) inflight.current = null;
        if (mine !== current.current) return;
        setBox({ epoch: mine, data, at: Date.now() });
      },
      (e: unknown) => {
        if (inflight.current === mine) inflight.current = null;
        if (mine !== current.current) return;
        setBox((prev) =>
          prev?.epoch === mine ? { ...prev, error: asError(e) } : { epoch: mine, error: asError(e) },
        );
      },
    );
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer) return;
      once();
      timer = setInterval(once, ms);
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
  }, [epoch, ms, once]);

  const mine = box?.epoch === epoch ? box : null;
  return {
    data: mine?.data,
    loading: !mine || (mine.at === undefined && !mine.error),
    error: mine?.error,
    updatedAt: mine?.at ?? null,
    reload: once,
  };
}

export type PagedState<T> = {
  items: T[];
  loading: boolean;
  error?: Error;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

const defaultKey = (t: unknown): string => {
  const o = t as { key?: unknown; id?: unknown };
  return String(o?.key ?? o?.id ?? JSON.stringify(t));
};

/**
 * Keyset paging over `cursor` / `nextCursor`. `loadMore` appends the next
 * page; rows already shown (same `keyOf`) are not repeated if the list moved
 * between pages. `reload` starts again from the first page. A failed later
 * page keeps the rows already shown and reports the error.
 */
export function usePaged<T>(
  loadPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  deps: DependencyList,
  keyOf: (t: T) => string = defaultKey,
): PagedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const loadRef = useRef(loadPage);
  loadRef.current = loadPage;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;
  const gen = useRef(0);

  const fetchPage = useCallback((from: string | null, append: boolean) => {
    const mine = ++gen.current;
    setLoading(true);
    if (!append) {
      setItems([]);
      setHasMore(false);
    }
    loadRef.current(from).then(
      (page) => {
        if (mine !== gen.current) return;
        setItems((prev) => {
          if (!append) return page.items;
          const seen = new Set(prev.map((t) => keyRef.current(t)));
          return [...prev, ...page.items.filter((t) => !seen.has(keyRef.current(t)))];
        });
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== gen.current) return;
        setError(asError(e));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    fetchPage(null, false);
    return () => {
      gen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    if (cursor !== null) fetchPage(cursor, true);
  }, [cursor, fetchPage]);
  const reload = useCallback(() => fetchPage(null, false), [fetchPage]);

  return { items, loading, error, hasMore, loadMore, reload };
}
