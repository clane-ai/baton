import React, { useState } from 'react';

import { Button, Timeline } from '../../../../ds';
import { useT } from '../../../../i18n';
import { money } from '../lib/money';
import { personName } from '../lib/people';
import { hhmmss } from '../format';

// A step's or run's history as sentences a person can read, newest first,
// grouped by day. Machinery (tool calls, heartbeats, prompts) is hidden behind
// a toggle. Ported from packages/dash ActivityLog onto the design system's
// Timeline; every sentence comes from the catalogue.

type Obj = Record<string, unknown>;
type T = (key: string, vars?: Record<string, unknown>) => string;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (v == null ? '' : String(v));
const words = (v: unknown): string => s(v).replace(/_/g, ' ');
const list = (v: unknown): string => (Array.isArray(v) ? v.map(s).join(', ') : '');

export type ActivityEvent = {
  id: number | string;
  ts: string;
  type: string;
  payload: unknown;
  agent?: string | null;
  task_key?: string | null;
};

/** Event types that are machinery rather than progress. */
export const NOISE = new Set(['tool', 'heartbeat', 'prompt', 'turn_end', 'progress', 'tool_batch', 'tool_failure']);

/** The decider as a person: platform label or operator owner, never a raw user id. */
const byName = (t: T, e: ActivityEvent): string =>
  personName(s(o(e.payload).by), null, [e]) ?? t('workflow.decide.aColleague');

/** ": <reason>" when there is one. */
const why = (t: T, p: Obj): string => (p.reason ? t('workflow.event.because', { reason: s(p.reason) }) : '');

/** One event as a sentence. Unknown types read as their name in words. */
export function sentence(e: ActivityEvent, t: T): string {
  const p = o(e.payload);
  const who = e.agent || '';
  switch (e.type) {
    case 'task_created':
      return p.actor ? t('workflow.event.createdBy', { actor: s(p.actor) }) : t('workflow.event.created');
    case 'task_state_changed':
      return t('workflow.event.stateChanged', { from: words(p.from), to: words(p.to) });
    case 'task_claimed':
      return t('workflow.event.claimed', { who: who || t('workflow.event.anAgent'), attempt: s(p.attempts) });
    case 'task_submitted':
      return t('workflow.event.submitted', { who: who || t('workflow.event.theAgent') });
    case 'artifact_registered':
      return t('workflow.event.artefactRegistered', { kind: words(p.kind) });
    case 'artifact_rejected':
      return t('workflow.event.artefactRejected', { kind: words(p.kind), errors: s(p.errors) });
    case 'gate_passed':
      return t('workflow.event.gatePassed');
    case 'gate_failed':
      return t('workflow.event.gateFailed', {
        missing: list(p.missing) || t('workflow.event.nothing'),
        problems: (Array.isArray(p.problems) ? p.problems.map(s).join('; ') : '') || t('workflow.event.noProblems'),
      });
    case 'approval_required':
      return t('workflow.event.approvalRequired');
    case 'approval_overdue':
      return t('workflow.event.approvalOverdue', { minutes: s(p.waiting_minutes) });
    case 'approved':
      return t('workflow.event.approved', { by: byName(t, e) }) + why(t, p);
    case 'rejected':
      return t('workflow.event.rejected', { by: byName(t, e) }) + why(t, p);
    case 'task_retried':
      return t('workflow.event.retried', { by: byName(t, e) }) + why(t, p);
    case 'task_cancelled':
      return t('workflow.event.cancelled', { by: byName(t, e) }) + why(t, p);
    case 'branch_not_taken':
      return t('workflow.event.branchNotTaken', { decidedBy: s(p.decided_by), outcome: s(p.outcome_required) });
    case 'cancelled_upstream':
      return t('workflow.event.cancelledUpstream', { because: s(p.because) });
    case 'deadline_passed':
      return t('workflow.event.deadlinePassed');
    case 'budget_exceeded':
      return t('workflow.event.budgetExceeded', { cost: money(p.cost_usd, 'USD'), budget: money(p.budget_usd, 'USD') });
    case 'lease_expired':
      return t('workflow.event.leaseExpired', { attempts: s(p.attempts), max: s(p.max_attempts) });
    case 'task_released':
      return t('workflow.event.released', { reason: s(p.reason) });
    case 'task_asked':
      return t('workflow.event.asked', { to: p.to_role ? s(p.to_role) : t('workflow.event.aPerson'), question: s(p.question) });
    case 'question_answered':
      return t('workflow.event.answered', { by: byName(t, e) });
    case 'task_delegated':
      return t('workflow.event.delegated', { child: s(p.child_key), role: s(p.role) });
    case 'delegation_returned':
      return t('workflow.event.delegationReturned', { child: s(p.child_key) });
    case 'session_start':
      return t('workflow.event.sessionStart', { who: who || t('workflow.event.agent') });
    case 'session_end':
      return t('workflow.event.sessionEnd', { reason: s(p.reason) });
    case 'workflow_run_finished':
      return t('workflow.event.runFinished', { run: s(p.run), status: words(p.status) });
    case 'no_lease':
      return t('workflow.event.noLease', { tool: s(p.tool), path: s(p.path) });
    case 'scope_violation':
      return t('workflow.event.scopeViolation', { path: s(p.path) });
    case 'tool_rejected':
      return t('workflow.event.toolRejected', { code: s(p.code) });
    default:
      return words(e.type);
  }
}

/** The StatusDot colour an event carries in the timeline. */
export function eventStatus(type: string): string {
  if (['approved', 'gate_passed', 'artifact_registered', 'question_answered', 'delegation_returned'].includes(type)) return 'done';
  if (['approval_required', 'approval_overdue', 'task_asked'].includes(type)) return 'needsYou';
  if (
    [
      'rejected',
      'gate_failed',
      'artifact_rejected',
      'budget_exceeded',
      'deadline_passed',
      'lease_expired',
      'no_lease',
      'scope_violation',
      'tool_rejected',
    ].includes(type)
  )
    return 'failed';
  if (['task_claimed', 'task_submitted', 'task_state_changed', 'session_start', 'task_retried'].includes(type)) return 'running';
  return 'var(--text-faint)';
}

const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export function ActivityList({ events, showKeys }: { events: ActivityEvent[]; showKeys?: boolean }): JSX.Element {
  const { t } = useT();
  const [all, setAll] = useState(false);
  if (!events.length) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>{t('workflow.activity.empty')}</p>;
  }
  const rows = events.filter((e) => all || !NOISE.has(e.type)).sort((a, b) => b.ts.localeCompare(a.ts));
  const hidden = events.length - rows.length;
  const days: { day: string; items: ActivityEvent[] }[] = [];
  for (const e of rows) {
    const day = dayOf(e.ts);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(e);
    else days.push({ day, items: [e] });
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {days.map((g) => (
        <div key={g.day} style={{ display: 'grid', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{g.day}</span>
          <Timeline
            items={g.items.map((e) => ({
              status: eventStatus(e.type),
              title: (
                <span data-testid="activity-title">
                  {showKeys && e.task_key ? (
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {e.task_key}
                      </span>{' '}
                    </>
                  ) : null}
                  {sentence(e, t)}
                </span>
              ),
              meta: [hhmmss(e.ts), e.agent].filter(Boolean).join(' · '),
            }))}
          />
        </div>
      ))}
      {hidden > 0 || all ? (
        <div>
          <Button variant="ghost" onClick={() => setAll(!all)}>
            {all ? t('workflow.activity.hideNoise') : t('workflow.activity.showAll', { n: hidden })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
