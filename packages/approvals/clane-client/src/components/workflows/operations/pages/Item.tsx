import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Banner, Card, StatusChip } from '../../../../ds';
import { useAuthOptional } from '../../../../lib/auth';
import { useT } from '../../../../i18n';
import { getDocumentBlob, getDocumentText, getInbox, getItem, getItemDocuments } from '../data/api';
import { useAsync, usePoll } from '../data/hook';
import type { Artifact, DocumentRef, TaskDetailResponse } from '../data/types';
import { documentsFor, mergeDocuments } from '../lib/documents';
import { nextText, stripProcess, summaryLine, waitingText } from '../lib/inbox';
import { personName } from '../lib/people';
import { policySummary } from '../lib/policy';
import { documentNumber } from '../lib/summary';
import { dsStatus, stateLabel, type Tone } from '../lib/theme';
import { dateTime } from '../format';
import { paths } from '../paths';
import { ActivityList } from '../components/ActivityList';
import { ArtefactDocument } from '../components/ArtefactDocument';
import { DecisionBar } from '../components/DecisionBar';
import { DocumentViewer } from '../components/DocumentViewer';
import { LinkButton } from '../components/LinkButton';
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

export function Item(): JSX.Element {
  const { t } = useT();
  const { key = '' } = useParams();
  const detail = usePoll(() => getItem(key), [key], ITEM_POLL_MS);
  const d = detail.data;
  const back = <Link to={paths.approvals()} style={{ color: 'inherit', textDecoration: 'none' }}>{t('workflow.nav.approvals')}</Link>;

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
          action={<LinkButton to={paths.approvals()}>{t('workflow.decide.backToApprovals')}</LinkButton>}
        />
      </Page>
    );
  }
  return <ItemBody itemKey={key} detail={d} back={back} onChanged={detail.reload} />;
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
  const files = useAsync(() => getItemDocuments(key), [key]);
  const inbox = usePoll(() => getInbox(null, 50), [], INBOX_POLL_MS);
  const [tab, setTab] = useState<'doc' | 'policy' | 'activity'>('doc');

  const task = d.task;
  const approval = task?.role === 'operator';
  const kindLabel = (kind: string): string => {
    const k = `workflow.kind.${kind}`;
    const v = t(k);
    return v === k ? kind.replace(/_/g, ' ') : v;
  };

  const consumed = useMemo(() => {
    const seen = new Set<string>();
    return (d.consumed ?? []).filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  }, [d]);
  const own = d.artifacts ?? [];
  const primary: Artifact | undefined = approval
    ? consumed.find((a) => a.kind === 'purchase_order') ?? consumed[0]
    : own[0] ?? consumed[0];
  const shown: Artifact[] = approval ? consumed : own.length ? [own[0], ...consumed] : consumed;

  const docs: DocumentRef[] = useMemo(() => {
    const fromApi = [...(files.data?.documents ?? []), ...(d.documents ?? [])];
    const conventions = [...consumed, ...own].flatMap((a) => documentsFor(a.kind, a.content));
    return mergeDocuments(fromApi, conventions);
  }, [files.data, d, consumed, own]);

  const item = inbox.data?.items.find((i) => i.key === key) ?? null;
  const nextWaiting = useMemo(() => {
    const others = (inbox.data?.items ?? [])
      .filter((i) => i.kind === 'approval' && i.key !== key)
      .sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
    return others[0]?.key ?? null;
  }, [inbox.data, key]);

  const summary = primary ? policySummary(primary.kind, primary.content) : null;
  const title = primary ? `${kindLabel(primary.kind)} ${numberOf(primary)}`.trim() : stripProcess(task.title);
  const events = d.events ?? [];
  const lastFailure = !approval ? events.find((e) => FAILURES.includes(e.type)) : undefined;
  const decidedByName = d.decision ? personName(d.decision.by, user, events) ?? undefined : undefined;
  const producer = d.claims?.find((c) => c.outcome === 'completed')?.agent ?? null;

  const actions = (
    <>
      <StatusChip status={dsStatus(task.state)}>{stateLabel(task.state)}</StatusChip>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>{task.key}</span>
    </>
  );

  return (
    <Page breadcrumb={back} title={title} actions={actions}>
      <div style={{ display: 'grid', gap: 18 }}>
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
                    <Banner tone="danger" title={t('workflow.item.lastFailure', { what: lastFailure.type.replace(/_/g, ' '), when: dateTime(lastFailure.ts) })}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {JSON.stringify(lastFailure.payload, null, 2)}
                      </pre>
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
                <ActivityList events={events} />
              )}
            </div>
            <DecisionBar
              task={task}
              decision={d.decision}
              questions={d.questions ?? d.messages ?? []}
              next={item?.next ?? []}
              nextWaiting={nextWaiting}
              decidedByName={decidedByName}
              onDone={() => {
                onChanged();
                inbox.reload();
              }}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}
