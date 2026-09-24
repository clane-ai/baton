import React, { useMemo } from 'react';

import { useT } from '../../../../i18n';
import type { WorkflowRun, WorkflowRunStep } from '../data/types';
import { dsStatus } from '../lib/theme';
import { stripProcess } from '../lib/inbox';

// A BPMN-style view of one run: a swimlane per role, start and end events,
// each step as a task shape (an operator step as a user task), sequence flows
// along depends_on, exclusive gateways for conditional branches, and the live
// state of every step in the Clane status palette. Ported from
// packages/dash RunGraph; every colour is a design-system token.

const STROKE: Record<string, string> = {
  done: 'var(--green-600)',
  running: 'var(--amber-500)',
  needsYou: 'var(--blue-500)',
  failed: 'var(--red-500)',
};
const FILL: Record<string, string> = {
  done: 'var(--green-tint)',
  running: 'var(--bg-well)',
  needsYou: 'var(--blue-tint)',
  failed: 'var(--red-tint)',
};
const strokeOf = (state: string): string => STROKE[dsStatus(state)] ?? 'var(--text-faint)';
const fillOf = (state: string): string => FILL[dsStatus(state)] ?? 'var(--bg-page)';

const TAKEN = 'var(--text-tertiary)';
const UNTAKEN = 'var(--border-mid)';
const LANE_H = 110;
const LANE_LABEL_W = 120;
const COL_W = 230;
const NODE_W = 170;
const NODE_H = 62;
const PAD_L = 24;
const PAD_T = 44;
const EVENT_R = 16;

type Placed = { s: WorkflowRunStep; col: number; lane: number; x: number; y: number };

function layers(steps: WorkflowRunStep[]): Map<string, number> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const s = byId.get(id);
    const d = s
      ? Math.max(-1, ...(s.depends_on ?? []).filter((p) => byId.has(p)).map((p) => depth(p, seen))) + 1
      : 0;
    memo.set(id, d);
    return d;
  };
  for (const s of steps) depth(s.id);
  return memo;
}

const label = { fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--text-tertiary)' } as const;

export function RunGraph({ run }: { run: WorkflowRun }): JSX.Element {
  const { t } = useT();
  const steps = run.steps ?? [];
  const model = useMemo(() => {
    const L = layers(steps);
    const lanes: string[] = [];
    for (const s of [...steps].sort((a, b) => (L.get(a.id) ?? 0) - (L.get(b.id) ?? 0))) {
      if (!lanes.includes(s.role)) lanes.push(s.role);
    }
    const cols = Math.max(1, ...steps.map((s) => (L.get(s.id) ?? 0) + 1));
    const placed: Placed[] = steps.map((s) => {
      const col = L.get(s.id) ?? 0;
      const lane = lanes.indexOf(s.role);
      return {
        s,
        col,
        lane,
        x: PAD_L + LANE_LABEL_W + 60 + col * COL_W,
        y: PAD_T + lane * LANE_H + (LANE_H - NODE_H) / 2,
      };
    });
    const width = PAD_L + LANE_LABEL_W + 60 + cols * COL_W + 60 + PAD_L;
    const height = PAD_T + Math.max(1, lanes.length) * LANE_H + 16;
    const startLane = placed.find((p) => p.col === 0)?.lane ?? 0;
    const lastCol = cols - 1;
    const endLane = placed.find((p) => p.col === lastCol)?.lane ?? startLane;
    const start = { x: PAD_L + LANE_LABEL_W + 20, y: PAD_T + startLane * LANE_H + LANE_H / 2 };
    const end = { x: PAD_L + LANE_LABEL_W + 60 + cols * COL_W + 20, y: PAD_T + endLane * LANE_H + LANE_H / 2 };
    return { lanes, placed, width, height, start, end, lastCol };
  }, [steps]);

  const byId = new Map(model.placed.map((p) => [p.s.id, p]));
  const flow = (x1: number, y1: number, x2: number, y2: number): string => {
    if (Math.abs(y1 - y2) < 1) return `M${x1},${y1} L${x2},${y2}`;
    const mx = x1 + (x2 - x1) / 2;
    return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
  };
  const edge = (d: string, taken: boolean, key: string): JSX.Element => (
    <path
      key={key}
      d={d}
      fill="none"
      stroke={taken ? TAKEN : UNTAKEN}
      strokeWidth={taken ? 1.8 : 1.4}
      strokeDasharray={taken ? undefined : '6 4'}
      markerEnd={taken ? 'url(#wf-arrow)' : 'url(#wf-arrow-light)'}
      data-flow={taken ? 'taken' : 'not-taken'}
    />
  );
  const doneEnd = steps.length > 0 && steps.every((s) => s.state === 'done' || (s.state === 'cancelled' && !!s.condition));
  const title = t('workflow.graph.title', {
    name: run.workflow_name ?? run.key,
    run: run.key,
    status: run.status.replace(/_/g, ' '),
  });

  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <svg
        role="img"
        aria-label={title}
        width={model.width}
        height={model.height}
        viewBox={`0 0 ${model.width} ${model.height}`}
        style={{ display: 'block' }}
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={TAKEN} />
          </marker>
          <marker id="wf-arrow-light" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={UNTAKEN} />
          </marker>
        </defs>
        <text x={PAD_L + 10} y={PAD_T - 12} style={{ ...label, fontSize: 11.5, fill: 'var(--text-secondary)' }}>
          {title}
        </text>
        {model.lanes.map((lane, i) => (
          <g key={lane} data-lane={lane}>
            <rect
              x={PAD_L}
              y={PAD_T + i * LANE_H}
              width={model.width - PAD_L * 2}
              height={LANE_H}
              fill={i % 2 ? 'var(--bg-page)' : 'var(--surface-card)'}
              stroke="var(--border-subtle)"
            />
            <rect
              x={PAD_L}
              y={PAD_T + i * LANE_H}
              width={LANE_LABEL_W}
              height={LANE_H}
              fill="var(--bg-well)"
              stroke="var(--border-subtle)"
            />
            <text
              x={PAD_L + LANE_LABEL_W / 2}
              y={PAD_T + i * LANE_H + LANE_H / 2 + 4}
              textAnchor="middle"
              style={{ ...label, fill: 'var(--text-secondary)' }}
            >
              {lane === 'operator' ? t('workflow.graph.person') : lane}
            </text>
          </g>
        ))}

        {[...new Set(model.placed.filter((p) => p.s.condition).map((p) => p.s.condition!.task))].map((decId) => {
          const dec = byId.get(decId);
          if (!dec) return null;
          const branches = model.placed.filter((p) => p.s.condition?.task === decId);
          const gx = dec.x + NODE_W + 34;
          const gy = dec.y + NODE_H / 2;
          const D = 18;
          const decided = dec.s.state === 'done';
          return (
            <g key={`gw-${decId}`}>
              <path d={`M${dec.x + NODE_W},${gy} L${gx - D},${gy}`} fill="none" stroke={decided ? TAKEN : UNTAKEN} strokeWidth={1.6} />
              <polygon
                points={`${gx},${gy - D} ${gx + D},${gy} ${gx},${gy + D} ${gx - D},${gy}`}
                fill="var(--surface-card)"
                stroke="var(--amber-500)"
                strokeWidth={1.6}
              />
              <text x={gx} y={gy + 4} textAnchor="middle" style={{ ...label, fontSize: 14, fill: 'var(--ink)' }}>
                ×
              </text>
              {branches.map((b) => {
                const taken = decided && b.s.state !== 'cancelled';
                const d = `M${gx + D},${gy} L${gx + D + 20},${gy} L${gx + D + 20},${b.y + NODE_H / 2} L${b.x},${b.y + NODE_H / 2}`;
                return (
                  <g key={b.s.id}>
                    {edge(d, taken, `br-${b.s.id}`)}
                    <text x={gx + D + 26} y={b.y + NODE_H / 2 - 6} style={label}>
                      {b.s.condition?.outcome ?? b.s.condition?.equals}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {model.placed
          .filter((p) => p.col === 0)
          .map((p) => edge(flow(model.start.x + EVENT_R, model.start.y, p.x, p.y + NODE_H / 2), true, `s-${p.s.id}`))}
        {model.placed.flatMap((p) =>
          (p.s.depends_on ?? []).map((d) => {
            const a = byId.get(d);
            if (!a || p.s.condition?.task === d) return null;
            return edge(flow(a.x + NODE_W, a.y + NODE_H / 2, p.x, p.y + NODE_H / 2), a.s.state === 'done', `${d}>${p.s.id}`);
          }),
        )}
        {model.placed
          .filter((p) => p.col === model.lastCol)
          .map((p) =>
            edge(
              flow(p.x + NODE_W, p.y + NODE_H / 2, model.end.x - EVENT_R, model.end.y),
              p.s.state === 'done',
              `e-${p.s.id}`,
            ),
          )}

        <circle cx={model.start.x} cy={model.start.y} r={EVENT_R} fill="var(--surface-card)" stroke={TAKEN} strokeWidth={1.6} />
        <text x={model.start.x} y={model.start.y + EVENT_R + 14} textAnchor="middle" style={label}>
          {t('workflow.graph.start')}
        </text>

        {model.placed.map((p) => {
          const s = p.s;
          const human = s.role === 'operator';
          const active = s.state === 'in_progress' || s.state === 'review';
          const meta = [
            s.state.replace(/_/g, ' '),
            s.assignee,
            s.cost_credits ? `${Number(s.cost_credits).toFixed(0)} cr` : null,
            Number(s.cost_usd) > 0 ? `$${Number(s.cost_usd).toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`} opacity={s.state === 'cancelled' ? 0.55 : 1}>
              <title>{`${s.key} · ${stripProcess(s.title)} · ${meta}`}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={human ? 6 : 10}
                fill={fillOf(s.state)}
                stroke={strokeOf(s.state)}
                strokeWidth={active ? 2.4 : 1.6}
              />
              {human ? (
                <g transform="translate(8,7)" fill="none" stroke="var(--text-secondary)" strokeWidth={1.4}>
                  <circle cx={6} cy={4} r={3} />
                  <path d="M0.5,13 C0.5,9 11.5,9 11.5,13" />
                </g>
              ) : (
                <g transform="translate(8,7)" fill="none" stroke="var(--text-secondary)" strokeWidth={1.4}>
                  <circle cx={6} cy={6} r={3} />
                  <path d="M6,0 V2 M6,10 V12 M0,6 H2 M10,6 H12" />
                </g>
              )}
              <text x={26} y={18} style={{ ...label, fill: 'var(--text-secondary)' }}>
                {s.key}
              </text>
              <text x={10} y={38} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 500, fill: 'var(--ink)' }}>
                {stripProcess(s.title).slice(0, 26)}
              </text>
              <text x={10} y={53} style={{ ...label, fontSize: 10.5 }}>
                {meta.slice(0, 34)}
              </text>
            </g>
          );
        })}

        <circle
          cx={model.end.x}
          cy={model.end.y}
          r={EVENT_R}
          fill={doneEnd ? 'var(--green-tint)' : 'var(--surface-card)'}
          stroke={TAKEN}
          strokeWidth={3.2}
        />
        <text x={model.end.x} y={model.end.y + EVENT_R + 14} textAnchor="middle" style={label}>
          {doneEnd ? t('workflow.graph.done') : t('workflow.graph.end')}
        </text>
      </svg>
    </div>
  );
}
