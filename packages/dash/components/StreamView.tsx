"use client";

import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import type { EventsResponse, StreamEvent } from "@/lib/types";
import { compact, pretty, ts } from "@/lib/format";
import { ErrorBox, Key } from "./ui";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function Payload({ p, expanded }: { p: unknown; expanded: boolean }) {
  if (expanded) return <pre className="block">{pretty(p)}</pre>;
  const obj = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  const transcript = obj && typeof obj.transcript_path === "string" ? obj.transcript_path : null;
  if (transcript) {
    const rest = { ...obj };
    delete rest.transcript_path;
    return (
      <span className="payload">
        <span className="path" title="local path on the agent machine">
          transcript {transcript}
        </span>
        {Object.keys(rest).length ? <span> · {compact(rest, 120)}</span> : null}
      </span>
    );
  }
  return <span className="payload">{compact(p)}</span>;
}

function Row({ e }: { e: StreamEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <tr className={open ? "expanded" : ""} onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
      <td className="mono nowrap" title={e.ts}>
        {ts(e.ts)}
      </td>
      <td className="nowrap">{e.agent ?? <span className="muted">-</span>}</td>
      <td className="nowrap">{e.task_key ? <Key>{e.task_key}</Key> : <span className="muted">-</span>}</td>
      <td className="mono nowrap">{e.type}</td>
      <td>
        <Payload p={e.payload} expanded={open} />
      </td>
    </tr>
  );
}

export default function StreamView() {
  const [agent, setAgent] = useState("");
  const [task, setTask] = useState("");
  const [type, setType] = useState("");
  const dAgent = useDebounced(agent.trim(), 300);
  const dTask = useDebounced(task.trim(), 300);
  const dType = useDebounced(type.trim(), 300);

  const url = useMemo(() => {
    const q = new URLSearchParams({ limit: "200" });
    if (dAgent) q.set("agent", dAgent);
    if (dTask) q.set("task", dTask);
    if (dType) q.set("type", dType);
    return `/api/events?${q.toString()}`;
  }, [dAgent, dTask, dType]);

  const ev = usePoll<EventsResponse>(url, 5000);
  const events = ev.data?.events ?? [];

  return (
    <div>
      <div className="view-head">
        <h2>Stream</h2>
        <div className="stream-filters">
          <input className="field mono" placeholder="agent name or id" value={agent} onChange={(e) => setAgent(e.target.value)} style={{ width: 180 }} />
          <input className="field mono" placeholder="task key or id" value={task} onChange={(e) => setTask(e.target.value)} style={{ width: 160 }} />
          <input className="field mono" placeholder="type (exact)" value={type} onChange={(e) => setType(e.target.value)} style={{ width: 160 }} />
          {agent || task || type ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setAgent("");
                setTask("");
                setType("");
              }}
            >
              clear
            </button>
          ) : null}
        </div>
        <span className="muted">{events.length} events, newest first · click a row to expand</span>
      </div>
      <ErrorBox error={ev.error} />
      <div className="panel">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 150 }}>ts</th>
              <th style={{ width: 120 }}>agent</th>
              <th style={{ width: 100 }}>task</th>
              <th style={{ width: 160 }}>type</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  {ev.loading ? "Loading…" : "No events."}
                </td>
              </tr>
            ) : (
              events.map((e) => <Row key={e.id} e={e} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
