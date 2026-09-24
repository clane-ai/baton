"use client";

// The decision area at the bottom of the item screen. One mode per situation: approve or reject an
// approval, retry a parked step, answer an agent's question, or read who already decided.
import { useEffect, useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/usePoll";
import type { ApiError, Decision, InboxNext, Message, Task } from "@/lib/types";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { outcomeSide } from "@/lib/inbox";
import { ts, usd } from "@/lib/format";

type Outcome = { kind: "ok" | "bad"; text: string } | null;

const storage = () => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

function Approval({ task, next, nextWaiting, onDone }: { task: Task; next: InboxNext[]; nextWaiting: string | null; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<"" | "saved" | "draft">("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [done, setDone] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    const d = loadDraft(storage(), task.key);
    if (d) { setReason(d); setSaved("draft"); }
  }, [task.key]);

  const save = () => { saveDraft(storage(), task.key, reason); setSaved("saved"); setTimeout(() => setSaved(reason.trim() ? "draft" : ""), 2000); };
  const act = async (action: "approve" | "reject") => {
    if (busy || done) return;
    if (action === "reject" && !reason.trim()) { setOutcome({ kind: "bad", text: "Add a reason to reject." }); return; }
    setBusy(action); setOutcome(null);
    try {
      await postJson(`/api/tasks/${encodeURIComponent(task.id)}/action`, { action, reason: reason.trim() || null });
      clearDraft(storage(), task.key);
      setDone(action);
      const yes = next.filter((n) => outcomeSide(n.when) !== "reject").map((n) => n.title);
      const no = next.filter((n) => outcomeSide(n.when) === "reject").map((n) => n.title);
      setOutcome({ kind: "ok", text: action === "approve" ? `Approved.${yes.length ? ` ${yes.join(", ")} is ready.` : ""}` : `Rejected.${no.length ? ` ${no.join(", ")} is ready.` : ""}` });
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setOutcome({ kind: "bad", text: `${err.code}: ${err.message}` });
    } finally { setBusy(null); }
  };

  if (done) {
    return (
      <div className="decide done">
        <span className={`outcome ${outcome?.kind ?? "ok"}`}>{outcome?.text}</span>
        <span className="sp" />
        {nextWaiting ? <Link className="btn primary" href={`/inbox/${encodeURIComponent(nextWaiting)}`}>Next waiting: {nextWaiting}</Link> : <Link className="btn" href="/inbox">Back to Inbox</Link>}
      </div>
    );
  }
  return (
    <div className="decide">
      <div className="decide-main">
        <textarea id={`reason-${task.key}`} className="reason" rows={2} placeholder="Reason (required to reject; recorded on the decision and in the activity log)" value={reason} onChange={(e) => { setReason(e.target.value); setSaved(""); }} />
        {saved === "saved" ? <span className="muted small">Draft saved</span> : saved === "draft" ? <span className="muted small">Draft, not sent</span> : null}
        {outcome ? <span className={`outcome ${outcome.kind}`}>{outcome.text}</span> : null}
      </div>
      <div className="decide-actions">
        <button type="button" className="btn ghost" onClick={save} disabled={!!busy}>Save draft</button>
        <button type="button" className="btn danger" onClick={() => void act("reject")} disabled={!!busy || !reason.trim()} title={!reason.trim() ? "Add a reason to reject" : undefined}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
        <button type="button" className="btn primary" onClick={() => void act("approve")} disabled={!!busy}>{busy === "approve" ? "Approving…" : "Approve"}</button>
      </div>
    </div>
  );
}

function Retry({ task, onDone }: { task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const go = async () => {
    if (busy) return;
    setBusy(true); setOutcome(null);
    try {
      const r = await postJson<{ ok: boolean; state?: string }>(`/api/tasks/${encodeURIComponent(task.id)}/action`, {
        action: "retry", reason: reason.trim() || null, budget_usd: budget || undefined, deadline: deadline ? new Date(deadline).toISOString() : undefined,
      });
      setOutcome({ kind: "ok", text: `Back in the queue (${r.state ?? "ready"}).` });
      onDone();
    } catch (e) { const err = e as ApiError; setOutcome({ kind: "bad", text: `${err.code}: ${err.message}` }); }
    finally { setBusy(false); }
  };
  return (
    <div className="decide">
      <div className="decide-main">
        <div className="muted small">Parked after {task.attempts} of {task.max_attempts} attempts{task.budget_usd != null ? `, spent ${usd(task.cost_usd)} of ${usd(task.budget_usd)}` : ""}. Retry resets the attempts.</div>
        <div className="retry-fields">
          <input id={`budget-${task.key}`} className="input" placeholder="New budget $" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <input id={`deadline-${task.key}`} className="input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} title="New deadline" />
          <input id={`why-${task.key}`} className="input grow" placeholder="Why (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {outcome ? <span className={`outcome ${outcome.kind}`}>{outcome.text}</span> : null}
      </div>
      <div className="decide-actions">
        <button type="button" className="btn primary" onClick={() => void go()} disabled={busy}>{busy ? "Retrying…" : "Retry"}</button>
      </div>
    </div>
  );
}

function Answer({ task, question, onDone }: { task: Task; question: Message; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const send = async () => {
    if (busy || !body.trim()) return;
    setBusy(true); setOutcome(null);
    try {
      await postJson("/api/answer", { task_key: task.key, message_id: question.id, body: body.trim() });
      setOutcome({ kind: "ok", text: "Answer sent. The step is back in the queue." });
      setBody("");
      onDone();
    } catch (e) { const err = e as ApiError; setOutcome({ kind: "bad", text: `${err.code}: ${err.message}` }); }
    finally { setBusy(false); }
  };
  return (
    <div className="decide">
      <div className="decide-main">
        <div className="question"><span className="muted small">{question.from_name ?? "An agent"} asked, {ts(question.created_at)}</span><div>{question.body}</div></div>
        <textarea id={`answer-${task.key}`} className="reason" rows={2} placeholder="Your answer" value={body} onChange={(e) => setBody(e.target.value)} />
        {outcome ? <span className={`outcome ${outcome.kind}`}>{outcome.text}</span> : null}
      </div>
      <div className="decide-actions">
        <button type="button" className="btn primary" onClick={() => void send()} disabled={busy || !body.trim()}>{busy ? "Sending…" : "Send answer"}</button>
      </div>
    </div>
  );
}

export default function DecisionBar({ task, decision, questions, next, nextWaiting, onDone }: {
  task: Task; decision: Decision | null | undefined; questions: Message[]; next: InboxNext[]; nextWaiting: string | null; onDone: () => void;
}) {
  const open = questions.filter((q) => q.kind === "question" && !q.answered_at);
  if (open.length) return <Answer task={task} question={open[open.length - 1]} onDone={onDone} />;
  if (task.role === "operator" && task.state === "needs_human") return <Approval task={task} next={next} nextWaiting={nextWaiting} onDone={onDone} />;
  if (task.state === "needs_human" || task.state === "failed") return <Retry task={task} onDone={onDone} />;
  if (decision) {
    return (
      <div className="decide done">
        <span>{decision.verdict === "approve" ? "Approved" : "Rejected"} by <b>{decision.by}</b> at {ts(decision.at)}{decision.reason ? <span className="muted"> · {decision.reason}</span> : null}</span>
      </div>
    );
  }
  return <div className="decide done"><span className="muted">Nothing to decide here: this step is {task.state.replace(/_/g, " ")}.</span></div>;
}
