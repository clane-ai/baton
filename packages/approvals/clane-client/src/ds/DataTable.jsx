import React from 'react';

// Answer table from Clane Analytics chat: mono uppercase headers on --bg-page, hairline rows, footer bar.
export function DataTable({ columns, rows, footer, footerAction }) {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface-card)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: c.align || 'left', padding: '10px 14px', fontFamily: 'var(--font-mono)',
                fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 500,
                color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-page)' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c, j) => (
                <td key={c.key} style={{ padding: '10px 14px', textAlign: c.align || 'left',
                  fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-body)', fontSize: c.mono ? 12.5 : 13,
                  fontWeight: j === 0 ? 500 : c.emphasis ? 500 : 400,
                  color: c.color || (j === 0 ? 'var(--ink)' : 'var(--text-secondary)'),
                  borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(footer || footerAction) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px',
          borderTop: '1px solid var(--border-default)', background: 'var(--bg-page)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{footer}</span>
          {footerAction}
        </div>
      )}
    </div>
  );
}
