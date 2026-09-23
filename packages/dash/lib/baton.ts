// Server-side only. Proxies a request to the Baton edge function's operator API
// with the operator token from the server environment. Never import this from a
// client component.
//
// BATON_URL and BATON_OPERATOR_TOKEN come from the repo-root `.env` for local
// development (the dev/start scripts pass `--env-file=../../.env`) and from the
// host's environment in deployment.

import { NextResponse } from "next/server";

type Init = {
  method?: "GET" | "POST";
  query?: Record<string, string | null | undefined>;
  body?: unknown;
};

function config(): { url: string; token: string } | { error: string } {
  const url = (process.env.BATON_URL ?? "").replace(/\/+$/, "");
  const token = process.env.BATON_OPERATOR_TOKEN ?? "";
  if (!url) return { error: "BATON_URL is not set in the server environment" };
  if (!token) return { error: "BATON_OPERATOR_TOKEN is not set in the server environment" };
  return { url, token };
}

/** Call `${BATON_URL}${path}` and return the upstream JSON with the upstream status. */
export async function proxy(path: string, init: Init = {}): Promise<NextResponse> {
  const cfg = config();
  if ("error" in cfg) {
    return NextResponse.json({ ok: false, error: { code: "CONFIG", message: cfg.error } }, { status: 500 });
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  }
  const target = cfg.url + path + (qs.size ? `?${qs.toString()}` : "");
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: { code: "UPSTREAM_UNREACHABLE", message } }, { status: 502 });
  }

  const text = await upstream.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : { ok: upstream.ok };
  } catch {
    json = { ok: false, error: { code: "UPSTREAM_NOT_JSON", message: text.slice(0, 500) } };
  }
  return NextResponse.json(json, { status: upstream.status });
}

/** Selected query params from a request URL, as a plain record. */
export function queryOf(req: Request, keys: string[]): Record<string, string | null> {
  const u = new URL(req.url);
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = u.searchParams.get(k);
  return out;
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
