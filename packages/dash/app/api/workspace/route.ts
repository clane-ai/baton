// Serves documents from the workflow workspace (the folder the agents read and the integrations write),
// so the inbox can show the requisition, the invoice or the count sheet next to the artefact.
// BATON_WORKSPACE names the folder; paths are relative to it and may not leave it.
import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".eml": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

export async function GET(req: Request) {
  const root = process.env.BATON_WORKSPACE;
  const u = new URL(req.url);
  const rel = u.searchParams.get("path") ?? "";
  if (!root) return NextResponse.json({ ok: false, error: { code: "CONFIG", message: "BATON_WORKSPACE is not set; documents cannot be shown" } }, { status: 500 });
  if (!rel || rel.includes("\0")) return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "path is required" } }, { status: 400 });
  const base = resolve(root);
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "path leaves the workspace" } }, { status: 403 });
  const type = TYPES[extname(full).toLowerCase()];
  if (!type) return NextResponse.json({ ok: false, error: { code: "UNSUPPORTED", message: "only pdf, text, email, csv, json and images are served" } }, { status: 415 });
  try {
    const s = await stat(full);
    if (!s.isFile()) throw new Error("not a file");
    const body = await readFile(full);
    if (u.searchParams.get("meta") === "1") return NextResponse.json({ ok: true, path: rel, bytes: s.size, type });
    return new NextResponse(body, { status: 200, headers: { "content-type": type, "content-length": String(s.size), "cache-control": "no-store", "content-disposition": "inline" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: `no such document: ${rel}` } }, { status: 404 });
  }
}
