"use client";

// Documents: find a purchase order, receipt, invoice, match, payment or review by number, vendor or run.
import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { usePoll } from "@/lib/usePoll";
import type { Artifact } from "@/lib/types";
import { summaryOf } from "@/lib/inboxFallback";
import { money } from "@/lib/money";
import { ts } from "@/lib/format";
import { Chip, Empty, ErrorBox } from "@/components/ui";
import DocumentPane from "@/components/item/DocumentPane";

const KINDS = ["purchase_order", "goods_receipt", "invoice", "delivery_note", "invoice_match", "payment", "review", "handoff", "task_spec", "design_spec", "test_report", "build", "pr", "doc", "other"];
type Art = Artifact & { task_key?: string | null; task_id?: string };
type Resp = { ok: true; artifacts: Art[] };

export default function DocumentsScreen() {
  const [kind, setKind] = useState("purchase_order");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Art | null>(null);
  const list = usePoll<Resp>(`/api/artifacts?kind=${encodeURIComponent(kind)}`, 15000);
  const rows = useMemo(() => {
    const all = (list.data?.artifacts ?? []).map((a) => ({ a, s: summaryOf(a.kind, a.content) }));
    const needle = q.trim().toLowerCase();
    return needle ? all.filter(({ a, s }) => `${a.task_key ?? ""} ${s.document ?? ""} ${s.counterparty ?? ""} ${JSON.stringify(a.content ?? "")}`.toLowerCase().includes(needle)) : all;
  }, [list.data, q]);

  return (
    <div>
      <div className="screen-head">
        <h1>Documents</h1>
        <span className="muted">{list.data ? `${rows.length} of ${list.data.artifacts.length}` : ""}</span>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={() => void list.refresh()}>Refresh</button>
      </div>
      <div className="filters">
        <select id="docs-kind" className="select" value={kind} onChange={(e) => { setKind(e.target.value); setOpen(null); }}>
          {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
        </select>
        <input id="docs-search" className="search" placeholder="Search number, vendor, task key, any field…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={list.error} />
      <section className="surface board stripe-info">
        {rows.length === 0 ? <Empty title={list.loading ? "Loading…" : `No ${kind.replace(/_/g, " ")} documents${q ? " match" : ""}`} hint={q ? "Try another number or vendor." : "Documents appear as steps produce them."} /> : (
          <div className="rows">
            <div className="row docs-row head"><div className="cell">Document</div><div className="cell">Counterparty</div><div className="cell c-amt">Amount</div><div className="cell">Flags</div><div className="cell">Step</div><div className="cell">Created</div></div>
            {rows.map(({ a, s }) => (
              <button key={a.id} type="button" className={`row docs-row${open?.id === a.id ? " selected" : ""}`} onClick={() => setOpen(open?.id === a.id ? null : a)}>
                <div className="cell"><span className="mono key">{s.document ?? a.kind.replace(/_/g, " ")}</span><span className="sub">{a.kind.replace(/_/g, " ")}</span></div>
                <div className="cell">{s.counterparty ?? ""}</div>
                <div className="cell c-amt num">{s.amount != null ? money(s.amount, s.currency ?? undefined) : ""}</div>
                <div className="cell c-flags">{s.flags.map((f) => <Chip key={f} tone="working">{f.replace(/_/g, " ")}</Chip>)}</div>
                <div className="cell"><span className="mono">{a.task_key ?? ""}</span></div>
                <div className="cell sub">{ts(a.created_at)}</div>
              </button>
            ))}
          </div>
        )}
      </section>
      {open ? (
        <aside className="sheet surface" aria-label="Document">
          <div className="sheet-h">
            <b>{open.kind.replace(/_/g, " ")}</b>
            {open.task_key ? <Link className="btn sm" href={`/inbox/${encodeURIComponent(open.task_key)}`}>Open step</Link> : null}
            <span className="sp" />
            <button type="button" className="btn ghost sm" onClick={() => setOpen(null)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="sheet-b"><DocumentPane kind={open.kind} content={open.content} /></div>
        </aside>
      ) : null}
    </div>
  );
}
