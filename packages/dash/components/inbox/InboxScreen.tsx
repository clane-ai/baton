"use client";

// The Inbox: what needs a person now. Tiles, filters, one board per kind, keyboard navigation.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoll, useTick } from "@/lib/usePoll";
import type { InboxItem, InboxKind, InboxResponse } from "@/lib/types";
import { groupItems, tilesOf } from "@/lib/inbox";
import { money } from "@/lib/money";
import { agoMs } from "@/lib/format";
import { Empty, ErrorBox, Tile } from "@/components/ui";
import InboxRow from "./InboxRow";

const KINDS: { kind: InboxKind; label: string; empty: string; tone: "waiting" | "stuck" | "info" }[] = [
  { kind: "approval", label: "Approvals", empty: "Nothing waiting for a decision", tone: "waiting" },
  { kind: "parked", label: "Parked", empty: "No step is stuck", tone: "stuck" },
  { kind: "question", label: "Questions", empty: "No agent is waiting for an answer", tone: "info" },
];

function matches(item: InboxItem, q: string): boolean {
  if (!q) return true;
  const s = item.summary;
  const hay = [item.key, item.title, item.workflow_run, item.run_name, s?.document, s?.counterparty].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function InboxScreen() {
  const router = useRouter();
  const inbox = usePoll<InboxResponse>("/api/inbox", 5000);
  const now = useTick(1000);
  const [q, setQ] = useState("");
  const [process, setProcess] = useState("");
  const [kinds, setKinds] = useState<Set<InboxKind>>(new Set(["approval", "parked", "question"]));
  const [sel, setSel] = useState<string | null>(null);

  const all = inbox.data?.items ?? [];
  const processes = useMemo(() => [...new Set(all.map((i) => i.run_name ?? i.workflow_run?.replace(/-\d+$/, "") ?? "").filter(Boolean))].sort(), [all]);
  const shown = useMemo(
    () => all.filter((i) => kinds.has(i.kind) && matches(i, q) && (!process || (i.run_name ?? i.workflow_run?.replace(/-\d+$/, "") ?? "") === process)),
    [all, kinds, q, process],
  );
  const groups = useMemo(() => groupItems(shown), [shown]);
  const order = useMemo(() => [...groups.approvals, ...groups.parked, ...groups.questions].map((i) => i.key), [groups]);
  const tiles = useMemo(() => tilesOf(all), [all]);

  useEffect(() => {
    if (order.length === 0) { setSel(null); return; }
    if (!sel || !order.includes(sel)) setSel(order[0]);
  }, [order, sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (!order.length) return;
      const i = sel ? order.indexOf(sel) : -1;
      if (e.key === "j") { setSel(order[Math.min(order.length - 1, i + 1)]); e.preventDefault(); }
      else if (e.key === "k") { setSel(order[Math.max(0, i - 1)]); e.preventDefault(); }
      else if (e.key === "Enter" && sel) { router.push(`/inbox/${encodeURIComponent(sel)}`); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, sel, router]);

  const toggleKind = (k: InboxKind) => setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const amounts = Object.entries(tiles.waitingAmount).map(([c, v]) => money(v, c)).join(" + ");
  const freshness = inbox.error ? `error: ${inbox.error.message}` : inbox.updatedAt ? `updated ${agoMs(now - inbox.updatedAt)}` : "loading…";

  return (
    <div className="inbox-screen">
      <div className="screen-head">
        <h1>Inbox</h1>
        <span className="muted">what needs a person</span>
        <span className="sp" />
        <span className="muted small">{freshness}</span>
        <button type="button" className="btn sm" onClick={() => void inbox.refresh()}>Refresh</button>
      </div>
      <div className="tiles">
        <Tile n={tiles.waiting} label="waiting for you" sub={amounts || undefined} tone={tiles.waiting ? "waiting" : undefined} />
        <Tile n={tiles.parked} label="parked after attempts" tone={tiles.parked ? "stuck" : undefined} />
        <Tile n={tiles.questions} label="questions from agents" tone={tiles.questions ? "info" : undefined} />
        <Tile n={tiles.overdue} label="past their deadline" tone={tiles.overdue ? "stuck" : undefined} />
      </div>
      <div className="filters">
        <input id="inbox-search" className="search" placeholder="Search key, document, vendor, run…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="inbox-process" className="select" value={process} onChange={(e) => setProcess(e.target.value)}>
          <option value="">All processes</option>
          {processes.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className={`filter-chip${kinds.has(k.kind) ? " on" : ""}`} onClick={() => toggleKind(k.kind)} aria-pressed={kinds.has(k.kind)}>{k.label}</button>
        ))}
        {inbox.data?.fallback ? <span className="muted small" title={inbox.data.upstream_error ?? ""}>rows built from task details</span> : null}
      </div>
      <ErrorBox error={inbox.error} />
      {KINDS.filter((k) => kinds.has(k.kind)).map((k) => {
        const rows = groups[k.kind === "approval" ? "approvals" : k.kind === "parked" ? "parked" : "questions"];
        return (
          <section key={k.kind} className={`board surface stripe-${k.tone}`} aria-label={k.label}>
            <header className="board-h">
              <b>{k.label}</b>
              <span className="count num">{rows.length}</span>
            </header>
            {rows.length === 0 ? (
              <Empty title={k.empty} />
            ) : (
              <div className="rows" role="table">
                <div className="row head" role="row">
                  <div className="cell c-item">Item</div><div className="cell c-run">Run</div><div className="cell c-doc">Document</div><div className="cell c-amt">Amount</div><div className="cell c-flags">Policy</div><div className="cell c-wait">Waiting</div><div className="cell c-act" />
                </div>
                {rows.map((i) => <InboxRow key={i.key} item={i} selected={sel === i.key} now={now} />)}
              </div>
            )}
          </section>
        );
      })}
      <div className="foot muted small">
        <span>{shown.length} of {all.length} items</span>
        <span className="sp" />
        <span><kbd>j</kbd> <kbd>k</kbd> move · <kbd>Enter</kbd> open</span>
      </div>
    </div>
  );
}
