import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Banner, Button, Card, StatusChip } from '../../../../ds';
import { useAuthOptional } from '../../../../lib/auth';
import { useT } from '../../../../i18n';
import { getDocumentBlob, getDocumentText, getItem, getItemDocuments } from '../data/api';
import { markActed } from '../data/inboxStore';
import { useInbox } from '../data/useInbox';
import { useAsync, usePoll } from '../data/hook';
import { useSectionShell } from '../context';
import { kindLabel as kindLabelOf } from '../lib/labels';
import type { Artifact, DocumentRef, TaskDetailResponse } from '../data/types';
import { documentsFor, mergeDocuments } from '../lib/documents';
import { nextText, stripProcess, summaryLine, waitingText } from '../lib/inbox';
import { personName } from '../lib/people';
import { policySummary } from '../lib/policy';
import { documentNumber } from '../lib/summary';
import { dsStatus, stateLabel, type Tone } from '../lib/theme';
import { dateTime } from '../format';
import { paths } from '../paths';
import { ActivityList, sentence } from '../components/ActivityList';
import { ArtefactDocument } from '../components/ArtefactDocument';
import { DecisionBar } from '../components/DecisionBar';
import { DocumentViewer } from '../components/DocumentViewer';
import { Meta, Page } from '../components/page';
import { ErrorBanner, Loading, NothingHere } from '../components/States';
import { TabBar } from '../components/TabBar';

// The screen an approver lives on: the source documents on the left, the
// artefact as its business document on the right with the policy and the
// history as tabs, and the decision at the foot.

const ITEM_POLL_MS = 8000;
const INBOX_POLL_MS = 15000;

const BANNER_TONE: Record<Tone, 'info' | 'success' | 'attention' | 'danger'> = {
  done: 'success',
  working: 'attention',
  stuck: 'danger',
  waiting: 'info',
  info: 'info',
  neutral: 'info',
};

const FAILURES = ['gate_failed', 'artifact_rejected', 'deadline_passed', 'budget_exceeded', 'lease_expired', 'task_released'];

const numberOf = (a: Artifact | undefined): string => (a ? documentNumber(a.kind, a.content) : '');

/** "Home" as a way back, when the shell provides one; the inbox lives there. */
function BackHome(): JSX.Element {
  const { t } = useT();
  const { onHome } = useSectionShell();
  if (!onHome) return <span>{t('workflow.breadcrumb')}</span>;
  return (
    <button
      type="button"
      onClick={onHome}
      style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', letterSpacing: 'inherit', textTransform: 'inherit' }}
    >
      {t('workflow.item.backHome')}
    </button>
  );
}

export function Item(): JSX.Element {
  const { t } = useT();
  const { onHome } = useSectionShell();
  const { key = '' } = useParams();
  const detail = usePoll(() => getItem(key), [key], ITEM_POLL_MS);
  const d = detail.data;
  const back = <BackHome />;

  if (detail.error && !d) {
    return (
      <Page breadcrumb={back} title={key}>
        <ErrorBanner error={detail.error} onRetry={detail.reload} />
      </Page>
    );
  }
  if (detail.loading && !d) {
    return (
      <Page breadcrumb={back} title={key}>
        <Loading rows={6} />
      </Page>
    );
  }
  if (!d || !d.task) {
    return (
      <Page breadcrumb={back} title={key}>
        <NothingHere
          title={t('workflow.item.missing.title')}
          hint={t('workflow.item.missing.hint', { key })}
          action={
            onHome ? (
              <Button variant="secondary" onClick={onHome}>
                {t('workflow.item.backHome')}
              </Button>
            ) : undefined
          }
        />
      </Page>
    );
  }
  // Keyed by item: nothing typed or chosen on one item survives onto another.
  return <ItemBody key={key} itemKey={key} detail={d} back={back} onChanged={detail.reload} />;
}

/** The item once it is known to exist: only then are its documents and the inbox loaded. */
function ItemBody({
  itemKey: key,
  detail: d,
  back,
  onChanged,
}: {
  itemKey: string;
  detail: TaskDetailResponse;
  back: React.ReactNode;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useT();
  const user = useAuthOptional()?.user ?? null;
  const { onHome } = useSectionShell();
  const files = useAsync(() => getItemDocuments(key), [key]);
  const inbox = useInbox(INBOX_POLL_MS);
  const [tab, setTab] = useState<'doc' | 'policy' | 'activity'>('doc');
  const [notice, setNotice] = useState<string | null>(null);

  const task = d.task;
  const approval = task?.role === 'operator';
  const kindLabel = (kind: string): string => kindLabelOf(t, kind);

  const consumed = useMemo(() => {
    const seen = new Set<string>();
    return (d.consumed ?? []).filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  }, [d]);
  const own = d.artifacts ?? [];
  const primary: Artifact | undefined = approval
    ? consumed.find((a) => a.kind === 'purchase_order') ?? consumed[0]
    : own[0] ?? consumed[0];
  const shown: Artifact[] = approval ? consumed : own.length ? [own[0], ...consumed] : consumed;

  // The engine lists every document a step refers to, each with `available`.
  // Paths guessed from artefact conventions are used only when that list could
  // not be loaded, so "Not uploaded" is never claimed for a guess.
  const docs: DocumentRef[] = useMemo(() => {
    const fromApi = [...(files.data?.documents ?? []), ...(d.documents ?? [])];
    if (files.data) return mergeDocuments(fromApi, []);
    const conventions = [...consumed, ...own].flatMap((a) => documentsFor(a.kind, a.content));
    return mergeDocuments(fromApi, conventions);
  }, [files.data, d, consumed, own]);

  const item = inbox.data?.items.find((i) => i.key === key) ?? null;

  /** After an action: hide the item from the queue, then go back to it on Home. */
  const acted = (kind: 'approval' | 'parked' | 'question', confirmation: string): void => {
    markActed(key, kind, onHome ? confirmation : null);
    if (onHome) {
      onHome();
      return;
    }
    setNotice(confirmation);
    onChanged();
  };

  const summary = primary ? policySummary(primary.kind, primary.content) : null;
  const title = primary ? `${kindLabel(primary.kind)} ${numberOf(primary)}`.trim() : stripProcess(task.title);
  const events = d.events ?? [];
  const lastFailure = !approval ? events.find((e) => FAILURES.includes(e.type)) : undefined;
  const decidedByName = d.decision ? personName(d.decision.by, user, events) ?? undefined : undefined;
  const producer = d.claims?.find((c) => c.outcome === 'completed')?.agent ?? null;
  const me = user ? { id: user.id, name: user.name, username: user.username, email: user.email } : null;

  const actions = (
    <>
      <StatusChip status={dsStatus(task.state)}>{stateLabel(task.state)}</StatusChip>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>{task.key}</span>
    </>
  );

  return (
    <Page breadcrumb={back} title={title} actions={actions}>
      <div style={{ display: 'grid', gap: 18 }}>
        {notice ? <Banner tone="success" title={notice} onClose={() => setNotice(null)} /> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px' }}>
          <Meta
            parts={[
              stripProcess(task.title),
              item ? summaryLine(item) : null,
              primary ? `${producer ? t('workflow.item.raisedBy', { who: producer }) + ' ' : ''}${dateTime(primary.created_at)}` : null,
              task.state === 'needs_human' ? t('workflow.item.waiting', { time: waitingText(task.updated_at) }) : null,
            ]}
          />
          {task.workflow_run ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
              {t('workflow.item.run')}{' '}
              <Link to={paths.run(task.workflow_run)} style={{ fontFamily: 'var(--font-mono)', color: 'var(--link, var(--blue-500))' }}>
                {task.workflow_run}
              </Link>
            </span>
          ) : null}
          {item && item.next.length ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{nextText(item.next)}</span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 18, alignItems: 'start' }}>
          <Card app style={{ minWidth: 0 }}>
            {files.error ? <ErrorBanner error={files.error} onRetry={files.reload} /> : null}
            <DocumentViewer
              itemKey={task.key}
              docs={docs}
              textOf={(doc) => getDocumentText(task.key, doc.id ?? '')}
              blobOf={(doc) => getDocumentBlob(task.key, doc.id ?? '')}
            />
          </Card>

          <Card app style={{ minWidth: 0, display: 'grid', gap: 16 }}>
            <TabBar
              label={t('workflow.item.tabs')}
              value={tab}
              onChange={(v) => setTab(v as typeof tab)}
              items={[
                { value: 'doc', label: primary ? kindLabel(primary.kind) : t('workflow.item.tab.document') },
                { value: 'policy', label: t('workflow.item.tab.policy') },
                { value: 'activity', label: t('workflow.item.tab.activity'), count: events.length },
              ]}
            />
            <div role="tabpanel" style={{ minWidth: 0 }}>
              {tab === 'doc' ? (
                <div style={{ display: 'grid', gap: 18 }}>
                  {summary ? (
                    <Banner tone={BANNER_TONE[summary.tone]} title={`${summary.text.split('. ')[0]}.`}>
                      {summary.text.split('. ').slice(1).join('. ')}
                    </Banner>
                  ) : null}
                  {shown.length ? (
                    shown.map((a, i) => (
                      <div key={a.id} style={i ? { borderTop: '1px solid var(--border-subtle)', paddingTop: 6 } : undefined}>
                        {i ? (
                          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, margin: '10px 0 0' }}>
                            {kindLabel(a.kind)}
                          </h3>
                        ) : null}
                        <ArtefactDocument kind={a.kind} content={a.content} />
                      </div>
                    ))
                  ) : (
                    <NothingHere title={t('workflow.item.noArtefacts.title')} hint={t('workflow.item.noArtefacts.hint')} />
                  )}
                  {lastFailure ? (
                    <Banner tone="danger" title={t('workflow.item.lastFailure', { when: dateTime(lastFailure.ts) })}>
                      {sentence(lastFailure, t, me)}
                    </Banner>
                  ) : null}
                </div>
              ) : tab === 'policy' ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {t('workflow.item.asked')}
                  </h3>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>
                    {task.spec ?? ''}
                  </pre>
                  {task.acceptance ? (
                    <>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, margin: '8px 0 0' }}>
                        {t('workflow.item.acceptance')}
                      </h3>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>
                        {task.acceptance}
                      </pre>
                    </>
                  ) : null}
                </div>
              ) : (
                <ActivityList events={events} me={me} />
              )}
            </div>
            <DecisionBar
              key={task.key}
              task={task}
              decision={d.decision}
              questions={d.questions ?? d.messages ?? []}
              next={item?.next ?? []}
              decidedByName={decidedByName}
              onActed={acted}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}
