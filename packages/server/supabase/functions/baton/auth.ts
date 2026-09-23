// Identity comes from the bearer token and nothing else (prd.md 13.5, 14).
import { sql } from "./db.ts";

export type Agent = {
  id: string; name: string; role: string; machine: string; status: string; current_task: string | null;
};
export type Operator = { id: string; name: string };
export type Ctx =
  | { kind: "agent"; agent: Agent; actor: string }
  | { kind: "operator"; operator: Operator; actor: string };

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return "btn_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logRejected(hash: string | null, path: string, reason: string, agentId?: string) {
  const payload = { path, reason, token_prefix: hash?.slice(0, 8) ?? null };
  try {
    await sql`insert into baton.events (agent_id, type, payload)
              values (${agentId ?? null}, 'auth_rejected',
                      ${payload}::jsonb)`;
  } catch (e) {
    console.error("could not log auth rejection", e);
  }
}

/** Resolve the caller. Null means rejected, and the rejection has been logged as an event. */
export async function authenticate(req: Request, path: string): Promise<Ctx | null> {
  const token = bearer(req);
  if (!token) {
    await logRejected(null, path, "missing token");
    return null;
  }
  const hash = await sha256Hex(token);
  const [a] = await sql`select id, name, role, machine, status, current_task, revoked_at
                          from baton.agents where token_hash = ${hash}`;
  if (a) {
    if (a.revoked_at) {
      await logRejected(hash, path, "revoked agent token", a.id);
      return null;
    }
    return { kind: "agent", agent: a as Agent, actor: `agent:${a.id}` };
  }
  const [o] = await sql`select id, name, revoked_at from baton.operators where token_hash = ${hash}`;
  if (o) {
    if (o.revoked_at) {
      await logRejected(hash, path, "revoked operator token");
      return null;
    }
    return { kind: "operator", operator: o as Operator, actor: `operator:${o.name}` };
  }
  await logRejected(hash, path, "unknown token");
  return null;
}
