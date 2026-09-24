import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button, StatCard, StatusChip } from '../../../../ds';
import { useT } from '../../../../i18n';
import { getInbox } from '../data/api';
import { usePoll } from '../data/hook';
import type { InboxItem, InboxKind } from '../data/types';
import { flagLabel, groupItems, stripProcess, tilesOf, waitingText } from '../lib/inbox';
import { money } from '../lib/money';
import type { Tone } from '../lib/theme';
import { hhmmss } from '../format';
import { paths } from '../paths';
import { Page, SectionTitle } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TextField } from '../components/TextField';

// Approvals: what needs a person now. Counts, filters, one list per kind
// (decisions, parked steps, questions), j/k/Enter to move and open.

const POLL_MS = 10000;

const TONE_STATUS: Record<Tone, string> = {
  done: 'done',
  working: 'running',
  stuck: 'failed',
  waiting: 'needsYou',
  info: 'needsYou',
  neutral: 'var(--text-faint)',
};

const KINDS: { kind: InboxKind; group: 'approvals' | 'parked' | 'questions'; dot: string }[] = [
  { kind: 'approval', group: 'approvals', dot: 'var(--blue-500)' },
  { kind: 'parked', group: 'parked', dot: 'var(--red-500)' },
  { kind: 'question', group: 'questions', dot: 'var(--orange-500)' },
];

const processOf = (i: InboxItem): string => i.run_name ?? i.workflow_run?.replace(/-\d+$/, '') ?? '';

function matches(item: InboxItem, q: string): boolean {
  if (!q) return true;
  const s = item.summary;
  const hay = [item.key, item.title, item.workflow_run, item.run_name, s?.document, s?.counterparty]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** A filter chip in the shared Chip's look, as a real toggle button. */
function ToggleChip({
  on,
  dot,
  count,
  onClick,
  children,
}: {
  on: boolean;
  dot: string;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        padding: '5px 12px',
        borderRadius: 'var(--radius-pill)',
        color: on ? 'var(--ink)' : 'var(--text-secondary)',
        fontWeight: on ? 500 : 400,
        whiteSpace: 'nowrap',
        background: on ? 'var(--blue-tint)' : 'var(--surface-card)',
        border: `1px solid ${on ? 'var(--blue-selected-border)' : 'var(--border-default)'}`,
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {children}
      <span style={{ fontSize: 10, color: on ? 'var(--blue-500)' : 'var(--text-faint)' }}>{count}</span>
    </button>
  );
}

const COLS = 'minmax(180px, 2fr) minmax(90px, 1fr) minmax(150px, 2fr) minmax(110px, 1fr) minmax(140px, 2fr) minmax(90px, 1fr) 84px';

function Row({ item, selected, now }: { item: InboxItem; selected: boolean; now: number }): JSX.Element {
  const { t } = useT();
  const s = item.summary;
  const action = t(`workflow.approvals.action.${item.kind}`);
  const muted = { fontSize: 12, color: 'var(--text-tertiary)' } as const;
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 12.5 } as const;
  return (
    <Link
      to={paths.item(item.key)}
      aria-current={selected ? 'true' : undefined}
      data-key={item.key}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 14,
        alignItems: 'center',
        padding: '11px 14px',
        textDecoration: 'none',
        color: 'var(--ink)',
        background: selected ? 'var(--blue-tint)' : 'var(--surface-card)',
        borderTop: '1px solid var(--border-subtle)',
        outline: selected ? '1px solid var(--blue-selected-border)' : 'none',
        outlineOffset: -1,
      }}
    >
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <span style={{ ...mono, fontWeight: 500 }}>{item.key}</span>
        <span style={{ ...muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stripProcess(item.title)}
          {item.kind === 'parked' ? ` · ${item.role}` : ''}
        </span>
      </span>
      <span style={{ ...mono, color: 'var(--text-secondary)' }}>{item.workflow_run ?? ''}</span>
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        {s?.document ? <span style={mono}>{s.document}</span> : <span style={muted}>{t('workflow.approvals.noDocument')}</span>}
        {s?.counterparty ? <span style={muted}>{s.counterparty}</span> : null}
      </span>
      <span style={{ ...mono, textAlign: 'right' }}>{s?.amount != null ? money(s.amount, s.currency ?? undefined) : ''}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(s?.flags ?? []).map((f) => {
          const l = flagLabel(f);
          return (
            <StatusChip key={f} status={TONE_STATUS[l.tone]}>
              {l.text}
            </StatusChip>
          );
        })}
        {item.kind === 'parked' ? (
          <StatusChip status="running">
            {t('workflow.approvals.attempts', { attempts: item.attempts, max: item.max_attempts })}
          </StatusChip>
        ) : null}
      </span>
      <span style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
        <span style={{ ...mono, color: 'var(--text-secondary)' }}>{waitingText(item.waiting_since, now)}</span>
        {item.overdue ? <StatusChip status="failed">{t('workflow.approvals.overdue')}</StatusChip> : null}
      </span>
      <span
        aria-hidden="true"
        style={{
          justifySelf: 'end',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--blue-500)',
          border: '1px solid var(--blue-500)',
          borderRadius: 'var(--radius-btn)',
          padding: '5px 12px',
        }}
      >
        {action}
      </span>
    </Link>
  );
}

export function Approvals(): JSX.Element {
  const { t } = useT();
  const navigate = useNavigate();
  const inbox = usePoll(() => getInbox(null, 50), [], POLL_MS);
  const [more, setMore] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [process, setProcess] = useState('');
  const [kinds, setKinds] = useState<Set<InboxKind>>(new Set(['approval', 'parked', 'question']));
  const [sel, setSel] = useState<string | null>(null);
  const now = inbox.updatedAt ?? Date.now();

  const all = useMemo(() => {
    const first = inbox.data?.items ?? [];
    const seen = new Set(first.map((i) => i.key));
    return [...first, ...more.filter((i) => !seen.has(i.key))];
  }, [inbox.data, more]);
  const nextCursor = cursor === undefined ? inbox.data?.nextCursor ?? null : cursor;

  const processes = useMemo(() => [...new Set(all.map(processOf).filter(Boolean))].sort(), [all]);
  const shown = useMemo(
    () => all.filter((i) => kinds.has(i.kind) && matches(i, q) && (!process || processOf(i) === process)),
    [all, kinds, q, process],
  );
  const groups = useMemo(() => groupItems(shown), [shown]);
  const order = useMemo(
    () => KINDS.filter((k) => kinds.has(k.kind)).flatMap((k) => groups[k.group].map((i) => i.key)),
    [groups, kinds],
  );
  const loadedTiles = useMemo(() => tilesOf(all), [all]);
  const tiles = inbox.data?.tiles;

  useEffect(() => {
    if (!order.length) setSel(null);
    else if (!sel || !order.includes(sel)) setSel(order[0]);
  }, [order, sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!order.length) return;
      const i = sel ? order.indexOf(sel) : -1;
      if (e.key === 'j') {
        setSel(order[Math.min(order.length - 1, i + 1)]);
        e.preventDefault();
      } else if (e.key === 'k') {
        setSel(order[Math.max(0, i - 1)]);
        e.preventDefault();
      } else if (e.key === 'Enter' && sel) {
        navigate(paths.item(sel));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, sel, navigate]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getInbox(nextCursor, 50);
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = (k: InboxKind): void =>
    setKinds((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const amounts = Object.entries(loadedTiles.waitingAmount)
    .map(([c, v]) => money(v, c))
    .join(' + ');

  const actions = (
    <>
      {inbox.updatedAt ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          {t('workflow.approvals.updated', { time: hhmmss(new Date(inbox.updatedAt).toISOString()) })}
        </span>
      ) : null}
      <Button variant="ghost" size="sm" onClick={inbox.reload}>
        {t('workflow.approvals.refresh')}
      </Button>
    </>
  );

  let body: React.ReactNode;
  if (inbox.error && !inbox.data) {
    body = <ErrorBanner error={inbox.error} onRetry={inbox.reload} />;
  } else if (!inbox.data) {
    body = <Loading rows={5} />;
  } else if (!all.length) {
    body = <NothingHere title={t('workflow.approvals.empty.title')} hint={t('workflow.approvals.empty.hint')} />;
  } else {
    body = (
      <div style={{ display: 'grid', gap: 22 }}>
        {inbox.error ? <ErrorBanner error={inbox.error} onRetry={inbox.reload} /> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
          <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
            <TextField
              id="workflow-approvals-search"
              label={t('workflow.approvals.search')}
              hideLabel
              type="search"
              placeholder={t('workflow.approvals.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {processes.length > 1 ? (
            <select
              aria-label={t('workflow.approvals.process')}
              value={process}
              onChange={(e) => setProcess(e.target.value)}
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
              <option value="">{t('workflow.approvals.allProcesses')}</option>
              {processes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {KINDS.map((k) => (
              <ToggleChip
                key={k.kind}
                on={kinds.has(k.kind)}
                dot={k.dot}
                count={groups[k.group].length}
                onClick={() => toggle(k.kind)}
              >
                {t(`workflow.approvals.kind.${k.kind}`)}
              </ToggleChip>
            ))}
          </div>
        </div>

        {KINDS.filter((k) => kinds.has(k.kind)).map((k) => {
          const rows = groups[k.group];
          const label = t(`workflow.approvals.group.${k.kind}`);
          return (
            <section key={k.kind} aria-label={label}>
              <SectionTitle meta={String(rows.length)}>{label}</SectionTitle>
              {rows.length ? (
                <div
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-card)',
                    overflowX: 'auto',
                    background: 'var(--surface-card)',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: COLS,
                      gap: 14,
                      padding: '9px 14px',
                      background: 'var(--bg-page)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      color: 'var(--text-tertiary)',
                      minWidth: 900,
                    }}
                  >
                    <span>{t('workflow.approvals.col.item')}</span>
                    <span>{t('workflow.approvals.col.run')}</span>
                    <span>{t('workflow.approvals.col.document')}</span>
                    <span style={{ textAlign: 'right' }}>{t('workflow.approvals.col.amount')}</span>
                    <span>{t('workflow.approvals.col.policy')}</span>
                    <span>{t('workflow.approvals.col.waiting')}</span>
                    <span />
                  </div>
                  <div style={{ minWidth: 900 }}>
                    {rows.map((i) => (
                      <Row key={i.key} item={i} selected={sel === i.key} now={now} />
                    ))}
                  </div>
                </div>
              ) : (
                <NothingHere title={t(`workflow.approvals.groupEmpty.${k.kind}`)} />
              )}
            </section>
          );
        })}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
          }}
        >
          <span>{t('workflow.approvals.shown', { shown: shown.length, all: tiles?.total ?? all.length })}</span>
          {nextCursor ? (
            <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {t('workflow.approvals.more')}
            </Button>
          ) : null}
          <span style={{ marginLeft: 'auto' }}>{t('workflow.approvals.keys')}</span>
        </div>
      </div>
    );
  }

  return (
    <Page breadcrumb={t('workflow.breadcrumb')} title={t('workflow.nav.approvals')} actions={actions}>
      <div style={{ display: 'grid', gap: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <StatCard
            label={t('workflow.approvals.tile.waiting')}
            value={tiles?.approvals ?? loadedTiles.waiting}
            delta={amounts || undefined}
            deltaColor="var(--text-secondary)"
          />
          <StatCard
            label={t('workflow.approvals.tile.parked')}
            value={tiles?.parked ?? loadedTiles.parked}
            valueColor={(tiles?.parked ?? 0) > 0 ? 'var(--red-500)' : undefined}
          />
          <StatCard label={t('workflow.approvals.tile.questions')} value={tiles?.questions ?? loadedTiles.questions} />
          <StatCard
            label={t('workflow.approvals.tile.overdue')}
            value={tiles?.overdue ?? loadedTiles.overdue}
            valueColor={(tiles?.overdue ?? 0) > 0 ? 'var(--red-500)' : undefined}
          />
        </div>
        {body}
      </div>
    </Page>
  );
}
