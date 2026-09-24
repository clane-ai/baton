// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/EmptyState.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Empty state: dashed border well, muted icon, Space Grotesk title, body, optional action.
export function EmptyState({ icon, title, description, action, style }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        border: '1.5px dashed var(--border-strong)',
        borderRadius: 'var(--radius-card)',
        padding: '40px 28px',
        background: 'var(--bg-page)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {icon && <div style={{ marginBottom: 14, opacity: 0.8 }}>{icon}</div>}
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 16,
          color: 'var(--ink)',
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: 'var(--text-tertiary)',
            margin: '7px 0 0',
            maxWidth: 340,
          }}
        >
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}
