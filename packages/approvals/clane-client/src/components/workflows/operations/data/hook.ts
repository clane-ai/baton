// Async state for the Approvals pages, in the platform's hand-rolled style
// (src/hr/data/hook.ts): no query library, plain effects, stale results from
// superseded loads dropped.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';

export type AsyncState<T> = {
  data: T | undefined;
  loading: boolean;
  error?: Error;
  reload: () => void;
};

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** Load once per change of `deps`. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadRef.current().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(asError(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export type PollState<T> = AsyncState<T> & { updatedAt: number | null };

/**
 * Load now and every `ms`, pausing while the tab is hidden and loading again
 * as soon as it is visible. Keeps the last good data across a failed load, so
 * a network blip shows a notice instead of emptying the page.
 */
export function usePoll<T>(load: () => Promise<T>, deps: DependencyList, ms: number): PollState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const gen = useRef(0);

  const once = useCallback(() => {
    const mine = ++gen.current;
    loadRef.current().then(
      (d) => {
        if (mine !== gen.current) return;
        setData(d);
        setError(undefined);
        setUpdatedAt(Date.now());
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
    setLoading(true);
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
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      gen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, once]);

  return { data, loading, error, updatedAt, reload: once };
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
 * between pages. `reload` starts again from the first page.
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
