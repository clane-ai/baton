import React from 'react';

// Toggleable filter chip: mono pill, optional status dot or count; active = blue tint.
export function Chip({ active, dot, count, onClick, onRemove, children, style }) {
  return (
    <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: onClick ? 'pointer' : 'default',
      fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '5px 12px', borderRadius: 'var(--radius-pill)',
      color: active ? 'var(--ink)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400, whiteSpace: 'nowrap',
      background: active ? 'var(--blue-tint)' : 'var(--surface-card)',
      border: '1px solid ' + (active ? 'var(--blue-selected-border)' : 'var(--border-default)'), ...style }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {children}
      {count != null && <span style={{ fontSize: 10, color: active ? 'var(--blue-500)' : 'var(--text-faint)' }}>{count}</span>}
      {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ cursor: 'pointer', display: 'inline-flex', marginLeft: 1 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: 'var(--text-tertiary)' }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>}
    </span>
  );
}

// Filter bar: chip row with mono label, active-count "Clear all" affordance.
export function FilterBar({ label, filters, active, onChange, style }) {
  const toggle = (id) => {
    const next = new Set(active);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange && onChange([...next]);
  };
  const activeSet = new Set(active);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}>
      {label && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-faint)', marginRight: 2 }}>{label}</span>}
      {filters.map(f => (
        <Chip key={f.id} active={activeSet.has(f.id)} dot={f.dot} count={f.count} onClick={() => toggle(f.id)}>{f.label}</Chip>
      ))}
      {activeSet.size > 0 && (
        <span onClick={() => onChange && onChange([])}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue-500)', cursor: 'pointer', marginLeft: 4 }}>Clear all</span>
      )}
    </div>
  );
}
