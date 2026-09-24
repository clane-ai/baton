// The MCP face: JSON-RPC over streamable HTTP, seventeen tools (prd.md section 10, docs/delegation.md).
import { sql, asAgent } from "./db.ts";
import type { Agent } from "./auth.ts";
import { uploadArtifact, signArtifact, sha256Hex, uploadBytes } from "./storage.ts";
import { drainOutbox } from "./gh.ts";
import { drainWebhooks } from "./webhooks.ts";

type Json = Record<string, unknown>;
type ToolDef = { name: string; description: string; inputSchema: Json; mutating: boolean };

const uuid = { type: "string", description: "UUID" };
const idem = { idempotency_key: { type: "string", description: "Optional. Same key twice returns the first result instead of applying again." } };

export const TOOLS: ToolDef[] = [
  { name: "whoami", mutating: false,
    description: "Who am I: my agent, role, current task (if I hold a live lease) and undelivered message count. Call first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "task_next", mutating: true,
    description: "Atomically claim the next ready task for my role. Returns {none:true} when there is no work: then stop and exit, do not invent work.",
    inputSchema: { type: "object", properties: { lease_seconds: { type: "integer", minimum: 60, maximum: 14400, default: 1800 }, ...idem } } },
  { name: "task_heartbeat", mutating: true,
    description: "Extend my lease on a task. Call at least every 10 minutes while working. LEASE_LOST means stop immediately and exit.",
    inputSchema: { type: "object", required: ["task_id"], properties: { task_id: uuid, extend_seconds: { type: "integer", default: 1800 } } } },
  { name: "task_progress", mutating: true,
    description: "Record one line of progress on my task. One line, no essays.",
    inputSchema: { type: "object", required: ["task_id", "note"], properties: { task_id: uuid, note: { type: "string" }, pct: { type: "integer", minimum: 0, maximum: 100 } } } },
  { name: "task_ask", mutating: true,
    description: "Ask a question I cannot answer myself. Moves the task to blocked and releases my lease: after this, exit. Address a role, an agent, or nobody (a human supervisor).",
    inputSchema: { type: "object", required: ["task_id", "question"], properties: { task_id: uuid, question: { type: "string" }, to_role: { type: "string" }, to_agent: uuid, ...idem } } },
  { name: "task_submit", mutating: true,
    description: "Submit my task for the completion gate, optionally registering artefacts in the same call. The service decides whether the task is done, not me.",
    inputSchema: { type: "object", required: ["task_id"], properties: { task_id: uuid,
      artifacts: { type: "array", items: { type: "object", required: ["kind"], properties: {
        kind: { type: "string" }, uri: { type: "string" }, sha256: { type: "string" }, schema_version: { type: "string", default: "v1" },
        meta: { type: "object" }, content: { description: "JSON object or string. Uploaded to storage when given." } } } }, ...idem } } },
  { name: "task_release", mutating: true,
    description: "Voluntarily give the task back to the queue with a reason. After this, exit.",
    inputSchema: { type: "object", required: ["task_id", "reason"], properties: { task_id: uuid, reason: { type: "string" }, ...idem } } },
  { name: "task_split", mutating: true,
    description: "Create child tasks under my task (same role unless given). I keep my lease on the parent.",
    inputSchema: { type: "object", required: ["task_id", "children"], properties: { task_id: uuid,
      children: { type: "array", minItems: 1, items: { type: "object", required: ["title", "spec", "acceptance"], properties: {
        title: { type: "string" }, spec: { type: "string" }, acceptance: { type: "string" }, role: { type: "string" },
        consumes: { type: "array" }, produces: { type: "array" }, priority: { type: "integer" }, scope: { type: "array", items: { type: "string" } } } } }, ...idem } } },
  { name: "task_delegate", mutating: true,
    description: "Hand part of my task to another role and wait for the result. Creates a child task that must produce the artefact kinds I name (db_schema, api_contract, config, migration, handoff ...). My task goes to blocked and my lease is released: after this, exit. When the child passes its gate my task returns to ready with the child's artefacts in my consumes, and I am respawned to continue.",
    inputSchema: { type: "object", required: ["task_id", "role", "title", "spec", "acceptance", "produces"], properties: {
      task_id: uuid, role: { type: "string", description: "The role that owns this kind of work." }, title: { type: "string" },
      spec: { type: "string", description: "Exactly what they must do and what I need back." }, acceptance: { type: "string", description: "Given / When / Then" },
      produces: { type: "array", minItems: 1, items: { type: "string" }, description: "Artefact kinds they must register, which become my inputs." },
      priority: { type: "integer" }, scope: { type: "array", items: { type: "string" }, description: "Paths they may write; empty means no restriction." }, ...idem } } },
  { name: "task_create", mutating: true,
    description: "Create a task for any role (used by analysts and for fix tasks). It becomes ready as soon as its preconditions hold.",
    inputSchema: { type: "object", required: ["title", "spec", "acceptance", "role"], properties: {
      title: { type: "string" }, spec: { type: "string" }, acceptance: { type: "string", description: "Given / When / Then" }, role: { type: "string" },
      priority: { type: "integer", default: 100 }, depends_on: { type: "array", items: uuid },
      consumes: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, from_task: { type: ["string", "null"] } } } },
      produces: { type: "array", items: { type: "object", properties: { kind: { type: "string" } } } },
      scope: { type: "array", items: { type: "string" }, description: "Glob list of paths the assignee may write." },
      budget_usd: { type: "number" }, max_attempts: { type: "integer" }, ...idem } } },
  { name: "inbox", mutating: true,
    description: "Fetch undelivered messages for me or my role (questions, answers, notices, broadcasts). Marks them delivered.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "answer", mutating: true,
    description: "Answer a question message. Unblocks the asking task.",
    inputSchema: { type: "object", required: ["message_id", "body"], properties: { message_id: uuid, body: { type: "string" }, ...idem } } },
  { name: "broadcast", mutating: true,
    description: "Send a short notice to every agent. Rate limited to 10 per hour.",
    inputSchema: { type: "object", required: ["body"], properties: { body: { type: "string" }, task_id: uuid, ...idem } } },
  { name: "artifact_put", mutating: true,
    description: "Register an artefact on my task. Give content (JSON or text) to upload it to storage, or a uri (for example a PR URL). It must validate against its schema.",
    inputSchema: { type: "object", required: ["task_id", "kind"], properties: { task_id: uuid, kind: { type: "string" },
      content: { description: "JSON object or string" }, uri: { type: "string" }, sha256: { type: "string" },
      schema_version: { type: "string", default: "v1" }, meta: { type: "object" }, ...idem } } },
  { name: "artifact_get", mutating: false,
    description: "Read artefacts my role is entitled to, by kind (and task). Returns content inline and a short-lived signed URL for blobs. This is how I read my inputs.",
    inputSchema: { type: "object", required: ["kind"], properties: { kind: { type: "string" }, task_id: uuid, latest: { type: "boolean", default: true } } } },
  { name: "decision_log", mutating: true,
    description: "Record a durable decision so it is not re-litigated.",
    inputSchema: { type: "object", required: ["title", "body"], properties: { title: { type: "string" }, body: { type: "string" }, task_id: uuid, ...idem } } },
  { name: "board", mutating: false,
    description: "Counts of tasks by state for my role, and my own tasks.",
    inputSchema: { type: "object", properties: { role: { type: "string" } } } },
  { name: "document_put", mutating: true,
    description: "Upload a workspace file (PDF, email, text) that an artefact refers to, so people can open it from the app. Path is relative to the workspace, forward slashes. Needs a live lease on the task.",
    inputSchema: { type: "object", required: ["task_id", "path", "content_base64"], properties: { task_id: uuid, path: { type: "string" }, content_base64: { type: "string" }, content_type: { type: "string" } } } },
];

// postgres.js serialises objects for jsonb parameters itself; never pre-stringify.
const j = (v: unknown) => (v === undefined ? null : v);
const one = async (rows: Promise<{ r: Json }[]>) => (await rows)[0].r;

function toJsonContent(content: unknown): { text: string; json: Json | null; contentType: string } {
  if (content === undefined || content === null) return { text: "", json: null, contentType: "text/plain" };
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") return { text: JSON.stringify(parsed, null, 2), json: parsed, contentType: "application/json" };
    } catch { /* plain text */ }
    return { text: content, json: null, contentType: "text/plain" };
  }
  return { text: JSON.stringify(content, null, 2), json: content as Json, contentType: "application/json" };
}

async function putArtifact(agent: Agent, a: Json): Promise<Json> {
  const taskId = String(a.task_id);
  const [{ e }] = await sql`select baton.check_lease(${agent.id}::uuid, ${taskId}::uuid) as e`;
  if (e) return one(sql`select baton.lease_error(${e}) as r`);
  let uri = a.uri ? String(a.uri) : "";
  let sha = a.sha256 ? String(a.sha256) : null;
  const { text, json, contentType } = toJsonContent(a.content);
  if (text) {
    const [{ key }] = await sql`select key from baton.tasks where id = ${taskId}::uuid`;
    const ext = contentType === "application/json" ? "json" : "txt";
    uri = await uploadArtifact(`${key}/${a.kind}-${Date.now()}.${ext}`, text, contentType);
    sha = await sha256Hex(text);
  }
  const meta = { ...(a.meta as Json ?? {}), ...(text && json === null ? { content_type: contentType, bytes: text.length } : {}) };
  return one(sql`select baton.artifact_put(${agent.id}::uuid, ${taskId}::uuid, ${String(a.kind)}, ${uri}, ${sha},
                   ${String(a.schema_version ?? "v1")}, ${j(meta)}::jsonb, ${json ? j(json) : null}::jsonb) as r`);
}

export async function runTool(agent: Agent, name: string, args: Json, session: string | null = null): Promise<Json> {
  switch (name) {
    case "whoami":
      return await asAgent(agent.id, async (tx) => {
        const [me] = await tx`select id, name, role, machine, status, current_task, last_seen from baton.agents where id = ${agent.id}::uuid`;
        let task: Json | null = null;
        if (me.current_task) {
          const [row] = await tx`select baton.task_json(t) as j, (t.state = 'in_progress' and t.lease_until > now()) as live
                                   from baton.tasks t where t.id = ${me.current_task}::uuid and t.assignee = ${agent.id}::uuid`;
          if (row?.live) task = row.j;
        }
        const [{ n }] = await tx`select count(*)::int as n from baton.messages
                                  where delivered_at is null and kind <> 'broadcast'
                                    and (to_agent = ${agent.id}::uuid or (to_agent is null and to_role = ${me.role}))`;
        return { ok: true, agent: { id: me.id, name: me.name, role: me.role, machine: me.machine, status: me.status },
                 role: me.role, current_task: task, undelivered_messages: n,
                 hint: task ? "You hold a live lease. Resume this task." : "Call task_next to claim work." };
      });

    case "task_next": {
      const lease = Math.min(14400, Math.max(60, Number(args.lease_seconds ?? 1800)));
      const [row] = await sql`select baton.task_json(baton.claim_next(${agent.id}::uuid, ${lease}::int, ${session})) as j`;
      if (!row?.j?.id) return { ok: true, none: true, message: "No work for your role right now. Stop and exit." };
      const t = row.j as Json;
      const delegations = await sql`select key, title, produces, cost_usd from baton.tasks where parent_task = ${String(t.id)}::uuid and state = 'done' order by updated_at`;
      return { ok: true, task: t,
               delegations: delegations.length ? delegations.map((d) => ({ key: d.key, title: d.title, produces: (d.produces as Json[]).map((p) => p.kind), cost_usd: d.cost_usd,
                 read_with: `artifact_get task_id=<id of ${d.key}> (already pinned in your consumes)` })) : undefined,
               inputs: (t.consumes as Json[]).map((c) => `artifact_get kind=${c.kind}${c.from_task ? ` task_id=${c.from_task}` : ""}`),
               outputs: (t.produces as Json[]).map((p) => p.kind),
               heartbeat_every_seconds: Math.min(600, Math.floor(lease / 3)) };
    }
    case "task_heartbeat":
      return one(sql`select baton.task_heartbeat(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${Number(args.extend_seconds ?? 1800)}::int) as r`);
    case "task_progress":
      return one(sql`select baton.task_progress(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${String(args.note ?? "")}, ${args.pct == null ? null : Number(args.pct)}::int) as r`);
    case "task_ask":
      return one(sql`select baton.task_ask(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${String(args.question ?? "")},
                       ${args.to_role ? String(args.to_role) : null}, ${args.to_agent ? String(args.to_agent) : null}::uuid) as r`);
    case "task_release":
      return one(sql`select baton.task_release(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${String(args.reason ?? "")}) as r`);
    case "task_split":
      return one(sql`select baton.task_split(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${j(args.children ?? [])}::jsonb) as r`);
    case "task_delegate":
      return one(sql`select baton.task_delegate(${agent.id}::uuid, ${String(args.task_id)}::uuid, ${String(args.role ?? "")}, ${String(args.title ?? "")},
                       ${String(args.spec ?? "")}, ${String(args.acceptance ?? "")}, ${j(Array.isArray(args.produces) ? args.produces : [])}::jsonb,
                       ${args.priority == null ? null : Number(args.priority)}::int, ${Array.isArray(args.scope) && args.scope.length ? args.scope.map(String) : null}::text[]) as r`);
    case "task_create": {
      const { idempotency_key: _k, ...fields } = args;
      return one(sql`select baton.task_create(${`agent:${agent.id}`}, ${j(fields)}::jsonb) as r`);
    }
    case "inbox":
      return one(sql`select baton.inbox(${agent.id}::uuid) as r`);
    case "answer":
      return one(sql`select baton.answer(${`agent:${agent.name}`}, ${agent.id}::uuid, ${String(args.message_id)}::uuid, ${String(args.body ?? "")}) as r`);
    case "broadcast":
      return one(sql`select baton.broadcast(${agent.id}::uuid, ${String(args.body ?? "")}, ${args.task_id ? String(args.task_id) : null}::uuid) as r`);
    case "decision_log":
      return one(sql`select baton.decision_log(${agent.id}::uuid, ${String(args.title ?? "")}, ${String(args.body ?? "")}, ${args.task_id ? String(args.task_id) : null}::uuid) as r`);
    case "board":
      return one(sql`select baton.board(${agent.id}::uuid, ${args.role ? String(args.role) : null}) as r`);

    case "task_submit": {
      const artifacts = Array.isArray(args.artifacts) ? args.artifacts as Json[] : [];
      for (const a of artifacts) {
        const r = await putArtifact(agent, { ...a, task_id: args.task_id });
        if (r.ok === false) return r;
      }
      const r = await one(sql`select baton.task_submit(${agent.id}::uuid, ${String(args.task_id)}::uuid, '[]'::jsonb) as r`);
      // State transition: send any GitHub calls it queued (open PR, completion comment). Not the hook face.
      try { await drainOutbox(); } catch (e) { console.error("outbox drain failed", e); }
      return r;
    }
    case "artifact_put":
      return putArtifact(agent, args);

    case "document_put": {
      const taskId = String(args.task_id);
      const [{ e }] = await sql`select baton.check_lease(${agent.id}::uuid, ${taskId}::uuid) as e`;
      if (e) return one(sql`select baton.lease_error(${e}) as r`);
      const path = String(args.path ?? "").replace(/\\/g, "/").trim();
      if (!path || path.includes("..") || path.startsWith("/") || /^[a-z]:/i.test(path)) return { ok: false, error: { code: "PRECONDITION_FAILED", message: "path must be relative, forward slashes, no ..", retryable: false } };
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(String(args.content_base64 ?? "")), (c) => c.charCodeAt(0)); } catch { return { ok: false, error: { code: "PRECONDITION_FAILED", message: "content_base64 is not base64", retryable: false } }; }
      if (bytes.length > 25 * 1024 * 1024) return { ok: false, error: { code: "PRECONDITION_FAILED", message: "document exceeds 25 MB", retryable: false } };
      const [{ ws }] = await sql`select baton.task_workspace(${taskId}::uuid) as ws`;
      const contentType = args.content_type ? String(args.content_type) : "application/octet-stream";
      await uploadBytes(`docs/${ws}/${path}`, bytes, contentType);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
      return one(sql`select baton.document_upsert(${ws}, ${path}, ${contentType}, ${bytes.length}::bigint, ${sha}, ${`agent:${agent.name}`}) as r`);
    }

    case "artifact_get": {
      const kind = String(args.kind);
      const taskId = args.task_id ? String(args.task_id) : null;
      const latest = args.latest !== false;
      const rows = await asAgent(agent.id, (tx) => tx`
        select baton.artifact_json(a) as j from baton.artifacts a
         where a.kind::text = ${kind}
           and (${taskId}::uuid is null or a.task_id = ${taskId}::uuid)
         order by a.created_at desc limit ${latest ? 1 : 50}`);
      const artifacts = [] as Json[];
      for (const { j: art } of rows) {
        artifacts.push({ ...art, signed_url: await signArtifact(String(art.uri)) });
      }
      return { ok: true, artifacts, message: artifacts.length ? undefined : `No ${kind} artefact is visible to your role${taskId ? " for that task" : ""}.` };
    }
    default:
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${name}`, retryable: false } };
  }
}

export async function callTool(agent: Agent, name: string, args: Json, session: string | null = null): Promise<Json> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${name}`, retryable: false } };
  const key = typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key : null;
  if (def.mutating && key) {
    const [hit] = await sql`select response from baton.idempotency where agent_id = ${agent.id}::uuid and key = ${key}`;
    if (hit) return { ...hit.response, idempotent_replay: true };
  }
  const result = await runTool(agent, name, args, session);
  if (def.mutating && name !== "task_heartbeat" && name !== "task_progress") { try { await drainWebhooks(); } catch (e) { console.error("webhooks", e); } }
  if (def.mutating && key) {
    await sql`insert into baton.idempotency (agent_id, key, tool, response) values (${agent.id}::uuid, ${key}, ${name}, ${j(result)}::jsonb)
              on conflict do nothing`;
  }
  return result;
}

const SERVER_INSTRUCTIONS = `Baton coordination protocol. 1) whoami. If you hold a task, resume it; otherwise task_next. If none, stop and exit. 2) artifact_get for every kind in the task's consumes. 3) task_heartbeat at least every 10 minutes; LEASE_LOST means stop and exit. 4) task_progress after each meaningful step. 5) Missing information: task_ask, then exit. Missing work that belongs to another role: task_delegate naming the artefact kinds you need back, then exit; you are respawned when it is done. 6) Produce exactly the artefacts in produces, register with artifact_put. 7) task_submit; the service decides. 8) decision_log for durable decisions. 9) Stay in your role; task_delegate when you must wait for another role, task_create when you need not.`;

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Json };

export async function handleRpc(agent: Agent, m: Rpc, session: string | null = null): Promise<Json | null> {
  const id = m.id ?? null;
  const ok = (result: Json) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (m.method) {
    case "initialize":
      return ok({ protocolVersion: (m.params?.protocolVersion as string) ?? "2025-03-26",
                  capabilities: { tools: { listChanged: false } },
                  serverInfo: { name: "baton", version: "0.2.0" },
                  instructions: SERVER_INSTRUCTIONS });
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments as Json) ?? {};
      try {
        const result = await callTool(agent, name, args, session);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: result.ok === false });
      } catch (e) {
        console.error(`tool ${name} failed`, e);
        const result = { ok: false, error: { code: "INTERNAL", message: String((e as Error)?.message ?? e), retryable: true } };
        return ok({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: true });
      }
    }
    default:
      if (m.method?.startsWith("notifications/")) return null;
      return err(-32601, `Method not found: ${m.method}`);
  }
}
