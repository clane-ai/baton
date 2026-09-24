// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/StatusDot.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

const C = {
  done: 'var(--green-600)',
  needsYou: 'var(--blue-500)',
  running: 'var(--amber-500)',
  failed: 'var(--red-500)',
  attention: 'var(--orange-500)',
};

export function StatusDot({ status = 'done', size = 7, pulse, style }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: C[status] || status,
        flexShrink: 0,
        animation: pulse ? 'cl-livedot 2s ease-in-out infinite' : 'none',
        ...style,
      }}
    />
  );
}
