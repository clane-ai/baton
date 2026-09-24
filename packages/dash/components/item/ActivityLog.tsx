"use client";

// A task's or run's history as sentences a person can read, newest first. Noise (tool calls,
// heartbeats, prompts) is hidden behind a toggle.
import { useState } from "react";
import type { TaskEvent } from "@/lib/types";
import { usd } from "@/lib/format";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown) => (v == null ? "" : String(v));

export const NOISE = new Set(["tool", "heartbeat", "prompt", "turn_end", "progress", "tool_batch", "tool_failure"]);

export function sentence(e: { type: string; payload: unknown; agent?: string | null }): string {
  const p = o(e.payload);
  const who = e.agent ?? "";
  switch (e.type) {
    case "task_created": return `Step created${p.actor ? ` by ${s(p.actor)}` : ""}`;
    case "task_state_changed": return `${s(p.from).replace(/_/g, " ")} → ${s(p.to).replace(/_/g, " ")}${p.actor ? ` (${s(p.actor)})` : ""}`;
    case "task_claimed": return `${who || "An agent"} claimed it (attempt ${s(p.attempts)})`;
    case "task_submitted": return `${who || "The agent"} submitted it for the gate`;
    case "artifact_registered": return `${s(p.kind).replace(/_/g, " ")} registered`;
    case "artifact_rejected": return `${s(p.kind).replace(/_/g, " ")} rejected by the schema: ${s(p.errors)}`;
    case "gate_passed": return "Passed its gate";
    case "gate_failed": return `Gate failed: missing ${(Array.isArray(p.missing) ? p.missing : []).join(", ") || "nothing"}; ${(Array.isArray(p.problems) ? p.problems : []).join("; ") || "no problems"}`;
    case "approval_required": return "Waiting for a person";
    case "approval_overdue": return `Approval overdue by ${s(p.waiting_minutes)} min`;
    case "approved": return `Approved by ${s(p.by)}${p.reason ? `: ${s(p.reason)}` : ""}`;
    case "rejected": return `Rejected by ${s(p.by)}${p.reason ? `: ${s(p.reason)}` : ""}`;
    case "task_retried": return `Put back in the queue by ${s(p.by)}${p.reason ? `: ${s(p.reason)}` : ""}`;
    case "task_cancelled": return `Cancelled by ${s(p.by)}${p.reason ? `: ${s(p.reason)}` : ""}`;
    case "branch_not_taken": return `Not taken: ${s(p.decided_by)} decided "${s(p.outcome_required)}" was not the outcome`;
    case "cancelled_upstream": return `Cancelled because ${s(p.because)} was cancelled`;
    case "deadline_passed": return "Deadline passed";
    case "budget_exceeded": return `Budget exceeded: ${usd(Number(p.cost_usd))} of ${usd(Number(p.budget_usd))}`;
    case "lease_expired": return `Lease expired after ${s(p.attempts)} of ${s(p.max_attempts)} attempts`;
    case "task_released": return `Released: ${s(p.reason)}`;
    case "task_asked": return `Asked ${p.to_role ? s(p.to_role) : "a person"}: ${s(p.question)}`;
    case "question_answered": return `Question answered by ${s(p.by)}`;
    case "task_delegated": return `Delegated ${s(p.child_key)} to ${s(p.role)}`;
    case "delegation_returned": return `${s(p.child_key)} came back done`;
    case "session_start": return `${who || "Agent"} session started`;
    case "session_end": return `Session ended (${s(p.reason)})`;
    case "workflow_run_finished": return `Run ${s(p.run)} finished: ${s(p.status)}`;
    case "no_lease": return `Write denied, no lease (${s(p.tool)} ${s(p.path)})`;
    case "scope_violation": return `Write denied, outside scope: ${s(p.path)}`;
    case "tool_rejected": return `Call rejected: ${s(p.code)}`;
    default: return e.type.replace(/_/g, " ");
  }
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export default function ActivityLog({ events, showKeys }: { events: (TaskEvent & { task_key?: string | null })[]; showKeys?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = [...events].filter((e) => all || !NOISE.has(e.type)).sort((a, b) => b.ts.localeCompare(a.ts));
  const hidden = events.length - rows.length;
  if (!events.length) return <div className="muted">Nothing has happened yet.</div>;
  let lastDay = "";
  return (
    <div className="log">
      {rows.map((e) => {
        const day = dayOf(e.ts);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={String(e.id)}>
            {showDay ? <div className="log-day">{day}</div> : null}
            <div className="log-row">
              <span className="t mono">{hhmmss(e.ts)}</span>
              <span className="what">{showKeys && e.task_key ? <span className="mono key">{e.task_key} </span> : null}{sentence(e)}</span>
              <span className="who">{e.agent ?? ""}</span>
            </div>
          </div>
        );
      })}
      {hidden > 0 || all ? (
        <button type="button" className="btn ghost sm" onClick={() => setAll(!all)}>{all ? "Hide tool calls and heartbeats" : `Show everything (${hidden} more)`}</button>
      ) : null}
    </div>
  );
}
