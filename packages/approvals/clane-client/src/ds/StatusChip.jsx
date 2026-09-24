// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/StatusChip.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';
import { StatusDot } from './StatusDot.jsx';

export function StatusChip({ status, pulse, tone = 'light', pill = true, style, children }) {
  const dark = tone === 'dark';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--font-mono)',
        fontSize: dark ? 12 : 11.5,
        color: dark ? 'var(--text-dark-mono)' : 'var(--ink)',
        background: dark ? 'var(--surface-dark-raised)' : 'var(--surface-card)',
        border: '1px solid ' + (dark ? 'var(--border-dark-2)' : 'var(--border-default)'),
        borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-sm)',
        padding: dark ? '9px 13px' : '5px 12px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {status && <StatusDot status={status} pulse={pulse} size={dark ? 6 : 7} />}
      {children}
    </span>
  );
}
