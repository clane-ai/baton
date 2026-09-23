import { proxy, queryOf } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxy("/admin/workflow-runs", { query: queryOf(req, ["limit"]) });
}
