import React from 'react';

// DataTable extended with click-to-sort headers (▲▼), a filter-chip toolbar, and text search.
export function SortableTable({ columns, rows, filters = [], searchKeys, footer, pageSize, style }) {
  const [sort, setSort] = React.useState(null); // {key, dir}
  const [active, setActive] = React.useState(new Set());
  const [q, setQ] = React.useState('');
  const toggleFilter = (id) => setActive(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  let out = rows;
  if (q && searchKeys) out = out.filter(r => searchKeys.some(k => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase())));
  for (const f of filters) if (active.has(f.id)) out = out.filter(f.fn);
  if (sort) {
    const col = columns.find(c => c.key === sort.key);
    out = [...out].sort((a, b) => {
      const av = col && col.sortValue ? col.sortValue(a) : a[sort.key];
      const bv = col && col.sortValue ? col.sortValue(b) : b[sort.key];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }
  const shown = pageSize ? out.slice(0, pageSize) : out;
  const clickSort = (c) => {
    if (c.sortable === false) return;
    setSort(s => !s || s.key !== c.key ? { key: c.key, dir: 'asc' } : s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null);
  };
  return (
    <div style={style}>
      {(filters.length > 0 || searchKeys) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {searchKeys && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--surface-card)', border: '1px solid var(--scrollbar-thumb)',
              borderRadius: 'var(--radius-btn)', padding: '6px 10px', flex: '1 1 180px', maxWidth: 280 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A9BB8" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font-body)', background: 'transparent' }} />
            </span>
          )}
          {filters.map(f => {
            const on = active.has(f.id);
            return (
              <span key={f.id} onClick={() => toggleFilter(f.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '5px 12px', borderRadius: 'var(--radius-pill)',
                  color: on ? 'var(--ink)' : 'var(--text-secondary)', fontWeight: on ? 500 : 400,
                  background: on ? 'var(--blue-tint)' : 'var(--surface-card)',
                  border: '1px solid ' + (on ? 'var(--blue-selected-border)' : 'var(--border-default)') }}>
                {f.dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: f.dot }} />}{f.label}
              </span>
            );
          })}
        </div>
      )}
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface-card)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {columns.map(c => {
                const on = sort && sort.key === c.key;
                return (
                  <th key={c.key} onClick={() => clickSort(c)}
                    style={{ textAlign: c.align || 'left', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 10.5,
                      letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 500,
                      color: on ? 'var(--blue-500)' : 'var(--text-tertiary)', borderBottom: '1px solid var(--border-default)',
                      background: 'var(--bg-page)', cursor: c.sortable === false ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {c.label}{c.sortable !== false && <span style={{ marginLeft: 5, opacity: on ? 1 : .35 }}>{on ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {columns.map((c, j) => (
                  <td key={c.key} style={{ padding: '10px 14px', textAlign: c.align || 'left',
                    fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-body)', fontSize: c.mono ? 12.5 : 13,
                    fontWeight: j === 0 ? 500 : 400, color: c.color || (j === 0 ? 'var(--ink)' : 'var(--text-secondary)'),
                    borderBottom: i < shown.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length} style={{ padding: '22px 14px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)' }}>No rows match.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-page)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{out.length} of {rows.length} rows{footer ? ' · ' + footer : ''}</span>
        </div>
      </div>
    </div>
  );
}
