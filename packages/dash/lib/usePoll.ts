"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "./types";

export type PollState<T> = {
  data: T | null;
  error: ApiError | null;
  /** Epoch ms of the last successful fetch. */
  updatedAt: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Minimal SWR-style polling hook. Fetches `url` immediately and then every
 * `intervalMs`, pausing while the document is hidden (and refetching as soon
 * as it becomes visible again). Keeps the last good data across errors.
 * Pass `null` as url to disable.
 */
export function usePoll<T extends { ok: boolean }>(url: string | null, intervalMs = 5000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const inFlight = useRef<AbortController | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchOnce = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;
    try {
      const res = await fetch(u, { signal: ac.signal, cache: "no-store" });
      const json = (await res.json()) as T | { ok: false; error?: ApiError };
      if (ac.signal.aborted) return;
      if (!res.ok || !json || json.ok !== true) {
        const err = (json as { error?: ApiError })?.error ?? {
          code: `HTTP_${res.status}`,
          message: res.statusText || "Request failed",
        };
        setError(err);
      } else {
        setData(json as T);
        setError(null);
        setUpdatedAt(Date.now());
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      setError({ code: "FETCH", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setUpdatedAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void fetchOnce();
      timer = setInterval(() => void fetchOnce(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      inFlight.current?.abort();
    };
  }, [url, intervalMs, fetchOnce]);

  return { data, error, updatedAt, loading, refresh: fetchOnce };
}

/** Re-renders the caller every `ms` milliseconds. Returns the current epoch ms. */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** POST JSON to a route handler; resolves to the parsed JSON, rejects with an ApiError on failure. */
export async function postJson<T = { ok: boolean }>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: ApiError };
  if (!res.ok || json.ok === false) {
    const err: ApiError = json.error ?? { code: `HTTP_${res.status}`, message: res.statusText || "Request failed" };
    throw err;
  }
  return json;
}
