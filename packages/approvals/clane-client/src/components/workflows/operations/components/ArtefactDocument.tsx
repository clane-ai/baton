import React from 'react';

import { DataTable, StatusChip } from '../../../../ds';
import { useT } from '../../../../i18n';
import { money } from '../lib/money';
import type { Provenance } from '../data/types';
import { FieldGrid, type FieldItem } from './FieldGrid';

// An artefact rendered as the business document it represents: labelled
// fields, lines with totals, the policy chips and notes. A field carries a
// source marker and confidence when the artefact's _provenance names it.
// Ported from packages/dash/components/item/DocumentPane.tsx.

type Obj = Record<string, unknown>;
type T = (key: string, vars?: Record<string, unknown>) => string;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function provOf(a: Obj): Provenance | null {
  const p = a._provenance;
  return p && typeof p === 'object' ? (p as Provenance) : null;
}

function sourceOf(prov: Provenance | null, path: string): string | null {
  const p = prov?.[path];
  if (!p) return null;
  const page = p.page != null ? ` p.${p.page}` : '';
  const conf = p.confidence != null ? ` · ${Math.round(p.confidence * 100)}%` : '';
  return `${p.source}${page}${conf}`;
}

type F = { label: string; value: unknown; path: string; mono?: boolean; wide?: boolean };
const fieldsOf = (prov: Provenance | null, list: F[]): FieldItem[] =>
  list.map((f) => ({
    label: f.label,
    value: has(f.value) ? str(f.value) : null,
    mono: f.mono,
    wide: f.wide,
    source: sourceOf(prov, f.path),
  }));

function SubHead({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 14,
        color: 'var(--ink)',
        margin: '20px 0 10px',
      }}
    >
      {children}
    </h3>
  );
}

function Quote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p
      style={{
        margin: '10px 0 0',
        padding: '10px 12px',
        borderLeft: '3px solid var(--border-strong)',
        background: 'var(--bg-page)',
        color: 'var(--text-secondary)',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {children}
    </p>
  );
}

function Notes({ items }: { items: string[] }): JSX.Element | null {
  if (!items.length) return null;
  return (
    <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

type Col = { k: string; h: string; n?: boolean; f?: (v: unknown, r: Obj) => string };

/** Document lines. A flagged line (short, damaged, mismatched) is set in the failed colour. */
function Lines({
  cols,
  rows,
  flag,
  total,
  t,
}: {
  cols: Col[];
  rows: Obj[];
  flag?: (r: Obj) => boolean;
  total?: string;
  t: T;
}): JSX.Element {
  if (!rows.length) return <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('workflow.doc.noLines')}</p>;
  const data = rows.map((r) => {
    const bad = flag?.(r) ?? false;
    const row: Record<string, React.ReactNode> = {};
    for (const c of cols) {
      const text = c.f ? c.f(r[c.k], r) : str(r[c.k]);
      row[c.k] = bad ? <span style={{ color: 'var(--red-500)' }}>{text}</span> : text;
    }
    return row;
  });
  return (
    <div style={{ overflowX: 'auto' }}>
      <DataTable
        columns={cols.map((c) => ({ key: c.k, label: c.h, align: c.n ? 'right' : 'left', mono: c.n }))}
        rows={data}
        footer={
          total ? (
            <>
              <span>{t('workflow.doc.total')}</span> <span style={{ color: 'var(--ink)' }}>{total}</span>
            </>
          ) : undefined
        }
      />
    </div>
  );
}

type ChipTone = 'done' | 'failed' | 'running' | 'needsYou';
function Chips({ items }: { items: { text: string; tone: ChipTone }[] }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map((c) => (
        <StatusChip key={c.text} status={c.tone}>
          {c.text}
        </StatusChip>
      ))}
    </div>
  );
}

const moneyCell = (v: unknown): string => money(v);

function PurchaseOrder({ a, t }: { a: Obj; t: T }): JSX.Element {
  const v = obj(a.vendor);
  const pc = obj(a.policy_check);
  const prov = provOf(a);
  const chips: { text: string; tone: ChipTone }[] = [];
  chips.push(
    pc.approval_required
      ? { text: t('workflow.doc.po.approvalRequired'), tone: 'needsYou' }
      : { text: t('workflow.doc.po.noApproval'), tone: 'done' },
  );
  if (has(pc.approver_level)) {
    const level = str(pc.approver_level);
    chips.push({
      text: t('workflow.doc.po.level', { level: cap(level === 'cfo' ? 'CFO' : level) }),
      tone: level === 'director' || level === 'cfo' ? 'failed' : 'done',
    });
  }
  chips.push(
    pc.vendor_approved === false
      ? { text: t('workflow.doc.po.vendorNotApproved'), tone: 'failed' }
      : { text: t('workflow.doc.po.vendorApproved'), tone: 'done' },
  );
  if (pc.within_budget === false) chips.push({ text: t('workflow.doc.po.overBudget'), tone: 'failed' });
  const vendor = has(v.name) ? `${str(v.name)}${has(v.id) ? ` (${str(v.id)})` : ''}` : a.vendor_name;
  return (
    <div>
      <SubHead>{t('workflow.doc.po.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.poNumber'), value: a.po_number, path: 'po_number', mono: true },
          { label: t('workflow.doc.field.requisition'), value: a.requisition, path: 'requisition', mono: true },
          { label: t('workflow.doc.field.vendor'), value: vendor, path: 'vendor' },
          { label: t('workflow.doc.field.costCentre'), value: a.cost_center, path: 'cost_center' },
          { label: t('workflow.doc.field.requester'), value: a.requester, path: 'requester' },
          { label: t('workflow.doc.field.neededBy'), value: a.needed_by, path: 'needed_by' },
          { label: t('workflow.doc.field.deliverTo'), value: a.delivery_address ?? a.deliver_to, path: 'delivery_address', wide: true },
          { label: t('workflow.doc.field.vendorEmail'), value: v.email, path: 'vendor.email' },
          { label: t('workflow.doc.field.paymentTerms'), value: v.payment_terms ?? a.payment_terms, path: 'payment_terms' },
        ])}
      />
      <SubHead>{t('workflow.doc.lines')}</SubHead>
      <Lines
        t={t}
        rows={arr(a.lines)}
        total={money(a.total, a.currency)}
        cols={[
          { k: 'line', h: '#' },
          { k: 'sku', h: t('workflow.doc.col.sku') },
          { k: 'item', h: t('workflow.doc.col.item') },
          { k: 'quantity', h: t('workflow.doc.col.qty'), n: true },
          { k: 'unit_price', h: t('workflow.doc.col.unitPrice'), n: true, f: moneyCell },
          {
            k: 'line_total',
            h: t('workflow.doc.col.total'),
            n: true,
            f: (x, r) => money(has(x) ? x : num(r.quantity) * num(r.unit_price)),
          },
        ]}
      />
      <SubHead>{t('workflow.doc.po.policy')}</SubHead>
      <Chips items={chips} />
      {has(pc.notes) ? <Quote>{str(pc.notes)}</Quote> : null}
    </div>
  );
}

function GoodsReceipt({ a, t }: { a: Obj; t: T }): JSX.Element {
  const prov = provOf(a);
  return (
    <div>
      <SubHead>{t('workflow.doc.grn.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.grnNumber'), value: a.grn_number, path: 'grn_number', mono: true },
          { label: t('workflow.doc.field.purchaseOrder'), value: a.po_number, path: 'po_number', mono: true },
          { label: t('workflow.doc.field.deliveryNote'), value: a.delivery_note_number, path: 'delivery_note_number', mono: true },
          { label: t('workflow.doc.field.received'), value: a.received_at, path: 'received_at' },
          { label: t('workflow.doc.field.receivedBy'), value: a.received_by, path: 'received_by' },
        ])}
      />
      <SubHead>{t('workflow.doc.lines')}</SubHead>
      <Lines
        t={t}
        rows={arr(a.lines)}
        flag={(r) => num(r.quantity_received) < num(r.quantity_ordered) || (has(r.condition) && r.condition !== 'good')}
        cols={[
          { k: 'line', h: '#' },
          { k: 'sku', h: t('workflow.doc.col.sku') },
          { k: 'item', h: t('workflow.doc.col.item') },
          { k: 'quantity_ordered', h: t('workflow.doc.col.ordered'), n: true },
          { k: 'quantity_received', h: t('workflow.doc.col.received'), n: true },
          { k: 'condition', h: t('workflow.doc.col.condition') },
          { k: 'note', h: t('workflow.doc.col.note') },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        <Chips
          items={[
            a.complete
              ? { text: t('workflow.doc.grn.complete'), tone: 'done' }
              : { text: t('workflow.doc.grn.incomplete'), tone: 'failed' },
          ]}
        />
      </div>
      <Notes items={Array.isArray(a.discrepancies) ? a.discrepancies.map(str) : []} />
    </div>
  );
}

function Invoice({ a, t }: { a: Obj; t: T }): JSX.Element {
  const prov = provOf(a);
  const b = obj(a.bank);
  return (
    <div>
      <SubHead>{t('workflow.doc.invoice.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.invoiceNumber'), value: a.invoice_number, path: 'invoice_number', mono: true },
          { label: t('workflow.doc.field.purchaseOrder'), value: a.po_number, path: 'po_number', mono: true },
          { label: t('workflow.doc.field.vendor'), value: a.vendor, path: 'vendor' },
          { label: t('workflow.doc.field.issued'), value: a.issued_at, path: 'issued_at' },
          { label: t('workflow.doc.field.due'), value: a.due_at, path: 'due_at' },
          { label: t('workflow.doc.field.iban'), value: b.iban, path: 'bank.iban', mono: true },
        ])}
      />
      <SubHead>{t('workflow.doc.lines')}</SubHead>
      <Lines
        t={t}
        rows={arr(a.lines)}
        total={money(a.total, a.currency)}
        cols={[
          { k: 'line', h: '#' },
          { k: 'sku', h: t('workflow.doc.col.sku') },
          { k: 'item', h: t('workflow.doc.col.item') },
          { k: 'quantity', h: t('workflow.doc.col.qty'), n: true },
          { k: 'unit_price', h: t('workflow.doc.col.unitPrice'), n: true, f: moneyCell },
          { k: 'line_total', h: t('workflow.doc.col.total'), n: true, f: moneyCell },
        ]}
      />
    </div>
  );
}

function DeliveryNote({ a, t }: { a: Obj; t: T }): JSX.Element {
  const prov = provOf(a);
  const carrier = has(a.carrier) ? `${str(a.carrier)}${has(a.tracking) ? ` · ${str(a.tracking)}` : ''}` : a.tracking;
  return (
    <div>
      <SubHead>{t('workflow.doc.dn.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.noteNumber'), value: a.delivery_note_number, path: 'delivery_note_number', mono: true },
          { label: t('workflow.doc.field.purchaseOrder'), value: a.po_number, path: 'po_number', mono: true },
          { label: t('workflow.doc.field.vendor'), value: a.vendor, path: 'vendor' },
          { label: t('workflow.doc.field.shipped'), value: a.shipped_at, path: 'shipped_at' },
          { label: t('workflow.doc.field.carrier'), value: carrier, path: 'carrier' },
        ])}
      />
      <SubHead>{t('workflow.doc.lines')}</SubHead>
      <Lines
        t={t}
        rows={arr(a.lines)}
        cols={[
          { k: 'line', h: '#' },
          { k: 'sku', h: t('workflow.doc.col.sku') },
          { k: 'item', h: t('workflow.doc.col.item') },
          { k: 'quantity_shipped', h: t('workflow.doc.col.shipped'), n: true },
        ]}
      />
    </div>
  );
}

function InvoiceMatch({ a, t }: { a: Obj; t: T }): JSX.Element {
  const prov = provOf(a);
  const tol = obj(a.tolerance);
  return (
    <div>
      <SubHead>{t('workflow.doc.match.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.status'), value: a.status, path: 'status' },
          { label: t('workflow.doc.field.invoice'), value: a.invoice_number, path: 'invoice_number', mono: true },
          { label: t('workflow.doc.field.purchaseOrder'), value: a.po_number, path: 'po_number', mono: true },
          { label: t('workflow.doc.field.goodsReceipt'), value: a.grn_number, path: 'grn_number', mono: true },
          {
            label: t('workflow.doc.field.tolerance'),
            value: has(tol.price_pct)
              ? t('workflow.doc.match.tolerance', { price: str(tol.price_pct), quantity: str(tol.quantity ?? 0) })
              : undefined,
            path: 'tolerance',
          },
          { label: t('workflow.doc.field.payable'), value: money(a.amount_payable, a.currency), path: 'amount_payable', mono: true },
        ])}
      />
      <SubHead>{t('workflow.doc.lines')}</SubHead>
      <Lines
        t={t}
        rows={arr(a.lines)}
        flag={(r) => r.ok === false}
        cols={[
          { k: 'line', h: '#' },
          { k: 'item', h: t('workflow.doc.col.item') },
          { k: 'ordered_qty', h: t('workflow.doc.col.ordered'), n: true },
          { k: 'received_qty', h: t('workflow.doc.col.received'), n: true },
          { k: 'invoiced_qty', h: t('workflow.doc.col.invoiced'), n: true },
          { k: 'po_unit_price', h: t('workflow.doc.col.poPrice'), n: true, f: moneyCell },
          { k: 'invoice_unit_price', h: t('workflow.doc.col.invoicePrice'), n: true, f: moneyCell },
          { k: 'ok', h: t('workflow.doc.col.ok'), f: (v) => (v ? t('workflow.doc.yes') : t('workflow.doc.no')) },
          { k: 'variance', h: t('workflow.doc.col.variance') },
        ]}
      />
      <Notes items={Array.isArray(a.variances) ? a.variances.map(str) : []} />
      {has(a.summary) ? <Quote>{str(a.summary)}</Quote> : null}
    </div>
  );
}

function Payment({ a, t }: { a: Obj; t: T }): JSX.Element {
  const prov = provOf(a);
  const b = obj(a.beneficiary);
  return (
    <div>
      <SubHead>{t('workflow.doc.payment.title')}</SubHead>
      <FieldGrid
        fields={fieldsOf(prov, [
          { label: t('workflow.doc.field.reference'), value: a.payment_ref, path: 'payment_ref', mono: true },
          { label: t('workflow.doc.field.status'), value: a.status, path: 'status' },
          { label: t('workflow.doc.field.amount'), value: money(a.amount, a.currency), path: 'amount', mono: true },
          { label: t('workflow.doc.field.scheduledFor'), value: a.scheduled_for, path: 'scheduled_for' },
          { label: t('workflow.doc.field.beneficiary'), value: b.name, path: 'beneficiary.name' },
          { label: t('workflow.doc.field.iban'), value: b.iban, path: 'beneficiary.iban', mono: true },
          { label: t('workflow.doc.field.invoice'), value: a.invoice_number, path: 'invoice_number', mono: true },
          { label: t('workflow.doc.field.purchaseOrder'), value: a.po_number, path: 'po_number', mono: true },
        ])}
      />
    </div>
  );
}

function Review({ a, t }: { a: Obj; t: T }): JSX.Element {
  const findings = arr(a.findings);
  return (
    <div>
      <SubHead>{t('workflow.doc.review.title')}</SubHead>
      <Chips
        items={[{ text: cap(str(a.verdict).replace(/_/g, ' ')), tone: a.verdict === 'approve' ? 'done' : 'failed' }]}
      />
      {has(a.summary) ? <Quote>{str(a.summary)}</Quote> : null}
      <Notes
        items={findings.map(
          (x) => `${str(x.severity)} ${str(x.file)}${has(x.line) ? `:${str(x.line)}` : ''} ${str(x.note)}`.trim(),
        )}
      />
    </div>
  );
}

function Handoff({ a, t }: { a: Obj; t: T }): JSX.Element {
  const caveats = Array.isArray(a.caveats) ? a.caveats.map(str) : [];
  return (
    <div>
      <SubHead>{str(a.summary) || t('workflow.doc.handoff.title')}</SubHead>
      {has(a.details) ? (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink)', margin: 0 }}>
          {str(a.details)}
        </pre>
      ) : null}
      {caveats.length ? (
        <>
          <SubHead>{t('workflow.doc.handoff.caveats')}</SubHead>
          <Notes items={caveats} />
        </>
      ) : null}
    </div>
  );
}

function Generic({ a }: { a: Obj }): JSX.Element {
  const prov = provOf(a);
  const flat = Object.entries(a).filter(([k, v]) => k !== '_provenance' && (v === null || typeof v !== 'object'));
  const nested = Object.fromEntries(
    Object.entries(a).filter(([k, v]) => k !== '_provenance' && v !== null && typeof v === 'object'),
  );
  return (
    <div>
      <FieldGrid fields={fieldsOf(prov, flat.map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, path: k })))} />
      {Object.keys(nested).length ? (
        <pre
          style={{
            marginTop: 14,
            padding: 12,
            background: 'var(--bg-page)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(nested, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** One artefact as its business document; unknown kinds fall back to labelled fields. */
export function ArtefactDocument({ kind, content }: { kind: string; content: unknown }): JSX.Element {
  const { t } = useT();
  const a = obj(content);
  if (!Object.keys(a).length) {
    return <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: 0 }}>{t('workflow.doc.empty')}</p>;
  }
  switch (kind) {
    case 'purchase_order':
      return <PurchaseOrder a={a} t={t} />;
    case 'goods_receipt':
      return <GoodsReceipt a={a} t={t} />;
    case 'invoice':
      return <Invoice a={a} t={t} />;
    case 'delivery_note':
      return <DeliveryNote a={a} t={t} />;
    case 'invoice_match':
      return <InvoiceMatch a={a} t={t} />;
    case 'payment':
      return <Payment a={a} t={t} />;
    case 'review':
      return <Review a={a} t={t} />;
    case 'handoff':
      return <Handoff a={a} t={t} />;
    default:
      return <Generic a={a} />;
  }
}
