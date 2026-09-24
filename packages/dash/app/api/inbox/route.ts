import { NextResponse } from "next/server";
import { proxy } from "@/lib/baton";
import { itemFromTask, shouldFallback } from "@/lib/inboxFallback";
import type { Artifact, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/inbox: the engine's /admin/inbox when it exists; until then the same shape built from
// /admin/tasks (needs_human and failed) plus each task's detail, at most 30 detail calls.
export async function GET() {
  const up = await proxy("/admin/inbox");
  if (!shouldFallback(up.status)) return up;
  // Not deployed (404) or broken (5xx): build the rows here and say so, with the upstream error kept.
  // An auth or config failure on the task list is returned as that error, never as an empty queue.
  const upstream = (await up.json().catch(() => null)) as { error?: { message?: string } } | null;

  const now = Date.now();
  const tasksOf = async (state: string): Promise<Task[] | NextResponse> => {
    const r = await proxy("/admin/tasks", { query: { state, limit: "30" } });
    if (!r.ok) return r;
    const j = (await r.json()) as { ok?: boolean; tasks?: Task[] };
    return j.tasks ?? [];
  };
  const a = await tasksOf("needs_human");
  if (a instanceof NextResponse) return a;
  const b = await tasksOf("failed");
  if (b instanceof NextResponse) return b;
  const tasks = [...a, ...b].slice(0, 30);
  const items = await Promise.all(
    tasks.map(async (t) => {
      const d = (await (await proxy(`/admin/tasks/${encodeURIComponent(t.id)}`)).json()) as { task?: Task; consumed?: Artifact[]; artifacts?: Artifact[] };
      const own = d.artifacts ?? [];
      const consumed = d.consumed ?? [];
      return itemFromTask(d.task ?? t, t.role === "operator" ? consumed : own.length ? own : consumed, now);
    }),
  );
  const tiles = {
    approvals: items.filter((i) => i.kind === "approval").length,
    parked: items.filter((i) => i.kind === "parked").length,
    questions: 0,
    overdue: items.filter((i) => i.overdue).length,
  };
  return NextResponse.json({ ok: true, tiles, items, fallback: true, upstream_status: up.status, upstream_error: upstream?.error?.message ?? null });
}
