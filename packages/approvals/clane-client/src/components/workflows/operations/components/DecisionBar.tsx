import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../ds';
import { useT } from '../../../../i18n';
import { answer, decide, errorText, retry } from '../data/api';
import type { Decision, InboxNext, Message, Task } from '../data/types';
import { clearDraft, loadDraft, saveDraft, type DraftStore } from '../lib/drafts';
import { outcomeSide } from '../lib/inbox';
import { dateTime } from '../format';
import { paths } from '../paths';
import { LinkButton } from './LinkButton';
import { ReasonField } from './ReasonField';
import { TextField } from './TextField';

// The decision area at the foot of a work item. One mode per situation:
// answer an agent's question, approve or reject a gate, retry a parked step,
// or read who already decided. Ported from packages/dash DecisionBar, on the
// design system's Button (the promoted ApprovalCard's actions are spans with
// no keyboard access or disabled state, so only its look is borrowed).

type Outcome = { kind: 'ok' | 'bad'; text: string } | null;

const storage = (): DraftStore | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

function Frame({
  tone = 'needsYou',
  heading,
  children,
}: {
  tone?: 'needsYou' | 'plain';
  heading?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const blue = tone === 'needsYou';
  return (
    <section
      style={{
        border: `1px solid ${blue ? 'var(--blue-tint-border)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-panel)',
        background: 'var(--surface-card)',
        overflow: 'hidden',
      }}
    >
      {heading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 15px',
            background: blue ? 'var(--blue-tint)' : 'var(--bg-page)',
            borderBottom: `1px solid ${blue ? 'var(--blue-tint-border)' : 'var(--border-subtle)'}`,
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 7, height: 7, borderRadius: '50%', background: blue ? 'var(--blue-500)' : 'var(--text-faint)' }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: blue ? 'var(--blue-500)' : 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            {heading}
          </span>
        </div>
      ) : null}
      <div style={{ padding: '14px 15px', display: 'grid', gap: 12 }}>{children}</div>
    </section>
  );
}

function OutcomeLine({ outcome }: { outcome: Outcome }): JSX.Element | null {
  if (!outcome) return null;
  return (
    <p
      role={outcome.kind === 'bad' ? 'alert' : 'status'}
      style={{ margin: 0, fontSize: 13, color: outcome.kind === 'bad' ? 'var(--red-500)' : 'var(--green-600)' }}
    >
      {outcome.text}
    </p>
  );
}

const Actions = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
    {children}
  </div>
);

function Approval({
  task,
  next,
  nextWaiting,
  onDone,
}: {
  task: Task;
  next: InboxNext[];
  nextWaiting: string | null;
  onDone: () => void;
}): JSX.Element {
  const { t } = useT();
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<'' | 'saved' | 'draft'>('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [done, setDone] = useState(false);
  // A ref, not state: a second click in the same frame sees it at once.
  const inFlight = useRef(false);

  useEffect(() => {
    const d = loadDraft(storage(), task.key);
    if (d) {
      setReason(d);
      setDraft('draft');
    }
  }, [task.key]);

  const save = (): void => {
    saveDraft(storage(), task.key, reason);
    setDraft('saved');
  };

  const act = async (verdict: 'approve' | 'reject'): Promise<void> => {
    if (inFlight.current || done) return;
    const why = reason.trim();
    if (verdict === 'reject' && !why) {
      setOutcome({ kind: 'bad', text: t('workflow.decide.reasonNeeded') });
      return;
    }
    inFlight.current = true;
    setBusy(verdict);
    setOutcome(null);
    try {
      await decide(task.key, verdict, why || null);
      clearDraft(storage(), task.key);
      const side = next.filter((n) => (outcomeSide(n.when) === 'reject') === (verdict === 'reject'));
      const ready = side.map((n) => n.title).join(', ');
      const head = verdict === 'approve' ? t('workflow.decide.approved') : t('workflow.decide.rejected');
      setOutcome({ kind: 'ok', text: ready ? `${head} ${t('workflow.decide.nextReady', { steps: ready })}` : head });
      setDone(true);
      onDone();
    } catch (e) {
      setOutcome({ kind: 'bad', text: errorText(e) });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (done) {
    return (
      <Frame tone="plain">
        <OutcomeLine outcome={outcome} />
        <Actions>
          {nextWaiting ? (
            <LinkButton to={paths.item(nextWaiting)} variant="primary">
              {t('workflow.decide.nextWaiting', { key: nextWaiting })}
            </LinkButton>
          ) : (
            <LinkButton to={paths.approvals()}>{t('workflow.decide.backToApprovals')}</LinkButton>
          )}
        </Actions>
      </Frame>
    );
  }

  return (
    <Frame heading={t('workflow.decide.needsYou')}>
      <ReasonField
        id={`reason-${task.key}`}
        label={t('workflow.decide.reason')}
        value={reason}
        onChange={(v) => {
          setReason(v);
          setDraft('');
        }}
        placeholder={t('workflow.decide.reasonPlaceholder')}
        helper={
          draft === 'saved'
            ? t('workflow.decide.draftSaved')
            : draft === 'draft'
              ? t('workflow.decide.draftNotSent')
              : t('workflow.decide.reasonHelper')
        }
        disabled={!!busy}
      />
      <OutcomeLine outcome={outcome} />
      <Actions>
        <Button variant="ghost" onClick={save} disabled={!!busy || !reason.trim()}>
          {t('workflow.decide.saveDraft')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void act('reject')}
          disabled={!!busy || !reason.trim()}
          title={!reason.trim() ? t('workflow.decide.reasonNeeded') : undefined}
        >
          {busy === 'reject' ? t('workflow.decide.rejecting') : t('workflow.decide.reject')}
        </Button>
        <Button variant="primary" onClick={() => void act('approve')} disabled={!!busy}>
          {busy === 'approve' ? t('workflow.decide.approving') : t('workflow.decide.approve')}
        </Button>
      </Actions>
    </Frame>
  );
}

function Retry({ task, onDone }: { task: Task; onDone: () => void }): JSX.Element {
  const { t } = useT();
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);

  const go = async (): Promise<void> => {
    if (inFlight.current) return;
    const budgetUsd = budget.trim() ? Number(budget) : undefined;
    if (budgetUsd !== undefined && !(budgetUsd > 0)) {
      setOutcome({ kind: 'bad', text: t('workflow.decide.budgetInvalid') });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const body: Parameters<typeof retry>[1] = { reason: reason.trim() || null, reset_attempts: true };
      if (budgetUsd !== undefined) body.budget_usd = budgetUsd;
      if (deadline) body.deadline = new Date(deadline).toISOString();
      const r = (await retry(task.key, body)) as { state?: string };
      setOutcome({ kind: 'ok', text: t('workflow.decide.retried', { state: (r?.state ?? 'ready').replace(/_/g, ' ') }) });
      onDone();
    } catch (e) {
      setOutcome({ kind: 'bad', text: errorText(e) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Frame heading={t('workflow.decide.parked')}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('workflow.decide.parkedAfter', { attempts: task.attempts, max: task.max_attempts })}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <TextField
          id={`budget-${task.key}`}
          label={t('workflow.decide.newBudget')}
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          disabled={busy}
        />
        <TextField
          id={`deadline-${task.key}`}
          label={t('workflow.decide.newDeadline')}
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          disabled={busy}
        />
      </div>
      <ReasonField
        id={`retry-${task.key}`}
        label={t('workflow.decide.retryWhy')}
        value={reason}
        onChange={setReason}
        rows={1}
        disabled={busy}
      />
      <OutcomeLine outcome={outcome} />
      <Actions>
        <Button variant="primary" onClick={() => void go()} disabled={busy}>
          {busy ? t('workflow.decide.retrying') : t('workflow.decide.retry')}
        </Button>
      </Actions>
    </Frame>
  );
}

function Answer({ task, question, onDone }: { task: Task; question: Message; onDone: () => void }): JSX.Element {
  const { t } = useT();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);

  const send = async (): Promise<void> => {
    const text = body.trim();
    if (inFlight.current || !text) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      await answer(task.key, text);
      setOutcome({ kind: 'ok', text: t('workflow.decide.answered') });
      setBody('');
      onDone();
    } catch (e) {
      setOutcome({ kind: 'bad', text: errorText(e) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Frame heading={t('workflow.decide.question')}>
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
          {t('workflow.decide.asked', {
            who: question.from_name ?? t('workflow.decide.anAgent'),
            when: dateTime(question.created_at),
          })}
        </span>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.55 }}>{question.body}</p>
      </div>
      <ReasonField
        id={`answer-${task.key}`}
        label={t('workflow.decide.yourAnswer')}
        value={body}
        onChange={setBody}
        disabled={busy}
      />
      <OutcomeLine outcome={outcome} />
      <Actions>
        <Button variant="primary" onClick={() => void send()} disabled={busy || !body.trim()}>
          {busy ? t('workflow.decide.sending') : t('workflow.decide.send')}
        </Button>
      </Actions>
    </Frame>
  );
}

export function DecisionBar({
  task,
  decision,
  questions,
  next,
  nextWaiting,
  onDone,
  decidedByName,
}: {
  task: Task;
  decision: Decision | null | undefined;
  questions: Message[];
  next: InboxNext[];
  nextWaiting: string | null;
  onDone: () => void;
  /** The decider as a person's name; the page resolves it, never a raw id. */
  decidedByName?: string;
}): JSX.Element {
  const { t } = useT();
  const open = questions.filter((q) => q.kind === 'question' && !q.answered_at);
  if (open.length) return <Answer task={task} question={open[open.length - 1]} onDone={onDone} />;
  if (task.role === 'operator' && task.state === 'needs_human') {
    return <Approval task={task} next={next} nextWaiting={nextWaiting} onDone={onDone} />;
  }
  if (task.state === 'needs_human' || task.state === 'failed') return <Retry task={task} onDone={onDone} />;
  if (decision) {
    const approved = decision.verdict === 'approve';
    return (
      <Frame tone="plain">
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              marginRight: 8,
              background: approved ? 'var(--green-600)' : 'var(--red-500)',
            }}
          />
          {t(approved ? 'workflow.decide.approvedBy' : 'workflow.decide.rejectedBy', {
            who: decidedByName || t('workflow.decide.aColleague'),
            when: dateTime(decision.at),
          })}
          {decision.reason ? <span style={{ color: 'var(--text-secondary)' }}> · {decision.reason}</span> : null}
        </p>
      </Frame>
    );
  }
  return (
    <Frame tone="plain">
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('workflow.decide.nothing', { state: task.state.replace(/_/g, ' ') })}
      </p>
    </Frame>
  );
}
