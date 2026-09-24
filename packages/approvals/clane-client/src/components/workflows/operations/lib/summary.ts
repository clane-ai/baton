// The headline facts of an artefact for a list row: its number, counterparty,
// amount and policy flags. Ported from packages/dash/lib/inboxFallback.ts
// (summaryOf only; the inbox fallback itself stays with the reference app).
import type { InboxSummary } from '../data/types';

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function summaryOf(_kind: string, content: unknown): InboxSummary {
  const a = o(content);
  const pc = o(a.policy_check);
  const flags: string[] = [];
  if (pc.vendor_approved === false) flags.push('vendor_not_approved');
  if (pc.approver_level === 'director' || pc.approver_level === 'cfo') flags.push(`level_${pc.approver_level}`);
  if (a.status === 'mismatched') flags.push('mismatched');
  if (a.complete === false) flags.push('short_delivery');
  const document = a.po_number ?? a.invoice_number ?? a.grn_number ?? a.payment_ref ?? a.delivery_note_number ?? null;
  const vendor = o(a.vendor).name ?? (typeof a.vendor === 'string' ? a.vendor : null) ?? a.counterparty ?? null;
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

const OWN_NUMBER: Record<string, string> = {
  purchase_order: 'po_number',
  invoice: 'invoice_number',
  goods_receipt: 'grn_number',
  delivery_note: 'delivery_note_number',
  payment: 'payment_ref',
  invoice_match: 'invoice_number',
};
const ANY_NUMBER = ['po_number', 'invoice_number', 'grn_number', 'payment_ref', 'delivery_note_number'];

/** The document's own number: an invoice by its invoice number, not by the PO it references. */
export function documentNumber(kind: string, content: unknown): string {
  const a = o(content);
  const own = OWN_NUMBER[kind];
  const v = (own ? a[own] : undefined) ?? ANY_NUMBER.map((k) => a[k]).find((x) => x !== undefined && x !== null && x !== '');
  return v === undefined || v === null ? '' : String(v);
}
