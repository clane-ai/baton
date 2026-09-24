// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Eyebrow.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

export function Eyebrow({
  dot,
  dotColor = 'var(--blue-500)',
  tone = 'light',
  size = 'md',
  style,
  children,
}) {
  const color = tone === 'dark' ? 'var(--text-dark-tertiary)' : 'var(--text-secondary)';
  const sz =
    size === 'sm'
      ? { fontSize: 10, letterSpacing: '.14em' }
      : { fontSize: 11, letterSpacing: '.16em' };
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        color,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        ...sz,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
        />
      )}
      {children}
    </div>
  );
}
