"use client";

// An artefact rendered as the business document it represents: labelled fields in a two-column
// rhythm, lines with totals, the policy chips and notes. Each field carries a source marker and a
// confidence figure when the artefact's _provenance names it; otherwise nothing is shown there.
import type { Provenance } from "@/lib/types";
import { money } from "@/lib/money";
import { Chip, Json } from "@/components/ui";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const has = (v: unknown) => v !== null && v !== undefined && v !== "";

function Source({ prov, path }: { prov: Provenance | null; path: string }) {
  const p = prov?.[path];
  if (!p) return null;
  const conf = p.confidence != null ? ` · ${Math.round(p.confidence * 100)}%` : "";
  return <span className="src" title={p.note ? String(p.note) : undefined}>{p.source}{p.page != null ? ` p.${p.page}` : ""}{conf}</span>;
}

function Field({ label, value, path, prov, wide, mono }: { label: string; value: unknown; path: string; prov: Provenance | null; wide?: boolean; mono?: boolean }) {
  if (!has(value)) return null;
  return (
    <div className={`f${wide ? " wide" : ""}`}>
      <span className="lab">{label}</span>
      <span className="val"><span className={mono ? "mono" : ""}>{str(value)}</span><Source prov={prov} path={path} /></span>
    </div>
  );
}

type Col = { k: string; h: string; n?: boolean; f?: (v: unknown, r: Obj) => string };

function Lines({ cols, rows, flag, total }: { cols: Col[]; rows: Obj[]; flag?: (r: Obj) => boolean; total?: string }) {
  if (!rows.length) return <div className="muted">No lines.</div>;
  return (
    <table className="lines">
      <thead><tr>{cols.map((c) => <th key={c.k} className={c.n ? "r" : ""}>{c.h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={flag?.(r) ? "flag" : ""}>
            {cols.map((c) => <td key={c.k} className={c.n ? "r" : ""}>{c.f ? c.f(r[c.k], r) : str(r[c.k])}</td>)}
          </tr>
        ))}
      </tbody>
      {total ? <tfoot><tr><td colSpan={cols.length - 1} className="r lab-cell">Total</td><td className="r">{total}</td></tr></tfoot> : null}
    </table>
  );
}

function provOf(a: Obj): Provenance | null {
  const p = a._provenance;
  return p && typeof p === "object" ? (p as Provenance) : null;
}

function PurchaseOrder({ a }: { a: Obj }) {
  const v = obj(a.vendor), pc = obj(a.policy_check), prov = provOf(a);
  const flags: { text: string; tone: "done" | "stuck" | "working" | "info" }[] = [];
  flags.push(pc.approval_required ? { text: "approval required", tone: "info" } : { text: "no approval needed", tone: "done" });
  if (has(pc.approver_level)) flags.push({ text: `${str(pc.approver_level)} level`, tone: pc.approver_level === "director" || pc.approver_level === "cfo" ? "stuck" : "done" });
  flags.push(pc.vendor_approved === false ? { text: "vendor not approved", tone: "stuck" } : { text: "vendor approved", tone: "done" });
  if (pc.within_budget === false) flags.push({ text: "over budget", tone: "stuck" });
  return (
    <div className="doc">
      <h3>Order</h3>
      <div className="fields">
        <Field label="PO number" value={a.po_number} path="po_number" prov={prov} mono />
        <Field label="Requisition" value={a.requisition} path="requisition" prov={prov} mono />
        <Field label="Vendor" value={has(v.name) ? `${str(v.name)}${has(v.id) ? ` (${str(v.id)})` : ""}` : a.vendor_name} path="vendor" prov={prov} />
        <Field label="Cost centre" value={a.cost_center} path="cost_center" prov={prov} />
        <Field label="Requester" value={a.requester} path="requester" prov={prov} />
        <Field label="Needed by" value={a.needed_by} path="needed_by" prov={prov} />
        <Field label="Deliver to" value={a.delivery_address ?? a.deliver_to} path="delivery_address" prov={prov} wide />
        <Field label="Vendor email" value={v.email} path="vendor.email" prov={prov} />
        <Field label="Payment terms" value={v.payment_terms ?? a.payment_terms} path="payment_terms" prov={prov} />
      </div>
      <h3>Lines</h3>
      <Lines rows={arr(a.lines)} total={money(a.total, a.currency)} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity", h: "Qty", n: true }, { k: "unit_price", h: "Unit price", n: true, f: money }, { k: "line_total", h: "Total", n: true, f: (x, r) => money(has(x) ? x : num(r.quantity) * num(r.unit_price)) }]} />
      <h3>Policy check</h3>
      <div className="policy-chips">{flags.map((f) => <Chip key={f.text} tone={f.tone}>{f.text}</Chip>)}</div>
      {has(pc.notes) ? <div className="quote">{str(pc.notes)}</div> : null}
    </div>
  );
}

function GoodsReceipt({ a }: { a: Obj }) {
  const prov = provOf(a);
  return (
    <div className="doc">
      <h3>Receipt</h3>
      <div className="fields">
        <Field label="GRN number" value={a.grn_number} path="grn_number" prov={prov} mono />
        <Field label="Purchase order" value={a.po_number} path="po_number" prov={prov} mono />
        <Field label="Delivery note" value={a.delivery_note_number} path="delivery_note_number" prov={prov} mono />
        <Field label="Received" value={a.received_at} path="received_at" prov={prov} />
        <Field label="Received by" value={a.received_by} path="received_by" prov={prov} />
      </div>
      <h3>Lines</h3>
      <Lines rows={arr(a.lines)} flag={(r) => num(r.quantity_received) < num(r.quantity_ordered) || (has(r.condition) && r.condition !== "good")} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity_ordered", h: "Ordered", n: true }, { k: "quantity_received", h: "Received", n: true }, { k: "condition", h: "Condition" }, { k: "note", h: "Note" }]} />
      <div className="policy-chips" style={{ marginTop: 10 }}>{a.complete ? <Chip tone="done">complete</Chip> : <Chip tone="stuck">incomplete</Chip>}</div>
      {Array.isArray(a.discrepancies) && a.discrepancies.length ? <ul className="notes">{a.discrepancies.map((d, i) => <li key={i}>{str(d)}</li>)}</ul> : null}
    </div>
  );
}

function Invoice({ a }: { a: Obj }) {
  const prov = provOf(a), b = obj(a.bank);
  return (
    <div className="doc">
      <h3>Invoice</h3>
      <div className="fields">
        <Field label="Invoice number" value={a.invoice_number} path="invoice_number" prov={prov} mono />
        <Field label="Purchase order" value={a.po_number} path="po_number" prov={prov} mono />
        <Field label="Vendor" value={a.vendor} path="vendor" prov={prov} />
        <Field label="Issued" value={a.issued_at} path="issued_at" prov={prov} />
        <Field label="Due" value={a.due_at} path="due_at" prov={prov} />
        <Field label="IBAN" value={b.iban} path="bank.iban" prov={prov} mono />
      </div>
      <h3>Lines</h3>
      <Lines rows={arr(a.lines)} total={money(a.total, a.currency)} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity", h: "Qty", n: true }, { k: "unit_price", h: "Unit price", n: true, f: money }, { k: "line_total", h: "Total", n: true, f: money }]} />
    </div>
  );
}

function DeliveryNote({ a }: { a: Obj }) {
  const prov = provOf(a);
  return (
    <div className="doc">
      <h3>Delivery note</h3>
      <div className="fields">
        <Field label="Note number" value={a.delivery_note_number} path="delivery_note_number" prov={prov} mono />
        <Field label="Purchase order" value={a.po_number} path="po_number" prov={prov} mono />
        <Field label="Vendor" value={a.vendor} path="vendor" prov={prov} />
        <Field label="Shipped" value={a.shipped_at} path="shipped_at" prov={prov} />
        <Field label="Carrier" value={has(a.carrier) ? `${str(a.carrier)}${has(a.tracking) ? ` · ${str(a.tracking)}` : ""}` : a.tracking} path="carrier" prov={prov} />
      </div>
      <h3>Lines</h3>
      <Lines rows={arr(a.lines)} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity_shipped", h: "Shipped", n: true }]} />
    </div>
  );
}

function InvoiceMatch({ a }: { a: Obj }) {
  const prov = provOf(a), tol = obj(a.tolerance);
  return (
    <div className="doc">
      <h3>Three-way match</h3>
      <div className="fields">
        <Field label="Status" value={a.status} path="status" prov={prov} />
        <Field label="Invoice" value={a.invoice_number} path="invoice_number" prov={prov} mono />
        <Field label="Purchase order" value={a.po_number} path="po_number" prov={prov} mono />
        <Field label="Goods receipt" value={a.grn_number} path="grn_number" prov={prov} mono />
        <Field label="Tolerance" value={has(tol.price_pct) ? `price ${str(tol.price_pct)}%, quantity ${str(tol.quantity ?? 0)}` : undefined} path="tolerance" prov={prov} />
        <Field label="Payable" value={money(a.amount_payable, a.currency)} path="amount_payable" prov={prov} mono />
      </div>
      <h3>Lines</h3>
      <Lines rows={arr(a.lines)} flag={(r) => r.ok === false} cols={[{ k: "line", h: "#" }, { k: "item", h: "Item" }, { k: "ordered_qty", h: "Ordered", n: true }, { k: "received_qty", h: "Received", n: true }, { k: "invoiced_qty", h: "Invoiced", n: true }, { k: "po_unit_price", h: "PO price", n: true, f: money }, { k: "invoice_unit_price", h: "Invoice price", n: true, f: money }, { k: "ok", h: "OK", f: (v) => (v ? "yes" : "no") }, { k: "variance", h: "Variance" }]} />
      {Array.isArray(a.variances) && a.variances.length ? <ul className="notes">{a.variances.map((d, i) => <li key={i}>{str(d)}</li>)}</ul> : null}
      {has(a.summary) ? <div className="quote">{str(a.summary)}</div> : null}
    </div>
  );
}

function Payment({ a }: { a: Obj }) {
  const prov = provOf(a), b = obj(a.beneficiary);
  return (
    <div className="doc">
      <h3>Payment</h3>
      <div className="fields">
        <Field label="Reference" value={a.payment_ref} path="payment_ref" prov={prov} mono />
        <Field label="Status" value={a.status} path="status" prov={prov} />
        <Field label="Amount" value={money(a.amount, a.currency)} path="amount" prov={prov} mono />
        <Field label="Scheduled for" value={a.scheduled_for} path="scheduled_for" prov={prov} />
        <Field label="Beneficiary" value={b.name} path="beneficiary.name" prov={prov} />
        <Field label="IBAN" value={b.iban} path="beneficiary.iban" prov={prov} mono />
        <Field label="Invoice" value={a.invoice_number} path="invoice_number" prov={prov} mono />
        <Field label="Purchase order" value={a.po_number} path="po_number" prov={prov} mono />
      </div>
    </div>
  );
}

function Review({ a }: { a: Obj }) {
  const f = arr(a.findings);
  return (
    <div className="doc">
      <h3>Review</h3>
      <div className="policy-chips"><Chip tone={a.verdict === "approve" ? "done" : "stuck"}>{str(a.verdict).replace(/_/g, " ")}</Chip></div>
      {has(a.summary) ? <div className="quote">{str(a.summary)}</div> : null}
      {f.length ? <ul className="notes">{f.map((x, i) => <li key={i}><b>{str(x.severity)}</b> {str(x.file)}{has(x.line) ? `:${str(x.line)}` : ""} {str(x.note)}</li>)}</ul> : null}
    </div>
  );
}

function Handoff({ a }: { a: Obj }) {
  const c = Array.isArray(a.caveats) ? a.caveats.map(str) : [];
  return (
    <div className="doc">
      <h3>{str(a.summary) || "Handoff"}</h3>
      {has(a.details) ? <pre className="letter">{str(a.details)}</pre> : null}
      {c.length ? <><h3>Caveats</h3><ul className="notes">{c.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
    </div>
  );
}

function Generic({ a }: { a: Obj }) {
  const prov = provOf(a);
  const flat = Object.entries(a).filter(([k, v]) => k !== "_provenance" && typeof v !== "object");
  const rest = Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== "_provenance" && typeof v === "object" && v !== null));
  return (
    <div className="doc">
      <div className="fields">{flat.map(([k, v]) => <Field key={k} label={k.replace(/_/g, " ")} value={v} path={k} prov={prov} />)}</div>
      {Object.keys(rest).length ? <Json value={rest} /> : null}
    </div>
  );
}

export default function DocumentPane({ kind, content }: { kind: string; content: unknown }) {
  const a = obj(content);
  if (!Object.keys(a).length) return <div className="muted">No document to show.</div>;
  switch (kind) {
    case "purchase_order": return <PurchaseOrder a={a} />;
    case "goods_receipt": return <GoodsReceipt a={a} />;
    case "invoice": return <Invoice a={a} />;
    case "delivery_note": return <DeliveryNote a={a} />;
    case "invoice_match": return <InvoiceMatch a={a} />;
    case "payment": return <Payment a={a} />;
    case "review": return <Review a={a} />;
    case "handoff": return <Handoff a={a} />;
    default: return <Generic a={a} />;
  }
}
