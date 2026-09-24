import React from 'react';

export type FieldItem = {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  /** Spans both columns (addresses, long notes). */
  wide?: boolean;
  /** Where the value came from, e.g. "email · 96%". */
  source?: React.ReactNode;
};

const empty = (v: React.ReactNode): boolean => v === null || v === undefined || v === '' || v === false;

/**
 * Labelled values in a two-column rhythm: mono label over the value, with an
 * optional source marker after it. Empty values are left out rather than shown
 * as dashes, so a document shows what it has.
 */
export function FieldGrid({ fields }: { fields: FieldItem[] }): JSX.Element {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '14px 24px',
        margin: 0,
      }}
    >
      {fields
        .filter((f) => !empty(f.value))
        .map((f, i) => (
          <div key={i} style={{ gridColumn: f.wide ? '1 / -1' : undefined, minWidth: 0 }}>
            <dt
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                marginBottom: 4,
              }}
            >
              {f.label}
            </dt>
            <dd
              style={{
                margin: 0,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: 8,
                color: 'var(--ink)',
                fontFamily: f.mono ? 'var(--font-mono)' : 'var(--font-body)',
                fontSize: f.mono ? 12.5 : 13.5,
                overflowWrap: 'anywhere',
              }}
            >
              <span>{f.value}</span>
              {f.source ? <SourceMark>{f.source}</SourceMark> : null}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function SourceMark({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        color: 'var(--text-tertiary)',
        background: 'var(--bg-well)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-pill)',
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
