// Workspace documents: email parsing, type by extension, the conventions the P2P workflow uses,
// and merging the engine's list with those conventions. Pure functions.
import type { DocumentRef } from "./types";

export type ParsedEmail = { headers: Record<string, string>; text: string; attachments: string[] };

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Header names as mail readers show them: "content-type" -> "Content-Type", "subject" -> "Subject". */
function canonical(name: string): string {
  return name.toLowerCase().replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase());
}

function splitHeaders(block: string): { headers: Record<string, string>; rest: string } {
  const norm = block.replace(/\r\n/g, "\n");
  const i = norm.indexOf("\n\n");
  const head = i < 0 ? norm : norm.slice(0, i);
  const rest = i < 0 ? "" : norm.slice(i + 2);
  const headers: Record<string, string> = {};
  let last: string | null = null;
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] = (headers[last] + " " + line.trim()).trim();
      continue;
    }
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) {
      last = canonical(m[1]);
      headers[last] = m[2].trim();
    }
  }
  return { headers, rest };
}

function charsetOf(contentType: string): string {
  const m = contentType.match(/charset="?([^";\s]+)"?/i);
  return (m?.[1] ?? "utf-8").toLowerCase();
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

function decodeQuotedPrintable(s: string, charset: string): string {
  const joined = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Plain characters in a QP body are ASCII; encode any stray non-ASCII as UTF-8.
      const enc = new TextEncoder().encode(c);
      for (const b of enc) bytes.push(b);
    }
  }
  return decodeBytes(new Uint8Array(bytes), charset);
}

function decodeBase64(s: string, charset: string): string {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return decodeBytes(bytes, charset);
  } catch { return ""; }
}

function decodeBody(body: string, headers: Record<string, string>): string {
  const enc = (headers["Content-Transfer-Encoding"] ?? "").toLowerCase();
  const cs = charsetOf(headers["Content-Type"] ?? "");
  if (enc === "quoted-printable") return decodeQuotedPrintable(body, cs);
  if (enc === "base64") return decodeBase64(body, cs);
  return body;
}

function boundaryOf(contentType: string): string | null {
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1] : null;
}

function splitParts(body: string, boundary: string): string[] {
  const re = new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*$`, "m");
  return body.split(re).slice(1).map((p) => p.replace(/^\n/, ""));
}

/** Walks a MIME tree: the first text/plain part becomes the text; attachment file names are collected. */
function walk(headers: Record<string, string>, body: string, out: { text: string; attachments: string[] }): void {
  const ctype = (headers["Content-Type"] ?? "").toLowerCase();
  const disp = headers["Content-Disposition"] ?? "";
  const fn = disp.match(/filename="?([^";]+)"?/i);
  if (fn) { out.attachments.push(fn[1]); return; }
  const boundary = boundaryOf(headers["Content-Type"] ?? "");
  if (ctype.startsWith("multipart/") && boundary) {
    for (const part of splitParts(body, boundary)) {
      const p = splitHeaders(part);
      walk(p.headers, p.rest, out);
    }
    return;
  }
  if ((ctype.startsWith("text/plain") || !ctype) && !out.text) out.text = decodeBody(body, headers).trim();
}

/** Headers, the text/plain part (decoded), and attachment file names. Never the base64 blobs. */
export function parseEml(raw: string): ParsedEmail {
  if (!raw || !raw.trim()) return { headers: {}, text: "", attachments: [] };
  const { headers, rest } = splitHeaders(raw);
  const out = { text: "", attachments: [] as string[] };
  walk(headers, rest, out);
  return { headers, text: out.text, attachments: out.attachments };
}

export function docType(path: string): DocumentRef["type"] {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "eml") return "email";
  if (ext === "txt" || ext === "md") return "text";
  return "data";
}

/** Documents an artefact points at: its documents[] and *_path fields, plus the P2P workspace conventions. */
export function documentsFor(kind: string, content: unknown): DocumentRef[] {
  const a = o(content);
  const out: DocumentRef[] = [];
  const add = (label: string, path: unknown, from: DocumentRef["from"]) => {
    const p = str(path);
    if (!p || out.some((x) => x.path === p)) return;
    out.push({ label, path: p, type: docType(p), from, kind });
  };
  if (Array.isArray(a.documents)) for (const d of a.documents) add(str(o(d).label) || str(o(d).path), o(d).path, "artefact");
  // *_path fields: email before pdf.
  const pathKeys = Object.keys(a).filter((k) => /(_path|^path)$/.test(k)).sort((x, y) => (x.includes("email") ? -1 : 0) - (y.includes("email") ? -1 : 0));
  for (const k of pathKeys) add(`${kind.replace(/_/g, " ")} ${k.replace(/_path$/, "").replace(/_/g, " ")}`, a[k], "artefact");
  if (kind === "purchase_order" && a.requisition) {
    add("requester email", `inbox/requisitions/${str(a.requisition)}.eml`, "convention");
    add("requisition", `inbox/requisitions/${str(a.requisition)}.pdf`, "convention");
    add("requisition text", `inbox/requisitions/${str(a.requisition)}.txt`, "convention");
  }
  if (kind === "goods_receipt" && a.po_number) add("count sheet", `inbox/deliveries/count-${str(a.po_number)}.txt`, "convention");
  if (kind === "invoice" && a.invoice_number) add("invoice text", `inbox/invoices/${str(a.invoice_number)}.txt`, "convention");
  if (kind === "delivery_note" && a.delivery_note_number) add("delivery note text", `inbox/deliveries/${str(a.delivery_note_number)}.txt`, "convention");
  if (kind === "payment" && a.remittance_path) add("remittance", a.remittance_path, "artefact");
  return out;
}

const ORDER: Record<DocumentRef["type"], number> = { email: 0, pdf: 1, text: 2, data: 3 };

/** The engine's list first, conventions filling gaps; no duplicate paths; emails before PDFs before text. */
export function mergeDocuments(fromApi: DocumentRef[], fallback: DocumentRef[]): DocumentRef[] {
  const seen = new Set<string>();
  const out: DocumentRef[] = [];
  for (const d of [...fromApi, ...fallback]) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    out.push(d);
  }
  return out.sort((x, y) => ORDER[x.type] - ORDER[y.type]);
}
