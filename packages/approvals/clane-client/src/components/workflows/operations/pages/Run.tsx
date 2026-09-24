import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Card, StatusChip, StatusDot } from '../../../../ds';
import { useT } from '../../../../i18n';
import { kindLabel as kindLabelOf } from '../lib/labels';
import { getEvents, getRun, getRunArtifacts } from '../data/api';
import { useAsync, usePoll } from '../data/hook';
import type { RunArtifact, WorkflowRunStep } from '../data/types';
import { stripProcess } from '../lib/inbox';
import { documentNumber } from '../lib/summary';
import { dsStatus, runTone, stateLabel } from '../lib/theme';
import { dateTime, hhmmss, usd } from '../format';
import { paths } from '../paths';
import { ActivityList } from '../components/ActivityList';
import { ArtefactDocument } from '../components/ArtefactDocument';
import { LinkButton } from '../components/LinkButton';
import { Meta, Page } from '../components/page';
import { RunGraph } from '../components/RunGraph';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TabBar } from '../components/TabBar';
import { RUN_STATUS, progressOf, useRunStatusLabel } from './Runs';

// One run: its graph, its steps in order (with the branches not taken), every
// artefact it produced in one call, and its activity.

const RUN_POLL_MS = 5000;
const ARTEFACT_POLL_MS = 15000;

const notTaken = (s: WorkflowRunStep): boolean => s.state === 'cancelled' && !!s.condition;

function duration(a: string, b: string | null): number | null {
  if (!b) return null;
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return Number.isFinite(s) && s >= 0 ? s : null;
}

function Steps({ steps, artefacts }: { steps: WorkflowRunStep[]; artefacts: RunArtifact[] }): JSX.Element {
  const { t } = useT();
  return (
    <ol aria-label={t('workflow.run.steps')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
      {steps.map((s) => {
        const off = notTaken(s);
        const outcome = s.condition?.outcome ?? s.condition?.equals ?? '';
        const nums = artefacts
          .filter((a) => a.task_key === s.key)
          .map((a) => documentNumber(a.kind, a.content))
          .filter(Boolean);
        const meta = [
          s.role,
          s.key,
          [...new Set(nums)].join(', ') || null,
          s.assignee,
          s.state === 'done' || s.state === 'cancelled' ? hhmmss(s.updated_at) : null,
          Number(s.cost_usd) > 0 ? usd(s.cost_usd) : null,
          Number(s.cost_credits) > 0 ? t('workflow.runs.credits', { n: Number(s.cost_credits).toFixed(0) }) : null,
        ];
        return (
          <li
            key={s.key}
            style={{
              display: 'grid',
              gridTemplateColumns: '16px 1fr auto',
              gap: 12,
              alignItems: 'center',
              padding: '12px 4px',
              borderTop: '1px solid var(--border-subtle)',
              opacity: off ? 0.7 : 1,
            }}
          >
            <StatusDot status={off ? 'var(--text-faint)' : dsStatus(s.state)} size={8} />
            <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: off ? 'var(--text-tertiary)' : 'var(--ink)' }}>
                {stripProcess(s.title)}
                {s.condition ? (
                  <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                    {' · '}
                    {off ? t('workflow.run.notTaken', { outcome }) : t('workflow.run.branch', { outcome })}
                  </span>
                ) : null}
              </span>
              <Meta parts={meta} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusChip status={off ? 'var(--text-faint)' : dsStatus(s.state)}>{stateLabel(s.state)}</StatusChip>
              {!off ? <LinkButton to={paths.item(s.key)} variant="ghost">{t('workflow.run.open')}</LinkButton> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Artefacts({ artefacts }: { artefacts: RunArtifact[] }): JSX.Element {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!artefacts.length) return <NothingHere title={t('workflow.run.noArtefacts')} />;
  const kindLabel = (k: string): string => kindLabelOf(t, k);
  return (
    <div style={{ display: 'grid' }}>
      {artefacts.map((a) => {
        const on = open === a.id;
        const number = documentNumber(a.kind, a.content);
        return (
          <div key={a.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              aria-expanded={on}
              onClick={() => setOpen(on ? null : a.id)}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: 10,
                width: '100%',
                padding: '11px 4px',
                background: 'none',
                border: 0,
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--ink)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{a.task_key}</span>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{kindLabel(a.kind)}</span>
              {number ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{number}</span> : null}
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{dateTime(a.created_at)}</span>
            </button>
            {on ? (
              <div style={{ padding: '4px 4px 18px' }}>
                <ArtefactDocument kind={a.kind} content={a.content} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RunActivity({ runKey }: { runKey: string }): JSX.Element {
  const events = useAsync(() => getEvents({ workflow_run: runKey, limit: 200 }), [runKey]);
  if (events.error) return <ErrorBanner error={events.error} onRetry={events.reload} />;
  if (!events.data) return <Loading rows={4} />;
  return <ActivityList events={events.data.events} showKeys />;
}

export function Run(): JSX.Element {
  const { t } = useT();
  const label = useRunStatusLabel();
  const { key = '' } = useParams();
  const run = usePoll(() => getRun(key), [key], RUN_POLL_MS);
  const arts = usePoll(() => getRunArtifacts(key), [key], ARTEFACT_POLL_MS);
  const [tab, setTab] = useState<'steps' | 'artefacts' | 'activity'>('steps');

  const back = <Link to={paths.runs()} style={{ color: 'inherit', textDecoration: 'none' }}>{t('workflow.nav.runs')}</Link>;
  const r = run.data;

  if (run.error && !r) {
    return (
      <Page breadcrumb={back} title={key}>
        <ErrorBanner error={run.error} onRetry={run.reload} />
      </Page>
    );
  }
  if (run.loading && !r) {
    return (
      <Page breadcrumb={back} title={key}>
        <Loading rows={6} />
      </Page>
    );
  }
  if (!r) {
    return (
      <Page breadcrumb={back} title={key}>
        <NothingHere
          title={t('workflow.run.missing.title')}
          hint={t('workflow.run.missing.hint', { key })}
          action={<LinkButton to={paths.runs()}>{t('workflow.run.back')}</LinkButton>}
        />
      </Page>
    );
  }

  const steps = r.steps ?? [];
  const artefacts = arts.data?.artifacts ?? [];
  const workspace = arts.data?.workspace ?? r.workspace;
  const p = progressOf(r.counts);
  const secs = duration(r.created_at, r.finished_at);
  const po = artefacts.find((a) => a.kind === 'purchase_order');
  const poc = (po?.content ?? {}) as Record<string, unknown>;
  const vendor = (poc.vendor as Record<string, unknown> | undefined)?.name;
  const name = r.workflow_name ?? r.workflow_key ?? t('workflow.nav.run');

  return (
    <Page
      breadcrumb={back}
      title={
        <>
          {name} <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-tertiary)' }}>{r.key}</span>
        </>
      }
      actions={
        <>
          <StatusChip status={RUN_STATUS[runTone(r.status)]}>{label(r.status)}</StatusChip>
          {workspace ? <StatusChip>{t('workflow.run.workspace', { name: workspace })}</StatusChip> : null}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <Meta
          parts={[
            t('workflow.run.stepsDone', { done: p.done, total: p.total }),
            secs !== null ? t('workflow.run.took', { min: Math.floor(secs / 60), sec: secs % 60 }) : null,
            usd(r.cost_usd),
            Number(r.cost_credits) ? t('workflow.runs.credits', { n: Number(r.cost_credits).toFixed(0) }) : null,
            r.input,
            poc.po_number ? String(poc.po_number) : null,
            vendor ? String(vendor) : null,
            t('workflow.run.started', { when: dateTime(r.created_at) }),
          ]}
        />
        {arts.error ? <ErrorBanner error={arts.error} onRetry={arts.reload} /> : null}
        <Card app style={{ minWidth: 0 }}>
          <RunGraph run={r} />
        </Card>
        <Card app style={{ minWidth: 0, display: 'grid', gap: 12 }}>
          <TabBar
            label={t('workflow.run.tabs')}
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            items={[
              { value: 'steps', label: t('workflow.run.steps'), count: steps.length },
              { value: 'artefacts', label: t('workflow.run.artefacts'), count: artefacts.length },
              { value: 'activity', label: t('workflow.item.tab.activity') },
            ]}
          />
          <div role="tabpanel">
            {tab === 'steps' ? (
              <Steps steps={steps} artefacts={artefacts} />
            ) : tab === 'artefacts' ? (
              <Artefacts artefacts={artefacts} />
            ) : (
              <RunActivity runKey={r.key} />
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
