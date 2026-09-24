import React from 'react';

const TONES = {
  info:      { bg: 'var(--blue-tint)',   border: 'var(--blue-tint-border)',   dot: 'var(--blue-500)',   ink: 'var(--ink)' },
  success:   { bg: 'var(--green-tint)',  border: 'var(--green-tint-border)',                   dot: 'var(--green-600)',  ink: 'var(--ink)' },
  attention: { bg: 'var(--orange-tint)', border: 'var(--orange-tint-border)', dot: 'var(--orange-500)', ink: 'var(--orange-ink)' },
  danger:    { bg: 'var(--red-tint)',            border: 'var(--red-tint-border)',                   dot: 'var(--red-500)',    ink: 'var(--ink)' },
};

// Inline banner/alert: tinted panel with status dot, title + optional body, action link, dismissible.
export function Banner({ tone = 'info', title, action, onAction, onClose, children, style }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, background: t.bg, border: '1px solid ' + t.border,
      borderRadius: 'var(--radius-panel)', padding: '13px 15px', boxSizing: 'border-box', fontFamily: 'var(--font-body)', ...style }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.dot, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontSize: 13.5, fontWeight: 600, color: t.ink, lineHeight: 1.45 }}>{title}</div>}
        {children && <div style={{ fontSize: 13, lineHeight: 1.55, color: tone === 'attention' ? t.ink : 'var(--text-secondary)', marginTop: title ? 3 : 0 }}>{children}</div>}
        {action && <span onClick={onAction} style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 500, color: t.dot, cursor: 'pointer', marginTop: 7 }}>{action}</span>}
      </div>
      {onClose && <span onClick={onClose} style={{ cursor: 'pointer', display: 'inline-flex', marginTop: 2 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-tertiary)' }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>}
    </div>
  );
}
