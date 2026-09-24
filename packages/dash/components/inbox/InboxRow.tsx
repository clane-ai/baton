"use client";

// One board row of the Inbox: what it is, which run, the document and counterparty, the amount,
// the policy flags, how long it has waited, and the one action a person takes on it.
import Link from "next/link";
import type { InboxItem } from "@/lib/types";
import { flagLabel, stripProcess, waitingText } from "@/lib/inbox";
import { money } from "@/lib/money";
import { Chip } from "@/components/ui";

const ACTION: Record<InboxItem["kind"], string> = { approval: "Review", parked: "Retry", question: "Answer" };

export default function InboxRow({ item, selected, now }: { item: InboxItem; selected: boolean; now: number }) {
  const s = item.summary;
  const href = `/inbox/${encodeURIComponent(item.key)}`;
  return (
    <Link href={href} className={`row${selected ? " selected" : ""}`} role="row" aria-selected={selected} data-key={item.key}>
      <div className="cell c-item">
        <span className="mono key">{item.key}</span>
        <span className="sub">{stripProcess(item.title)}{item.kind === "parked" ? ` · ${item.role}` : ""}</span>
      </div>
      <div className="cell c-run mono">{item.run_name ? <span title={item.workflow_run ?? ""}>{item.workflow_run}</span> : item.workflow_run ?? ""}</div>
      <div className="cell c-doc">
        {s?.document ? <span className="mono">{s.document}</span> : <span className="sub">no document</span>}
        {s?.counterparty ? <span className="sub">{s.counterparty}</span> : null}
      </div>
      <div className="cell c-amt num">{s?.amount != null ? money(s.amount, s.currency ?? undefined) : ""}</div>
      <div className="cell c-flags">
        {(s?.flags ?? []).map((f) => {
          const l = flagLabel(f);
          return <Chip key={f} tone={l.tone}>{l.text}</Chip>;
        })}
        {item.kind === "parked" ? <Chip tone="working">{item.attempts} of {item.max_attempts} attempts</Chip> : null}
      </div>
      <div className="cell c-wait">
        <span>{waitingText(item.waiting_since, now)}</span>
        {item.overdue ? <Chip tone="stuck">overdue</Chip> : null}
      </div>
      <div className="cell c-act"><span className="btn sm">{ACTION[item.kind]}</span></div>
    </Link>
  );
}
