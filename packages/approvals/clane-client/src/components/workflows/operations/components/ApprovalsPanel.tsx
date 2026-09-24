import React, { useMemo, useRef, useState } from 'react';

import { Banner, Button, StatCard, StatusChip } from '../../../../ds';
import { withBase } from '../../../../lib/base';
import { useT } from '../../../../i18n';
import { getInbox } from '../data/api';
import { takeNotice } from '../data/inboxStore';
import type { InboxItem, InboxKind } from '../data/types';
import { useInbox } from '../data/useInbox';
import { flagLabel, groupItems, stripProcess, tilesOf, waitingText } from '../lib/inbox';
import { money } from '../lib/money';
import type { Tone } from '../lib/theme';
import { hhmmss } from '../format';
import { SECTION_MOUNT, paths } from '../paths';
import { SectionTitle } from './page';
import { ErrorBanner, Loading, NothingHere } from './States';
import { TextField } from './TextField';

// The one inbox: approvals, parked steps and questions from agents. Home
// mounts it (summary first, the whole list on request); there is no second
// implementation anywhere. It reads the shared inbox store, so after a
// decision the queue is there at once, without the item just acted on.

const POLL_MS = 10000;
const SUMMARY_ROWS = 5;

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

export type ApprovalsPanelProps = {
  /** Start as the summary (Home's default) or the whole list. */
  initialMode?: 'summary' | 'full';
  /** Open one item. The shell navigates to the Workflow section's item screen. */
  onOpenItem: (key: string) => void;
  /** Where a row links to, for a new tab or a copied link. */
  itemHref?: (key: string) => string;
  /** Rows in summary mode. */
  summaryRows?: number;
};

const defaultHref = (key: string): string => withBase(`${SECTION_MOUNT}${paths.item(key)}`);
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

/** A plain click opens in place through the shell; a modified click keeps the browser's behaviour. */
function openHandler(key: string, onOpenItem: (key: string) => void) {
  return (e: React.MouseEvent<HTMLAnchorElement>): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpenItem(key);
  };
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

function Row({
  item,
  now,
  href,
  onOpen,
}: {
  item: InboxItem;
  now: number;
  href: string;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const { t } = useT();
  const s = item.summary;
  const muted = { fontSize: 12, color: 'var(--text-tertiary)' } as const;
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 12.5 } as const;
  return (
    <a
      href={href}
      onClick={onOpen}
      data-key={item.key}
      data-row="inbox"
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 14,
        alignItems: 'center',
        padding: '11px 14px',
        textDecoration: 'none',
        color: 'var(--ink)',
        background: 'var(--surface-card)',
        borderTop: '1px solid var(--border-subtle)',
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
        {t(`workflow.approvals.action.${item.kind}`)}
      </span>
    </a>
  );
}

/** A compact row for the summary: what, which document, how long it waited. */
function SummaryRow({
  item,
  now,
  href,
  onOpen,
}: {
  item: InboxItem;
  now: number;
  href: string;
  onOpen: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const { t } = useT();
  const s = item.summary;
  const facts = [s?.document, s?.counterparty, s?.amount != null ? money(s.amount, s.currency ?? undefined) : null].filter(Boolean);
  const dot = KINDS.find((k) => k.kind === item.kind)?.dot ?? 'var(--text-faint)';
  return (
    <a
      href={href}
      onClick={onOpen}
      data-key={item.key}
      data-row="inbox"
      style={{
        display: 'grid',
        gridTemplateColumns: '10px minmax(0, 1fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        borderTop: '1px solid var(--border-subtle)',
        textDecoration: 'none',
        color: 'var(--ink)',
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stripProcess(item.title)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.key}</span>
          {facts.length ? ` · ${facts.join(' · ')}` : ''}
        </span>
      </span>
      <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
          {waitingText(item.waiting_since, now)}
        </span>
        {item.overdue ? <StatusChip status="failed">{t('workflow.approvals.overdue')}</StatusChip> : null}
      </span>
    </a>
  );
}

/** j / k move focus between the rows inside `root`; Enter is the focused link's own. */
function onListKey(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (e.key !== 'j' && e.key !== 'k') return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-row="inbox"]')];
  if (!rows.length) return;
  const at = rows.indexOf(target as HTMLAnchorElement);
  const next = e.key === 'j' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
  e.preventDefault();
  rows[next].focus();
  rows[next].scrollIntoView?.({ block: 'nearest' });
}

export function ApprovalsPanel({
  initialMode = 'summary',
  onOpenItem,
  itemHref = defaultHref,
  summaryRows = SUMMARY_ROWS,
}: ApprovalsPanelProps): JSX.Element {
  const { t } = useT();
  const inbox = useInbox(POLL_MS);
  const [mode, setMode] = useState(initialMode);
  const [notice, setNotice] = useState<string | null>(() => takeNotice());
  const [more, setMore] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [process, setProcess] = useState('');
  const [kinds, setKinds] = useState<Set<InboxKind>>(new Set(['approval', 'parked', 'question']));
  const listRef = useRef<HTMLDivElement>(null);
  const now = inbox.updatedAt ?? Date.now();

  const first = inbox.data?.items ?? [];
  const all = useMemo(() => {
    const seen = new Set(first.map((i) => i.key));
    return [...first, ...more.filter((i) => !seen.has(i.key))];
  }, [first, more]);
  const tiles = inbox.data?.tiles;
  const loadedTiles = useMemo(() => tilesOf(all), [all]);
  const waiting = (tiles?.approvals ?? 0) + (tiles?.parked ?? 0) + (tiles?.questions ?? 0);
  const nextCursor = cursor === undefined ? inbox.data?.nextCursor ?? null : cursor;
  const open = (key: string) => openHandler(key, onOpenItem);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await getInbox(nextCursor, 50);
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setMoreError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const noticeBanner = notice ? (
    <Banner tone="success" title={notice} onClose={() => setNotice(null)} />
  ) : null;

  let body: React.ReactNode;
  if (inbox.error && !inbox.data) body = <ErrorBanner error={inbox.error} onRetry={inbox.reload} />;
  else if (!inbox.data) body = <Loading rows={mode === 'summary' ? 3 : 5} />;
  else if (!all.length) body = <NothingHere title={t('workflow.approvals.empty.title')} hint={t('workflow.approvals.empty.hint')} />;
  else if (mode === 'summary') {
    const oldest = [...all].sort((a, b) => a.waiting_since.localeCompare(b.waiting_since)).slice(0, summaryRows);
    body = (
      <div
        ref={listRef}
        onKeyDown={onListKey}
        style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-card)', background: 'var(--surface-card)', overflow: 'hidden' }}
      >
        {oldest.map((i) => (
          <SummaryRow key={i.key} item={i} now={now} href={itemHref(i.key)} onOpen={open(i.key)} />
        ))}
      </div>
    );
  } else {
    const processes = [...new Set(all.map(processOf).filter(Boolean))].sort();
    const shown = all.filter((i) => kinds.has(i.kind) && matches(i, q) && (!process || processOf(i) === process));
    const groups = groupItems(shown);
    body = (
      <div style={{ display: 'grid', gap: 22 }}>
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
                onClick={() =>
                  setKinds((prev) => {
                    const n = new Set(prev);
                    if (n.has(k.kind)) n.delete(k.kind);
                    else n.add(k.kind);
                    return n;
                  })
                }
              >
                {t(`workflow.approvals.kind.${k.kind}`)}
              </ToggleChip>
            ))}
          </div>
        </div>
        <div ref={listRef} onKeyDown={onListKey} style={{ display: 'grid', gap: 22 }}>
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
                        <Row key={i.key} item={i} now={now} href={itemHref(i.key)} onOpen={open(i.key)} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <NothingHere title={t(`workflow.approvals.groupEmpty.${k.kind}`)} />
                )}
              </section>
            );
          })}
        </div>
        {moreError ? <ErrorBanner error={moreError} onRetry={() => void loadMore()} /> : null}
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

  const amounts = Object.entries(loadedTiles.waitingAmount)
    .map(([c, v]) => money(v, c))
    .join(' + ');

  return (
    <section aria-label={t('workflow.approvals.title')} style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
          {t('workflow.approvals.title')}
        </h2>
        {inbox.data ? (
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {waiting ? t('workflow.approvals.waitingCount', { n: waiting }) : null}
            {tiles?.overdue ? ` · ${t('workflow.approvals.overdueCount', { n: tiles.overdue })}` : ''}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {inbox.updatedAt && mode === 'full' ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {t('workflow.approvals.updated', { time: hhmmss(new Date(inbox.updatedAt).toISOString()) })}
            </span>
          ) : null}
          {all.length ? (
            <Button variant="ghost" size="sm" onClick={() => setMode(mode === 'summary' ? 'full' : 'summary')}>
              {mode === 'summary' ? t('workflow.approvals.showAll', { n: waiting }) : t('workflow.approvals.showSummary')}
            </Button>
          ) : null}
          {mode === 'full' ? (
            <Button variant="ghost" size="sm" onClick={inbox.reload}>
              {t('workflow.approvals.refresh')}
            </Button>
          ) : null}
        </span>
      </div>
      {noticeBanner}
      {mode === 'full' && inbox.data ? (
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
      ) : null}
      {inbox.error && inbox.data ? <ErrorBanner error={inbox.error} onRetry={inbox.reload} /> : null}
      {body}
    </section>
  );
}

export default ApprovalsPanel;
