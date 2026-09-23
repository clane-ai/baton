// Hook face (prd.md section 11) and the hook-driven gates (13.4).
// Every payload is redacted before it touches the database.
import { sql } from "./db.ts";
import type { Agent } from "./auth.ts";

type Json = Record<string, unknown>;
const one = async (rows: Promise<{ r: Json }[]>) => (await rows)[0].r;

// ---- redaction ------------------------------------------------------------
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g,                                   // OpenAI / Anthropic style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,                       // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,                                 // Slack
  /\bAKIA[0-9A-Z]{16}\b/g,                                             // AWS access key id
  /\bbtn_[0-9a-f]{40}\b/g,                                             // Baton tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"'`]+/gi, // connection strings
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /^\s*[A-Z][A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*\S+/gim, // .env lines
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}["']?/gi,
];

export function redactString(s: string): string {
  let out = s;
  for (const p of PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

export function redact<T>(v: T): T {
  if (typeof v === "string") return redactString(v) as T;
  if (Array.isArray(v)) return v.map(redact) as T;
  if (v && typeof v === "object") {
    const o: Json = {};
    for (const [k, val] of Object.entries(v as Json)) o[k] = redact(val);
    return o as T;
  }
  return v;
}

// ---- hook handling ----------------------------------------------------------
const EVENT_TYPES: Record<string, string> = {
  "session-start": "session_start",
  "prompt": "prompt",
  "tool": "tool",
  "tool-failure": "tool_failure",
  "turn-end": "turn_end",
  "session-end": "session_end",
  "post-tool-batch": "tool_batch",
};

function trimPayload(p: Json): Json {
  // Keep what correlates and describes; drop bulky fields.
  const keep = ["session_id", "prompt_id", "transcript_path", "cwd", "permission_mode", "hook_event_name", "tool_name",
    "tool_use_id", "tool_input", "tool_response", "error", "prompt", "stop_hook_active", "reason", "source", "agent_id", "agent_type", "model"];
  const out: Json = {};
  for (const k of keep) if (p[k] !== undefined) out[k] = p[k];
  if (typeof out.tool_response === "string" && out.tool_response.length > 4000) out.tool_response = (out.tool_response as string).slice(0, 4000) + "…";
  if (typeof out.prompt === "string" && out.prompt.length > 4000) out.prompt = (out.prompt as string).slice(0, 4000) + "…";
  if (out.tool_input && typeof out.tool_input === "object") {
    const ti = { ...(out.tool_input as Json) };
    for (const k of ["content", "new_string", "old_string", "command"]) {
      if (typeof ti[k] === "string" && (ti[k] as string).length > 2000) ti[k] = (ti[k] as string).slice(0, 2000) + "…";
    }
    out.tool_input = ti;
  }
  return out;
}

function contextText(ctx: Json): string {
  const lines: string[] = [`[Baton] ${ctx.task_line}`];
  const msgs = (ctx.messages as Json[]) ?? [];
  if (msgs.length) {
    lines.push(`[Baton] ${msgs.length} new message${msgs.length > 1 ? "s" : ""}:`);
    for (const m of msgs) {
      lines.push(`  - ${m.kind} from ${m.from_name}${m.task_key ? ` on ${m.task_key}` : ""} (id ${m.id}): ${m.body}`);
    }
  }
  return lines.join("\n");
}

export async function handleHook(agent: Agent, event: string, raw: Json): Promise<{ status: number; body: Json }> {
  const type = EVENT_TYPES[event];
  if (!type) return { status: 404, body: { ok: false, error: { code: "NOT_FOUND", message: `Unknown hook event ${event}`, retryable: false } } };
  const payload = redact(trimPayload(raw));
  const session = String(raw.session_id ?? "unknown");

  switch (type) {
    case "session_start": {
      await one(sql`select baton.session_start(${agent.id}::uuid, ${session}, ${payload}::jsonb) as r`);
      const ctx = await one(sql`select baton.context_for(${agent.id}::uuid) as r`);
      const text = contextText(ctx);
      return { status: 200, body: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } } };
    }
    case "prompt": {
      await one(sql`select baton.hook_event(${agent.id}::uuid, ${session}, 'prompt', ${payload}::jsonb) as r`);
      const ctx = await one(sql`select baton.context_for(${agent.id}::uuid) as r`);
      const msgs = (ctx.messages as Json[]) ?? [];
      if (!msgs.length) return { status: 200, body: {} };
      return { status: 200, body: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: contextText(ctx) } } };
    }
    case "turn_end": {
      await one(sql`select baton.hook_event(${agent.id}::uuid, ${session}, 'turn_end', ${payload}::jsonb) as r`);
      if (raw.stop_hook_active === true) return { status: 200, body: {} };
      const gate = await one(sql`select baton.gate_stop(${agent.id}::uuid, ${session}) as r`);
      if (gate.block) return { status: 200, body: { decision: "block", reason: String(gate.reason) } };
      return { status: 200, body: {} };
    }
    case "session_end": {
      const r = await one(sql`select baton.session_end(${agent.id}::uuid, ${session}, ${raw.reason ? String(raw.reason) : "session_end"}, ${payload}::jsonb) as r`);
      return { status: 200, body: r };
    }
    default: {
      const r = await one(sql`select baton.hook_event(${agent.id}::uuid, ${session}, ${type}, ${payload}::jsonb) as r`);
      return { status: 200, body: r };
    }
  }
}

// PreToolUse gate. Returns the hook JSON Claude Code expects.
export async function handleGate(agent: Agent, name: string, raw: Json): Promise<{ status: number; body: Json }> {
  if (name !== "pretool" && name !== "lease") {
    return { status: 404, body: { ok: false, error: { code: "NOT_FOUND", message: `Unknown gate ${name}`, retryable: false } } };
  }
  const session = String(raw.session_id ?? "unknown");
  const tool = String(raw.tool_name ?? "");
  const input = (raw.tool_input as Json) ?? {};
  const path = typeof input.file_path === "string" ? input.file_path
    : typeof input.notebook_path === "string" ? input.notebook_path : null;
  const cwd = typeof raw.cwd === "string" ? raw.cwd : null;
  const r = await one(sql`select baton.gate_pretool(${agent.id}::uuid, ${session}, ${tool}, ${path}, ${cwd}) as r`);
  if (r.allow) return { status: 200, body: {} };
  return { status: 200, body: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: String(r.reason) } } };
}
