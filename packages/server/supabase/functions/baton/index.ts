// Baton service: one edge function, several faces (prd.md section 6).
//   /mcp             MCP face (agents)
//   /hooks/:event    hook face (Claude Code hooks)
//   /gate/:name      enforcement gates
//   /gh              GitHub webhooks
//   /work-available  supervisor daemon
//   /admin/*         operator and dashboard API
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sql } from "./db.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Strip the function prefix: /functions/v1/baton/<route> or /baton/<route>
  const path = url.pathname.replace(/^\/(functions\/v1\/)?baton/, "") || "/";

  try {
    if (path === "/health") {
      const [row] = await sql`select current_user as u, now() as ts, count(*)::int as tasks from baton.tasks`;
      return json({ ok: true, user: row.u, ts: row.ts, tasks: row.tasks });
    }
    return json({ ok: false, error: { code: "NOT_FOUND", message: `No route ${path}`, retryable: false } }, 404);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: { code: "INTERNAL", message: String(e?.message ?? e), retryable: true } }, 500);
  }
});
