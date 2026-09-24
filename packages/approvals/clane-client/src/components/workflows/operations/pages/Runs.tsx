import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, ProgressBar, StatCard, StatusChip } from '../../../../ds';
import { useT } from '../../../../i18n';
import { getRuns } from '../data/api';
import { usePaged } from '../data/hook';
import type { WorkflowRun } from '../data/types';
import { runTone, type Tone } from '../lib/theme';
import { dateTime, usd } from '../format';
import { paths } from '../paths';
import { Page } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TextField } from '../components/TextField';

// Runs: every instance of a process, where it stands and what it cost.

export const RUN_STATUS: Record<Tone, string> = {
  done: 'done',
  working: 'running',
  waiting: 'needsYou',
  stuck: 'failed',
  info: 'var(--text-faint)',
  neutral: 'var(--text-faint)',
};

export function progressOf(counts: Record<string, number>): { done: number; total: number } {
  const done = Number(counts?.done ?? 0);
  const total = Object.values(counts ?? {}).reduce((a, n) => a + Number(n), 0);
  return { done, total };
}

/** "Done", "Needs you", … from the catalogue, or the status in words. */
export function useRunStatusLabel(): (status: string) => string {
  const { t } = useT();
  return (status: string) => {
    const key = `workflow.runStatus.${status}`;
    const v = t(key);
    return v === key ? status.replace(/_/g, ' ') : v;
  };
}

const COLS = 'minmax(150px, 1.4fr) minmax(140px, 1.4fr) 120px minmax(150px, 1.4fr) 110px 150px 150px';

export function Runs(): JSX.Element {
  const { t } = useT();
  const label = useRunStatusLabel();
  const runs = usePaged(
    (cursor) => getRuns(cursor, 50).then((r) => ({ items: r.runs, nextCursor: r.nextCursor })),
    [],
    (r: WorkflowRun) => r.key,
  );
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = runs.items;
  const statuses = useMemo(() => [...new Set(list.map((r) => r.status))].sort(), [list]);
  const shown = useMemo(
    () =>
      list.filter(
        (r) =>
          (!status || r.status === status) &&
          (!q || `${r.key} ${r.workflow_name ?? ''} ${r.input ?? ''}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [list, q, status],
  );
  const count = (s: string): number => list.filter((r) => r.status === s).length;

  let body: React.ReactNode;
  if (runs.error && !list.length) body = <ErrorBanner error={runs.error} onRetry={runs.reload} />;
  else if (runs.loading && !list.length) body = <Loading rows={5} />;
  else if (!list.length) body = <NothingHere title={t('workflow.runs.empty.title')} hint={t('workflow.runs.empty.hint')} />;
  else if (!shown.length) body = <NothingHere title={t('workflow.runs.noMatch.title')} hint={t('workflow.runs.noMatch.hint')} />;
  else {
    body = (
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-card)', overflowX: 'auto', background: 'var(--surface-card)' }}>
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
            minWidth: 960,
          }}
        >
          <span>{t('workflow.runs.col.run')}</span>
          <span>{t('workflow.runs.col.process')}</span>
          <span>{t('workflow.runs.col.status')}</span>
          <span>{t('workflow.runs.col.progress')}</span>
          <span style={{ textAlign: 'right' }}>{t('workflow.runs.col.cost')}</span>
          <span>{t('workflow.runs.col.started')}</span>
          <span>{t('workflow.runs.col.finished')}</span>
        </div>
        <div style={{ minWidth: 960 }}>
          {shown.map((r) => {
            const p = progressOf(r.counts);
            const tone = runTone(r.status);
            return (
              <Link
                key={r.key}
                to={paths.run(r.key)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 14,
                  alignItems: 'center',
                  padding: '11px 14px',
                  borderTop: '1px solid var(--border-subtle)',
                  textDecoration: 'none',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{r.key}</span>
                  {r.input ? <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{r.input}</span> : null}
                </span>
                <span style={{ fontSize: 13 }}>{r.workflow_name ?? r.workflow_key ?? ''}</span>
                <span>
                  <StatusChip status={RUN_STATUS[tone]}>{label(r.status)}</StatusChip>
                </span>
                <span style={{ display: 'grid', gap: 5 }}>
                  <ProgressBar value={p.done} max={Math.max(1, p.total)} color={tone === 'stuck' ? 'var(--red-500)' : undefined} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {t('workflow.runs.progress', { done: p.done, total: p.total })}
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right' }}>
                  {usd(r.cost_usd)}
                  {Number(r.cost_credits) ? (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {t('workflow.runs.credits', { n: Number(r.cost_credits).toFixed(0) })}
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{dateTime(r.created_at)}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.finished_at ? dateTime(r.finished_at) : ''}</span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Page
      breadcrumb={t('workflow.breadcrumb')}
      title={t('workflow.nav.runs')}
      actions={
        <Button variant="ghost" size="sm" onClick={runs.reload}>
          {t('workflow.approvals.refresh')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <StatCard label={t('workflow.runs.tile.loaded')} value={list.length} />
          <StatCard label={t('workflow.runs.tile.running')} value={count('running') + count('pending')} />
          <StatCard label={t('workflow.runs.tile.waiting')} value={count('needs_human')} />
          <StatCard
            label={t('workflow.runs.tile.failed')}
            value={count('failed')}
            valueColor={count('failed') ? 'var(--red-500)' : undefined}
          />
        </div>
        {list.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <TextField
                id="workflow-runs-search"
                label={t('workflow.runs.search')}
                hideLabel
                type="search"
                placeholder={t('workflow.runs.searchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label={t('workflow.runs.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
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
              <option value="">{t('workflow.runs.allStatuses')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {body}
        {runs.hasMore ? (
          <div>
            <Button variant="secondary" size="sm" onClick={runs.loadMore} disabled={runs.loading}>
              {t('workflow.approvals.more')}
            </Button>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
