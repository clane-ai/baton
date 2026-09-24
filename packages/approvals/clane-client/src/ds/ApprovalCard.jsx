import React from 'react';

// In-thread approval card: blue-tint header ("Needs your approval"), detail rows, Approve / Reject / edit actions.
// Renders inside an AgentTurn. Resolved states collapse to a single confirmation line.
export function ApprovalCard({ title, description, rows = [], approveLabel = 'Approve', rejectLabel = 'Reject', editLabel, onApprove, onReject, onEdit, resolved, style }) {
  if (resolved) {
    const ok = resolved === 'approved';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-panel)', padding: '11px 14px', background: 'var(--surface-card)', ...style }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'var(--green-600)' : 'var(--red-500)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{title}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: ok ? 'var(--green-600)' : 'var(--red-500)', marginLeft: 'auto' }}>{ok ? 'approved' : 'rejected'}</span>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--blue-tint-border)', borderRadius: 'var(--radius-panel)', overflow: 'hidden',
      background: 'var(--surface-card)', boxSizing: 'border-box', fontFamily: 'var(--font-body)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 15px', background: 'var(--blue-tint)',
        borderBottom: '1px solid var(--blue-tint-border)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue-500)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--blue-500)', fontWeight: 500 }}>Needs your approval</span>
      </div>
      <div style={{ padding: '14px 15px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{title}</div>
        {description && <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', marginTop: 5 }}>{description}</div>}
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 14 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', width: 82, flexShrink: 0, paddingTop: 1 }}>{r.label}</span>
                <span style={{ fontFamily: r.mono ? 'var(--font-mono)' : 'var(--font-body)', fontSize: r.mono ? 12.5 : 13, color: 'var(--ink)', minWidth: 0 }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 15 }}>
          <span onClick={onApprove} style={{ fontSize: 13, fontWeight: 600, color: 'var(--cta-text)', background: 'var(--cta)', borderRadius: 'var(--radius-btn)', padding: '8px 16px', cursor: 'pointer' }}>{approveLabel}</span>
          <span onClick={onReject} style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'var(--surface-card)', border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-btn)', padding: '8px 16px', cursor: 'pointer' }}>{rejectLabel}</span>
          {editLabel && <span onClick={onEdit} style={{ fontSize: 12.5, color: 'var(--blue-500)', cursor: 'pointer', marginLeft: 4 }}>{editLabel}</span>}
        </div>
      </div>
    </div>
  );
}
