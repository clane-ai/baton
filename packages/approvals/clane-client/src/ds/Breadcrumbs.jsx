import React from 'react';

// Mono breadcrumb trail: muted links, › separators, last item ink. Matches the app's mono metadata style.
export function Breadcrumbs({ items, style }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11.5, ...style }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--text-faint)' }}>›</span>}
            {last
              ? <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{it.label}</span>
              : <a href={it.href || '#'} onClick={it.onClick} style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>{it.label}</a>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
