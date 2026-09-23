import { proxy, queryOf } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxy("/admin/tasks", { query: queryOf(req, ["state", "role", "limit", "workflow_run"]) });
}
