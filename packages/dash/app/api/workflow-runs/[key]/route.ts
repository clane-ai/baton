import { proxy } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  return proxy(`/admin/workflow-runs/${encodeURIComponent(key)}`);
}
