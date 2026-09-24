import React from 'react';

// Sticky thread header: mono breadcrumb, Space Grotesk title, right-side status pills; blurred app bg.
export function AppHeader({ breadcrumb, title, right, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, padding: '16px 28px',
      borderBottom: '1px solid var(--border-app)', background: 'rgba(244,246,250,.85)', backdropFilter: 'blur(8px)',
      boxSizing: 'border-box', ...style }}>
      <div style={{ minWidth: 0 }}>
        {breadcrumb && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 3 }}>{breadcrumb}</div>}
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.01em', color: 'var(--ink)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}
