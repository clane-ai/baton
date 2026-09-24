import { NextResponse } from "next/server";
import { proxy, readBody } from "@/lib/baton";

export const dynamic = "force-dynamic";

// Answer a question by message id, or the newest open question on a task by task key.
export async function POST(req: Request) {
  const b = await readBody(req);
  const message_id = b.message_id ? String(b.message_id) : null;
  const task_key = b.task_key ? String(b.task_key) : null;
  const body = String(b.body ?? "").trim();
  if ((!message_id && !task_key) || !body) {
    return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "message_id or task_key, and body, are required" } }, { status: 400 });
  }
  return proxy("/admin/answer", { method: "POST", body: message_id ? { message_id, body } : { task_key, body } });
}
