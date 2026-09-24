"use client";

// The human-facing inbox: approvals waiting for a person, and parked tasks an operator can put back.
// Left: the queue. Right: the thing to decide on (the artefact the step consumes, rendered as a document),
// the source files from the workspace, and the decision with a reason. Nothing here talks to the engine
// except through the operator API; the engine still decides what happens next.
import { useEffect, useMemo, useState } from "react";
import { postJson, usePoll } from "@/lib/usePoll";
import type { ApiError, Artifact, Task, TaskDetailResponse, TasksResponse } from "@/lib/types";
import { ago, ts, usd } from "@/lib/format";
import { ErrorBox, Flash, Key, StateBadge } from "./ui";
import ArtefactView, { documentsOf } from "./ArtefactView";

type FlashMsg = { kind: "ok" | "bad"; text: string } | null;

function Document({ path }: { path: string }) {
  const url = `/api/workspace?path=${encodeURIComponent(path)}`;
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isPdf = /\.pdf$/i.test(path);
  useEffect(() => {
    setText(null); setErr(null);
    if (isPdf) return;
    let alive = true;
    fetch(url, { cache: "no-store" }).then(async (r) => {
      if (!alive) return;
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j?.error?.message ?? `HTTP ${r.status}`); return; }
      const t = await r.text();
      // an .eml: show headers and the text part, drop the base64 attachment
      const cut = /\.eml$/i.test(path) ? t.split(/\n--=+/)[0].replace(/^(MIME-Version|Content-Type|Content-Transfer-Encoding):.*\n/gm, "") : t;
      setText(cut);
    }).catch((e) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [url, isPdf, path]);
  if (isPdf) return <iframe className="doc-pdf" src={url} title={path} />;
  if (err) return <div className="error">{err}</div>;
  if (text == null) return <div className="muted">loading…</div>;
  return <pre className="doc-text">{text}</pre>;
}

function Documents({ docs }: { docs: { label: string; path: string }[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [docs.map((d) => d.path).join("|")]);
  if (!docs.length) return <div className="muted">This step points at no workspace documents.</div>;
  const cur = docs[Math.min(i, docs.length - 1)];
  return (
    <div className="docs">
      <div className="doc-tabs">
        {docs.map((d, k) => <button key={d.path} type="button" className={`tab${k === i ? " active" : ""}`} onClick={() => setI(k)}>{d.label}</button>)}
        <a className="btn link" href={`/api/workspace?path=${encodeURIComponent(cur.path)}`} target="_blank" rel="noreferrer">open</a>
      </div>
      <div className="doc-body"><Document path={cur.path} /></div>
    </div>
  );
}

function Decide({ task, onDone }: { task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashMsg>(null);
  const act = async (action: "approve" | "reject") => {
    setBusy(action); setFlash(null);
    try {
      await postJson(`/api/tasks/${encodeURIComponent(task.id)}/action`, { action, reason: reason.trim() || null });
      setFlash({ kind: "ok", text: action === "approve" ? "Approved. The next step is ready." : "Rejected. The rework branch is ready; the other branch is cancelled." });
      setReason(""); onDone();
    } catch (e) { const err = e as ApiError; setFlash({ kind: "bad", text: `${err.code} ${err.message}` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="decide">
      <textarea id={`reason-${task.id}`} className="field" rows={3} placeholder="Reason (required for a rejection; recorded on the review artefact and in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="field-row">
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void act("approve")}>{busy === "approve" ? "Approving…" : "Approve"}</button>
        <button type="button" className="btn danger" disabled={!!busy || !reason.trim()} onClick={() => void act("reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
        <span className="muted">{task.workflow_run ? <>run <Key>{task.workflow_run}</Key> · </> : null}waiting {ago(task.updated_at)}</span>
      </div>
      <Flash msg={flash} />
    </div>
  );
}

function Retry({ task, onDone }: { task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<FlashMsg>(null);
  const go = async () => {
    setBusy(true); setFlash(null);
    try {
      const r = await postJson<{ ok: boolean; state?: string }>(`/api/tasks/${encodeURIComponent(task.id)}/action`, { action: "retry", reason: reason.trim() || null, budget_usd: budget || undefined });
      setFlash({ kind: "ok", text: `Back in the queue (${r.state ?? "ready"}).` }); onDone();
    } catch (e) { const err = e as ApiError; setFlash({ kind: "bad", text: `${err.code} ${err.message}` }); }
    finally { setBusy(false); }
  };
  return (
    <div className="decide">
      <div className="muted">Parked after {task.attempts} of {task.max_attempts} attempts{task.budget_usd != null ? `, spent ${usd(task.cost_usd)} of ${usd(task.budget_usd)}` : ""}. Retry resets the attempts; raise the budget if it ran out.</div>
      <div className="field-row">
        <input className="field" style={{ maxWidth: 140 }} placeholder="new budget $" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <input className="field" placeholder="why (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? "Retrying…" : "Retry"}</button>
      </div>
      <Flash msg={flash} />
    </div>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const d = usePoll<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(id)}`, 8000);
  const t = d.data?.task;
  const inputs: Artifact[] = useMemo(() => {
    const seen = new Set<string>();
    return (d.data?.consumed ?? []).filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  }, [d.data]);
  const docs = useMemo(() => inputs.flatMap((a) => documentsOf(a.kind, a.content)), [inputs]);
  const own = d.data?.artifacts ?? [];
  const lastFailure = (d.data?.events ?? []).find((e) => ["gate_failed", "artifact_rejected", "deadline_passed", "budget_exceeded", "task_released"].includes(e.type));
  if (d.error) return <ErrorBox error={d.error} />;
  if (!t) return <div className="muted">loading…</div>;
  const approval = t.role === "operator";
  return (
    <div className="inbox-detail">
      <div className="detail-head">
        <Key>{t.key}</Key> <StateBadge state={t.state} />
        <h3>{t.title}</h3>
        <span className="muted">{approval ? "needs a decision from a person" : `${t.role} · parked`}</span>
      </div>
      {t.spec ? <details className="spec"><summary>What this step was asked to do</summary><pre className="doc-text">{t.spec}</pre></details> : null}
      <div className="detail-cols">
        <section className="panel">
          <div className="panel-h">{approval ? "What you are deciding on" : "Inputs"}<span className="muted">{inputs.map((a) => a.kind).join(", ") || "none"}</span></div>
          <div className="panel-b">
            {inputs.length ? inputs.map((a) => <div key={a.id} className="art-block"><div className="art-kind mono">{a.kind}</div><ArtefactView kind={a.kind} content={a.content} /></div>) : <div className="muted">This step consumes no artefacts.</div>}
            {!approval && own.length ? <><div className="art-kind mono" style={{ marginTop: 12 }}>what it produced so far</div>{own.slice(0, 2).map((a) => <div key={a.id} className="art-block"><ArtefactView kind={a.kind} content={a.content} /></div>)}</> : null}
            {!approval && lastFailure ? <div className="error" style={{ marginTop: 10 }}><b className="mono">{lastFailure.type}</b> {ts(lastFailure.ts)} <pre className="block" style={{ marginTop: 6 }}>{JSON.stringify(lastFailure.payload, null, 2)}</pre></div> : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h">Documents<span className="muted">from the workspace</span></div>
          <div className="panel-b"><Documents docs={docs} /></div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-h">{approval ? "Your decision" : "Put it back"}</div>
        <div className="panel-b">{t.state !== "needs_human" && t.state !== "failed" ? <div className="muted">Already decided: this task is {t.state}.</div> : approval ? <Decide task={t} onDone={onChanged} /> : <Retry task={t} onDone={onChanged} />}</div>
      </section>
    </div>
  );
}

export default function InboxView() {
  const q = usePoll<TasksResponse>("/api/tasks?state=needs_human&limit=200", 5000);
  const f = usePoll<TasksResponse>("/api/tasks?state=failed&limit=100", 15000);
  const items = useMemo(() => {
    const all = [...(q.data?.tasks ?? []), ...(f.data?.tasks ?? [])];
    return all.sort((a, b) => (a.role === "operator" ? 0 : 1) - (b.role === "operator" ? 0 : 1) || a.updated_at.localeCompare(b.updated_at));
  }, [q.data, f.data]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!sel && items.length) setSel(items[0].id); if (sel && !items.some((t) => t.id === sel)) setSel(items[0]?.id ?? null); }, [items, sel]);
  const refresh = () => { void q.refresh(); void f.refresh(); };
  const approvals = items.filter((t) => t.role === "operator"), parked = items.filter((t) => t.role !== "operator");
  return (
    <div className="inbox">
      <aside className="inbox-list">
        <div className="panel">
          <div className="panel-h">Approvals<span className="muted">{approvals.length}</span></div>
          {approvals.length === 0 ? <div className="panel-b muted">Nothing waiting for a decision.</div> : approvals.map((t) => (
            <button key={t.id} type="button" className={`inbox-item${sel === t.id ? " active" : ""}`} onClick={() => setSel(t.id)}>
              <div className="l1"><Key>{t.key}</Key><span className="muted">{t.workflow_run ?? ""}</span></div>
              <div className="l2">{t.title.replace(/^.*?: /, "")}</div>
              <div className="l3 muted">waiting {ago(t.updated_at)}</div>
            </button>
          ))}
        </div>
        <div className="panel">
          <div className="panel-h">Parked<span className="muted">{parked.length}</span></div>
          {parked.length === 0 ? <div className="panel-b muted">No task is stuck.</div> : parked.map((t) => (
            <button key={t.id} type="button" className={`inbox-item${sel === t.id ? " active" : ""}`} onClick={() => setSel(t.id)}>
              <div className="l1"><Key>{t.key}</Key><StateBadge state={t.state} /><span className="muted">{t.role}</span></div>
              <div className="l2">{t.title.replace(/^.*?: /, "")}</div>
              <div className="l3 muted">{t.attempts}/{t.max_attempts} attempts · {ago(t.updated_at)}</div>
            </button>
          ))}
        </div>
        <ErrorBox error={q.error} />
      </aside>
      <div className="inbox-main">{sel ? <Detail id={sel} onChanged={refresh} /> : <div className="panel"><div className="panel-b muted">Select an item.</div></div>}</div>
    </div>
  );
}
