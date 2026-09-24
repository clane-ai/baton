"use client";

// Runs: every instance of a process, where it stands, what it cost.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePoll } from "@/lib/usePoll";
import type { WorkflowRun, WorkflowRunsResponse } from "@/lib/types";
import { runTone } from "@/lib/theme";
import { usd } from "@/lib/format";
import { Empty, ErrorBox, Pill } from "@/components/ui";

export function progressOf(counts: Record<string, number>): { done: number; total: number } {
  const done = Number(counts.done ?? 0);
  const total = Object.entries(counts).reduce((a, [, n]) => a + Number(n), 0);
  return { done, total };
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RunsScreen() {
  const runs = usePoll<WorkflowRunsResponse>("/api/workflow-runs", 5000);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = runs.data?.runs ?? [];
  const statuses = useMemo(() => [...new Set(list.map((r) => r.status))].sort(), [list]);
  const shown = useMemo(
    () => list.filter((r) => (!status || r.status === status) && (!q || `${r.key} ${r.workflow_name ?? ""} ${r.input ?? ""}`.toLowerCase().includes(q.toLowerCase()))),
    [list, q, status],
  );
  return (
    <div>
      <div className="screen-head">
        <h1>Runs</h1>
        <span className="muted">{list.length} runs</span>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={() => void runs.refresh()}>Refresh</button>
      </div>
      <div className="filters">
        <input id="runs-search" className="search" placeholder="Search run key, process, input…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="runs-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <ErrorBox error={runs.error} />
      <section className="surface board stripe-info">
        {shown.length === 0 ? <Empty title={list.length ? "No run matches" : "No runs yet"} hint={list.length ? "Clear the search or the status filter." : "Compile a workflow to start one."} /> : (
          <div className="rows">
            <div className="row runs-row head"><div className="cell">Run</div><div className="cell">Process</div><div className="cell">Status</div><div className="cell">Progress</div><div className="cell c-amt">Cost</div><div className="cell">Started</div><div className="cell">Finished</div></div>
            {shown.map((r: WorkflowRun) => {
              const p = progressOf(r.counts);
              return (
                <Link key={r.key} href={`/runs/${encodeURIComponent(r.key)}`} className="row runs-row">
                  <div className="cell"><span className="mono key">{r.key}</span>{r.input ? <span className="sub">{r.input}</span> : null}</div>
                  <div className="cell">{r.workflow_name ?? r.workflow_key ?? ""}</div>
                  <div className="cell"><span><Pill tone={runTone(r.status)}>{r.status.replace(/_/g, " ")}</Pill></span></div>
                  <div className="cell c-progress"><span className="progress"><span className={`progress-bar tone-${runTone(r.status)}`} style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} /></span><span className="sub num">{p.done} of {p.total}</span></div>
                  <div className="cell c-amt num">{usd(r.cost_usd)}{r.cost_credits ? <span className="sub">{Number(r.cost_credits).toFixed(0)} credits</span> : null}</div>
                  <div className="cell sub">{fmt(r.created_at)}</div>
                  <div className="cell sub">{fmt(r.finished_at)}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
