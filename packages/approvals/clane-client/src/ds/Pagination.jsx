import React from 'react';

function PageBtn({ active, disabled, onClick, children }) {
  const [h, setH] = React.useState(false);
  return (
    <span onClick={disabled ? undefined : onClick} onMouseOver={() => setH(true)} onMouseOut={() => setH(false)}
      style={{ minWidth: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 6px', boxSizing: 'border-box', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
        color: active ? 'var(--ink)' : disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400, opacity: disabled ? .5 : 1,
        background: active ? 'var(--blue-tint)' : h && !disabled ? 'var(--bg-app)' : 'transparent',
        border: active ? '1px solid var(--blue-selected-border)' : '1px solid transparent' }}>{children}</span>
  );
}

// Mono pagination: ‹ › arrows, blue-tint active page, … ellipsis, optional mono range caption.
export function Pagination({ page, pageCount, onChange, caption, style }) {
  const pages = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <PageBtn disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</PageBtn>
        {pages.map((p, i) => p === '…'
          ? <span key={'e' + i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', padding: '0 4px' }}>…</span>
          : <PageBtn key={p} active={p === page} onClick={() => onChange(p)}>{p}</PageBtn>)}
        <PageBtn disabled={page >= pageCount} onClick={() => onChange(page + 1)}>›</PageBtn>
      </div>
      {caption && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{caption}</span>}
    </div>
  );
}
