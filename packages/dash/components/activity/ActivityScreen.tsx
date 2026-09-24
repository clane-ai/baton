"use client";

// Activity: what the system did, when, by whom. Filters by run, step, agent and event type;
// sentences from the same map the item and run screens use, with the raw payload one click away.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePoll } from "@/lib/usePoll";
import type { EventsResponse, StreamEvent } from "@/lib/types";
import { compact, pretty } from "@/lib/format";
import { Empty, ErrorBox } from "@/components/ui";
import { NOISE, sentence } from "@/components/item/ActivityLog";

const TYPES = ["", "approval_required", "approval_overdue", "approved", "rejected", "gate_passed", "gate_failed", "artifact_registered", "artifact_rejected", "branch_not_taken", "cancelled_upstream", "deadline_passed", "budget_exceeded", "lease_expired", "task_retried", "task_claimed", "task_released", "task_state_changed", "workflow_run_finished", "session_start", "session_end", "auth_rejected", "no_lease", "scope_violation"];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Row({ e }: { e: StreamEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`act-row${open ? " open" : ""}`} onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") setOpen(!open); }}>
      <span className="t mono">{hhmmss(e.ts)}</span>
      <span className="what">
        {e.task_key ? <Link className="mono key" href={`/inbox/${encodeURIComponent(e.task_key)}`} onClick={(ev) => ev.stopPropagation()}>{e.task_key}</Link> : null}
        {e.task_key ? " " : ""}{sentence(e)}
        {!open ? <span className="payload muted small"> {compact(e.payload, 120)}</span> : null}
      </span>
      <span className="who">{e.agent ?? ""}</span>
      {open ? <pre className="block act-payload">{pretty({ type: e.type, session_id: e.session_id, payload: e.payload })}</pre> : null}
    </div>
  );
}

export default function ActivityScreen() {
  const params = useSearchParams();
  const [run, setRun] = useState(params.get("workflow_run") ?? "");
  const [task, setTask] = useState(params.get("task") ?? "");
  const [agent, setAgent] = useState("");
  const [type, setType] = useState("");
  const [noise, setNoise] = useState(false);
  const [follow, setFollow] = useState(true);
  const dRun = useDebounced(run.trim(), 300), dTask = useDebounced(task.trim(), 300), dAgent = useDebounced(agent.trim(), 300);

  const url = useMemo(() => {
    const q = new URLSearchParams({ limit: "300" });
    if (dRun) q.set("workflow_run", dRun);
    if (dTask) q.set("task", dTask);
    if (dAgent) q.set("agent", dAgent);
    if (type) q.set("type", type);
    return `/api/events?${q.toString()}`;
  }, [dRun, dTask, dAgent, type]);
  const ev = usePoll<EventsResponse>(url, follow ? 5000 : 3600000);
  const events = useMemo(() => (ev.data?.events ?? []).filter((e) => noise || !NOISE.has(e.type)), [ev.data, noise]);
  const hidden = (ev.data?.events.length ?? 0) - events.length;

  return (
    <div>
      <div className="screen-head">
        <h1>Activity</h1>
        <span className="muted">{events.length} events, newest first{hidden ? `, ${hidden} routine hidden` : ""}</span>
        <span className="sp" />
        <label className="lbl"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>
        <button type="button" className="btn sm" onClick={() => void ev.refresh()}>Refresh</button>
      </div>
      <div className="filters">
        <input id="act-run" className="input mono" placeholder="run key" value={run} onChange={(e) => setRun(e.target.value)} style={{ width: 150 }} />
        <input id="act-task" className="input mono" placeholder="step key" value={task} onChange={(e) => setTask(e.target.value)} style={{ width: 130 }} />
        <input id="act-agent" className="input mono" placeholder="agent" value={agent} onChange={(e) => setAgent(e.target.value)} style={{ width: 150 }} />
        <select id="act-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t ? t.replace(/_/g, " ") : "All types"}</option>)}
        </select>
        <label className="lbl"><input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} /> show tool calls and heartbeats</label>
        {run || task || agent || type ? <button type="button" className="btn ghost sm" onClick={() => { setRun(""); setTask(""); setAgent(""); setType(""); }}>Clear</button> : null}
      </div>
      <ErrorBox error={ev.error} />
      <section className="surface act-list">
        {events.length === 0 ? <Empty title={ev.loading ? "Loading…" : "No events match"} hint="Widen the filters or show routine events." /> : events.map((e) => <Row key={String(e.id)} e={e} />)}
      </section>
    </div>
  );
}
