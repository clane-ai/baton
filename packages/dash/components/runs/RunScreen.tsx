"use client";

// One run: its steps in order, the graph, every artefact it produced, and its activity.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePoll } from "@/lib/usePoll";
import type { Artifact, EventsResponse, TasksResponse, WorkflowRunResponse, WorkflowRunStep } from "@/lib/types";
import { runTone, stateTone } from "@/lib/theme";
import { stripProcess } from "@/lib/inbox";
import { usd, ts } from "@/lib/format";
import { Empty, ErrorBox, Pill, StatePill } from "@/components/ui";
import RunGraph from "@/components/RunGraph";
import DocumentPane from "@/components/item/DocumentPane";
import ActivityLog from "@/components/item/ActivityLog";
import { progressOf } from "./RunsScreen";

function duration(a: string, b: string | null): string {
  if (!b) return "";
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  if (!Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function RunScreen({ runKey }: { runKey: string }) {
  const run = usePoll<WorkflowRunResponse>(`/api/workflow-runs/${encodeURIComponent(runKey)}`, 5000);
  const events = usePoll<EventsResponse>(`/api/events?workflow_run=${encodeURIComponent(runKey)}&limit=500`, 10000);
  const tasks = usePoll<TasksResponse>(`/api/tasks?workflow_run=${encodeURIComponent(runKey)}&limit=100`, 30000);
  const [tab, setTab] = useState<"steps" | "artefacts" | "activity">("steps");
  const [openKind, setOpenKind] = useState<string | null>(null);
  const r = run.data?.run;
  const steps = useMemo(() => r?.steps ?? [], [r]);

  // Artefacts per step come from the task list's detail endpoint; one call per step, cached by the poll.
  const artefacts = useArtefacts(steps.map((s) => s.key));

  if (run.error) return <div><Link href="/runs" className="crumb"><ArrowLeft size={14} /> Runs</Link><ErrorBox error={run.error} /></div>;
  if (!r) return <div className="muted">Loading…</div>;
  const p = progressOf(r.counts);
  const po = artefacts.find((a) => a.kind === "purchase_order");
  const poc = (po?.content ?? {}) as Record<string, unknown>;
  const vendor = (poc.vendor as Record<string, unknown> | undefined)?.name;
  const notTaken = (s: WorkflowRunStep) => s.state === "cancelled" && !!s.condition;

  return (
    <div className="run">
      <Link href="/runs" className="crumb"><ArrowLeft size={14} /> Runs</Link>
      <header className="item-head">
        <div className="l1">
          <h1>{r.workflow_name ?? r.workflow_key ?? "Run"} <span className="mono muted">{r.key}</span></h1>
          <Pill tone={runTone(r.status)}>{r.status.replace(/_/g, " ")}</Pill>
          <span className="sp" />
          <span className="muted num">{p.done} of {p.total} steps{r.finished_at ? ` · ${duration(r.created_at, r.finished_at)}` : ""} · {usd(r.cost_usd)}{r.cost_credits ? ` · ${Number(r.cost_credits).toFixed(0)} credits` : ""}</span>
        </div>
        <div className="l2 muted">
          {r.input ? <span>{r.input}</span> : null}
          {poc.po_number ? <span className="mono">{String(poc.po_number)}</span> : null}
          {vendor ? <span>{String(vendor)}</span> : null}
          <span>started {ts(r.created_at)}</span>
        </div>
      </header>

      <div className="run-cols">
        <section className="surface pane">
          <div className="tabs">
            <button type="button" className={`tab${tab === "steps" ? " on" : ""}`} onClick={() => setTab("steps")}>Steps<span className="n">{steps.length}</span></button>
            <button type="button" className={`tab${tab === "artefacts" ? " on" : ""}`} onClick={() => setTab("artefacts")}>Artefacts<span className="n">{artefacts.length}</span></button>
            <button type="button" className={`tab${tab === "activity" ? " on" : ""}`} onClick={() => setTab("activity")}>Activity<span className="n">{events.data?.events.length ?? 0}</span></button>
          </div>
          {tab === "steps" ? (
            <ol className="steps">
              {steps.map((s) => {
                const arts = artefacts.filter((a) => a.task_key === s.key);
                const nums = arts.map((a) => docNumber(a)).filter(Boolean).join(", ");
                const off = notTaken(s);
                return (
                  <li key={s.key} className={off ? "off" : ""}>
                    <span className={`dot tone-${off ? "neutral" : s.role === "operator" && s.state === "done" ? "waiting" : stateTone(s.state)}`} />
                    <div className="step-main">
                      <div className="step-title">{stripProcess(s.title)}{s.condition ? <span className="muted small"> · {off ? `not taken: needed "${s.condition.outcome ?? s.condition.equals}"` : `branch "${s.condition.outcome ?? s.condition.equals}"`}</span> : null}</div>
                      <div className="step-meta muted small">
                        <span>{s.role}</span><span className="mono">{s.key}</span>
                        {nums ? <span className="mono">{nums}</span> : null}
                        {s.assignee ? <span>{s.assignee}</span> : null}
                        {s.state === "done" || s.state === "cancelled" ? <span>{hhmm(s.updated_at)}</span> : null}
                        {Number(s.cost_usd) > 0 ? <span>{usd(s.cost_usd)}</span> : null}
                        {Number(s.cost_credits) > 0 ? <span>{Number(s.cost_credits).toFixed(0)} credits</span> : null}
                      </div>
                    </div>
                    <div className="step-side">
                      <StatePill state={s.state} />
                      {!off ? <Link className="btn sm" href={`/inbox/${encodeURIComponent(s.key)}`}>Open</Link> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : tab === "artefacts" ? (
            <div className="pane-b">
              {artefacts.length === 0 ? <Empty title="No artefacts yet" /> : artefacts.map((a) => (
                <div key={a.id} className="art-item">
                  <button type="button" className="art-toggle" onClick={() => setOpenKind(openKind === a.id ? null : a.id)}>
                    <span className="mono">{a.task_key}</span> <b>{a.kind.replace(/_/g, " ")}</b> <span className="mono muted">{docNumber(a)}</span><span className="muted small"> · {ts(a.created_at)}</span>
                  </button>
                  {openKind === a.id ? <div className="art-body"><DocumentPane kind={a.kind} content={a.content} /></div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="pane-b"><ErrorBox error={events.error} /><ActivityLog events={(events.data?.events ?? []).map((e) => ({ ...e, id: e.id, task_key: e.task_key }))} showKeys /></div>
          )}
        </section>
        <section className="surface pane graph-pane">
          <RunGraph run={r} />
        </section>
      </div>
      <ErrorBox error={tasks.error} />
    </div>
  );
}

function docNumber(a: Artifact): string {
  const c = (a.content ?? {}) as Record<string, unknown>;
  const n = c.po_number ?? c.invoice_number ?? c.grn_number ?? c.payment_ref ?? c.delivery_note_number;
  return n == null ? "" : String(n);
}

type ArtWithKey = Artifact & { task_key: string };

/** All artefacts of the given steps, fetched once per step key. */
function useArtefacts(keys: string[]): ArtWithKey[] {
  const joined = keys.join(",");
  const list = usePoll<{ ok: true; artifacts: (Artifact & { task_key?: string })[] }>(joined ? `/api/artifacts/by-tasks?keys=${encodeURIComponent(joined)}` : null, 15000);
  return useMemo(() => (list.data?.artifacts ?? []).map((a) => ({ ...a, task_key: a.task_key ?? "" })), [list.data]);
}
