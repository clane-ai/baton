// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Modal.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Centered dialog. Intentional addition: derived from the sidecar scrim + card patterns.
export function Modal({ open, title, onClose, footer, width = 440, inline, children }) {
  if (!open) return null;
  const pos = inline ? 'absolute' : 'fixed';
  return (
    <div style={{ display: 'contents' }}>
      <div
        onClick={onClose}
        style={{ position: pos, inset: 0, background: 'rgba(10,18,36,.28)', zIndex: 60 }}
      />
      <div
        role="dialog"
        style={{
          position: pos,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width,
          maxWidth: inline ? '86%' : '92vw',
          background: 'var(--surface-card)',
          borderRadius: 16,
          boxShadow: '0 24px 60px -20px rgba(10,18,36,.5)',
          zIndex: 61,
          fontFamily: 'var(--font-body)',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 16,
              color: 'var(--ink)',
            }}
          >
            {title}
          </span>
          <span onClick={onClose} style={{ display: 'inline-flex', cursor: 'pointer' }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9AA9C2"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        </div>
        <div
          style={{
            padding: '18px 20px',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              padding: '14px 20px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
