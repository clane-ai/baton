"use client";

// Spend: what the agents cost, by run, role, day and step. Dollars from Claude Code runs, credits
// from Clane runs; nothing is converted.
import { useMemo } from "react";
import Link from "next/link";
import { usePoll } from "@/lib/usePoll";
import type { SpendResponse, WorkflowRunsResponse } from "@/lib/types";
import { runTone } from "@/lib/theme";
import { usd } from "@/lib/format";
import { Empty, ErrorBox, Pill, StatePill, Tile } from "@/components/ui";

function DayChart({ days }: { days: { day: string; cost_usd: number }[] }) {
  const max = Math.max(0.01, ...days.map((d) => Number(d.cost_usd)));
  if (!days.length) return <Empty title="No spend recorded yet" />;
  return (
    <div className="chart" role="img" aria-label="Spend per day">
      {days.map((d) => (
        <div key={d.day} className="bar-wrap" title={`${d.day}: ${usd(d.cost_usd)}`}>
          <span className="bar-v">{usd(d.cost_usd)}</span>
          <span className="bar" style={{ height: `${Math.max(2, (Number(d.cost_usd) / max) * 100)}%` }} />
          <span className="bar-l">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function SpendScreen() {
  const spend = usePoll<SpendResponse>("/api/spend", 15000);
  const runs = usePoll<WorkflowRunsResponse>("/api/workflow-runs", 15000);
  const s = spend.data;
  const byRun = useMemo(() => (runs.data?.runs ?? []).filter((r) => Number(r.cost_usd) > 0 || Number(r.cost_credits) > 0).sort((a, b) => Number(b.cost_usd) - Number(a.cost_usd) || Number(b.cost_credits) - Number(a.cost_credits)), [runs.data]);
  return (
    <div>
      <div className="screen-head">
        <h1>Spend</h1>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={() => { void spend.refresh(); void runs.refresh(); }}>Refresh</button>
      </div>
      <ErrorBox error={spend.error} />
      <div className="tiles tiles-3">
        <Tile n={usd(s?.total_usd ?? 0)} label="total, Claude Code runs" />
        <Tile n={Number(s?.total_credits ?? 0).toFixed(0)} label="total credits, Clane runs" />
        <Tile n={byRun.length} label="runs with spend" />
      </div>
      <div className="spend-grid">
        <section className="surface">
          <header className="board-h"><b>By run</b></header>
          {byRun.length === 0 ? <Empty title="No run has spent anything yet" /> : (
            <div className="rows">
              {byRun.map((r) => (
                <Link key={r.key} href={`/runs/${encodeURIComponent(r.key)}`} className="row spend-row">
                  <div className="cell"><span className="mono key">{r.key}</span><span className="sub">{r.workflow_name ?? ""}</span></div>
                  <div className="cell"><span><Pill tone={runTone(r.status)}>{r.status.replace(/_/g, " ")}</Pill></span></div>
                  <div className="cell c-amt num">{usd(r.cost_usd)}</div>
                  <div className="cell c-amt num">{Number(r.cost_credits) ? `${Number(r.cost_credits).toFixed(0)} cr` : ""}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="surface">
          <header className="board-h"><b>By role</b></header>
          <div className="rows">
            {(s?.by_role ?? []).map((r) => (
              <div key={r.role} className="row spend-row"><div className="cell">{r.role}</div><div className="cell" /><div className="cell c-amt num">{usd(r.cost_usd)}</div><div className="cell c-amt num">{r.credits ? `${Number(r.credits).toFixed(0)} cr` : ""}</div></div>
            ))}
          </div>
        </section>
        <section className="surface">
          <header className="board-h"><b>By day</b></header>
          <div className="pane-b"><DayChart days={s?.by_day ?? []} /></div>
        </section>
        <section className="surface">
          <header className="board-h"><b>Most expensive steps</b></header>
          <div className="rows">
            {(s?.by_task ?? []).slice(0, 20).map((t) => (
              <Link key={t.id} href={`/inbox/${encodeURIComponent(t.key)}`} className="row spend-row">
                <div className="cell"><span className="mono key">{t.key}</span><span className="sub">{t.title.replace(/^[^:]+:\s*/, "")}</span></div>
                <div className="cell"><span><StatePill state={t.state} /></span></div>
                <div className="cell c-amt num">{usd(t.cost_usd)}{t.budget_usd != null ? <span className={`sub${Number(t.cost_usd) > Number(t.budget_usd) ? " over" : ""}`}>of {usd(t.budget_usd)}</span> : null}</div>
                <div className="cell c-amt num">{t.cost_credits ? `${Number(t.cost_credits).toFixed(0)} cr` : ""}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
