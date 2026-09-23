"use client";

import { usePoll } from "@/lib/usePoll";
import type { SpendResponse } from "@/lib/types";
import { usd } from "@/lib/format";
import { ErrorBox, Key, StateBadge } from "./ui";

function DayChart({ days }: { days: { day: string; cost_usd: number }[] }) {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day)).slice(-45);
  const max = Math.max(0.01, ...sorted.map((d) => Number(d.cost_usd) || 0));
  if (sorted.length === 0) return <div className="empty">No spend recorded.</div>;
  return (
    <div className="chart" role="img" aria-label="Spend by day">
      {sorted.map((d) => {
        const v = Number(d.cost_usd) || 0;
        const h = Math.max(2, Math.round((v / max) * 130));
        return (
          <div key={d.day} className="bar-wrap" title={`${d.day}: ${usd(v, 4)}`}>
            <div className="bar-v">{usd(v)}</div>
            <div className="bar" style={{ height: h }} />
            <div className="bar-l">{d.day.slice(5)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function SpendView() {
  const s = usePoll<SpendResponse>("/api/spend", 5000);
  const byTask = [...(s.data?.by_task ?? [])].sort((a, b) => Number(b.cost_usd) - Number(a.cost_usd));
  const byRole = [...(s.data?.by_role ?? [])].sort((a, b) => Number(b.cost_usd) - Number(a.cost_usd));

  return (
    <div>
      <div className="view-head">
        <h2>Spend</h2>
      </div>
      <ErrorBox error={s.error} />

      <div className="spend-top">
        <div className="panel">
          <div className="panel-h">Total</div>
          <div className="panel-b">
            <div className="total">{usd(s.data?.total_usd, 4)}</div>
            {s.data?.total_credits ? <div className="muted">{Number(s.data.total_credits).toFixed(0)} gateway credits (Clane runs; not converted to dollars)</div> : null}
            <div className="muted">
              across {byTask.length} {byTask.length === 1 ? "task" : "tasks"} and {byRole.length} {byRole.length === 1 ? "role" : "roles"}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">By role</div>
          <table className="grid">
            <thead>
              <tr>
                <th>role</th>
                <th className="right">cost</th>
                <th className="right">share</th>
              </tr>
            </thead>
            <tbody>
              {byRole.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty">
                    none
                  </td>
                </tr>
              ) : (
                byRole.map((r) => (
                  <tr key={r.role}>
                    <td>{r.role}</td>
                    <td className="right num">{usd(r.cost_usd, 4)}</td>
                    <td className="right num muted">
                      {s.data?.total_usd ? `${((Number(r.cost_usd) / s.data.total_usd) * 100).toFixed(0)}%` : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          By day <span className="muted">last {Math.min(45, s.data?.by_day.length ?? 0)} days with spend</span>
        </div>
        <div className="panel-b">
          <DayChart days={s.data?.by_day ?? []} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          By task <span className="muted">sorted by cost</span>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>key</th>
              <th>title</th>
              <th>role</th>
              <th>state</th>
              <th className="right">cost</th>
              <th className="right">budget</th>
              <th className="right">used</th>
            </tr>
          </thead>
          <tbody>
            {byTask.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  {s.loading && !s.data ? "Loading…" : "none"}
                </td>
              </tr>
            ) : (
              byTask.map((t) => {
                const over = t.budget_usd != null && Number(t.cost_usd) > Number(t.budget_usd);
                return (
                  <tr key={t.id}>
                    <td>
                      <Key>{t.key}</Key>
                    </td>
                    <td>{t.title}</td>
                    <td>{t.role}</td>
                    <td>
                      <StateBadge state={t.state} />
                    </td>
                    <td className={`right num${over ? " over" : ""}`}>{usd(t.cost_usd, 4)}</td>
                    <td className="right num">{t.budget_usd != null ? usd(t.budget_usd) : <span className="muted">-</span>}</td>
                    <td className={`right num${over ? " over" : ""}`}>
                      {t.budget_usd ? `${((Number(t.cost_usd) / Number(t.budget_usd)) * 100).toFixed(0)}%` : <span className="muted">-</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
