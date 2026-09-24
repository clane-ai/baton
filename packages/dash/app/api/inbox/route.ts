import { NextResponse } from "next/server";
import { proxy } from "@/lib/baton";
import { itemFromTask } from "@/lib/inboxFallback";
import type { Artifact, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/inbox: the engine's /admin/inbox when it exists; until then the same shape built from
// /admin/tasks (needs_human and failed) plus each task's detail, at most 30 detail calls.
export async function GET() {
  const up = await proxy("/admin/inbox");
  if (up.status < 400) return up;
  // Not deployed (404) or broken (5xx): build the rows here and say so, with the upstream error kept.
  const upstream = (await up.json().catch(() => null)) as { error?: { message?: string } } | null;

  const now = Date.now();
  const tasksOf = async (state: string): Promise<Task[]> => {
    const r = await proxy("/admin/tasks", { query: { state, limit: "30" } });
    const j = (await r.json()) as { tasks?: Task[] };
    return j.tasks ?? [];
  };
  const tasks = [...(await tasksOf("needs_human")), ...(await tasksOf("failed"))].slice(0, 30);
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
