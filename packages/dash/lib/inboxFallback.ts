// Builds /admin/inbox rows from a task and its artefacts. Used by the dashboard's /api/inbox only
// while the engine's /admin/inbox is not deployed; the shapes are the engine's, so screens do not care.
import type { Artifact, InboxItem, InboxSummary, Task } from "./types";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export function summaryOf(_kind: string, content: unknown): InboxSummary {
  const a = o(content);
  const pc = o(a.policy_check);
  const flags: string[] = [];
  if (pc.vendor_approved === false) flags.push("vendor_not_approved");
  if (pc.approver_level === "director" || pc.approver_level === "cfo") flags.push(`level_${pc.approver_level}`);
  if (a.status === "mismatched") flags.push("mismatched");
  if (a.complete === false) flags.push("short_delivery");
  const document = a.po_number ?? a.invoice_number ?? a.grn_number ?? a.payment_ref ?? a.delivery_note_number ?? null;
  const vendor = o(a.vendor).name ?? (typeof a.vendor === "string" ? a.vendor : null) ?? a.counterparty ?? null;
  const amount = a.total ?? a.amount_payable ?? a.amount ?? null;
  const n = amount === null ? null : Number(amount);
  return {
    document: s(document),
    counterparty: s(vendor),
    amount: n !== null && Number.isFinite(n) ? n : null,
    currency: s(a.currency),
    flags,
    produced_by: null,
    produced_at: null,
  };
}

/** One inbox row. `artifacts` are the consumed artefacts for an approval, the task's own for a parked step. */
export function itemFromTask(t: Task, artifacts: Artifact[], now: number): InboxItem {
  const primary = artifacts.find((a) => a.kind === "purchase_order") ?? artifacts[0];
  const summary = primary ? { ...summaryOf(primary.kind, primary.content), produced_at: primary.created_at } : null;
  const deadline = t.deadline ?? null;
  return {
    id: t.id,
    key: t.key,
    kind: t.role === "operator" ? "approval" : "parked",
    state: t.state,
    role: t.role,
    title: t.title,
    workflow_run: t.workflow_run ?? null,
    run_name: null,
    waiting_since: t.updated_at,
    deadline,
    overdue: !!deadline && Date.parse(deadline) < now,
    summary,
    next: [],
    attempts: t.attempts,
    max_attempts: t.max_attempts,
    cost_usd: t.cost_usd,
    budget_usd: t.budget_usd,
  };
}
