import React, { useEffect, useMemo, useState } from 'react';

import { EmptyState } from '../../../../ds';
import { useT } from '../../../../i18n';
import { errorText } from '../data/api';
import type { DocumentRef } from '../data/types';
import { parseEml, type ParsedEmail } from '../lib/documents';
import { ExternalLink, Paperclip } from '../icons';

// The source documents of a step, one tab each. Emails show their headers,
// decoded text and attachment names; PDFs come through the authenticated
// wrapper as a Blob and show from an object URL (an <iframe src> cannot carry
// the bearer); text shows as is. A document the workspace does not hold
// (`available: false`) is a disabled tab that says so.

type Load = { text: string | null; url: string | null; error: string | null };

const isAvailable = (d: DocumentRef): boolean => d.available !== false && !!d.id;

function readStored(key: string): number {
  try {
    const n = Number(window.sessionStorage.getItem(key) ?? NaN);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

function writeStored(key: string, i: number): void {
  try {
    window.sessionStorage.setItem(key, String(i));
  } catch {
    /* per-viewer convenience only */
  }
}

function useDocument(
  doc: DocumentRef | null,
  textOf: (d: DocumentRef) => Promise<string>,
  blobOf: (d: DocumentRef) => Promise<Blob>,
): Load {
  const [state, setState] = useState<Load>({ text: null, url: null, error: null });
  useEffect(() => {
    setState({ text: null, url: null, error: null });
    if (!doc) return undefined;
    let live = true;
    let url: string | null = null;
    if (doc.type === 'pdf') {
      blobOf(doc).then(
        (b) => {
          if (!live) return;
          url = URL.createObjectURL(b);
          setState({ text: null, url, error: null });
        },
        (e: unknown) => live && setState({ text: null, url: null, error: errorText(e) }),
      );
    } else {
      textOf(doc).then(
        (text) => live && setState({ text, url: null, error: null }),
        (e: unknown) => live && setState({ text: null, url: null, error: errorText(e) }),
      );
    }
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // The loaders are stable per item; re-run only when the document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.type]);
  return state;
}

function Email({ mail }: { mail: ParsedEmail }): JSX.Element {
  const { t } = useT();
  const shown = ['From', 'To', 'Subject', 'Date'].filter((h) => mail.headers[h]);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          gap: '6px 14px',
          margin: 0,
          paddingBottom: 12,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {shown.map((h) => (
          <React.Fragment key={h}>
            <dt style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
              {t(`workflow.doc.mail.${h.toLowerCase()}`)}
            </dt>
            <dd style={{ margin: 0, fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{mail.headers[h]}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink)' }}>
        {mail.text || <span style={{ color: 'var(--text-tertiary)' }}>{t('workflow.doc.mail.noText')}</span>}
      </div>
      {mail.attachments.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {mail.attachments.map((a) => (
            <span
              key={a}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--text-secondary)',
                background: 'var(--bg-well)',
                borderRadius: 'var(--radius-pill)',
                padding: '3px 10px',
              }}
            >
              <Paperclip size={12} /> {a}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Body({ doc, load }: { doc: DocumentRef; load: Load }): JSX.Element {
  const { t } = useT();
  if (load.error) {
    return (
      <p role="alert" style={{ color: 'var(--red-500)', fontSize: 13, margin: 0 }}>
        {t('workflow.doc.cannotShow', { name: doc.label, error: load.error })}
      </p>
    );
  }
  if (doc.type === 'pdf') {
    if (!load.url) return <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('workflow.state.loading')}</p>;
    return (
      <iframe
        src={load.url}
        title={doc.label}
        style={{ width: '100%', height: '70vh', minHeight: 420, border: 0, borderRadius: 'var(--radius-sm)' }}
      />
    );
  }
  if (load.text === null) return <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('workflow.state.loading')}</p>;
  if (doc.type === 'email') return <Email mail={parseEml(load.text)} />;
  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        fontFamily: doc.type === 'data' ? 'var(--font-mono)' : 'var(--font-body)',
        fontSize: doc.type === 'data' ? 12 : 13.5,
        lineHeight: 1.6,
        color: 'var(--ink)',
      }}
    >
      {load.text}
    </pre>
  );
}

export function DocumentViewer({
  itemKey,
  docs,
  textOf,
  blobOf,
}: {
  itemKey: string;
  docs: DocumentRef[];
  textOf: (d: DocumentRef) => Promise<string>;
  blobOf: (d: DocumentRef) => Promise<Blob>;
}): JSX.Element {
  const { t } = useT();
  const storeKey = `workflow.source.${itemKey}`;
  const firstAvailable = useMemo(() => docs.findIndex(isAvailable), [docs]);
  const [picked, setPicked] = useState<number>(() => {
    const saved = readStored(storeKey);
    return saved >= 0 && saved < docs.length && isAvailable(docs[saved]) ? saved : firstAvailable;
  });
  const index = picked >= 0 && picked < docs.length && isAvailable(docs[picked]) ? picked : firstAvailable;
  const current = index >= 0 ? docs[index] : null;
  const load = useDocument(current, textOf, blobOf);

  if (!docs.length) {
    return <EmptyState title={t('workflow.doc.none.title')} description={t('workflow.doc.none.hint')} />;
  }

  const pick = (i: number): void => {
    if (!isAvailable(docs[i])) return;
    setPicked(i);
    writeStored(storeKey, i);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        role="tablist"
        aria-label={t('workflow.doc.tabs')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          borderBottom: '1px solid var(--border-default)',
          overflowX: 'auto',
        }}
      >
        {docs.map((d, i) => {
          const on = i === index;
          const off = !isAvailable(d);
          return (
            <button
              key={d.id ?? d.path}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={off}
              title={off ? t('workflow.doc.notUploadedHint', { path: d.path }) : d.path}
              onClick={() => pick(i)}
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 6,
                background: 'none',
                border: 0,
                borderBottom: `2px solid ${on ? 'var(--blue-500)' : 'transparent'}`,
                padding: '9px 12px',
                font: 'inherit',
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: off ? 'var(--text-faint)' : on ? 'var(--ink)' : 'var(--text-secondary)',
                cursor: off ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {d.label}
              {off ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
                  {t('workflow.doc.notUploaded')}
                </span>
              ) : null}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        {current?.type === 'pdf' && load.url ? (
          <a
            href={load.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t('workflow.doc.openNewTab')}
            title={t('workflow.doc.openNewTab')}
            style={{ display: 'inline-flex', padding: 8, color: 'var(--text-tertiary)' }}
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
      <div style={{ padding: '16px 2px 4px', minHeight: 0 }}>
        {current ? (
          <Body doc={current} load={load} />
        ) : (
          <EmptyState title={t('workflow.doc.noneAvailable.title')} description={t('workflow.doc.noneAvailable.hint')} />
        )}
      </div>
    </div>
  );
}
