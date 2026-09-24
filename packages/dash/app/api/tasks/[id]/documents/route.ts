import { NextResponse } from "next/server";
import { proxy } from "@/lib/baton";

export const dynamic = "force-dynamic";

// Documents the engine resolves for a task; an empty list when the endpoint is not deployed yet,
// so the screen falls back to the workspace conventions in lib/documents.ts.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxy(`/admin/tasks/${encodeURIComponent(id)}/documents`);
  if (up.status === 404) return NextResponse.json({ ok: true, documents: [], fallback: true });
  return up;
}
