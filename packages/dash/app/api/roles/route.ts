import { proxy } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/admin/roles");
}
