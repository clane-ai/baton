import React from 'react';

import { AppHeader } from '../../../../ds';

interface PageProps {
  /** Mono uppercase line above the title. */
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  /** Right cluster in the header: status chips, buttons. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Standard page frame: sticky AppHeader over a scrolling body (same recipe as
 * src/hr/components/page.tsx). AppHeader hard-codes a light translucent
 * background, which reads as a pale band in dark mode, so the token
 * background replaces it.
 */
export function Page({ breadcrumb, title, actions, children }: PageProps): JSX.Element {
  return (
    <>
      <AppHeader
        breadcrumb={breadcrumb}
        title={title}
        right={actions}
        style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg-app)' }}
      />
      <div style={{ padding: '24px 28px 56px', flex: 1, minWidth: 0 }}>{children}</div>
    </>
  );
}

/** Section heading used inside page bodies. */
export function SectionTitle({
  children,
  meta,
  action,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: '-.01em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {children}
        </h2>
        {meta && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {meta}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/** Mono middle-dot metadata line, the design system's standard meta treatment. */
export function Meta({ parts }: { parts: React.ReactNode[] }): JSX.Element {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
      {parts.filter(Boolean).map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && ' · '}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}
