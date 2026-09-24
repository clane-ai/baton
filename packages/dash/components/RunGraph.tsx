"use client";

// A BPMN-style view of one workflow run: one swimlane per role, a start and an end event,
// each step as a task shape (an operator step as a user task), sequence flows following
// depends_on, and the live state of every step. Polled by the parent, so it moves as the run runs.
import { useMemo } from "react";
import type { TaskState, WorkflowRun, WorkflowRunStep } from "@/lib/types";

const FILL: Record<TaskState, string> = {
  draft: "var(--info-soft)", ready: "var(--info-soft)", blocked: "var(--working-soft)", in_progress: "var(--working-soft)",
  review: "var(--working-soft)", done: "var(--done-soft)", needs_human: "var(--waiting-soft)", cancelled: "var(--neutral-soft)", failed: "var(--stuck-soft)",
};
const STROKE: Record<TaskState, string> = {
  draft: "var(--info)", ready: "var(--info)", blocked: "var(--working)", in_progress: "var(--working)",
  review: "var(--working)", done: "var(--done)", needs_human: "var(--waiting)", cancelled: "var(--neutral)", failed: "var(--stuck)",
};

const LANE_H = 110, LANE_LABEL_W = 120, COL_W = 230, NODE_W = 170, NODE_H = 62, PAD_L = 24, PAD_T = 44, EVENT_R = 16;

type Placed = { s: WorkflowRunStep; col: number; lane: number; x: number; y: number };

function layers(steps: WorkflowRunStep[]): Map<string, number> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const s = byId.get(id);
    const d = s ? Math.max(-1, ...(s.depends_on ?? []).filter((p) => byId.has(p)).map((p) => depth(p, seen))) + 1 : 0;
    memo.set(id, d);
    return d;
  };
  for (const s of steps) depth(s.id);
  return memo;
}

function Icon({ kind, x, y }: { kind: "user" | "check" | "pause" | "gear"; x: number; y: number }) {
  if (kind === "user") return <g transform={`translate(${x},${y})`} fill="none" stroke="var(--ink-2)" strokeWidth={1.4}><circle cx={6} cy={4} r={3} /><path d="M0.5,13 C0.5,9 11.5,9 11.5,13" /></g>;
  if (kind === "check") return <path transform={`translate(${x},${y})`} d="M1,6 L4.5,9.5 L11,2" fill="none" stroke="var(--done-ink)" strokeWidth={2} />;
  if (kind === "pause") return <g transform={`translate(${x},${y})`} fill="var(--waiting)"><rect x={2} y={1} width={3} height={10} /><rect x={7} y={1} width={3} height={10} /></g>;
  return <g transform={`translate(${x},${y})`} fill="none" stroke="var(--ink-2)" strokeWidth={1.4}><circle cx={6} cy={6} r={3} /><path d="M6,0 V2 M6,10 V12 M0,6 H2 M10,6 H12 M1.8,1.8 L3.2,3.2 M8.8,8.8 L10.2,10.2 M1.8,10.2 L3.2,8.8 M8.8,3.2 L10.2,1.8" /></g>;
}

export default function RunGraph({ run }: { run: WorkflowRun }) {
  const steps = run.steps ?? [];
  const model = useMemo(() => {
    const L = layers(steps);
    const lanes: string[] = [];
    for (const s of [...steps].sort((a, b) => (L.get(a.id) ?? 0) - (L.get(b.id) ?? 0))) if (!lanes.includes(s.role)) lanes.push(s.role);
    const cols = Math.max(1, ...steps.map((s) => (L.get(s.id) ?? 0) + 1));
    const placed: Placed[] = steps.map((s) => {
      const col = L.get(s.id) ?? 0; const lane = lanes.indexOf(s.role);
      return { s, col, lane, x: PAD_L + LANE_LABEL_W + 60 + col * COL_W, y: PAD_T + lane * LANE_H + (LANE_H - NODE_H) / 2 };
    });
    const width = PAD_L + LANE_LABEL_W + 60 + cols * COL_W + 60 + PAD_L;
    const height = PAD_T + Math.max(1, lanes.length) * LANE_H + 16;
    const startLane = placed.find((p) => p.col === 0)?.lane ?? 0;
    const lastCol = cols - 1;
    const endLane = placed.find((p) => p.col === lastCol)?.lane ?? startLane;
    const start = { x: PAD_L + LANE_LABEL_W + 20, y: PAD_T + startLane * LANE_H + LANE_H / 2 };
    const end = { x: PAD_L + LANE_LABEL_W + 60 + cols * COL_W + 20, y: PAD_T + endLane * LANE_H + LANE_H / 2 };
    return { L, lanes, cols, placed, width, height, start, end, lastCol };
  }, [steps]);

  const byId = new Map(model.placed.map((p) => [p.s.id, p]));
  const flow = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(y1 - y2) < 1) return `M${x1},${y1} L${x2},${y2}`;
    const mx = x1 + (x2 - x1) / 2;
    return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
  };
  const doneEnd = steps.length > 0 && steps.every((s) => s.state === "done" || (s.state === "cancelled" && !!s.condition));
  const status = run.status;

  return (
    <div className="flow-scroll">
      <svg className="flow bpmn" width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`}>
        <defs>
          <marker id="bpmn-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-2)" /></marker>
          <marker id="bpmn-arrow-light" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--border-2)" /></marker>
        </defs>
        <rect x={PAD_L} y={PAD_T - 30} width={model.width - PAD_L * 2} height={model.height - PAD_T + 20} fill="none" stroke="var(--border-2)" />
        <text x={PAD_L + 10} y={PAD_T - 12} className="bpmn-pool">{run.workflow_name ?? run.key} · run {run.key} · {status.replace("_", " ")}</text>
        {model.lanes.map((lane, i) => (
          <g key={lane}>
            <rect x={PAD_L} y={PAD_T + i * LANE_H} width={model.width - PAD_L * 2} height={LANE_H} fill={i % 2 ? "var(--surface-2)" : "var(--surface)"} stroke="var(--border)" />
            <rect x={PAD_L} y={PAD_T + i * LANE_H} width={LANE_LABEL_W} height={LANE_H} fill="var(--surface-2)" stroke="var(--border)" />
            <text x={PAD_L + LANE_LABEL_W / 2} y={PAD_T + i * LANE_H + LANE_H / 2 + 4} textAnchor="middle" className="bpmn-lane">{lane === "operator" ? "operator (human)" : lane}</text>
          </g>
        ))}

        {/* gateways: one diamond per deciding step that has conditional dependants */}
        {[...new Set(model.placed.filter((p) => p.s.condition).map((p) => p.s.condition!.task))].map((decId) => {
          const dec = byId.get(decId); if (!dec) return null;
          const branches = model.placed.filter((p) => p.s.condition?.task === decId);
          const gx = dec.x + NODE_W + 34, gy = dec.y + NODE_H / 2, D = 18;
          const decided = dec.s.state === "done";
          return (
            <g key={`gw-${decId}`}>
              <path d={`M${dec.x + NODE_W},${gy} L${gx - D},${gy}`} fill="none" stroke={decided ? "var(--ink-2)" : "var(--border-2)"} strokeWidth={1.6} />
              <polygon points={`${gx},${gy - D} ${gx + D},${gy} ${gx},${gy + D} ${gx - D},${gy}`} fill="var(--working-soft)" stroke="var(--working)" strokeWidth={1.6} />
              <text x={gx} y={gy + 4} textAnchor="middle" className="bpmn-gw">×</text>
              {branches.map((b) => {
                const taken = decided && b.s.state !== "cancelled";
                const path = `M${gx + D},${gy} L${gx + D + 20},${gy} L${gx + D + 20},${b.y + NODE_H / 2} L${b.x},${b.y + NODE_H / 2}`;
                return (
                  <g key={b.s.id}>
                    <path d={path} fill="none" stroke={taken ? "var(--ink-2)" : "var(--border-2)"} strokeWidth={taken ? 1.8 : 1.4} strokeDasharray={taken ? undefined : "6 4"} markerEnd={taken ? "url(#bpmn-arrow)" : "url(#bpmn-arrow-light)"} />
                    <text x={gx + D + 26} y={b.y + NODE_H / 2 - 6} className="bpmn-small">{b.s.condition?.outcome ?? b.s.condition?.equals}</text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* sequence flows */}
        {model.placed.filter((p) => p.col === 0).map((p) => (
          <path key={`s-${p.s.id}`} d={flow(model.start.x + EVENT_R, model.start.y, p.x, p.y + NODE_H / 2)} fill="none" stroke="var(--ink-2)" strokeWidth={1.6} markerEnd="url(#bpmn-arrow)" />
        ))}
        {model.placed.flatMap((p) => (p.s.depends_on ?? []).map((d) => {
          const a = byId.get(d); if (!a) return null;
          if (p.s.condition?.task === d) return null; // drawn through the gateway
          const taken = a.s.state === "done";
          return <path key={`${d}>${p.s.id}`} d={flow(a.x + NODE_W, a.y + NODE_H / 2, p.x, p.y + NODE_H / 2)} fill="none" stroke={taken ? "var(--ink-2)" : "var(--border-2)"} strokeWidth={taken ? 1.8 : 1.4} strokeDasharray={taken ? undefined : "6 4"} markerEnd={taken ? "url(#bpmn-arrow)" : "url(#bpmn-arrow-light)"} />;
        }))}
        {model.placed.filter((p) => p.col === model.lastCol).map((p) => (
          <path key={`e-${p.s.id}`} d={flow(p.x + NODE_W, p.y + NODE_H / 2, model.end.x - EVENT_R, model.end.y)} fill="none" stroke={p.s.state === "done" ? "var(--ink-2)" : "var(--border-2)"} strokeWidth={1.6} strokeDasharray={p.s.state === "done" ? undefined : "6 4"} markerEnd={p.s.state === "done" ? "url(#bpmn-arrow)" : "url(#bpmn-arrow-light)"} />
        ))}

        {/* start event */}
        <circle cx={model.start.x} cy={model.start.y} r={EVENT_R} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={1.6} />
        <text x={model.start.x} y={model.start.y + EVENT_R + 14} textAnchor="middle" className="bpmn-small">start</text>

        {/* tasks */}
        {model.placed.map((p) => {
          const s = p.s; const human = s.role === "operator";
          const active = s.state === "in_progress" || s.state === "review";
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`} className={active ? "bpmn-active" : ""}>
              <rect width={NODE_W} height={NODE_H} rx={human ? 6 : 10} fill={FILL[s.state]} stroke={STROKE[s.state]} strokeWidth={active ? 2.4 : 1.6} opacity={s.state === "cancelled" ? 0.55 : 1} />
              {human ? <Icon kind="user" x={8} y={7} /> : <Icon kind="gear" x={8} y={7} />}
              {s.state === "done" ? <Icon kind="check" x={NODE_W - 20} y={8} /> : null}
              {s.state === "needs_human" ? <Icon kind="pause" x={NODE_W - 20} y={8} /> : null}
              <text x={26} y={18} className="flow-key">{s.key}</text>
              <text x={10} y={38} className="flow-title">{(s.title.replace(/^[^:]+:\s*/, "")).slice(0, 26)}</text>
              <text x={10} y={53} className="flow-meta">{s.state.replace("_", " ")}{s.assignee ? ` · ${s.assignee}` : ""}{s.cost_credits ? ` · ${Number(s.cost_credits).toFixed(0)} cr` : ""}{Number(s.cost_usd) > 0 ? ` · $${Number(s.cost_usd).toFixed(2)}` : ""}</text>
            </g>
          );
        })}

        {/* end event */}
        <circle cx={model.end.x} cy={model.end.y} r={EVENT_R} fill={doneEnd ? "var(--done-soft)" : "var(--surface)"} stroke="var(--ink-2)" strokeWidth={3.2} />
        <text x={model.end.x} y={model.end.y + EVENT_R + 14} textAnchor="middle" className="bpmn-small">{doneEnd ? "done" : "end"}</text>
      </svg>
    </div>
  );
}
