"use client";

// Flow: the process as a graph. Stages (roles, in pipeline order) across the top with their
// counts, and below them every task as a node, connected by what it waits on: explicit
// dependencies, artefacts it consumes from a named task, or (dashed) artefacts by kind
// from whichever task produces them. Layout is layered left to right by longest path.
import { useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import type { RolesResponse, Task, TasksResponse, TaskState } from "@/lib/types";
import { usd } from "@/lib/format";
import { ErrorBox } from "./ui";
import TaskDetail from "./TaskDetail";

/** Pipeline order for the stage bar; roles not listed follow, alphabetically. */
const PROCESS_ORDER = ["analyst", "ui-designer", "backend-dev", "frontend-dev", "ai-dev", "qa", "reviewer"];

const STATE_FILL: Record<TaskState, string> = {
  draft: "#f1f3f5", ready: "#e7f5ff", blocked: "#fff4e6", in_progress: "#ebfbee",
  review: "#f3f0ff", done: "#e6fcf5", needs_human: "#fff5f5", cancelled: "#f8f9fa",
};
const STATE_STROKE: Record<TaskState, string> = {
  draft: "#dee2e6", ready: "#74c0fc", blocked: "#ffa94d", in_progress: "#69db7c",
  review: "#b197fc", done: "#63e6be", needs_human: "#ff8787", cancelled: "#e9ecef",
};

type Edge = { from: string; to: string; label: string; inferred: boolean };
type Node = { t: Task; layer: number; row: number; x: number; y: number };

const NODE_W = 196, NODE_H = 58, GAP_X = 70, GAP_Y = 18, PAD = 16;

function edgesFor(tasks: Task[]): Edge[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const producers = new Map<string, Task[]>();
  for (const t of tasks) for (const p of t.produces ?? []) {
    const k = typeof p === "string" ? p : p.kind;
    if (!producers.has(k)) producers.set(k, []);
    producers.get(k)!.push(t);
  }
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const add = (e: Edge) => { const k = `${e.from}>${e.to}:${e.label}`; if (!seen.has(k) && e.from !== e.to && byId.has(e.from)) { seen.add(k); edges.push(e); } };
  for (const t of tasks) {
    for (const d of t.depends_on ?? []) add({ from: d, to: t.id, label: "", inferred: false });
    for (const c of t.consumes ?? []) {
      const kind = typeof c === "string" ? c : c.kind;
      const from = typeof c === "string" ? null : c.from_task;
      if (from) add({ from, to: t.id, label: kind, inferred: false });
      else {
        // No named source: the nearest earlier producer of that kind, if any.
        const cands = (producers.get(kind) ?? []).filter((p) => p.id !== t.id && p.created_at <= t.created_at && p.state !== "cancelled");
        const p = cands.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (p) add({ from: p.id, to: t.id, label: kind, inferred: true });
      }
    }
    if (t.parent_task) add({ from: t.parent_task, to: t.id, label: "split", inferred: false });
  }
  return edges;
}

function layout(tasks: Task[], edges: Edge[], roleRank: (r: string) => number): { nodes: Node[]; width: number; height: number } {
  const ids = new Set(tasks.map((t) => t.id));
  const preds = new Map<string, string[]>();
  for (const t of tasks) preds.set(t.id, []);
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) preds.get(e.to)!.push(e.from);
  // Longest-path layering with cycle protection.
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...preds.get(id)!.map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const t of tasks) depth(t.id);
  const cols = new Map<number, Task[]>();
  for (const t of tasks) { const l = layer.get(t.id) ?? 0; if (!cols.has(l)) cols.set(l, []); cols.get(l)!.push(t); }
  const nodes: Node[] = [];
  let maxRows = 0;
  for (const [l, list] of cols) {
    list.sort((a, b) => roleRank(a.role) - roleRank(b.role) || b.priority - a.priority || a.key.localeCompare(b.key));
    list.forEach((t, i) => nodes.push({ t, layer: l, row: i, x: PAD + l * (NODE_W + GAP_X), y: PAD + i * (NODE_H + GAP_Y) }));
    maxRows = Math.max(maxRows, list.length);
  }
  const layers = cols.size;
  return { nodes, width: PAD * 2 + layers * NODE_W + Math.max(0, layers - 1) * GAP_X, height: PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * GAP_Y };
}

function path(a: Node, b: Node): string {
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
  if (x2 <= x1) { // backwards or same column: route around
    const dx = 40;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export default function FlowView() {
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const roles = usePoll<RolesResponse>("/api/roles", 60000);
  const tasks = usePoll<TasksResponse>("/api/tasks", 5000);

  const stages = useMemo(() => {
    const names = new Set<string>((roles.data?.roles ?? []).map((r) => r.name));
    for (const t of tasks.data?.tasks ?? []) names.add(t.role);
    const extra = [...names].filter((n) => !PROCESS_ORDER.includes(n)).sort();
    return [...PROCESS_ORDER.filter((n) => names.has(n)), ...extra];
  }, [roles.data, tasks.data]);
  const roleRank = (r: string) => { const i = stages.indexOf(r); return i < 0 ? 99 : i; };

  const all = tasks.data?.tasks ?? [];
  const visible = useMemo(() => (showClosed ? all : all.filter((t) => t.state !== "done" && t.state !== "cancelled")), [all, showClosed]);
  const edges = useMemo(() => edgesFor(all).filter((e) => visible.some((t) => t.id === e.from) && visible.some((t) => t.id === e.to)), [all, visible]);
  const g = useMemo(() => layout(visible, edges, roleRank), [visible, edges, stages]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = new Map(g.nodes.map((n) => [n.t.id, n]));

  const stageCounts = useMemo(() => {
    const m = new Map<string, Partial<Record<TaskState, number>>>();
    for (const t of all) { const c = m.get(t.role) ?? {}; c[t.state] = (c[t.state] ?? 0) + 1; m.set(t.role, c); }
    return m;
  }, [all]);

  return (
    <div>
      <div className="view-head">
        <h2>Flow</h2>
        <label className="lbl">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show done and cancelled
        </label>
        <span className="muted">{visible.length} tasks, {edges.length} links</span>
        <span className="spacer" />
        <span className="muted">solid: dependency or named artefact, dashed: artefact matched by kind</span>
      </div>
      <ErrorBox error={tasks.error} />

      <div className="stages">
        {stages.map((r, i) => {
          const c = stageCounts.get(r) ?? {};
          const active = (c.in_progress ?? 0) + (c.review ?? 0);
          const waiting = (c.ready ?? 0) + (c.blocked ?? 0) + (c.needs_human ?? 0);
          return (
            <div key={r} className="stage-wrap">
              {i > 0 ? <span className="stage-arrow">→</span> : null}
              <div className={`stage${active ? " active" : ""}`}>
                <div className="stage-name">{r}</div>
                <div className="stage-counts">
                  <span className="badge st-in_progress" title="in progress or review">{active}</span>
                  <span className="badge st-ready" title="ready, blocked or needs a human">{waiting}</span>
                  <span className="badge st-done" title="done">{c.done ?? 0}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="empty">No open tasks. Tick "show done and cancelled" to see the history as a graph.</div>
      ) : (
        <div className="flow-scroll">
          <svg className="flow" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#b9b9b0" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = pos.get(e.from), b = pos.get(e.to);
              if (!a || !b) return null;
              const d = path(a, b);
              const mx = (a.x + NODE_W + b.x) / 2, my = (a.y + b.y + NODE_H) / 2;
              return (
                <g key={`${e.from}>${e.to}:${e.label}`}>
                  <path d={d} fill="none" stroke="#b9b9b0" strokeWidth={1.4} strokeDasharray={e.inferred ? "5 4" : undefined} markerEnd="url(#arrow)" />
                  {e.label ? (
                    <text x={mx} y={my - 4} textAnchor="middle" className="flow-label">{e.label}</text>
                  ) : null}
                </g>
              );
            })}
            {g.nodes.map((n) => {
              const t = n.t;
              const over = t.budget_usd != null && (t.cost_usd ?? 0) > t.budget_usd;
              return (
                <g key={t.id} transform={`translate(${n.x},${n.y})`} className={`flow-node${selected === t.id ? " selected" : ""}`} onClick={() => setSelected(t.id)} style={{ cursor: "pointer" }}>
                  <rect width={NODE_W} height={NODE_H} rx={6} fill={STATE_FILL[t.state]} stroke={selected === t.id ? "#1f5fbf" : STATE_STROKE[t.state]} strokeWidth={selected === t.id ? 2 : 1.2} />
                  <text x={10} y={17} className="flow-key">{t.key}</text>
                  <text x={NODE_W - 10} y={17} textAnchor="end" className="flow-state">{t.state.replace("_", " ")}</text>
                  <text x={10} y={34} className="flow-title">{t.title.length > 30 ? t.title.slice(0, 29) + "…" : t.title}</text>
                  <text x={10} y={49} className="flow-meta">
                    {t.role}{t.assignee_name ? ` · @${t.assignee_name}` : ""}{t.attempts ? ` · att ${t.attempts}/${t.max_attempts}` : ""}
                  </text>
                  {(t.cost_usd ?? 0) > 0 ? (
                    <text x={NODE_W - 10} y={49} textAnchor="end" className={`flow-meta${over ? " over" : ""}`}>{usd(t.cost_usd)}</text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {selected ? <TaskDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void tasks.refresh()} /> : null}
    </div>
  );
}
