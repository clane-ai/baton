"use client";

import { useState } from "react";
import { postJson, type PollState } from "@/lib/usePoll";
import type { ApiError, AttentionItem, StatusResponse } from "@/lib/types";
import { ago, compact, pretty, ts, usd } from "@/lib/format";
import { ErrorBox, Flash, Key, StateBadge } from "./ui";

function AnswerForm({ messageId, onDone }: { messageId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setFlash(null);
    try {
      await postJson("/api/answer", { message_id: messageId, body });
      setFlash({ kind: "ok", text: "Answer sent; the task returns to ready." });
      setBody("");
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setFlash({ kind: "bad", text: `Answer failed: ${err.code} ${err.message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ans">
      <textarea className="field" rows={3} placeholder="Your answer to the agent…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="field-row" style={{ marginTop: 6 }}>
        <button type="button" className="btn primary" disabled={busy || !body.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Answer"}
        </button>
        <span className="muted mono">message {messageId.slice(0, 8)}</span>
      </div>
      <Flash msg={flash} />
    </div>
  );
}

function Item({ it, onChanged }: { it: AttentionItem; onChanged: () => void }) {
  const [showPayload, setShowPayload] = useState(false);
  const kind = it.question ? "question" : it.state;
  return (
    <div className={`panel att ${kind}`}>
      <div className="head">
        <Key>{it.key}</Key>
        <StateBadge state={it.state} />
        <span className="title">{it.title}</span>
        <span className="muted">{it.role}</span>
        <span className="spacer" />
        <span className="muted">
          att {it.attempts} · {usd(it.cost_usd)}
          {it.budget_usd != null ? ` / ${usd(it.budget_usd)}` : ""} · updated {ago(it.updated_at)}
        </span>
      </div>

      {it.question ? (
        <div className="q">
          <div className="from">
            question from <b>{it.question.from ?? "agent"}</b>
            {it.question.to_role ? ` to ${it.question.to_role}` : ""} · {ts(it.question.created_at)}
          </div>
          <div className="prose">{it.question.body}</div>
          <AnswerForm messageId={it.question.id} onDone={onChanged} />
        </div>
      ) : null}

      {it.last_event ? (
        <div className="ev">
          <span className="muted">last event </span>
          <span className="mono">{it.last_event.type}</span>
          <span className="muted"> at {ts(it.last_event.ts)} </span>
          <button type="button" className="btn link" onClick={() => setShowPayload((v) => !v)}>
            {showPayload ? "hide payload" : "show payload"}
          </button>
          {showPayload ? <pre className="block" style={{ marginTop: 6 }}>{pretty(it.last_event.payload)}</pre> : <div className="payload">{compact(it.last_event.payload, 240)}</div>}
        </div>
      ) : it.state === "needs_human" ? (
        <div className="ev muted">no events recorded</div>
      ) : null}
    </div>
  );
}

export default function AttentionView({ status }: { status: PollState<StatusResponse> }) {
  const items = [...(status.data?.attention ?? [])].sort((a, b) => {
    const qa = a.question ? 0 : 1;
    const qb = b.question ? 0 : 1;
    if (qa !== qb) return qa - qb;
    const na = a.state === "needs_human" ? 0 : 1;
    const nb = b.state === "needs_human" ? 0 : 1;
    if (na !== nb) return na - nb;
    return b.updated_at.localeCompare(a.updated_at);
  });
  const questions = items.filter((i) => i.question).length;

  return (
    <div>
      <div className="view-head">
        <h2>Attention</h2>
        <span className="muted">
          {items.length} tasks · {questions} unanswered {questions === 1 ? "question" : "questions"}
        </span>
      </div>
      <ErrorBox error={status.error} />
      {items.length === 0 ? (
        <div className="empty">{status.loading && !status.data ? "Loading…" : "Nothing needs a human right now."}</div>
      ) : (
        items.map((it) => <Item key={it.id} it={it} onChanged={() => void status.refresh()} />)
      )}
    </div>
  );
}
