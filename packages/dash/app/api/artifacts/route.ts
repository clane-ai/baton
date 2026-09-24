import { proxy, queryOf } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxy("/admin/artifacts", { query: queryOf(req, ["kind", "task"]) });
}
