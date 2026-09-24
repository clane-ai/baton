// Operator API: what the CLI and the dashboard use. Every route needs an operator token,
// except the few the supervisor daemon calls with an agent token (marked below).
import { sql } from "./db.ts";
import { newToken, sha256Hex, type Ctx } from "./auth.ts";
import { drainOutbox } from "./gh.ts";
import { drainWebhooks } from "./webhooks.ts";
import { inboxJson, documentsOf, decisionOf, decodeCursor, encodeCursor } from "./inbox.ts";
import { uploadBytes, downloadObject, sha256Hex as shaHex } from "./storage.ts";

type Json = Record<string, unknown>;
// postgres.js serialises objects for jsonb parameters itself; never pre-stringify.
const j = (v: unknown) => (v === undefined ? null : v);
const one = async (rows: Promise<{ r: Json }[]>) => (await rows)[0].r;

export type Route = { status: number; body: unknown };
const bad = (code: string, message: string, status = 400): Route => ({ status, body: { ok: false, error: { code, message, retryable: false } } });

async function readJson(req: Request): Promise<Json> {
  try { return (await req.json()) as Json; } catch { return {}; }
}

export async function handleAdmin(ctx: Ctx, req: Request, path: string, url: URL): Promise<Route | null> {
  const seg = path.split("/").filter(Boolean); // ["admin", ...]
  const method = req.method;
  // A platform proxy holding the operator token may name the signed-in person (X-Baton-Actor); the audit
  // trail then records user:<name> instead of the token owner. Interim until Clane identity mints operators.
  const named = ctx.kind === "operator" ? (req.headers.get("x-baton-actor") ?? "").trim().slice(0, 120) : "";
  const actor = named ? (named.startsWith("user:") ? named : `user:${named}`) : ctx.actor;
  const actorLabel = ctx.kind === "operator" ? (req.headers.get("x-baton-actor-label") ?? "").trim().slice(0, 200) : "";

  // Routes the daemon may call with an agent token.
  if (path === "/work-available" && method === "GET") {
    const role = url.searchParams.get("role") ?? (ctx.kind === "agent" ? ctx.agent.role : "");
    if (!role) return bad("PRECONDITION_FAILED", "role is required");
    const agentId = ctx.kind === "agent" ? ctx.agent.id : null;
    const r = await one(sql`select baton.work_available(${role}, ${agentId}::uuid) as r`);
    return { status: 200, body: { ...r, available: Number(r.ready) > 0 || Number(r.questions ?? 0) > 0 } };
  }
  if (path === "/runs/usage" && method === "POST") {
    const b = await readJson(req);
    const agentId = ctx.kind === "agent" ? ctx.agent.id : (b.agent_id ? String(b.agent_id) : null);
    if (!agentId || !b.session_id) return bad("PRECONDITION_FAILED", "session_id (and agent_id for operators) required");
    const r = await one(sql`select baton.runs_usage(${agentId}::uuid, ${String(b.session_id)}, ${b.task_id ? String(b.task_id) : null}::uuid,
      ${Number(b.tokens_in ?? 0)}::bigint, ${Number(b.tokens_out ?? 0)}::bigint, ${Number(b.cost_usd ?? 0)}::numeric,
      ${b.model ? String(b.model) : null}, ${b.exit_reason ? String(b.exit_reason) : null}, ${Number(b.credits ?? 0)}::numeric) as r`);
    return { status: 200, body: r };
  }
  if (path === "/agent/inbox" && method === "GET" && ctx.kind === "agent") {
    // Non-consuming peek for the monitor: everything addressed to me or my role since `since`.
    const since = url.searchParams.get("since") ?? new Date(Date.now() - 60_000).toISOString();
    const rows = await sql`select baton.message_json(m) as r from baton.messages m
      where m.created_at > ${since}::timestamptz
        and (m.to_agent = ${ctx.agent.id}::uuid or (m.to_agent is null and m.to_role = ${ctx.agent.role})
             or (m.kind = 'broadcast' and m.from_agent is distinct from ${ctx.agent.id}::uuid))
      order by m.created_at`;
    return { status: 200, body: { ok: true, messages: rows.map((x) => x.r), now: new Date().toISOString() } };
  }

  if (seg[0] !== "admin") return null;
  if (ctx.kind !== "operator") return bad("FORBIDDEN", "operator token required", 403);

  // ---- status, spend, events
  if (seg[1] === "status" && method === "GET") return { status: 200, body: await one(sql`select baton.status_summary() as r`) };
  if (seg[1] === "spend" && method === "GET") return { status: 200, body: await one(sql`select baton.spend_summary() as r`) };
  if (seg[1] === "events" && method === "GET") {
    const p = url.searchParams;
    const limit = Math.min(1000, Number(p.get("limit") ?? 200));
    const taskIn = p.get("task_in") ? p.get("task_in")!.split(",").map((s) => s.trim()).filter(Boolean) : null;
    // cursor = the id of the last event seen (events are listed newest first); keyset, so a stream that grows underneath stays stable
    const paged = p.get("cursor") !== null;
    const before = paged && p.get("cursor") ? Number(decodeCursor(p.get("cursor"))?.id ?? p.get("cursor")) : null;
    const cap = paged ? Math.max(1, Math.min(200, Number(p.get("limit") ?? 100))) : limit;
    const rows = await sql`
      select e.id, e.ts, e.type, e.payload, e.session_id, e.task_id, e.agent_id,
             (select name from baton.agents where id = e.agent_id) as agent,
             (select key from baton.tasks where id = e.task_id) as task_key
        from baton.events e
       where (${Number.isFinite(before) ? before : null}::bigint is null or e.id < ${Number.isFinite(before) ? before : null}::bigint)
         and (${p.get("agent")}::text is null or e.agent_id::text = ${p.get("agent")} or exists (select 1 from baton.agents a where a.id = e.agent_id and a.name = ${p.get("agent")}))
         and (${p.get("task")}::text is null or e.task_id::text = ${p.get("task")} or exists (select 1 from baton.tasks t where t.id = e.task_id and t.key = ${p.get("task")}))
         and (${p.get("workflow_run")}::text is null or exists (select 1 from baton.tasks t where t.id = e.task_id and t.workflow_run = ${p.get("workflow_run")}))
         and (${taskIn}::text[] is null or exists (select 1 from baton.tasks t where t.id = e.task_id and (t.key = any(${taskIn}::text[]) or t.id::text = any(${taskIn}::text[]))))
         and (${p.get("type")}::text is null or e.type = ${p.get("type")})
         and (${p.get("since")}::text is null or e.ts > ${p.get("since")}::timestamptz)
       order by e.id desc limit ${paged ? cap + 1 : cap}`;
    if (!paged) return { status: 200, body: { ok: true, events: rows } };
    const page = rows.slice(0, cap); const more = rows.length > cap; const last = page[page.length - 1];
    return { status: 200, body: { ok: true, events: page, limit: cap, next_cursor: more && last ? encodeCursor(String(last.ts), String(last.id)) : null } };
  }

  // ---- inbox (the human read model)
  if (seg[1] === "inbox" && method === "GET") return { status: 200, body: await inboxJson(url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 50)) };

  // ---- tasks: filter by one or more states, search, page
  if (seg[1] === "tasks" && seg.length === 2 && method === "GET") {
    const p = url.searchParams;
    const states = p.get("state") ? p.get("state")!.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const q = p.get("q") ? `%${p.get("q")!.trim()}%` : null;
    const limit = Math.min(1000, Number(p.get("limit") ?? 500)), offset = Math.max(0, Number(p.get("offset") ?? 0));
    const where = sql`
       where (${states}::text[] is null or t.state::text = any(${states}::text[]))
         and (${p.get("role")}::text is null or t.role = ${p.get("role")})
         and (${p.get("workflow_run")}::text is null or t.workflow_run = ${p.get("workflow_run")})
         and (${q}::text is null or t.key ilike ${q} or t.title ilike ${q} or t.workflow_run ilike ${q} or exists (select 1 from baton.artifacts a where a.task_id = t.id and a.content::text ilike ${q}))`;
    const [{ n }] = await sql`select count(*)::int as n from baton.tasks t ${where}`;
    const cur = decodeCursor(p.get("cursor"));
    if (p.get("cursor") !== null) {
      // keyset page: created_at desc, id desc; stable while rows change underneath the reader
      const cap = Math.max(1, Math.min(50, Number(p.get("limit") ?? 50)));
      const rows = await sql`
        select baton.task_json(t) || jsonb_build_object('assignee_name', (select name from baton.agents where id = t.assignee)) as r, t.created_at, t.id
          from baton.tasks t ${where}
           and (${cur?.sortValue ?? null}::timestamptz is null or (t.created_at, t.id::text) < (${cur?.sortValue ?? null}::timestamptz, ${cur?.id ?? null}::text))
         order by t.created_at desc, t.id desc limit ${cap + 1}`;
      const page = rows.slice(0, cap);
      const more = rows.length > cap;
      const last = page[page.length - 1];
      return { status: 200, body: { ok: true, tasks: page.map((x) => x.r), total: n, limit: cap, next_cursor: more && last ? encodeCursor(new Date(last.created_at as string).toISOString(), String(last.id)) : null } };
    }
    const rows = await sql`
      select baton.task_json(t) || jsonb_build_object('assignee_name', (select name from baton.agents where id = t.assignee)) as r
        from baton.tasks t ${where}
       order by (t.state = 'in_progress') desc, t.priority desc, t.created_at desc limit ${limit} offset ${offset}`;
    return { status: 200, body: { ok: true, tasks: rows.map((x) => x.r), total: n, offset, limit } };
  }
  if (seg[1] === "tasks" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const r = await one(sql`select baton.task_create(${actor}, ${j(b)}::jsonb) as r`);
    try { await drainWebhooks(); } catch (e) { console.error("webhooks", e); }
    return { status: 200, body: r };
  }
  // ---- workflows and runs (definitions stored, runs with a derived status)
  if (seg[1] === "workflows" && seg.length === 2 && method === "GET") {
    const rows = await sql`select key, name, version, created_by, created_at, updated_at, (select count(*)::int from baton.workflow_runs r where r.workflow_key = w.key) as runs from baton.workflows w order by name`;
    return { status: 200, body: { ok: true, workflows: rows } };
  }
  if (seg[1] === "workflows" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const key = String(b.key ?? "").trim(); if (!key) return bad("PRECONDITION_FAILED", "key is required");
    const [row] = await sql`insert into baton.workflows (key, name, version, manifest, created_by) values (${key}, ${String(b.name ?? key)}, ${String(b.version ?? "")}, ${j(b.manifest ?? {})}::jsonb, ${actor})
      on conflict (key) do update set name = excluded.name, version = excluded.version, manifest = excluded.manifest, updated_at = now() returning key, name, version`;
    return { status: 200, body: { ok: true, workflow: row } };
  }
  if (seg[1] === "workflows" && seg.length === 3 && method === "GET") {
    const [row] = await sql`select key, name, version, manifest, created_by, created_at from baton.workflows where key = ${seg[2]}`;
    return row ? { status: 200, body: { ok: true, workflow: row } } : bad("NOT_FOUND", "no such workflow", 404);
  }
  if (seg[1] === "workflow-runs" && seg.length === 2 && method === "GET") {
    const p = url.searchParams;
    if (p.get("cursor") === null) return { status: 200, body: { ok: true, runs: await one(sql`select baton.workflow_runs_json(${Math.min(500, Number(p.get("limit") ?? 100))}::int) as r`) } };
    const cur = decodeCursor(p.get("cursor"));
    const cap = Math.max(1, Math.min(50, Number(p.get("limit") ?? 50)));
    const [{ n }] = await sql`select count(*)::int as n from baton.workflow_runs`;
    const keys = await sql`select key, created_at from baton.workflow_runs r
      where (${cur?.sortValue ?? null}::timestamptz is null or (r.created_at, r.key) < (${cur?.sortValue ?? null}::timestamptz, ${cur?.id ?? null}::text))
      order by r.created_at desc, r.key desc limit ${cap + 1}`;
    const page = keys.slice(0, cap); const more = keys.length > cap; const last = page[page.length - 1];
    const runs = [] as Json[];
    for (const k of page) { const r = await one(sql`select baton.workflow_run_json(${k.key}) - 'steps' as r`); runs.push(r); }
    return { status: 200, body: { ok: true, runs, total: n, limit: cap, next_cursor: more && last ? encodeCursor(new Date(last.created_at as string).toISOString(), String(last.key)) : null } };
  }
  if (seg[1] === "workflow-runs" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const key = String(b.key ?? "").trim(); if (!key) return bad("PRECONDITION_FAILED", "key is required");
    const [row] = await sql`insert into baton.workflow_runs (key, workflow_key, workflow_name, input, created_by, workspace)
      values (${key}, ${b.workflow_key ? String(b.workflow_key) : null}, ${b.workflow_name ? String(b.workflow_name) : null}, ${b.input ? String(b.input) : null}, ${actor}, ${b.workspace ? String(b.workspace) : null})
      on conflict (key) do update set workflow_name = excluded.workflow_name, input = excluded.input, workspace = coalesce(excluded.workspace, baton.workflow_runs.workspace) returning key, workspace`;
    return { status: 200, body: { ok: true, run: row } };
  }
  if (seg[1] === "workflow-runs" && seg.length === 4 && seg[3] === "artifacts" && method === "GET") {
    // Every artefact of a run in one call (latest per kind per step), so a run screen needs no fan-out.
    const [run] = await sql`select key, workspace from baton.workflow_runs where key = ${seg[2]}`;
    if (!run) return bad("NOT_FOUND", "no such run", 404);
    const rows = await sql`
      select * from (
        select distinct on (t.id, a.kind) t.key as task_key, t.id as task_id, t.title as step, t.role, t.state, t.created_at as step_created, baton.artifact_json(a) as artifact
          from baton.tasks t join baton.artifacts a on a.task_id = t.id
         where t.workflow_run = ${seg[2]}
         order by t.id, a.kind, a.created_at desc) x
       order by x.step_created, x.task_key, (x.artifact->>'created_at')`;
    const stored = await sql`select id, path, content_type, bytes from baton.documents where workspace = ${run.workspace ?? "default"}`;
    const byPath = new Map(stored.map((s) => [String(s.path), s]));
    const artifacts = rows.map((r) => {
      const a = r.artifact as Json;
      const documents = documentsOf(String(a.kind), a.content).map((d) => { const s = byPath.get(d.path); return { ...d, id: s ? String(s.id) : null, available: !!s, content_type: s?.content_type ?? null, bytes: s?.bytes ?? null }; });
      return { task_key: r.task_key, task_id: r.task_id, step: String(r.step).replace(/^.*?: /, ""), role: r.role, state: r.state, ...a, documents };
    });
    return { status: 200, body: { ok: true, run: run.key, workspace: run.workspace ?? "default", artifacts } };
  }
  if (seg[1] === "workflow-runs" && seg.length === 3 && method === "GET") {
    const r = await one(sql`select baton.workflow_run_json(${seg[2]}) as r`);
    if (!r) return bad("NOT_FOUND", "no such run", 404);
    const steps = (r.steps as Json[]) ?? [];
    const byId = new Map(steps.map((s) => [String(s.id), s]));
    for (const s of steps) {
      s.next = steps.filter((d) => ((d.depends_on as string[]) ?? []).includes(String(s.id))).map((d) => ({ key: d.key, id: d.id, when: (d.condition as Json | null)?.outcome ?? null, state: d.state }));
      const c = s.condition as Json | null;
      if (c) { const dec = byId.get(String(c.task)); s.when = { gateway: c.gateway ?? null, outcome: c.outcome ?? null, decided_by: dec?.key ?? null, field: `${c.kind}.${c.field}`, equals: c.equals }; }
    }
    return { status: 200, body: { ok: true, run: r } };
  }
  // ---- webhooks: outbound event subscriptions for orchestrators
  if (seg[1] === "webhooks" && seg.length === 2 && method === "GET") {
    const rows = await sql`select w.id, w.url, w.events, w.active, w.created_by, w.created_at,
      (select count(*)::int from baton.webhook_deliveries d where d.webhook_id = w.id and d.sent_at is null and d.attempts < 5) as pending,
      (select max(sent_at) from baton.webhook_deliveries d where d.webhook_id = w.id) as last_sent
      from baton.webhooks w order by w.created_at`;
    return { status: 200, body: { ok: true, webhooks: rows } };
  }
  if (seg[1] === "webhooks" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const target = String(b.url ?? "");
    if (!/^https?:\/\//.test(target)) return bad("PRECONDITION_FAILED", "url must be http(s)");
    const secret = b.secret ? String(b.secret) : newToken().replace(/^btn_/, "whs_");
    const events = Array.isArray(b.events) ? b.events.map(String) : b.events ? String(b.events).split(",").map((x) => x.trim()).filter(Boolean) : null;
    const [row] = await sql`insert into baton.webhooks (url, secret, events, created_by) values (${target}, ${secret}, ${events}::text[], ${actor}) returning id, url, events, active`;
    return { status: 200, body: { ok: true, webhook: row, secret } };
  }
  if (seg[1] === "webhooks" && seg[2] === "flush" && method === "POST") return { status: 200, body: await drainWebhooks(100) };
  if (seg[1] === "webhooks" && seg.length === 3 && method === "DELETE") {
    await sql`delete from baton.webhooks where id::text = ${seg[2]}`;
    return { status: 200, body: { ok: true } };
  }
  if (seg[1] === "tasks" && seg.length >= 3) {
    const [{ id }] = await sql`select id from baton.tasks where id::text = ${seg[2]} or key = ${seg[2]} limit 1`.then((r) => r.length ? r : [{ id: null }]);
    if (!id) return bad("NOT_FOUND", "no such task", 404);
    if (seg.length === 3 && method === "GET") {
      const d = await one(sql`select baton.task_detail(${id}::uuid) as r`);
      if (d.ok === false) return { status: 404, body: d };
      const t = d.task as Json;
      d.decision = t.role === "operator" ? decisionOf((d.events as Json[]) ?? []) : null;
      d.questions = ((d.messages as Json[]) ?? []).filter((m) => m.kind === "question" && !m.answered_at);
      d.documents = [...((d.consumed as Json[]) ?? []), ...((d.artifacts as Json[]) ?? [])].flatMap((a) => documentsOf(String(a.kind), a.content));
      return { status: 200, body: d };
    }
    if (seg[3] === "documents" && seg.length === 4 && method === "GET") {
      const d = await one(sql`select baton.task_detail(${id}::uuid) as r`);
      if (d.ok === false) return { status: 404, body: d };
      const [{ ws }] = await sql`select baton.task_workspace(${id}::uuid) as ws`;
      const seen = new Set<string>();
      const wanted = [...((d.consumed as Json[]) ?? []), ...((d.artifacts as Json[]) ?? [])].flatMap((a) => documentsOf(String(a.kind), a.content)).filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
      const stored = await sql`select id, path, content_type, bytes, updated_at from baton.documents where workspace = ${ws}`;
      const byPath = new Map(stored.map((s) => [String(s.path), s]));
      const documents = wanted.map((w) => { const s = byPath.get(w.path); return { ...w, id: s ? String(s.id) : null, available: !!s, content_type: s?.content_type ?? null, bytes: s?.bytes ?? null, updated_at: s?.updated_at ?? null }; });
      return { status: 200, body: { ok: true, workspace: ws, documents } };
    }
    if (seg[3] === "documents" && seg.length === 5 && method === "GET") {
      const [{ ws }] = await sql`select baton.task_workspace(${id}::uuid) as ws`;
      const [doc] = await sql`select id, workspace, path, content_type, bytes from baton.documents where id::text = ${seg[4]} and workspace = ${ws}`;
      if (!doc) return bad("NOT_FOUND", "no such document for this task", 404);
      const obj = await downloadObject(`docs/${doc.workspace}/${doc.path}`);
      if (!obj) return bad("NOT_FOUND", "document bytes are missing from storage", 404);
      const name = String(doc.path).split("/").pop() ?? "document";
      return { status: 200, body: obj.body, raw: true, headers: { "content-type": String(doc.content_type), "content-length": String(doc.bytes), "content-disposition": `inline; filename="${name.replace(/"/g, "")}"`, "cache-control": "private, max-age=60" } } as unknown as Route;
    }
    const b = method === "POST" ? await readJson(req) : {};
    if (seg[3] === "prioritise" && method === "POST") return { status: 200, body: await one(sql`select baton.task_reprioritise(${actor}, ${id}::uuid, ${Number(b.priority)}::int) as r`) };
    if (seg[3] === "cancel" && method === "POST") { const r = await one(sql`select baton.task_cancel(${actor}, ${id}::uuid, ${b.reason ? String(b.reason) : null}) as r`); try { await drainWebhooks(); } catch { /* ignore */ } return { status: 200, body: r }; }
    if (seg[3] === "approve" && method === "POST") { const r = await one(sql`select baton.task_approve(${actor}, ${id}::uuid, ${String(b.verdict ?? "approve")}, ${b.reason ? String(b.reason) : null}) as r`); try { await drainWebhooks(); } catch { /* ignore */ } return { status: 200, body: r }; }
    if (seg[3] === "retry" && method === "POST") { const r = await one(sql`select baton.task_retry(${actor}, ${id}::uuid, ${b.reset_attempts !== false}, ${b.budget_usd == null ? null : Number(b.budget_usd)}, ${b.reason ? String(b.reason) : null}, ${b.deadline ? String(b.deadline) : null}) as r`); try { await drainWebhooks(); } catch { /* ignore */ } return { status: 200, body: r }; }
    if (seg[3] === "force-release" && method === "POST") return { status: 200, body: await one(sql`select baton.task_force_release(${actor}, ${id}::uuid) as r`) };
    if (seg[3] === "gate" && method === "POST") return { status: 200, body: await one(sql`select baton.run_gate(${id}::uuid) as r`) };
  }

  // ---- documents: files a workspace holds, uploaded by the sync command or a worker, streamed to screens by id
  if (seg[1] === "documents" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const workspace = String(b.workspace ?? "default").trim(), path = String(b.path ?? "").replace(/\\/g, "/").trim();
    if (!path || path.includes("..") || path.startsWith("/") || /^[a-z]:/i.test(path)) return bad("PRECONDITION_FAILED", "path must be relative, forward slashes, no ..");
    if (typeof b.content_base64 !== "string") return bad("PRECONDITION_FAILED", "content_base64 is required");
    const bytes = Uint8Array.from(atob(b.content_base64), (c) => c.charCodeAt(0));
    if (bytes.length > 25 * 1024 * 1024) return bad("PRECONDITION_FAILED", "document exceeds 25 MB");
    const contentType = b.content_type ? String(b.content_type) : "application/octet-stream";
    await uploadBytes(`docs/${workspace}/${path}`, bytes, contentType);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
    const r = await one(sql`select baton.document_upsert(${workspace}, ${path}, ${contentType}, ${bytes.length}::bigint, ${sha}, ${actor}) as r`);
    return { status: r.ok === false ? 400 : 200, body: r };
  }
  if (seg[1] === "documents" && seg.length === 2 && method === "GET") {
    const ws = url.searchParams.get("workspace") ?? "default";
    const rows = await sql`select id, workspace, path, content_type, bytes, uploaded_by, updated_at from baton.documents where workspace = ${ws} order by path`;
    return { status: 200, body: { ok: true, workspace: ws, documents: rows } };
  }

  // ---- messages
  if (seg[1] === "answer" && method === "POST") {
    const b = await readJson(req);
    let messageId = b.message_id ? String(b.message_id) : null;
    if (!messageId && b.task_key) {
      const [m] = await sql`select m.id from baton.messages m join baton.tasks t on t.id = m.task_id where (t.key = ${String(b.task_key)} or t.id::text = ${String(b.task_key)}) and m.kind = 'question' and m.answered_at is null order by m.created_at desc limit 1`;
      if (!m) return bad("NOT_FOUND", "that task has no open question", 404);
      messageId = String(m.id);
    }
    if (!messageId) return bad("PRECONDITION_FAILED", "message_id or task_key is required");
    const r = await one(sql`select baton.answer(${actor}, null, ${messageId}::uuid, ${String(b.body ?? "")}) as r`);
    try { await drainWebhooks(); } catch { /* ignore */ }
    return { status: 200, body: r };
  }
  if (seg[1] === "messages" && method === "GET") {
    const unanswered = url.searchParams.get("unanswered") === "1";
    const since = url.searchParams.get("since");
    const rows = await sql`select baton.message_json(m) as r from baton.messages m
      where (${unanswered}::boolean = false or (m.kind = 'question' and m.answered_at is null))
        and (${since}::text is null or m.created_at > ${since}::timestamptz)
      order by m.created_at desc limit 200`;
    return { status: 200, body: { ok: true, messages: rows.map((x) => x.r) } };
  }

  // ---- roles and agents
  if (seg[1] === "roles" && method === "GET") {
    const rows = await sql`select name, description, definition_path, default_model, max_concurrent from baton.roles order by name`;
    return { status: 200, body: { ok: true, roles: rows } };
  }
  if (seg[1] === "roles" && method === "POST") {
    const b = await readJson(req);
    return { status: 200, body: await one(sql`select baton.role_upsert(${actor}, ${String(b.name ?? "")}, ${String(b.description ?? "")},
      ${b.definition_path ? String(b.definition_path) : null}, ${b.default_model ? String(b.default_model) : null}, ${Number(b.max_concurrent ?? 1)}::int) as r`) };
  }
  if (seg[1] === "agents" && seg.length === 2 && method === "GET") {
    const rows = await sql`select a.id, a.name, a.role, a.machine, a.owner_email, a.status, a.last_seen, a.revoked_at, a.created_at,
                                  (select key from baton.tasks where id = a.current_task) as current_task_key
                             from baton.agents a order by a.role, a.name`;
    return { status: 200, body: { ok: true, agents: rows } };
  }
  if (seg[1] === "agents" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const token = newToken();
    const r = await one(sql`select baton.agent_create(${actor}, ${String(b.name ?? "")}, ${String(b.role ?? "")}, ${String(b.machine ?? "unknown")},
      ${b.owner_email ? String(b.owner_email) : null}, ${await sha256Hex(token)}) as r`);
    return { status: 200, body: r.ok ? { ...r, token } : r };
  }
  // ---- invites: one-time codes redeemed by `baton join` on a new machine
  if (seg[1] === "invites" && seg.length === 2 && method === "GET") {
    return { status: 200, body: { ok: true, invites: await one(sql`select baton.invite_list() as r`) } };
  }
  if (seg[1] === "invites" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    const roles = Array.isArray(b.roles) ? b.roles.map(String) : String(b.roles ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const code = "btn_inv_" + newToken().slice(4);
    const ttl = b.ttl_hours ? `${Number(b.ttl_hours)} hours` : "24 hours";
    const r = await one(sql`select baton.invite_create(${actor}, ${roles}::text[], ${b.machine ? String(b.machine) : null},
      ${String(b.name_prefix ?? "")}, ${await sha256Hex(code)}, ${ttl}::interval, ${b.project_key ? String(b.project_key) : null}) as r`);
    return { status: 200, body: r.ok ? { ...r, code } : r };
  }
  if (seg[1] === "invites" && seg.length === 3 && method === "DELETE") {
    // Withdraw a code that has not been redeemed. Agents already created from it are untouched and
    // are revoked one by one; withdrawing a code and disabling a fleet are different actions.
    if (!/^[0-9a-f-]{36}$/i.test(seg[2])) return bad("PRECONDITION_FAILED", "invite id must be a uuid");
    const r = await one(sql`select baton.invite_revoke(${actor}, ${seg[2]}::uuid) as r`);
    return { status: r.ok === false ? (String((r.error as Json)?.code) === "NOT_FOUND" ? 404 : 400) : 200, body: r };
  }
  if (seg[1] === "agents" && seg.length === 3 && method === "DELETE") {
    const [{ id }] = await sql`select id from baton.agents where id::text = ${seg[2]} or name = ${seg[2]} limit 1`.then((r) => r.length ? r : [{ id: null }]);
    if (!id) return bad("NOT_FOUND", "no such agent", 404);
    return { status: 200, body: await one(sql`select baton.agent_revoke(${actor}, ${id}::uuid) as r`) };
  }

  // ---- artifacts
  if (seg[1] === "artifacts" && method === "GET") {
    const p = url.searchParams;
    const rows = await sql`select baton.artifact_json(a) as r from baton.artifacts a
      where (${p.get("kind")}::text is null or a.kind::text = ${p.get("kind")})
        and (${p.get("task")}::text is null or a.task_id::text = ${p.get("task")})
      order by a.created_at desc limit 200`;
    return { status: 200, body: { ok: true, artifacts: rows.map((x) => x.r) } };
  }
  if (seg[1] === "artifacts" && method === "POST") {
    // Operators can register artefacts on any task (used by the GitHub face and tests).
    const b = await readJson(req);
    const [{ id }] = await sql`select id from baton.tasks where id::text = ${String(b.task_id)} or key = ${String(b.task_id)} limit 1`.then((r) => r.length ? r : [{ id: null }]);
    if (!id) return bad("NOT_FOUND", "no such task", 404);
    const [row] = await sql`insert into baton.artifacts (task_id, kind, uri, sha256, schema_version, meta, content)
      values (${id}::uuid, ${String(b.kind)}::baton.artifact_kind, ${String(b.uri ?? "")}, ${b.sha256 ? String(b.sha256) : null},
              ${String(b.schema_version ?? "v1")}, ${j(b.meta ?? {})}::jsonb, ${b.content ? j(b.content) : null}::jsonb) returning id`;
    return { status: 200, body: { ok: true, artifact_id: row.id } };
  }

  // ---- projects (phase 9)
  if (seg[1] === "projects") {
    if (seg[2] === "profile" && method === "GET") {
      const [row] = await sql`select baton.project_profile(${url.searchParams.get("repo") ?? ""}) as r`;
      return row.r ? { status: 200, body: row.r } : bad("NOT_FOUND", "no project profile for that repo", 404);
    }
    if (seg[2] === "drift" && method === "POST") {
      const b = await readJson(req);
      return { status: 200, body: await one(sql`select baton.project_drift(${actor}, ${String(b.project_id)}::uuid, ${String(b.machine ?? "unknown")}, ${j(b.actions ?? [])}::jsonb) as r`) };
    }
    if (seg.length === 2 && method === "GET") {
      const rows = await sql`select p.id, p.key, p.name, p.repo, p.marketplace_ref,
        (select coalesce(jsonb_agg(jsonb_build_object('plugin', pp.plugin, 'version', pp.version, 'scope', pp.scope, 'enabled', pp.enabled) order by pp.plugin), '[]'::jsonb) from baton.project_plugins pp where pp.project_id = p.id) as plugins,
        (select coalesce(jsonb_agg(m.server order by m.server), '[]'::jsonb) from baton.project_mcp m where m.project_id = p.id) as mcp
        from baton.projects p order by p.key`;
      return { status: 200, body: { ok: true, projects: rows } };
    }
    if (seg.length === 2 && method === "POST") {
      const b = await readJson(req);
      return { status: 200, body: await one(sql`select baton.project_upsert(${actor}, ${String(b.key ?? "")}, ${String(b.name ?? b.key ?? "")}, ${String(b.repo ?? "")}, ${String(b.marketplace_ref ?? "main")}) as r`) };
    }
    if (seg.length === 4 && seg[3] === "plugins" && method === "POST") {
      const b = await readJson(req);
      return { status: 200, body: await one(sql`select baton.project_plugin_set(${actor}, ${seg[2]}, ${String(b.plugin ?? "")}, ${b.version ? String(b.version) : null}, ${String(b.scope ?? "project")}, ${b.enabled !== false}) as r`) };
    }
    if (seg.length === 4 && seg[3] === "mcp" && method === "POST") {
      const b = await readJson(req);
      return { status: 200, body: await one(sql`select baton.project_mcp_set(${actor}, ${seg[2]}, ${String(b.server ?? "")}, ${b.config === null || b.config === undefined ? null : j(b.config)}::jsonb) as r`) };
    }
  }

  // ---- conformance (phase 8)
  if (seg[1] === "conformance" && method === "GET") {
    const days = Math.min(30, Number(url.searchParams.get("days") ?? 1));
    const [live] = await sql`select baton.conformance_report(now() - make_interval(days => ${days}), now()) as r`;
    const stored = await sql`select day, report, created_at from baton.conformance_reports order by day desc limit ${days}`;
    return { status: 200, body: { ok: true, live: live.r, daily: stored } };
  }
  if (seg[1] === "conformance" && seg[2] === "run" && method === "POST") {
    return { status: 200, body: { ok: true, report: await one(sql`select baton.conformance_daily() as r`) } };
  }

  // ---- github (phase 7)
  if (seg[1] === "github" && seg[2] === "outbox" && method === "GET") {
    const rows = await sql`select id, kind, repo, payload, created_at, sent_at, attempts, error, (select key from baton.tasks where id = o.task_id) as task_key from baton.gh_outbox o order by id desc limit 100`;
    return { status: 200, body: { ok: true, outbox: rows } };
  }
  if (seg[1] === "github" && seg[2] === "flush" && method === "POST") {
    return { status: 200, body: await drainOutbox() };
  }
  if (seg[1] === "github" && seg[2] === "check" && method === "POST") {
    // Operator-driven CI verdict (for CI systems that call back with a token instead of a webhook).
    const b = await readJson(req);
    const r = await one(sql`select baton.gh_check_event(${String(b.repo ?? "")}, ${String(b.head_sha ?? "")}, ${String(b.status ?? "pending")}, ${j(b.details ?? {})}::jsonb) as r`);
    await drainOutbox();
    return { status: 200, body: r };
  }

  return bad("NOT_FOUND", `No admin route ${method} ${path}`, 404);
}

/** POST /join {code, machine}: unauthenticated by design; the one-time code is the credential.
 *  Generates one agent token per role on the invite, stores only their hashes, returns the tokens once. */
export async function handleJoin(req: Request): Promise<Route> {
  const b = await readJson(req);
  const code = String(b.code ?? "").trim();
  if (!/^btn_inv_[0-9a-f]{40}$/.test(code)) return bad("PRECONDITION_FAILED", "malformed invite code");
  const machine = b.machine ? String(b.machine).slice(0, 80) : null;
  const hash = await sha256Hex(code);
  const [inv] = await sql`select roles from baton.invites where code_hash = ${hash} and redeemed_at is null and expires_at > now()`;
  if (!inv) {
    const r = await one(sql`select baton.invite_redeem(${hash}, ${machine}, '{}'::jsonb) as r`); // yields the precise error
    return { status: r.ok ? 200 : 400, body: r };
  }
  const tokens: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const role of inv.roles as string[]) { tokens[role] = newToken(); hashes[role] = await sha256Hex(tokens[role]); }
  const r = await one(sql`select baton.invite_redeem(${hash}, ${machine}, ${j(hashes)}::jsonb) as r`);
  if (!r.ok) return { status: 400, body: r };
  const agents: Record<string, { name: string; token: string }> = {};
  for (const a of r.agents as { name: string; role: string }[]) agents[a.role] = { name: a.name, token: tokens[a.role] };
  return { status: 200, body: { ok: true, machine: r.machine, project_key: r.project_key ?? null, agents } };
}
