"use client";

// Runs: every workflow run with its derived status, and the steps of the selected one.
import { useState } from "react";
import { usePoll } from "@/lib/usePoll";
import type { WorkflowRunResponse, WorkflowRunsResponse } from "@/lib/types";
import { usd } from "@/lib/format";
import { ErrorBox, StateBadge } from "./ui";
import TaskDetail from "./TaskDetail";
import RunGraph from "./RunGraph";

const STATUS_CLASS: Record<string, string> = { done: "st-done", running: "st-in_progress", blocked: "st-blocked", needs_human: "st-needs_human", failed: "st-needs_human", cancelled: "st-cancelled", pending: "st-ready", empty: "st-draft" };

export default function RunsView() {
  const [selected, setSelected] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const runs = usePoll<WorkflowRunsResponse>("/api/workflow-runs", 5000);
  const run = usePoll<WorkflowRunResponse>(selected ? `/api/workflow-runs/${encodeURIComponent(selected)}` : null, 5000);
  const list = runs.data?.runs ?? [];
  const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + Number(b), 0);

  return (
    <div>
      <div className="view-head">
        <h2>Runs</h2>
        <span className="muted">{list.length} runs</span>
      </div>
      <ErrorBox error={runs.error} />
      <div className="panel">
        <table className="grid">
          <thead>
            <tr><th>run</th><th>workflow</th><th>status</th><th>progress</th><th className="right">cost</th><th className="right">credits</th><th>started</th><th>finished</th></tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={8} className="empty">No workflow runs yet. Create one with baton workflow compile.</td></tr>
            ) : list.map((r) => {
              const n = total(r.counts); const done = r.counts.done ?? 0;
              return (
                <tr key={r.key} className={selected === r.key ? "selected" : ""} onClick={() => setSelected(r.key)} style={{ cursor: "pointer" }}>
                  <td className="mono">{r.key}</td>
                  <td>{r.workflow_name ?? "-"}</td>
                  <td><span className={`badge ${STATUS_CLASS[r.status] ?? "st-draft"}`}>{r.status.replace("_", " ")}</span></td>
                  <td>
                    <div className="progress" title={`${done}/${n} done`}>
                      <div className="progress-bar" style={{ width: `${n ? Math.round((done / n) * 100) : 0}%` }} />
                    </div>
                    <span className="muted num"> {done}/{n}</span>
                  </td>
                  <td className="right num">{usd(r.cost_usd)}</td>
                  <td className="right num">{Number(r.cost_credits).toFixed(0)}</td>
                  <td className="muted">{String(r.created_at).slice(0, 16).replace("T", " ")}</td>
                  <td className="muted">{r.finished_at ? String(r.finished_at).slice(0, 16).replace("T", " ") : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && run.data ? (
        <div className="panel">
          <div className="panel-h">
            {run.data.run.key} <span className="muted">{run.data.run.workflow_name}</span>
            <span className="spacer" />
            <span className={`badge ${STATUS_CLASS[run.data.run.status] ?? "st-draft"}`}>{run.data.run.status.replace("_", " ")}</span>
          </div>
          {run.data.run.input ? <div className="panel-b muted">input: {run.data.run.input}</div> : null}
          <div className="panel-b"><RunGraph run={run.data.run} /></div>
          <table className="grid">
            <thead><tr><th>step</th><th>role</th><th>state</th><th>attempts</th><th>assignee</th><th className="right">cost</th><th className="right">credits</th><th>produces</th></tr></thead>
            <tbody>
              {(run.data.run.steps ?? []).map((s) => (
                <tr key={s.id} onClick={() => setTask(s.id)} style={{ cursor: "pointer" }}>
                  <td><span className="mono">{s.key}</span> {s.title.replace(/^[^:]+:\s*/, "")}</td>
                  <td>{s.role}</td>
                  <td><StateBadge state={s.state} /></td>
                  <td className="num">{s.attempts}</td>
                  <td>{s.assignee ?? ""}</td>
                  <td className="right num">{usd(s.cost_usd)}</td>
                  <td className="right num">{Number(s.cost_credits).toFixed(0)}</td>
                  <td className="mono muted">{(s.produces ?? []).map((p) => p.kind).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {task ? <TaskDetail id={task} onClose={() => setTask(null)} onChanged={() => void run.refresh()} /> : null}
    </div>
  );
}
