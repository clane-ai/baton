import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { BarChart, Button, Card, DataTable, StatCard, StatusChip } from '../../../../ds';
import { useT } from '../../../../i18n';
import { getRuns, getSpend } from '../data/api';
import { useAsync } from '../data/hook';
import { stripProcess } from '../lib/inbox';
import { dsStatus, runTone, stateLabel } from '../lib/theme';
import { usd } from '../format';
import { paths } from '../paths';
import { Page, SectionTitle } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { RUN_STATUS, useRunStatusLabel } from './Runs';

// Spend: what the agents cost, by run, role, day and step. Dollars come from
// Claude Code runs and credits from Clane runs; nothing is converted.

const linkRow = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  gap: 12,
  alignItems: 'center',
  padding: '10px 14px',
  borderTop: '1px solid var(--border-subtle)',
  textDecoration: 'none',
  color: 'var(--ink)',
} as const;

export function Spend(): JSX.Element {
  const { t } = useT();
  const label = useRunStatusLabel();
  const spend = useAsync(getSpend, []);
  const runs = useAsync(() => getRuns(null, 50), []);
  const s = spend.data;
  const byRun = useMemo(
    () =>
      (runs.data?.runs ?? [])
        .filter((r) => Number(r.cost_usd) > 0 || Number(r.cost_credits) > 0)
        .sort((a, b) => Number(b.cost_usd) - Number(a.cost_usd) || Number(b.cost_credits) - Number(a.cost_credits)),
    [runs.data],
  );
  const days = (s?.by_day ?? []).filter((d) => Number(d.cost_usd) > 0);
  const nothing =
    !!s && !Number(s.total_usd) && !Number(s.total_credits ?? 0) && !(s.by_task ?? []).length && !(s.by_role ?? []).length;

  const reload = (): void => {
    spend.reload();
    runs.reload();
  };

  let body: React.ReactNode;
  if (spend.error && !s) body = <ErrorBanner error={spend.error} onRetry={reload} />;
  else if (!s) body = <Loading rows={5} />;
  else if (nothing) body = <NothingHere title={t('workflow.spend.empty.title')} hint={t('workflow.spend.empty.hint')} />;
  else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 18, alignItems: 'start' }}>
        <Card app>
          <SectionTitle>{t('workflow.spend.byDay')}</SectionTitle>
          {days.length ? (
            <div role="img" aria-label={t('workflow.spend.chart')}>
              <BarChart
                data={days.map((d, i) => ({ label: d.day ? String(d.day).slice(5) : String(i + 1), value: Number(d.cost_usd) }))}
                height={160}
                formatValue={(v: number) => usd(v)}
              />
            </div>
          ) : (
            <NothingHere title={t('workflow.spend.noDays')} />
          )}
        </Card>
        <Card app>
          <SectionTitle>{t('workflow.spend.byRole')}</SectionTitle>
          <DataTable
            columns={[
              { key: 'role', label: t('workflow.spend.col.role') },
              { key: 'usd', label: t('workflow.spend.col.usd'), align: 'right', mono: true },
              { key: 'credits', label: t('workflow.spend.col.credits'), align: 'right', mono: true },
            ]}
            rows={(s.by_role ?? []).map((r) => ({
              role: r.role ?? '',
              usd: usd(r.cost_usd),
              credits: r.credits ? Number(r.credits).toFixed(0) : '',
            }))}
          />
        </Card>
        <Card app flush>
          <div style={{ padding: '16px 14px 4px' }}>
            <SectionTitle>{t('workflow.spend.byRun')}</SectionTitle>
          </div>
          {byRun.length ? (
            byRun.map((r) => (
              <Link key={r.key} to={paths.run(r.key)} style={linkRow}>
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{r.key}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{r.workflow_name ?? ''}</span>
                </span>
                <StatusChip status={RUN_STATUS[runTone(r.status)]}>{label(r.status)}</StatusChip>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right' }}>
                  {usd(r.cost_usd)}
                  {Number(r.cost_credits) ? (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {t('workflow.runs.credits', { n: Number(r.cost_credits).toFixed(0) })}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))
          ) : (
            <div style={{ padding: 14 }}>
              <NothingHere title={t('workflow.spend.noRuns')} />
            </div>
          )}
        </Card>
        <Card app flush>
          <div style={{ padding: '16px 14px 4px' }}>
            <SectionTitle>{t('workflow.spend.steps')}</SectionTitle>
          </div>
          {(s.by_task ?? []).slice(0, 20).map((task) => {
            const over = task.budget_usd != null && Number(task.cost_usd) > Number(task.budget_usd);
            return (
              <Link key={task.id} to={paths.item(task.key)} style={linkRow}>
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{task.key}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {[stripProcess(task.title), task.role].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <StatusChip status={dsStatus(task.state)}>{stateLabel(task.state)}</StatusChip>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right' }}>
                  {usd(task.cost_usd)}
                  {task.budget_usd != null ? (
                    <span style={{ display: 'block', fontSize: 11, color: over ? 'var(--red-500)' : 'var(--text-tertiary)' }}>
                      {t('workflow.spend.ofBudget', { budget: usd(task.budget_usd) })}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </Card>
      </div>
    );
  }

  return (
    <Page
      breadcrumb={t('workflow.breadcrumb')}
      title={t('workflow.nav.spend')}
      actions={
        <Button variant="ghost" size="sm" onClick={reload}>
          {t('workflow.approvals.refresh')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <StatCard label={t('workflow.spend.tile.usd')} value={usd(s?.total_usd ?? 0)} />
          <StatCard label={t('workflow.spend.tile.credits')} value={Number(s?.total_credits ?? 0).toFixed(0)} />
          <StatCard label={t('workflow.spend.tile.runs')} value={byRun.length} />
        </div>
        {body}
      </div>
    </Page>
  );
}
