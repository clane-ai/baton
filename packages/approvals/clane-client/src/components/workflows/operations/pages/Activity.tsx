import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AuditLogRow, Button } from '../../../../ds';
import { useT } from '../../../../i18n';
import { useAuthOptional } from '../../../../lib/auth';
import { getEvents } from '../data/api';
import { usePaged } from '../data/hook';
import type { StreamEvent } from '../data/types';
import { dateTime } from '../format';
import { paths } from '../paths';
import { NOISE, eventStatus, sentence } from '../components/ActivityList';
import { Page } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TextField } from '../components/TextField';

// Activity: what happened, when, by whom, newest first, filtered by run, step,
// agent and event type. Same sentences as the item and run screens.

const TYPES = [
  'approval_required',
  'approval_overdue',
  'approved',
  'rejected',
  'gate_passed',
  'gate_failed',
  'artifact_registered',
  'artifact_rejected',
  'branch_not_taken',
  'cancelled_upstream',
  'deadline_passed',
  'budget_exceeded',
  'lease_expired',
  'task_retried',
  'task_claimed',
  'task_released',
  'task_state_changed',
  'workflow_run_finished',
  'session_start',
  'session_end',
  'no_lease',
  'scope_violation',
];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

export function Activity(): JSX.Element {
  const { t } = useT();
  const user = useAuthOptional()?.user ?? null;
  const [run, setRun] = useState('');
  const [task, setTask] = useState('');
  const [agent, setAgent] = useState('');
  const [type, setType] = useState('');
  const [noise, setNoise] = useState(false);
  const dRun = useDebounced(run.trim(), 300);
  const dTask = useDebounced(task.trim(), 300);
  const dAgent = useDebounced(agent.trim(), 300);

  const events = usePaged<StreamEvent>(
    (cursor) =>
      getEvents({ workflow_run: dRun, task: dTask, agent: dAgent, type, limit: 100, cursor }).then((r) => ({
        items: r.events,
        nextCursor: r.nextCursor,
      })),
    [dRun, dTask, dAgent, type],
    (e) => String(e.id),
  );
  const shown = events.items.filter((e) => noise || !NOISE.has(e.type));
  const hidden = events.items.length - shown.length;
  const filtered = run || task || agent || type;

  const field = (id: string, label: string, value: string, set: (v: string) => void): JSX.Element => (
    <div style={{ width: 170 }}>
      <TextField id={id} label={label} value={value} onChange={(e) => set(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
    </div>
  );

  let body: React.ReactNode;
  if (events.error && !events.items.length) body = <ErrorBanner error={events.error} onRetry={events.reload} />;
  else if (events.loading && !events.items.length) body = <Loading rows={6} />;
  else if (!shown.length) body = <NothingHere title={t('workflow.activityScreen.empty.title')} hint={t('workflow.activityScreen.empty.hint')} />;
  else {
    body = (
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        {shown.map((e) => (
          <AuditLogRow
            key={String(e.id)}
            actor={e.agent ?? t('workflow.activityScreen.system')}
            agent={!!e.agent}
            action={<span>{sentence(e, t, user)}</span>}
            target={
              e.task_key ? (
                <Link to={paths.item(e.task_key)} style={{ color: 'inherit' }}>
                  {e.task_key}
                </Link>
              ) : undefined
            }
            status={eventStatus(e.type)}
            time={dateTime(e.ts)}
          />
        ))}
      </div>
    );
  }

  return (
    <Page
      breadcrumb={t('workflow.breadcrumb')}
      title={t('workflow.nav.activity')}
      actions={
        <Button variant="ghost" size="sm" onClick={events.reload}>
          {t('workflow.approvals.refresh')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
          {field('workflow-activity-run', t('workflow.activityScreen.run'), run, setRun)}
          {field('workflow-activity-step', t('workflow.activityScreen.step'), task, setTask)}
          {field('workflow-activity-agent', t('workflow.activityScreen.agent'), agent, setAgent)}
          <div style={{ display: 'grid', gap: 7 }}>
            <label
              htmlFor="workflow-activity-type"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}
            >
              {t('workflow.activityScreen.type')}
            </label>
            <select
              id="workflow-activity-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
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
              <option value="">{t('workflow.activityScreen.allTypes')}</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', paddingBottom: 9 }}>
            <input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} />
            {t('workflow.activityScreen.showNoise')}
          </label>
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRun('');
                setTask('');
                setAgent('');
                setType('');
              }}
            >
              {t('workflow.activityScreen.clear')}
            </Button>
          ) : null}
        </div>
        {hidden > 0 ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {t('workflow.activityScreen.hidden', { n: hidden })}
          </span>
        ) : null}
        {body}
        {events.hasMore ? (
          <div>
            <Button variant="secondary" size="sm" onClick={events.loadMore} disabled={events.loading}>
              {t('workflow.activityScreen.older')}
            </Button>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
