// Baton service: one edge function, several faces (prd.md section 6).
//   /mcp             MCP face (agents)
//   /hooks/:event    hook face (Claude Code hooks)
//   /gate/:name      enforcement gates
//   /gh              GitHub webhooks
//   /join            one-time invite redemption (baton join)
//   /work-available  supervisor daemon
//   /runs/usage      supervisor daemon cost reports
//   /admin/*         operator and dashboard API
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sql } from "./db.ts";
import { authenticate } from "./auth.ts";
import { handleRpc } from "./mcp.ts";
import { handleAdmin, handleJoin } from "./admin.ts";
import { handleHook, handleGate } from "./hooks.ts";
import { handleWebhook } from "./gh.ts";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const unauthorized = (msg = "Unauthorized: invalid, missing or revoked Baton token") =>
  json({ ok: false, error: { code: "UNAUTHORIZED", message: msg, retryable: false } }, 401);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?baton/, "") || "/";

  try {
    if (path === "/health") {
      const [row] = await sql`select now() as ts`;
      return json({ ok: true, service: "baton", version: "0.2.0", ts: row.ts });
    }

    if (path === "/mcp") {
      if (req.method === "GET") return new Response("SSE stream not offered; use POST", { status: 405 });
      if (req.method === "DELETE") return new Response(null, { status: 200 });
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const ctx = await authenticate(req, path);
      if (!ctx || ctx.kind !== "agent") {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: invalid, missing or revoked Baton agent token" } }, 401);
      }
      const body = await req.json();
      const msgs = Array.isArray(body) ? body : [body];
      const responses = [];
      const batonSession = req.headers.get("x-baton-session");
      for (const m of msgs) {
        const r = await handleRpc(ctx.agent, m, batonSession);
        if (r) responses.push(r);
      }
      if (responses.length === 0) return new Response(null, { status: 202 });
      return json(Array.isArray(body) ? responses : responses[0]);
    }

    if (path === "/join") {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const r = await handleJoin(req);
      return json(r.body, r.status);
    }

    if (path === "/gh") {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const r = await handleWebhook(req);
      return json(r.body, r.status);
    }

    if (path.startsWith("/hooks/") || path.startsWith("/gate/")) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const ctx = await authenticate(req, path);
      if (!ctx || ctx.kind !== "agent") return unauthorized("Hooks need an agent token");
      let raw: Record<string, unknown> = {};
      try { raw = await req.json(); } catch { raw = {}; }
      const name = path.split("/")[2] ?? "";
      const r = path.startsWith("/hooks/") ? await handleHook(ctx.agent, name, raw) : await handleGate(ctx.agent, name, raw);
      return json(r.body, r.status);
    }

    if (path.startsWith("/admin") || path === "/work-available" || path === "/runs/usage" || path === "/agent/inbox") {
      const ctx = await authenticate(req, path);
      if (!ctx) return unauthorized();
      const r = await handleAdmin(ctx, req, path, url) as ({ status: number; body: unknown; raw?: boolean; headers?: Record<string, string> } | null);
      if (r && r.raw) return new Response(r.body as BodyInit, { status: r.status, headers: r.headers ?? {} });
      if (r) return json(r.body, r.status);
    }

    return json({ ok: false, error: { code: "NOT_FOUND", message: `No route ${req.method} ${path}`, retryable: false } }, 404);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: { code: "INTERNAL", message: String((e as Error)?.message ?? e), retryable: true } }, 500);
  }
});
