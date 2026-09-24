// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Menu.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Dropdown panel + items, from the composer "+" menu and agent picker.
export function Menu({ width = 262, style, children }) {
  return (
    <div
      style={{
        width,
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        boxShadow: '0 18px 40px -16px rgba(10,18,36,.36)',
        padding: 6,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function MenuItem({ icon, label, description, shortcut, trailing, active, onClick }) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseOver={() => setH(true)}
      onMouseOut={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: description ? 'flex-start' : 'center',
        gap: 11,
        padding: '9px 10px',
        borderRadius: 9,
        cursor: 'pointer',
        background: h || active ? 'var(--bg-app)' : 'transparent',
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: description ? 500 : 400, color: 'var(--ink)' }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>
      {shortcut && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
          {shortcut}
        </span>
      )}
      {trailing}
    </div>
  );
}

export function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 6px' }} />;
}
