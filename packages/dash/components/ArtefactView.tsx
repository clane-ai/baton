"use client";

// Renders an artefact by kind: business documents as documents, everything else as key/value.
// Every renderer takes the raw content object and never trusts a field to exist.
import { Json } from "./ui";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
export const money = (v: unknown, c?: unknown) => {
  const n = num(v);
  if (!Number.isFinite(n)) return str(v);
  return `${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c ? " " + str(c) : ""}`;
};

function Lines({ cols, rows, flag }: { cols: { k: string; h: string; n?: boolean; f?: (v: unknown, r: Obj) => string }[]; rows: Obj[]; flag?: (r: Obj) => boolean }) {
  if (!rows.length) return <div className="muted">no lines</div>;
  return (
    <table className="grid lines">
      <thead><tr>{cols.map((c) => <th key={c.k} className={c.n ? "right" : ""}>{c.h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={flag?.(r) ? "flag" : ""}>
            {cols.map((c) => <td key={c.k} className={c.n ? "right mono" : ""}>{c.f ? c.f(r[c.k], r) : str(r[c.k])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KV({ rows }: { rows: [string, unknown][] }) {
  return (
    <dl className="kv">
      {rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{typeof v === "object" ? <Json value={v} /> : str(v)}</dd></div>
      ))}
    </dl>
  );
}

function PurchaseOrder({ a }: { a: Obj }) {
  const v = obj(a.vendor), pc = obj(a.policy_check);
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.po_number)}</b><span className="muted"> for {str(a.requisition)} · {str(v.name)} ({str(v.id)})</span></div>
      <Lines rows={arr(a.lines)} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity", h: "Qty", n: true }, { k: "unit_price", h: "Unit", n: true, f: money }, { k: "line_total", h: "Total", n: true, f: (x, r) => money(x ?? num(r.quantity) * num(r.unit_price)) }]} />
      <div className="art-total">Total <b>{money(a.total, a.currency)}</b></div>
      <KV rows={[["requester", a.requester], ["cost centre", a.cost_center], ["deliver to", a.delivery_address], ["needed by", a.needed_by], ["vendor email", v.email]]} />
      <div className={`policy ${pc.vendor_approved === false || pc.approver_level === "director" || pc.approver_level === "cfo" ? "warn" : ""}`}>
        <div className="policy-h">Policy check</div>
        <div>approval {pc.approval_required ? "required" : "not required"} · level <b>{str(pc.approver_level ?? "-")}</b> · vendor {pc.vendor_approved === false ? <b className="bad">not approved</b> : "approved"}{pc.within_budget === false ? <> · <b className="bad">over budget</b></> : null}</div>
        {pc.notes ? <div className="policy-notes">{str(pc.notes)}</div> : null}
      </div>
    </div>
  );
}

function GoodsReceipt({ a }: { a: Obj }) {
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.grn_number)}</b><span className="muted"> for {str(a.po_number)} · received {str(a.received_at)} by {str(a.received_by)}</span></div>
      <Lines rows={arr(a.lines)} flag={(r) => num(r.quantity_received) < num(r.quantity_ordered) || r.condition !== "good"} cols={[{ k: "line", h: "#" }, { k: "item", h: "Item" }, { k: "quantity_ordered", h: "Ordered", n: true }, { k: "quantity_received", h: "Received", n: true }, { k: "condition", h: "Condition" }, { k: "note", h: "Note" }]} />
      <div className="art-total">{a.complete ? <span className="ok">complete</span> : <span className="bad">incomplete</span>}{Array.isArray(a.discrepancies) && a.discrepancies.length ? <span className="muted"> · {a.discrepancies.map(str).join("; ")}</span> : null}</div>
    </div>
  );
}

function Invoice({ a }: { a: Obj }) {
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.invoice_number)}</b><span className="muted"> for {str(a.po_number)} · {str(a.vendor)} · issued {str(a.issued_at)} · due {str(a.due_at)}</span></div>
      <Lines rows={arr(a.lines)} cols={[{ k: "line", h: "#" }, { k: "item", h: "Item" }, { k: "quantity", h: "Qty", n: true }, { k: "unit_price", h: "Unit", n: true, f: money }, { k: "line_total", h: "Total", n: true, f: money }]} />
      <div className="art-total">Total <b>{money(a.total, a.currency)}</b>{a.document_path ? <span className="muted"> · {str(a.document_path)}</span> : null}</div>
    </div>
  );
}

function DeliveryNote({ a }: { a: Obj }) {
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.delivery_note_number)}</b><span className="muted"> for {str(a.po_number)} · {str(a.vendor)} · shipped {str(a.shipped_at)} · {str(a.carrier)} {str(a.tracking)}</span></div>
      <Lines rows={arr(a.lines)} cols={[{ k: "line", h: "#" }, { k: "sku", h: "SKU" }, { k: "item", h: "Item" }, { k: "quantity_shipped", h: "Shipped", n: true }]} />
    </div>
  );
}

function InvoiceMatch({ a }: { a: Obj }) {
  const tol = obj(a.tolerance);
  return (
    <div className="art">
      <div className="art-head">Three-way match <b className={a.status === "matched" ? "ok" : "bad"}>{str(a.status)}</b><span className="muted"> · {str(a.invoice_number)} vs {str(a.po_number)} and {str(a.grn_number)}{tol.price_pct != null ? ` · tolerance price ${str(tol.price_pct)}%, qty ${str(tol.quantity ?? 0)}` : ""}</span></div>
      <Lines rows={arr(a.lines)} flag={(r) => r.ok === false} cols={[{ k: "line", h: "#" }, { k: "ordered_qty", h: "Ordered", n: true }, { k: "received_qty", h: "Received", n: true }, { k: "invoiced_qty", h: "Invoiced", n: true }, { k: "po_unit_price", h: "PO price", n: true, f: money }, { k: "invoice_unit_price", h: "Inv. price", n: true, f: money }, { k: "ok", h: "OK", f: (v) => (v ? "yes" : "no") }, { k: "variance", h: "Variance" }]} />
      <div className="art-total">Payable <b>{money(a.amount_payable)}</b>{Array.isArray(a.variances) && a.variances.length ? <span className="muted"> · {a.variances.map(str).join("; ")}</span> : null}</div>
      {a.summary ? <div className="prose">{str(a.summary)}</div> : null}
    </div>
  );
}

function Payment({ a }: { a: Obj }) {
  const b = obj(a.beneficiary);
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.payment_ref)}</b> <span className={a.status === "rejected" ? "bad" : "ok"}>{str(a.status)}</span><span className="muted"> · {money(a.amount, a.currency)} to {str(b.name)} {str(b.iban)} on {str(a.scheduled_for)} for {str(a.invoice_number)}</span></div>
    </div>
  );
}

function Review({ a }: { a: Obj }) {
  const f = arr(a.findings);
  return (
    <div className="art">
      <div className="art-head">Verdict <b className={a.verdict === "approve" ? "ok" : "bad"}>{str(a.verdict)}</b></div>
      <div className="prose">{str(a.summary)}</div>
      {f.length ? <ul>{f.map((x, i) => <li key={i}><b>{str(x.severity)}</b> {str(x.file)}{x.line ? `:${str(x.line)}` : ""} {str(x.note)}</li>)}</ul> : null}
    </div>
  );
}

function Handoff({ a }: { a: Obj }) {
  const c = Array.isArray(a.caveats) ? a.caveats.map(str) : [];
  return (
    <div className="art">
      <div className="art-head"><b>{str(a.summary)}</b></div>
      {a.details ? <pre className="mail">{str(a.details)}</pre> : null}
      {c.length ? <div className="muted">Caveats: {c.join("; ")}</div> : null}
    </div>
  );
}

function Generic({ a }: { a: Obj }) {
  const rows = Object.entries(a).filter(([, v]) => typeof v !== "object") as [string, unknown][];
  const rest = Object.entries(a).filter(([, v]) => typeof v === "object");
  return (
    <div className="art">
      <KV rows={rows} />
      {rest.length ? <Json value={Object.fromEntries(rest)} /> : null}
    </div>
  );
}

export default function ArtefactView({ kind, content }: { kind: string; content: unknown }) {
  const a = obj(content);
  if (!Object.keys(a).length) return <div className="muted">no inline content</div>;
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

/** Workspace documents an artefact points at, plus the well-known files for the P2P kinds. */
export function documentsOf(kind: string, content: unknown): { label: string; path: string }[] {
  const a = obj(content);
  const out: { label: string; path: string }[] = [];
  const add = (label: string, p: unknown) => { if (typeof p === "string" && p && !out.some((x) => x.path === p)) out.push({ label, path: p }); };
  for (const [k, v] of Object.entries(a)) if (/(_path|^path)$/.test(k)) add(`${kind} ${k.replace(/_path$/, "")}`, v);
  if (kind === "purchase_order" && a.requisition) {
    add("requisition (pdf)", `inbox/requisitions/${str(a.requisition)}.pdf`);
    add("requisition (text)", `inbox/requisitions/${str(a.requisition)}.txt`);
    add("requester email", `inbox/requisitions/${str(a.requisition)}.eml`);
  }
  if (kind === "goods_receipt" && a.po_number) add("count sheet", `inbox/deliveries/count-${str(a.po_number)}.txt`);
  if (kind === "invoice" && a.invoice_number) add("invoice (text)", `inbox/invoices/${str(a.invoice_number)}.txt`);
  if (kind === "payment" && a.remittance_path) add("remittance", a.remittance_path);
  return out;
}
