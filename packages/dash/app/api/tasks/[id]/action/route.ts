import { NextResponse } from "next/server";
import { proxy, readBody } from "@/lib/baton";

export const dynamic = "force-dynamic";

// The three task-level supervisor actions.
// Body: { action: "prioritise", priority } | { action: "cancel", reason } | { action: "force-release" }.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await readBody(req);
  const action = String(b.action ?? "");
  const base = `/admin/tasks/${encodeURIComponent(id)}`;

  if (action === "prioritise") {
    const priority = Number(b.priority);
    if (!Number.isFinite(priority)) {
      return NextResponse.json(
        { ok: false, error: { code: "BAD_REQUEST", message: "priority must be a number" } },
        { status: 400 },
      );
    }
    return proxy(`${base}/prioritise`, { method: "POST", body: { priority } });
  }
  if (action === "cancel") {
    return proxy(`${base}/cancel`, { method: "POST", body: { reason: b.reason ? String(b.reason) : null } });
  }
  if (action === "force-release") {
    return proxy(`${base}/force-release`, { method: "POST", body: {} });
  }
  return NextResponse.json(
    { ok: false, error: { code: "BAD_REQUEST", message: `Unknown action "${action}"` } },
    { status: 400 },
  );
}
