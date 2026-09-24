import { NextResponse } from "next/server";
import { proxy, readBody } from "@/lib/baton";

export const dynamic = "force-dynamic";

// Task-level operator actions.
// Body: { action: "prioritise", priority } | { action: "cancel", reason } | { action: "force-release" }
//     | { action: "approve" | "reject", reason } | { action: "retry", reason, budget_usd?, keep_attempts?, deadline? }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await readBody(req);
  const action = String(b.action ?? "");
  const base = `/admin/tasks/${encodeURIComponent(id)}`;
  const reason = b.reason ? String(b.reason) : null;

  if (action === "prioritise") {
    const priority = Number(b.priority);
    if (!Number.isFinite(priority)) {
      return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "priority must be a number" } }, { status: 400 });
    }
    return proxy(`${base}/prioritise`, { method: "POST", body: { priority } });
  }
  if (action === "cancel") return proxy(`${base}/cancel`, { method: "POST", body: { reason } });
  if (action === "force-release") return proxy(`${base}/force-release`, { method: "POST", body: {} });
  if (action === "approve" || action === "reject") {
    if (action === "reject" && !reason) {
      return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "a rejection needs a reason" } }, { status: 400 });
    }
    return proxy(`${base}/approve`, { method: "POST", body: { verdict: action, reason } });
  }
  if (action === "retry") {
    return proxy(`${base}/retry`, {
      method: "POST",
      body: {
        reason,
        reset_attempts: b.keep_attempts ? false : true,
        budget_usd: b.budget_usd != null && b.budget_usd !== "" ? Number(b.budget_usd) : undefined,
        deadline: b.deadline ? String(b.deadline) : undefined,
      },
    });
  }
  return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: `Unknown action "${action}"` } }, { status: 400 });
}
