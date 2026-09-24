import React, { useMemo, useState } from 'react';

import { Button, Card, StatusChip } from '../../../../ds';
import { useT } from '../../../../i18n';
import { kindLabel as kindLabelOf } from '../lib/labels';
import { getArtifacts } from '../data/api';
import { useAsync } from '../data/hook';
import type { Artifact } from '../data/types';
import { flagLabel } from '../lib/inbox';
import { money } from '../lib/money';
import { documentNumber, summaryOf } from '../lib/summary';
import { dateTime } from '../format';
import { paths } from '../paths';
import { ArtefactDocument } from '../components/ArtefactDocument';
import { LinkButton } from '../components/LinkButton';
import { Page } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TextField } from '../components/TextField';

// Documents: find a purchase order, receipt, invoice, match, payment or review
// by number, vendor or step, and read it beside the list.

const KINDS = [
  'purchase_order',
  'goods_receipt',
  'invoice',
  'delivery_note',
  'invoice_match',
  'payment',
  'review',
  'handoff',
  'task_spec',
  'test_report',
];

type Art = Artifact & { task_key?: string | null };

export function Documents(): JSX.Element {
  const { t } = useT();
  const [kind, setKind] = useState('purchase_order');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useAsync(() => getArtifacts({ kind }) as Promise<Art[]>, [kind]);

  const kindLabel = (k: string): string => kindLabelOf(t, k);
  const plural = (k: string): string => {
    const key = `workflow.kindPlural.${k}`;
    const v = t(key);
    return v === key ? `${kindLabel(k).toLowerCase()} documents` : v;
  };

  const rows = useMemo(() => {
    const all = (list.data ?? []).map((a) => ({ a, s: summaryOf(a.kind, a.content), n: documentNumber(a.kind, a.content) }));
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(({ a, s, n }) =>
      `${a.task_key ?? ''} ${n} ${s.counterparty ?? ''} ${JSON.stringify(a.content ?? '')}`.toLowerCase().includes(needle),
    );
  }, [list.data, q]);
  const open = rows.find((r) => r.a.id === openId) ?? null;

  let listBody: React.ReactNode;
  if (list.error && !list.data) listBody = <ErrorBanner error={list.error} onRetry={list.reload} />;
  else if (list.loading && !list.data) listBody = <Loading rows={5} />;
  else if (!rows.length) {
    listBody = q ? (
      <NothingHere title={t('workflow.documents.noMatch.title')} hint={t('workflow.documents.noMatch.hint')} />
    ) : (
      <NothingHere title={t('workflow.documents.empty.title', { kinds: plural(kind) })} hint={t('workflow.documents.empty.hint')} />
    );
  } else {
    listBody = (
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-card)', background: 'var(--surface-card)', overflow: 'hidden' }}>
        {rows.map(({ a, s, n }, i) => {
          const on = a.id === openId;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => setOpenId(on ? null : a.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(140px, 1.4fr) 130px',
                gap: 12,
                alignItems: 'center',
                width: '100%',
                padding: '11px 14px',
                background: on ? 'var(--blue-tint)' : 'transparent',
                border: 0,
                borderTop: i ? '1px solid var(--border-subtle)' : 0,
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--ink)',
              }}
            >
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{n || kindLabel(a.kind)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {a.task_key ? `${a.task_key} · ` : ''}
                  {dateTime(a.created_at)}
                </span>
              </span>
              <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.counterparty ?? ''}</span>
                {s.flags.length ? (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {s.flags.map((f) => (
                      <StatusChip key={f} status="failed">
                        {flagLabel(f).text}
                      </StatusChip>
                    ))}
                  </span>
                ) : null}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right' }}>
                {s.amount != null ? money(s.amount, s.currency ?? undefined) : ''}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Page
      breadcrumb={t('workflow.breadcrumb')}
      title={t('workflow.nav.documents')}
      actions={
        <Button variant="ghost" size="sm" onClick={list.reload}>
          {t('workflow.approvals.refresh')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
          <div style={{ display: 'grid', gap: 7 }}>
            <label
              htmlFor="workflow-documents-kind"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}
            >
              {t('workflow.documents.kind')}
            </label>
            <select
              id="workflow-documents-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setOpenId(null);
              }}
              style={{
                font: 'inherit',
                fontSize: 13.5,
                padding: '8px 10px',
                color: 'var(--ink)',
                background: 'var(--surface-card)',
                border: '1px solid var(--scrollbar-thumb)',
                borderRadius: 'var(--radius-input)',
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
            <TextField
              id="workflow-documents-search"
              label={t('workflow.approvals.search')}
              type="search"
              placeholder={t('workflow.documents.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {list.data ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {t('workflow.approvals.shown', { shown: rows.length, all: list.data.length })}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 18, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>{listBody}</div>
          {open ? (
            <section aria-label={`${kindLabel(open.a.kind)} ${open.n}`.trim()} style={{ minWidth: 0 }}>
              <Card app style={{ display: 'grid', gap: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                    {`${kindLabel(open.a.kind)} ${open.n}`.trim()}
                  </h2>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {open.a.task_key ? <LinkButton to={paths.item(open.a.task_key)}>{t('workflow.documents.openItem')}</LinkButton> : null}
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                      {t('workflow.documents.close')}
                    </Button>
                  </span>
                </div>
                <ArtefactDocument kind={open.a.kind} content={open.a.content} />
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
