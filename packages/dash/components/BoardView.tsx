"use client";

import { useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { TASK_STATES, type RolesResponse, type Task, type TasksResponse, type TaskState } from "@/lib/types";
import { usd } from "@/lib/format";
import { ErrorBox } from "./ui";
import TaskDetail from "./TaskDetail";

function Card({ t, selected, onClick }: { t: Task; selected: boolean; onClick: () => void }) {
  const over = t.budget_usd != null && (t.cost_usd ?? 0) > t.budget_usd;
  return (
    <button type="button" className={`card${selected ? " selected" : ""}`} onClick={onClick}>
      <div className="key">
        <span>{t.key}</span>
        <span title="priority">p{t.priority}</span>
      </div>
      <div className="title">{t.title}</div>
      <div className="foot">
        <span>{t.role}</span>
        {t.assignee_name ? <span>@{t.assignee_name}</span> : null}
        {t.attempts > 0 ? <span>att {t.attempts}/{t.max_attempts}</span> : null}
        {(t.cost_usd ?? 0) > 0 || t.budget_usd != null ? (
          <span className={over ? "over" : ""}>
            {usd(t.cost_usd)}
            {t.budget_usd != null ? ` / ${usd(t.budget_usd)}` : ""}
          </span>
        ) : null}
        {t.depends_on?.length ? <span title="depends on">deps {t.depends_on.length}</span> : null}
      </div>
    </button>
  );
}

export default function BoardView() {
  const [role, setRole] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const roles = usePoll<RolesResponse>("/api/roles", 60000);
  const url = `/api/tasks${role ? `?role=${encodeURIComponent(role)}` : ""}`;
  const tasks = usePoll<TasksResponse>(url, 5000);

  const byState = useMemo(() => {
    const m: Record<TaskState, Task[]> = {
      draft: [], ready: [], blocked: [], in_progress: [], review: [], done: [], needs_human: [], cancelled: [], failed: [],
    };
    for (const t of tasks.data?.tasks ?? []) (m[t.state] ?? (m[t.state] = [])).push(t);
    for (const k of TASK_STATES) m[k].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
    return m;
  }, [tasks.data]);

  const roleNames = useMemo(() => {
    const s = new Set<string>((roles.data?.roles ?? []).map((r) => r.name));
    for (const t of tasks.data?.tasks ?? []) s.add(t.role);
    return [...s].sort();
  }, [roles.data, tasks.data]);

  return (
    <div>
      <div className="view-head">
        <h2>Board</h2>
        <label className="lbl">
          role{" "}
          <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">all roles</option>
            {roleNames.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{tasks.data?.tasks.length ?? 0} tasks</span>
      </div>
      <ErrorBox error={tasks.error} />
      <div className="board">
        {TASK_STATES.map((s) => (
          <div key={s} className="col">
            <div className="col-h">
              <span className={`badge st-${s}`}>{s}</span>
              <span className="n">{byState[s].length}</span>
            </div>
            <div className="col-b">
              {byState[s].map((t) => (
                <Card key={t.id} t={t} selected={selected === t.id} onClick={() => setSelected(t.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected ? <TaskDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void tasks.refresh()} /> : null}
    </div>
  );
}
