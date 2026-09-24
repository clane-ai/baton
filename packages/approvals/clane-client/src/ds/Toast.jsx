import React from 'react';
import { StatusDot } from './StatusDot.jsx';

// Transient toast: white card, status dot, title + optional detail, optional action link.
// Derived from the app's card/chip language (no toast existed in source screens — intentional addition).
export function Toast({ status = 'done', title, detail, action, onAction, onClose, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, background: 'var(--surface-card)',
      border: '1px solid var(--border-default)', borderRadius: 'var(--radius-panel)',
      boxShadow: '0 18px 40px -16px rgba(10,18,36,.36)', padding: '13px 15px', width: 340,
      boxSizing: 'border-box', fontFamily: 'var(--font-body)', animation: 'cl-toast .25s ease', ...style }}>
      <StatusDot status={status} style={{ marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>{title}</div>
        {detail && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{detail}</div>}
        {action && <span onClick={onAction} style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 500, color: 'var(--blue-500)', cursor: 'pointer', marginTop: 7 }}>{action}</span>}
      </div>
      {onClose && <span onClick={onClose} style={{ cursor: 'pointer', display: 'inline-flex', marginTop: 2 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9AA9C2" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>}
    </div>
  );
}

// Fixed stack host: bottom-right, newest on top.
export function ToastStack({ toasts, onClose, inline }) {
  return (
    <div style={{ position: inline ? 'absolute' : 'fixed', right: 20, bottom: 20, display: 'flex',
      flexDirection: 'column-reverse', gap: 10, zIndex: 80 }}>
      {toasts.map(t => <Toast key={t.id} {...t} onClose={onClose ? () => onClose(t.id) : undefined} />)}
    </div>
  );
}
