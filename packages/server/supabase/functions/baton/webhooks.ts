// Outbound event webhooks (docs/clane-integration.md): an orchestrator subscribes to Baton's events
// instead of polling. Deliveries are queued by a trigger on baton.events and drained here after
// state transitions and on /admin/webhooks/flush. Each POST carries X-Baton-Signature: sha256=<hmac>.
import { sql } from "./db.ts";

type Json = Record<string, unknown>;

async function hmacHex(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function drainWebhooks(limit = 20): Promise<Json> {
  const [{ r }] = await sql`select baton.webhook_pending(${limit}::int) as r`;
  const pending = (r ?? []) as Json[];
  if (!pending.length) return { ok: true, sent: 0 };
  let sent = 0, failed = 0;
  for (const d of pending) {
    const body = JSON.stringify({ id: d.delivery_id, webhook_id: d.webhook_id, event: d.event, sent_at: new Date().toISOString() });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(String(d.url), {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "baton-webhook", "x-baton-signature": "sha256=" + await hmacHex(String(d.secret), body), "x-baton-event": String((d.event as Json).type) },
        body, signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (res.status >= 200 && res.status < 300) { await sql`select baton.webhook_delivery_done(${d.delivery_id}::bigint, true, null)`; sent++; }
      else { await sql`select baton.webhook_delivery_done(${d.delivery_id}::bigint, false, ${`HTTP ${res.status}`})`; failed++; }
    } catch (e) {
      await sql`select baton.webhook_delivery_done(${d.delivery_id}::bigint, false, ${String((e as Error).message).slice(0, 200)})`;
      failed++;
    }
  }
  return { ok: true, sent, failed, pending: pending.length - sent - failed };
}
