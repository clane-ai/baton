// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Avatar.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Deterministic tint per name — same PALETTE as projects/ds AvatarGroup.
const PALETTE = [
  ['var(--blue-tint, #eef3fe)', 'var(--blue-500, #3e7bfa)'],
  ['var(--green-tint, #eaf6f1)', 'var(--green-600, #1a8f6a)'],
  ['var(--purple-tint, #f1ecfb)', 'var(--purple-ink, #7b5bd6)'],
  ['var(--orange-tint, #fff7f3)', 'var(--orange-500, #ff6a3d)'],
  ['var(--red-tint, #fdecea)', 'var(--red-500, #e5484d)'],
];

function initialsOf(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ name, src, size = 30, style }) {
  const dim = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    boxSizing: 'border-box',
  };
  if (src) {
    return (
      <img
        data-avatar=""
        src={src}
        alt={name || ''}
        style={{ ...dim, objectFit: 'cover', ...style }}
      />
    );
  }
  const label = name ? initialsOf(name) : '';
  const [bg, ink] = name
    ? PALETTE[(name.charCodeAt(0) + name.length) % PALETTE.length]
    : ['var(--bg-well, #f2f5fa)', 'var(--text-faint, #9aa9c2)'];
  return (
    <span
      data-avatar=""
      style={{
        ...dim,
        background: bg,
        color: ink,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: Math.round(size * 0.36),
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {label}
    </span>
  );
}
