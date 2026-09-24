import React from 'react';

// Linear progress: 6px track, blue fill (or state color), optional mono label/value row; indeterminate sweep.
export function ProgressBar({ value, max = 100, label, color = 'var(--blue-500)', indeterminate, formatValue, style }) {
  const frac = Math.min(1, Math.max(0, (value || 0) / max));
  return (
    <div style={style}>
      {(label || formatValue) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          {label && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{label}</span>}
          {!indeterminate && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink)', fontWeight: 500 }}>{formatValue ? formatValue(value) : Math.round(frac * 100) + '%'}</span>}
        </div>
      )}
      <div style={{ height: 6, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden', position: 'relative' }}>
        {indeterminate
          ? <span style={{ position: 'absolute', top: 0, bottom: 0, width: '36%', borderRadius: 999, background: color, animation: 'cl-indeterminate 1.3s ease-in-out infinite' }} />
          : <span style={{ display: 'block', height: '100%', width: (frac * 100) + '%', borderRadius: 999, background: color, transition: 'width .3s ease' }} />}
      </div>
    </div>
  );
}
