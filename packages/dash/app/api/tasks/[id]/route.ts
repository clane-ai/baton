import { proxy } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy(`/admin/tasks/${encodeURIComponent(id)}`);
}
