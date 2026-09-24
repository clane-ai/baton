// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Tabs.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Underline tabs: 14px labels, active = ink + 2px blue underline; optional mono count badges.
export function Tabs({ tabs, value, onChange, style }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        borderBottom: '1px solid var(--border-default)',
        ...style,
      }}
    >
      {tabs.map((t) => {
        const key = typeof t === 'string' ? t : t.value;
        const label = typeof t === 'string' ? t : t.label;
        const count = typeof t === 'string' ? undefined : t.count;
        const on = key === value;
        return (
          <span
            key={key}
            onClick={() => onChange && onChange(key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 2px 11px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: on ? 500 : 400,
              color: on ? 'var(--ink)' : 'var(--text-secondary)',
              borderBottom: '2px solid ' + (on ? 'var(--blue-500)' : 'transparent'),
              marginBottom: -1,
            }}
          >
            {label}
            {count != null && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  color: on ? 'var(--blue-500)' : 'var(--text-faint)',
                  background: on ? 'var(--blue-tint)' : 'var(--bg-app)',
                  border:
                    '1px solid ' + (on ? 'var(--blue-selected-border)' : 'var(--border-default)'),
                  borderRadius: 999,
                  padding: '1px 7px',
                }}
              >
                {count}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
