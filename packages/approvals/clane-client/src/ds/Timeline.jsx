import React from 'react';
import { StatusDot } from './StatusDot.jsx';

// Activity feed: hairline spine, status-dot nodes, title + mono meta, optional body card.
// Generalizes the Activity-sidecar trace (Run-context ProgressSteps is the checklist sibling).
export function Timeline({ items, style }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 22, ...style }}>
      <span style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 1.5, background: 'var(--border-subtle)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {items.map((it, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: -21, top: 3, width: 15, height: 15, borderRadius: '50%',
              background: 'var(--surface-card)', border: '1.5px solid var(--border-strong)', boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StatusDot status={it.status || 'done'} size={6} />
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{it.title}</span>
              {it.meta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{it.meta}</span>}
            </div>
            {it.body && <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)', borderRadius: 9, padding: '10px 12px', marginTop: 7 }}>{it.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
