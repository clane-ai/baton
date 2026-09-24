// Workspace documents: email parsing, type by extension, the conventions the P2P workflow uses,
// and merging the engine's list with those conventions. Pure functions.
import type { DocumentRef } from "./types";

export type ParsedEmail = { headers: Record<string, string>; text: string; attachments: string[] };

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

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
      last = m[1];
      headers[last] = m[2].trim();
    }
  }
  return { headers, rest };
}

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Headers, the text/plain part (decoded), and attachment file names. Never the base64 blobs. */
export function parseEml(raw: string): ParsedEmail {
  if (!raw || !raw.trim()) return { headers: {}, text: "", attachments: [] };
  const { headers, rest } = splitHeaders(raw);
  const ctype = headers["Content-Type"] ?? headers["Content-type"] ?? "";
  const bm = ctype.match(/boundary="?([^";]+)"?/i);
  if (!bm) {
    const enc = (headers["Content-Transfer-Encoding"] ?? "").toLowerCase();
    return { headers, text: (enc === "quoted-printable" ? decodeQuotedPrintable(rest) : rest).trim(), attachments: [] };
  }
  const boundary = bm[1];
  const parts = rest.split(new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*$`, "m")).slice(1);
  let text = "";
  const attachments: string[] = [];
  for (const part of parts) {
    const p = splitHeaders(part.replace(/^\n/, ""));
    const pt = (p.headers["Content-Type"] ?? "").toLowerCase();
    const disp = p.headers["Content-Disposition"] ?? "";
    const fn = disp.match(/filename="?([^";]+)"?/i);
    if (fn) attachments.push(fn[1]);
    else if (pt.startsWith("text/plain") && !text) {
      const enc = (p.headers["Content-Transfer-Encoding"] ?? "").toLowerCase();
      text = (enc === "quoted-printable" ? decodeQuotedPrintable(p.rest) : p.rest).trim();
    }
  }
  return { headers, text, attachments };
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
