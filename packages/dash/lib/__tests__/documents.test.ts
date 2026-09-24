import { describe, it, expect } from "vitest";
import { parseEml, docType, documentsFor, mergeDocuments } from "../documents";

const eml =
  'From: Maeve Doyle <maeve.doyle@zeus.example>\r\nTo: purchasing@zeus.example\r\nSubject: Requisition PR-2026-101 for Engineering\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="==B=="\r\n\r\n' +
  '--==B==\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nPlease raise a PO with Nordlicht Com=\r\nputing GmbH. Total 5=2C520.00 EUR.\r\n\r\n' +
  '--==B==\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="PR-2026-101.pdf"\r\n\r\nJVBERi0xLjQK\r\n--==B==--\r\n';

describe("parseEml", () => {
  it("parses headers, decodes quoted-printable, lists attachments, drops base64", () => {
    const m = parseEml(eml);
    expect(m.headers.Subject).toBe("Requisition PR-2026-101 for Engineering");
    expect(m.headers.From).toBe("Maeve Doyle <maeve.doyle@zeus.example>");
    expect(m.text).toBe("Please raise a PO with Nordlicht Computing GmbH. Total 5,520.00 EUR.");
    expect(m.attachments).toEqual(["PR-2026-101.pdf"]);
    expect(m.text).not.toContain("JVBERi");
  });
  it("unfolds a folded Subject header and reads a plain body", () => {
    const m = parseEml("Subject:\r\n Requisition PR-2026-104 for Design\r\n\r\nbody line");
    expect(m.headers.Subject).toBe("Requisition PR-2026-104 for Design");
    expect(m.text).toBe("body line");
  });
  it("returns empty parts for empty input", () => {
    expect(parseEml("")).toEqual({ headers: {}, text: "", attachments: [] });
  });
});

describe("docType", () => {
  it("classifies by extension", () => {
    expect(docType("a/b.pdf")).toBe("pdf");
    expect(docType("x.EML")).toBe("email");
    expect(docType("x.txt")).toBe("text");
    expect(docType("x.md")).toBe("text");
    expect(docType("x.json")).toBe("data");
    expect(docType("x.csv")).toBe("data");
  });
});

describe("documentsFor", () => {
  it("lists the purchase order's requisition sources, email first", () => {
    const d = documentsFor("purchase_order", { requisition: "PR-2026-101" });
    expect(d.map((x) => x.path)).toEqual(["inbox/requisitions/PR-2026-101.eml", "inbox/requisitions/PR-2026-101.pdf", "inbox/requisitions/PR-2026-101.txt"]);
    expect(d[0].type).toBe("email");
    expect(d.every((x) => x.from === "convention")).toBe(true);
  });
  it("uses *_path fields and the count sheet", () => {
    const d = documentsFor("goods_receipt", { po_number: "PO-2026-105", delivery_note_number: "DN-2026-105" });
    expect(d.map((x) => x.path)).toContain("inbox/deliveries/count-PO-2026-105.txt");
    const inv = documentsFor("invoice", { document_path: "inbox/invoices/INV-2026-105.pdf", email_path: "inbox/invoices/INV-2026-105.eml", invoice_number: "INV-2026-105" });
    expect(inv.map((x) => x.path)).toEqual(["inbox/invoices/INV-2026-105.eml", "inbox/invoices/INV-2026-105.pdf", "inbox/invoices/INV-2026-105.txt"]);
  });
  it("reads an explicit documents[] array on the artefact", () => {
    const d = documentsFor("handoff", { documents: [{ label: "Dispute email", path: "outbox/dispute.eml" }] });
    expect(d).toEqual([{ label: "Dispute email", path: "outbox/dispute.eml", type: "email", from: "artefact", kind: "handoff" }]);
  });
});

describe("mergeDocuments", () => {
  it("prefers the API list and dedupes by path, keeping order email first", () => {
    const m = mergeDocuments(
      [{ label: "Email", path: "a.eml", type: "email", from: "artefact", kind: null }],
      [{ label: "x", path: "a.eml", type: "email", from: "convention", kind: null }, { label: "y", path: "b.pdf", type: "pdf", from: "convention", kind: null }],
    );
    expect(m.map((x) => x.path)).toEqual(["a.eml", "b.pdf"]);
    expect(m[0].label).toBe("Email");
  });
});
