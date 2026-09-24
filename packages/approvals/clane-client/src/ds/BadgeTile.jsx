// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/BadgeTile.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Square mono-initials tile: user avatars (AB), file types (PY/PDF), agents (PA), connectors (G).
export function BadgeTile({
  color = 'var(--blue-tint)',
  ink = 'var(--blue-500)',
  size = 24,
  radius,
  children,
  style,
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius != null ? radius : Math.round(size / 4) + 1,
        background: color,
        color: ink,
        fontFamily: 'var(--font-mono)',
        fontSize: Math.round(size * 0.42) - 1,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
