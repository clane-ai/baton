// GitHub face (prd.md 12.4): webhooks in, at most four outbound calls per task out.
// Secrets live in Supabase Vault: baton_github_token, baton_github_webhook_secret.
import { sql } from "./db.ts";

type Json = Record<string, unknown>;
const one = async (rows: Promise<{ r: Json }[]>) => (await rows)[0].r;

async function secret(name: string): Promise<string | null> {
  try {
    const [row] = await sql`select decrypted_secret as s from vault.decrypted_secrets where name = ${name} limit 1`;
    return row?.s ?? null;
  } catch { return null; }
}

async function hmacHex(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const conclusionToStatus = (c: string | null | undefined): string =>
  c == null ? "pending" : c === "success" || c === "neutral" || c === "skipped" ? "success"
  : ["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"].includes(c) ? "failure" : "pending";

export async function handleWebhook(req: Request): Promise<{ status: number; body: Json }> {
  const body = await req.text();
  const whSecret = await secret("baton_github_webhook_secret");
  if (!whSecret) return { status: 503, body: { ok: false, error: { code: "NOT_CONFIGURED", message: "baton_github_webhook_secret is not in Vault", retryable: false } } };
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + await hmacHex(whSecret, body);
  if (!timingSafeEqual(sig, expected)) {
    await sql`insert into baton.events (type, payload) values ('gh_webhook_rejected', ${{ reason: "bad signature", event: req.headers.get("x-github-event") }}::jsonb)`;
    return { status: 401, body: { ok: false, error: { code: "UNAUTHORIZED", message: "bad signature", retryable: false } } };
  }
  const event = req.headers.get("x-github-event") ?? "";
  let p: Json;
  try { p = JSON.parse(body); } catch { return { status: 400, body: { ok: false, error: { code: "BAD_REQUEST", message: "invalid json", retryable: false } } }; }
  const repo = String((p.repository as Json)?.full_name ?? "");

  let result: Json = { ok: true, ignored: event };
  if (event === "pull_request") {
    const pr = p.pull_request as Json;
    result = await one(sql`select baton.gh_pr_event(${repo}, ${Number(pr.number)}::int, ${String((pr.head as Json)?.sha ?? "")}, ${String(p.action)},
      ${String(pr.html_url ?? "")}, ${pr.merged === true}, ${String((pr.head as Json)?.ref ?? "")}) as r`);
  } else if (event === "check_suite" || event === "check_run" || event === "workflow_run") {
    const obj = (p.check_suite ?? p.check_run ?? p.workflow_run) as Json;
    const sha = String(obj.head_sha ?? "");
    const status = p.action === "completed" ? conclusionToStatus(obj.conclusion as string) : "pending";
    const details = { name: obj.name ?? event, conclusion: obj.conclusion ?? null, url: obj.html_url ?? obj.details_url ?? null, summary: (obj.output as Json)?.summary ?? null };
    result = await one(sql`select baton.gh_check_event(${repo}, ${sha}, ${status}, ${details}::jsonb) as r`);
  } else if (event === "status") {
    const status = p.state === "success" ? "success" : p.state === "failure" || p.state === "error" ? "failure" : "pending";
    result = await one(sql`select baton.gh_check_event(${repo}, ${String(p.sha)}, ${status}, ${{ name: p.context ?? "status", conclusion: p.state, url: p.target_url ?? null, summary: p.description ?? null }}::jsonb) as r`);
  }
  await drainOutbox();
  return { status: 200, body: result };
}

// ---- outbound ----------------------------------------------------------------
async function gh(token: string, method: string, path: string, body?: Json): Promise<{ status: number; json: Json }> {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "baton", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: Json = {};
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}

/** Send queued GitHub calls. Called after state transitions, never from the hook face. */
export async function drainOutbox(limit = 20): Promise<Json> {
  const rows = await sql`select id, kind, task_id, repo, payload from baton.gh_outbox where sent_at is null and attempts < 5 order by id limit ${limit}`;
  if (!rows.length) return { ok: true, sent: 0 };
  const token = await secret("baton_github_token");
  let sent = 0, skipped = 0;
  for (const o of rows) {
    if (!token) {
      await one(sql`select baton.gh_outbox_done(${o.id}::bigint, '{}'::jsonb, 'no GitHub token in Vault (baton_github_token)') as r`);
      skipped++;
      continue;
    }
    const p = o.payload as Json;
    try {
      let r: { status: number; json: Json };
      if (o.kind === "promote_issue") {
        r = await gh(token, "POST", `/repos/${o.repo}/issues`, { title: `[${p.key}] ${p.title}`, body: `Baton task ${p.key} needs a human decision. See the Baton dashboard.`, labels: ["baton"] });
      } else if (o.kind === "open_pr") {
        const [{ default_branch }] = [(await gh(token, "GET", `/repos/${o.repo}`)).json as Json & { default_branch?: string }];
        r = await gh(token, "POST", `/repos/${o.repo}/pulls`, { title: `[${p.key}] ${p.title}`, head: p.branch, base: default_branch ?? "main", body: String(p.body ?? "").slice(0, 4000) });
      } else if (o.kind === "completion_comment") {
        r = await gh(token, "POST", `/repos/${o.repo}/issues/${p.number}/comments`, { body: `Baton: task ${p.key} passed the completion gate (attempts ${p.attempts}, cost $${Number(p.cost_usd ?? 0).toFixed(2)}).` });
      } else if (o.kind === "close_issue") {
        r = await gh(token, "PATCH", `/repos/${o.repo}/issues/${p.issue}`, { state: "closed", state_reason: "completed" });
      } else {
        r = { status: 400, json: { message: `unknown outbox kind ${o.kind}` } };
      }
      if (r.status >= 200 && r.status < 300) {
        await one(sql`select baton.gh_outbox_done(${o.id}::bigint, ${{ number: r.json.number ?? null, html_url: r.json.html_url ?? null, id: r.json.id ?? null }}::jsonb, null) as r`);
        sent++;
      } else {
        await one(sql`select baton.gh_outbox_done(${o.id}::bigint, '{}'::jsonb, ${`GitHub ${r.status}: ${String(r.json.message ?? "").slice(0, 200)}`}) as r`);
      }
    } catch (e) {
      await one(sql`select baton.gh_outbox_done(${o.id}::bigint, '{}'::jsonb, ${String((e as Error).message).slice(0, 200)}) as r`);
    }
  }
  return { ok: true, sent, skipped, pending: rows.length - sent - skipped };
}
