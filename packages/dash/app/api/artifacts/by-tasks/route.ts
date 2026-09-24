import { NextResponse } from "next/server";
import { proxy } from "@/lib/baton";

export const dynamic = "force-dynamic";

// Artefacts of several tasks in one call: ?keys=TSK-1,TSK-2 (at most 40). Each artefact carries its task_key.
export async function GET(req: Request) {
  const keys = (new URL(req.url).searchParams.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 40);
  const lists = await Promise.all(
    keys.map(async (key) => {
      const r = await proxy(`/admin/tasks/${encodeURIComponent(key)}`);
      const j = (await r.json().catch(() => ({}))) as { artifacts?: { created_at?: string }[] };
      return (j.artifacts ?? []).map((a) => ({ ...a, task_key: key }));
    }),
  );
  const artifacts = lists.flat().sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return NextResponse.json({ ok: true, artifacts });
}
