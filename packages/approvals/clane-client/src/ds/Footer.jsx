// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Footer.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

const C = {
  fg: 'var(--text-dim, var(--text-secondary, #5a6b86))',
  faint: 'var(--text-faint, #9aa9c2)',
  border: 'var(--hair, var(--border-default, #e4eaf3))',
  accent: 'var(--accent, var(--blue-500, #3e7bfa))',
  font: 'var(--font-body, sans-serif)',
};

export function Footer({ copyright, links = [], version }) {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 16px',
        borderTop: `1px solid ${C.border}`,
        fontFamily: C.font,
        fontSize: 12.5,
        color: C.fg,
      }}
    >
      {copyright && <span>{copyright}</span>}
      <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0 }}>
        {links.map((l) => (
          <a key={l.href} href={l.href} style={{ color: C.fg, textDecoration: 'none' }}>
            {l.label}
          </a>
        ))}
      </div>
      {version && (
        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: C.faint }}>{version}</span>
      )}
    </footer>
  );
}
