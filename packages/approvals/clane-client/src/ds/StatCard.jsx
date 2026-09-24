// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/StatCard.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// KPI stat card from the Command Center: mono microlabel, big Space Grotesk number, optional delta + sparkline slot.
export function StatCard({
  label,
  value,
  valueColor = 'var(--ink)',
  delta,
  deltaColor = 'var(--green-600)',
  children,
  style,
}) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-app)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        padding: '18px 20px',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '8px 0 0' }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: '-.03em',
            color: valueColor,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {delta && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: deltaColor }}>
            {delta}
          </span>
        )}
      </div>
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
