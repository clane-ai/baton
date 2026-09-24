import React from 'react';

// Right sidecar overlay, from the Activity panel: 560px, slide-in, sticky blurred header, scrim.
export function Drawer({ open, title, headerExtra, onClose, width = 560, inline, children }) {
  if (!open) return null;
  const pos = inline ? 'absolute' : 'fixed';
  return (
    <div style={{ display: 'contents' }}>
      <div onClick={onClose} style={{ position: pos, inset: 0, background: 'rgba(10,18,36,.28)', zIndex: 60 }} />
      <aside style={{ position: pos, top: 0, right: 0, height: '100%', width, maxWidth: '92vw', background: 'var(--surface-card)',
        borderLeft: '1px solid var(--border-app)', boxShadow: '-24px 0 60px -28px rgba(10,18,36,.5)', zIndex: 61,
        overflowY: 'auto', animation: 'cl-drawer .25s ease', fontFamily: 'var(--font-body)', boxSizing: 'border-box' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--surface-overlay)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border-subtle)', padding: '16px 22px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 14, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>{title}</span>
            {headerExtra}
          </div>
          <span onClick={onClose} style={{ display: 'inline-flex', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA9C2" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        </div>
        <div style={{ padding: '20px 22px 40px' }}>{children}</div>
      </aside>
    </div>
  );
}
