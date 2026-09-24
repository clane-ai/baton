// Pure helpers behind the Inbox and Item screens. No React, no fetch.
import type { InboxItem, InboxNext } from "./types";
import type { Tone } from "./theme";
import { money } from "./money";

export type Groups = { approvals: InboxItem[]; parked: InboxItem[]; questions: InboxItem[] };

const byOldest = (a: InboxItem, b: InboxItem) => a.waiting_since.localeCompare(b.waiting_since);

export function groupItems(items: InboxItem[]): Groups {
  return {
    approvals: items.filter((i) => i.kind === "approval").sort(byOldest),
    parked: items.filter((i) => i.kind === "parked").sort(byOldest),
    questions: items.filter((i) => i.kind === "question").sort(byOldest),
  };
}

export type Tiles = { waiting: number; waitingAmount: Record<string, number>; parked: number; questions: number; overdue: number };

export function tilesOf(items: InboxItem[]): Tiles {
  const t: Tiles = { waiting: 0, waitingAmount: {}, parked: 0, questions: 0, overdue: 0 };
  for (const i of items) {
    if (i.kind === "approval") {
      t.waiting += 1;
      const amt = i.summary?.amount;
      const cur = i.summary?.currency ?? "";
      if (amt != null && Number.isFinite(amt)) t.waitingAmount[cur] = (t.waitingAmount[cur] ?? 0) + amt;
    } else if (i.kind === "parked") t.parked += 1;
    else if (i.kind === "question") t.questions += 1;
    if (i.overdue) t.overdue += 1;
  }
  return t;
}

/** "34 s", "12 min", "3 h 10 min", "2 d"; "" for an unparseable time. */
export function waitingText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function summaryLine(item: InboxItem): string {
  const s = item.summary;
  if (!s) return "";
  const parts: string[] = [];
  if (s.document) parts.push(s.document);
  if (s.counterparty) parts.push(s.counterparty);
  if (s.amount != null) parts.push(money(s.amount, s.currency ?? undefined));
  return parts.join(" · ");
}

const FLAGS: Record<string, { text: string; tone: Tone }> = {
  vendor_not_approved: { text: "vendor not approved", tone: "stuck" },
  level_director: { text: "director level", tone: "stuck" },
  level_cfo: { text: "CFO level", tone: "stuck" },
  above_authority: { text: "above your authority", tone: "stuck" },
  price_difference: { text: "price difference", tone: "working" },
  mismatched: { text: "mismatched", tone: "stuck" },
  short_delivery: { text: "short delivery", tone: "working" },
  damaged: { text: "damaged goods", tone: "working" },
  over_budget: { text: "over budget", tone: "stuck" },
  missing: { text: "items missing", tone: "stuck" },
  incomplete: { text: "incomplete delivery", tone: "working" },
  payment_rejected: { text: "payment rejected", tone: "stuck" },
  changes_requested: { text: "changes requested", tone: "working" },
  blocker: { text: "blocker found", tone: "stuck" },
  major: { text: "major finding", tone: "working" },
  tests_failed: { text: "tests failed", tone: "stuck" },
};

export function flagLabel(flag: string): { text: string; tone: Tone } {
  return FLAGS[flag] ?? { text: flag.replace(/_/g, " "), tone: "neutral" };
}

/** Which side of a decision gateway an outcome id names, when it is one of the approval words. */
export function outcomeSide(when: string | null | undefined): "approve" | "reject" | null {
  const w = (when ?? "").toLowerCase();
  if (["yes", "approve", "approved"].includes(w)) return "approve";
  if (["no", "reject", "rejected", "request_changes", "changes"].includes(w)) return "reject";
  return null;
}

const WHEN: Record<string, string> = { yes: "if approved", no: "if rejected", approve: "if approved", approved: "if approved", reject: "if rejected", rejected: "if rejected", request_changes: "if rejected" };

function whenText(when: string | null): string {
  if (!when) return "";
  if (WHEN[when.toLowerCase()]) return WHEN[when.toLowerCase()];
  return /^(once|if|when|after)\b/i.test(when) ? when : `if ${when}`;
}

export function nextText(next: InboxNext[]): string {
  if (!next.length) return "";
  return "Next: " + next.map((n) => { const w = whenText(n.when); return w ? `${n.title} ${w}` : n.title; }).join("; ");
}

/** "Procure to pay: Approve purchase order" -> "Approve purchase order". */
export function stripProcess(title: string): string {
  return title.replace(/^[^:]+:\s*/, "");
}
