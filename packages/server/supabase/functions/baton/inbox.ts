// The human-facing read model (docs/ui-brief.md, engine asks 1, 5, 7): what a person sees in the inbox,
// which documents belong to a task, and what was decided. Summaries are built per artefact kind here, so
// "which field is the counterparty" lives next to the schemas and not in the UI.
import { sql } from "./db.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));

export type Summary = { document: string | null; counterparty: string | null; amount: number | null; currency: string | null; flags: string[]; notes: string[]; kind: string | null };

/** One line about an artefact: what it is, who it concerns, how much. Flags are the things a person must notice. */
export function summarise(kind: string | null, content: unknown): Summary {
  const a = obj(content);
  const s: Summary = { document: null, counterparty: null, amount: null, currency: null, flags: [], notes: [], kind };
  switch (kind) {
    case "purchase_order": {
      const v = obj(a.vendor), pc = obj(a.policy_check);
      s.document = str(a.po_number); s.counterparty = str(v.name); s.amount = num(a.total); s.currency = str(a.currency);
      if (pc.vendor_approved === false || v.approved === false) s.flags.push("vendor_not_approved");
      if (pc.approver_level === "director" || pc.approver_level === "cfo") s.flags.push(`level_${pc.approver_level}`);
      if (pc.within_budget === false) s.flags.push("over_budget");
      if (/catalogue price|differs|instead of/i.test(String(pc.notes ?? ""))) s.flags.push("price_difference");
      if (pc.notes) s.notes.push(String(pc.notes));
      break;
    }
    case "invoice": s.document = str(a.invoice_number); s.counterparty = str(a.vendor); s.amount = num(a.total); s.currency = str(a.currency); if (a.due_at) s.notes.push(`due ${str(a.due_at)}`); break;
    case "delivery_note": s.document = str(a.delivery_note_number); s.counterparty = str(a.vendor); break;
    case "goods_receipt": {
      s.document = str(a.grn_number);
      const lines = Array.isArray(a.lines) ? a.lines.map(obj) : [];
      if (lines.some((l) => num(l.quantity_received) != null && num(l.quantity_ordered) != null && (num(l.quantity_received) as number) < (num(l.quantity_ordered) as number))) s.flags.push("short_delivery");
      if (lines.some((l) => l.condition === "damaged")) s.flags.push("damaged");
      if (lines.some((l) => l.condition === "missing")) s.flags.push("missing");
      if (a.complete === false && !s.flags.length) s.flags.push("incomplete");
      for (const d of Array.isArray(a.discrepancies) ? a.discrepancies : []) s.notes.push(String(d));
      break;
    }
    case "invoice_match": s.document = str(a.invoice_number); s.amount = num(a.amount_payable); if (a.status === "mismatched") s.flags.push("mismatched"); for (const v of Array.isArray(a.variances) ? a.variances : []) s.notes.push(String(v)); break;
    case "payment": s.document = str(a.payment_ref); s.counterparty = str(obj(a.beneficiary).name ?? a.vendor); s.amount = num(a.amount); s.currency = str(a.currency); if (a.status === "rejected") s.flags.push("payment_rejected"); break;
    case "review": s.document = str(a.verdict); if (a.verdict === "request_changes") s.flags.push("changes_requested"); for (const f of Array.isArray(a.findings) ? a.findings : []) { const x = obj(f); if (x.severity === "blocker" || x.severity === "major") { s.flags.push(x.severity as string); s.notes.push(`${x.severity}: ${str(x.note) ?? ""}`.slice(0, 160)); } } break;
    case "handoff": s.document = str(a.summary)?.slice(0, 120) ?? null; break;
    case "test_report": s.document = str(a.suite ?? a.summary); if (num(a.failed)) { s.flags.push("tests_failed"); s.notes.push(`${a.failed} failed`); } break;
    case "pr": s.document = str(a.url ?? a.title); break;
    default: s.document = str(a.title ?? a.name ?? a.summary)?.slice(0, 120) ?? null;
  }
  s.flags = [...new Set(s.flags)].slice(0, 6); s.notes = s.notes.slice(0, 6);
  return s;
}

const isPath = (v: unknown): v is string => typeof v === "string" && /^[^\s:*?"<>|]+\.[a-z0-9]{2,5}$/i.test(v) && !v.startsWith("/") && !v.includes("..");
const typeOf = (p: string) => (/\.pdf$/i.test(p) ? "pdf" : /\.eml$/i.test(p) ? "email" : /\.(csv|json)$/i.test(p) ? "data" : "text");

/** Workspace documents an artefact points at: explicit documents[], any *_path field, and the P2P conventions. */
export function documentsOf(kind: string, content: unknown): { label: string; path: string; type: string; from: string; kind: string }[] {
  const a = obj(content);
  const out: { label: string; path: string; type: string; from: string; kind: string }[] = [];
  const add = (label: string, p: unknown, from: string) => { if (isPath(p) && !out.some((x) => x.path === p)) out.push({ label, path: p, type: typeOf(p), from, kind }); };
  for (const d of Array.isArray(a.documents) ? a.documents : []) { const x = obj(d); add(String(x.label ?? x.path ?? ""), x.path, "artefact"); }
  for (const [k, v] of Object.entries(a)) if (/(_path|^path)$/.test(k)) add(`${kind.replace(/_/g, " ")} ${k.replace(/_path$/, "").replace(/_/g, " ")}`.trim(), v, "artefact");
  const r = str(a.requisition), po = str(a.po_number), inv = str(a.invoice_number);
  if (kind === "purchase_order" && r) { add("requisition", `inbox/requisitions/${r}.pdf`, "convention"); add("requisition text", `inbox/requisitions/${r}.txt`, "convention"); add("requester email", `inbox/requisitions/${r}.eml`, "convention"); }
  if (kind === "purchase_order" && po) add("PO email sent", `outbox/${po}.eml`, "convention");
  if (kind === "delivery_note" && po) { add("acknowledgement", `inbox/deliveries/${po}-ack.eml`, "convention"); add("count sheet", `inbox/deliveries/count-${po}.txt`, "convention"); }
  if (kind === "goods_receipt" && po) add("count sheet", `inbox/deliveries/count-${po}.txt`, "convention");
  if (kind === "invoice" && inv) { add("invoice text", `inbox/invoices/${inv}.txt`, "convention"); add("invoice email", `inbox/invoices/${inv}.eml`, "convention"); }
  const rank: Record<string, number> = { email: 0, pdf: 1, text: 2, data: 3 };
  return out.sort((x, y) => (rank[x.type] ?? 9) - (rank[y.type] ?? 9));
}

/** The decision recorded on an operator task, from its events. */
export function decisionOf(events: Json[]): Json | null {
  const e = events.find((x) => x.type === "approved" || x.type === "rejected");
  if (!e) return null;
  const p = obj(e.payload);
  return { verdict: e.type === "approved" ? "approve" : "reject", by: str(p.by), at: e.ts, reason: str(p.reason) };
}

/** Human inbox: approvals, parked tasks and open questions to nobody, each with a server-built summary. */
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => { try { return decodeURIComponent(escape(atob(s))); } catch { return ""; } };

/** Opaque keyset cursor: "<sort value>|<id>". Survives redeploys and rows changing under the reader. */
export function encodeCursor(sortValue: string, id: string): string { return b64(`${sortValue}|${id}`); }
export function decodeCursor(c: string | null): { sortValue: string; id: string } | null {
  if (!c) return null;
  const s = unb64(c); const i = s.lastIndexOf("|");
  return i > 0 ? { sortValue: s.slice(0, i), id: s.slice(i + 1) } : null;
}

export async function inboxJson(cursor: string | null = null, limit = 50): Promise<Json> {
  const rows = await sql`
    with waiting as (
      select t.* from baton.tasks t where t.state in ('needs_human', 'failed')
    ), q as (
      select m.*, t.key as tkey from baton.messages m join baton.tasks t on t.id = m.task_id
       where m.kind = 'question' and m.answered_at is null and m.to_agent is null and m.to_role is null
    )
    select 'task' as row_kind, baton.task_json(t) as task, null::jsonb as question,
           (select r.workflow_name from baton.workflow_runs r where r.key = t.workflow_run) as run_name,
           (select jsonb_build_object('kind', a.kind, 'content', a.content, 'created_at', a.created_at, 'task_key', (select key from baton.tasks where id = a.task_id))
              from baton.artifacts a, jsonb_array_elements(t.consumes) c
             where a.kind::text = c->>'kind' and (c->>'from_task' is null or a.task_id = (c->>'from_task')::uuid)
             order by a.created_at desc limit 1) as input,
           (select jsonb_build_object('kind', a.kind, 'content', a.content, 'created_at', a.created_at) from baton.artifacts a where a.task_id = t.id order by a.created_at desc limit 1) as own,
           (select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'title', d.title, 'when', d.condition->>'outcome') order by d.priority desc), '[]'::jsonb)
              from baton.tasks d where t.id = any(d.depends_on) and d.state not in ('cancelled')) as next,
           (select max(e.ts) from baton.events e where e.task_id = t.id and e.type in ('approval_required', 'task_state_changed', 'deadline_passed', 'gate_failed')) as waiting_since,
           exists (select 1 from baton.events e where e.task_id = t.id and e.type = 'approval_overdue') as overdue,
           (select jsonb_build_object('type', e.type, 'ts', e.ts, 'payload', e.payload) from baton.events e where e.task_id = t.id and e.type in ('gate_failed', 'artifact_rejected', 'deadline_passed', 'budget_exceeded', 'task_released', 'delegation_failed') order by e.id desc limit 1) as last_failure,
           (select name from baton.agents where id = t.assignee) as assignee_name
      from waiting t
    union all
    select 'question', baton.task_json(t), (select baton.message_json(m) from baton.messages m where m.id = q.id), (select r.workflow_name from baton.workflow_runs r where r.key = t.workflow_run), null, null, '[]'::jsonb, q.created_at, false, null, null
      from q join baton.tasks t on t.id = q.task_id
    order by 8 nulls last`;
  const items: Json[] = [];
  let approvals = 0, parked = 0, questions = 0, overdue = 0;
  for (const r of rows) {
    const t = r.task as Json;
    const isQ = r.row_kind === "question";
    const approval = !isQ && t.role === "operator";
    const src = (approval ? r.input : r.own ?? r.input) as Json | null;
    const summary = summarise(src ? String(src.kind) : null, src?.content);
    const kind = isQ ? "question" : approval ? "approval" : "parked";
    if (kind === "approval") approvals++; else if (kind === "parked") parked++; else questions++;
    if (r.overdue) overdue++;
    items.push({
      id: t.id, key: t.key, kind, state: t.state, role: t.role, title: t.title, workflow_run: t.workflow_run ?? null, run_name: r.run_name ?? null,
      waiting_since: r.waiting_since ?? t.updated_at, deadline: t.deadline ?? null, overdue: !!r.overdue,
      summary: { ...summary, produced_by: src?.task_key ?? null, produced_at: src?.created_at ?? null },
      next: r.next ?? [], question: isQ ? r.question : null, last_failure: r.last_failure ?? null,
      attempts: t.attempts, max_attempts: t.max_attempts, cost_usd: t.cost_usd, budget_usd: t.budget_usd, assignee: r.assignee_name ?? null,
    });
  }
  // keyset page over (waiting_since asc, id asc); tiles always describe the whole inbox
  items.sort((a, b) => String(a.waiting_since).localeCompare(String(b.waiting_since)) || String(a.id).localeCompare(String(b.id)));
  const c = decodeCursor(cursor);
  const start = c ? items.findIndex((i) => `${i.waiting_since}` > c.sortValue || (`${i.waiting_since}` === c.sortValue && String(i.id) > c.id)) : 0;
  const from = start < 0 ? items.length : start;
  const cap = Math.max(1, Math.min(50, limit));
  const page = items.slice(from, from + cap);
  const last = page[page.length - 1];
  const next_cursor = from + cap < items.length && last ? encodeCursor(String(last.waiting_since), String(last.id)) : null;
  return { ok: true, tiles: { approvals, parked, questions, overdue, total: items.length }, items: page, next_cursor, limit: cap };
}
