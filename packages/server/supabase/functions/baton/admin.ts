// Operator API: what the CLI and the dashboard use. Every route needs an operator token,
// except the few the supervisor daemon calls with an agent token (marked below).
import { sql } from "./db.ts";
import { newToken, sha256Hex, type Ctx } from "./auth.ts";
import { drainOutbox } from "./gh.ts";

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
  const actor = ctx.actor;

  // Routes the daemon may call with an agent token.
  if (path === "/work-available" && method === "GET") {
    const role = url.searchParams.get("role") ?? (ctx.kind === "agent" ? ctx.agent.role : "");
    if (!role) return bad("PRECONDITION_FAILED", "role is required");
    const r = await one(sql`select baton.work_available(${role}) as r`);
    return { status: 200, body: { ...r, available: Number(r.ready) > 0 } };
  }
  if (path === "/runs/usage" && method === "POST") {
    const b = await readJson(req);
    const agentId = ctx.kind === "agent" ? ctx.agent.id : (b.agent_id ? String(b.agent_id) : null);
    if (!agentId || !b.session_id) return bad("PRECONDITION_FAILED", "session_id (and agent_id for operators) required");
    const r = await one(sql`select baton.runs_usage(${agentId}::uuid, ${String(b.session_id)}, ${b.task_id ? String(b.task_id) : null}::uuid,
      ${Number(b.tokens_in ?? 0)}::bigint, ${Number(b.tokens_out ?? 0)}::bigint, ${Number(b.cost_usd ?? 0)}::numeric,
      ${b.model ? String(b.model) : null}, ${b.exit_reason ? String(b.exit_reason) : null}) as r`);
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
    const rows = await sql`
      select e.id, e.ts, e.type, e.payload, e.session_id, e.task_id, e.agent_id,
             (select name from baton.agents where id = e.agent_id) as agent,
             (select key from baton.tasks where id = e.task_id) as task_key
        from baton.events e
       where (${p.get("agent")}::text is null or e.agent_id::text = ${p.get("agent")} or exists (select 1 from baton.agents a where a.id = e.agent_id and a.name = ${p.get("agent")}))
         and (${p.get("task")}::text is null or e.task_id::text = ${p.get("task")} or exists (select 1 from baton.tasks t where t.id = e.task_id and t.key = ${p.get("task")}))
         and (${p.get("type")}::text is null or e.type = ${p.get("type")})
         and (${p.get("since")}::text is null or e.ts > ${p.get("since")}::timestamptz)
       order by e.id desc limit ${limit}`;
    return { status: 200, body: { ok: true, events: rows } };
  }

  // ---- tasks
  if (seg[1] === "tasks" && seg.length === 2 && method === "GET") {
    const p = url.searchParams;
    const rows = await sql`
      select baton.task_json(t) || jsonb_build_object('assignee_name', (select name from baton.agents where id = t.assignee)) as r
        from baton.tasks t
       where (${p.get("state")}::text is null or t.state::text = ${p.get("state")})
         and (${p.get("role")}::text is null or t.role = ${p.get("role")})
       order by (t.state = 'in_progress') desc, t.priority desc, t.created_at desc limit ${Math.min(1000, Number(p.get("limit") ?? 500))}`;
    return { status: 200, body: { ok: true, tasks: rows.map((x) => x.r) } };
  }
  if (seg[1] === "tasks" && seg.length === 2 && method === "POST") {
    const b = await readJson(req);
    return { status: 200, body: await one(sql`select baton.task_create(${actor}, ${j(b)}::jsonb) as r`) };
  }
  if (seg[1] === "tasks" && seg.length >= 3) {
    const [{ id }] = await sql`select id from baton.tasks where id::text = ${seg[2]} or key = ${seg[2]} limit 1`.then((r) => r.length ? r : [{ id: null }]);
    if (!id) return bad("NOT_FOUND", "no such task", 404);
    if (seg.length === 3 && method === "GET") return { status: 200, body: await one(sql`select baton.task_detail(${id}::uuid) as r`) };
    const b = method === "POST" ? await readJson(req) : {};
    if (seg[3] === "prioritise" && method === "POST") return { status: 200, body: await one(sql`select baton.task_reprioritise(${actor}, ${id}::uuid, ${Number(b.priority)}::int) as r`) };
    if (seg[3] === "cancel" && method === "POST") return { status: 200, body: await one(sql`select baton.task_cancel(${actor}, ${id}::uuid, ${b.reason ? String(b.reason) : null}) as r`) };
    if (seg[3] === "force-release" && method === "POST") return { status: 200, body: await one(sql`select baton.task_force_release(${actor}, ${id}::uuid) as r`) };
    if (seg[3] === "gate" && method === "POST") return { status: 200, body: await one(sql`select baton.run_gate(${id}::uuid) as r`) };
  }

  // ---- messages
  if (seg[1] === "answer" && method === "POST") {
    const b = await readJson(req);
    return { status: 200, body: await one(sql`select baton.answer(${actor}, null, ${String(b.message_id)}::uuid, ${String(b.body ?? "")}) as r`) };
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
