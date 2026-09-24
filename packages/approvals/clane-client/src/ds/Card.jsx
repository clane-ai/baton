// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Card.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

export function Card({ app, large, flush, style, children, ...rest }) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid ' + (app ? 'var(--border-app)' : 'var(--border-default)'),
        borderRadius: large ? 'var(--radius-card-lg)' : 'var(--radius-card)',
        padding: flush ? 0 : large ? '30px 28px' : '28px 26px',
        boxShadow: app ? 'var(--shadow-card)' : 'none',
        boxSizing: 'border-box',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
