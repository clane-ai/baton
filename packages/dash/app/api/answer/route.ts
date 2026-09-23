import { NextResponse } from "next/server";
import { proxy, readBody } from "@/lib/baton";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await readBody(req);
  const message_id = String(b.message_id ?? "");
  const body = String(b.body ?? "").trim();
  if (!message_id || !body) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "message_id and body are required" } },
      { status: 400 },
    );
  }
  return proxy("/admin/answer", { method: "POST", body: { message_id, body } });
}
