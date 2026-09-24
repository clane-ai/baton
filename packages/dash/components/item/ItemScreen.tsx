"use client";

// The screen an approver lives on: sources on the left, the artefact as a document on the right,
// the decision at the bottom, history as a tab.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePoll, useTick } from "@/lib/usePoll";
import type { Artifact, DocumentRef, DocumentsResponse, InboxItem, InboxResponse, TaskDetailResponse } from "@/lib/types";
import { documentsFor, mergeDocuments } from "@/lib/documents";
import { policySummary } from "@/lib/policy";
import { nextText, stripProcess, summaryLine, waitingText } from "@/lib/inbox";
import { itemFromTask } from "@/lib/inboxFallback";
import { countdown, ts } from "@/lib/format";
import { Chip, Empty, ErrorBox, StatePill } from "@/components/ui";
import Sources from "./Sources";
import DocumentPane from "./DocumentPane";
import ActivityLog from "./ActivityLog";
import DecisionBar from "./DecisionBar";

const KIND_LABEL: Record<string, string> = {
  purchase_order: "Purchase order", goods_receipt: "Goods receipt", invoice: "Invoice", delivery_note: "Delivery note",
  invoice_match: "Three-way match", payment: "Payment", review: "Review", handoff: "Handoff", task_spec: "Task spec", test_report: "Test report",
};
const numberOf = (a: Artifact | undefined): string => {
  const c = (a?.content ?? {}) as Record<string, unknown>;
  const n = c.po_number ?? c.invoice_number ?? c.grn_number ?? c.payment_ref ?? c.delivery_note_number;
  return n == null ? "" : String(n);
};

export default function ItemScreen({ itemKey }: { itemKey: string }) {
  const detail = usePoll<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(itemKey)}`, 8000);
  const docsApi = usePoll<DocumentsResponse>(`/api/tasks/${encodeURIComponent(itemKey)}/documents`, 60000);
  const inbox = usePoll<InboxResponse>("/api/inbox", 10000);
  const now = useTick(1000);
  const [tab, setTab] = useState<"doc" | "policy" | "activity">("doc");

  const t = detail.data?.task;
  const approval = t?.role === "operator";
  const consumed = useMemo(() => {
    const seen = new Set<string>();
    return (detail.data?.consumed ?? []).filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  }, [detail.data]);
  const own = detail.data?.artifacts ?? [];
  const primary: Artifact | undefined = approval ? consumed.find((a) => a.kind === "purchase_order") ?? consumed[0] : own[0] ?? consumed[0];
  const shown: Artifact[] = approval ? consumed : own.length ? [own[0], ...consumed] : consumed;

  const docs: DocumentRef[] = useMemo(() => {
    const api = [...(detail.data?.documents ?? []), ...(docsApi.data?.documents ?? [])] as DocumentRef[];
    const conv = [...consumed, ...own].flatMap((a) => documentsFor(a.kind, a.content));
    return mergeDocuments(api, conv);
  }, [detail.data, docsApi.data, consumed, own]);

  const item: InboxItem | null = useMemo(() => {
    const live = inbox.data?.items.find((i) => i.key === itemKey);
    if (live) return live;
    return t ? itemFromTask(t, approval ? consumed : own.length ? own : consumed, now) : null;
  }, [inbox.data, itemKey, t, approval, consumed, own, now]);
  const nextWaiting = useMemo(() => {
    const others = (inbox.data?.items ?? []).filter((i) => i.kind === "approval" && i.key !== itemKey).sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
    return others[0]?.key ?? null;
  }, [inbox.data, itemKey]);

  if (detail.error) return <div><Link href="/inbox" className="crumb"><ArrowLeft size={14} /> Inbox</Link><ErrorBox error={detail.error} /></div>;
  if (!t) return <div className="muted">Loading…</div>;

  const summary = primary ? policySummary(primary.kind, primary.content) : null;
  const title = primary ? `${KIND_LABEL[primary.kind] ?? primary.kind.replace(/_/g, " ")} ${numberOf(primary)}`.trim() : stripProcess(t.title);
  const producer = detail.data?.claims?.find((c) => c.outcome === "completed")?.agent ?? null;
  const deadline = t.deadline ? countdown(t.deadline, now) : null;
  const events = detail.data?.events ?? [];
  const lastFailure = events.find((e) => ["gate_failed", "artifact_rejected", "deadline_passed", "budget_exceeded", "lease_expired", "task_released"].includes(e.type));

  return (
    <div className="item">
      <Link href="/inbox" className="crumb"><ArrowLeft size={14} /> Inbox</Link>
      <header className="item-head">
        <div className="l1">
          <h1>{title}</h1>
          <StatePill state={t.state} />
          <span className="mono muted">{t.key}</span>
          {t.workflow_run ? <span className="muted">run <Link href={`/runs/${encodeURIComponent(t.workflow_run)}`} className="mono">{t.workflow_run}</Link></span> : null}
          <span className="sp" />
          {item && item.next.length ? <span className="next">{nextText(item.next)}</span> : null}
        </div>
        <div className="l2 muted">
          <span>{stripProcess(t.title)}</span>
          {item && summaryLine(item) ? <span>{summaryLine(item)}</span> : null}
          {primary ? <span>{producer ? `raised by ${producer} ` : ""}{ts(primary.created_at)}</span> : null}
          {t.state === "needs_human" ? <span>waiting {waitingText(t.updated_at, now)}</span> : null}
          {deadline && t.state === "needs_human" ? (deadline.msLeft < 0 ? <Chip tone="stuck">overdue</Chip> : <Chip tone="working">deadline in {deadline.text}</Chip>) : null}
        </div>
      </header>

      <div className="item-cols">
        <section className="surface pane">
          <Sources docs={docs} itemKey={t.key} />
        </section>

        <section className="surface pane pane-right">
          <div className="tabs">
            <button type="button" className={`tab${tab === "doc" ? " on" : ""}`} onClick={() => setTab("doc")}>{primary ? KIND_LABEL[primary.kind] ?? "Document" : "Document"}</button>
            <button type="button" className={`tab${tab === "policy" ? " on" : ""}`} onClick={() => setTab("policy")}>Policy</button>
            <button type="button" className={`tab${tab === "activity" ? " on" : ""}`} onClick={() => setTab("activity")}>Activity<span className="n">{events.length}</span></button>
          </div>
          <div className="pane-b pane-scroll">
            {tab === "doc" ? (
              <>
                {summary ? <div className={`summary-card tone-${summary.tone}`}><b>{summary.text.split(". ")[0]}.</b> {summary.text.split(". ").slice(1).join(". ")}</div> : null}
                {shown.length ? shown.map((a, i) => (
                  <div key={a.id} className={i ? "doc-block" : ""}>
                    {i ? <h3 className="doc-block-h">{KIND_LABEL[a.kind] ?? a.kind.replace(/_/g, " ")}</h3> : null}
                    <DocumentPane kind={a.kind} content={a.content} />
                  </div>
                )) : <Empty title="No document to show" hint="This step has no artefacts yet." />}
                {!approval && lastFailure ? (
                  <div className="failure"><b>{lastFailure.type.replace(/_/g, " ")}</b> at {ts(lastFailure.ts)}<pre className="block">{JSON.stringify(lastFailure.payload, null, 2)}</pre></div>
                ) : null}
              </>
            ) : tab === "policy" ? (
              <div className="doc">
                <h3>What this step was asked to do</h3>
                <pre className="letter">{t.spec ?? ""}</pre>
                {t.acceptance ? <><h3>Acceptance</h3><pre className="letter">{t.acceptance}</pre></> : null}
              </div>
            ) : (
              <ActivityLog events={events} />
            )}
          </div>
          <DecisionBar task={t} decision={detail.data?.decision} questions={detail.data?.questions ?? detail.data?.messages ?? []} next={item?.next ?? []} nextWaiting={nextWaiting} onDone={() => { void detail.refresh(); void inbox.refresh(); }} />
        </section>
      </div>
    </div>
  );
}
