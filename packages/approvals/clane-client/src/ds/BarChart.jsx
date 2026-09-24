import React from 'react';

// Vertical bar chart from the Analytics answer card: flex bars, mono labels, optional value labels.
export function BarChart({ data, height = 120, color = 'var(--blue-500)', valueColor = 'var(--orange-500)', maxBarWidth = 46, formatValue }) {
  const max = Math.max(...data.map(d => Math.abs(d.value)));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height, padding: '4px 6px 0' }}>
      {data.map(d => (
        <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 7 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: d.highlight ? valueColor : 'var(--text-secondary)' }}>{formatValue ? formatValue(d.value) : d.value}</span>
          <div style={{ width: '100%', maxWidth: maxBarWidth, height: Math.max(4, (Math.abs(d.value) / max) * (height - 42)), background: d.highlight ? 'var(--orange-500)' : color, borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}
