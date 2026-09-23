import { proxy, queryOf } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = queryOf(req, ["agent", "task", "type", "limit", "since"]);
  if (!q.limit) q.limit = "200";
  return proxy("/admin/events", { query: q });
}
