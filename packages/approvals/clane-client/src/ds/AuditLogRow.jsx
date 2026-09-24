import React from 'react';
import { StatusDot } from './StatusDot.jsx';

// One audit event: actor avatar, sentence with mono target, status dot + mono timestamp right.
export function AuditLogRow({ actor, agent, action, target, status, time, ip, style }) {
  const initial = typeof actor === 'string' ? actor.trim().charAt(0).toUpperCase() : '\u00B7';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-card)', ...style }}>
      <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11.5,
        background: agent ? 'var(--blue-tint)' : 'var(--bg-well)', color: agent ? 'var(--blue-500)' : 'var(--text-secondary)',
        border: '1px solid ' + (agent ? 'var(--blue-tint-border)' : 'var(--border-subtle)') }}>{agent ? '\u25CF' : initial}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{actor}</span> {action}{target && <React.Fragment> <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink)', background: 'var(--bg-well)', borderRadius: 5, padding: '1px 6px' }}>{target}</span></React.Fragment>}
        </div>
        {ip && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>{ip}</div>}
      </div>
      {status && <StatusDot status={status} size={7} />}
      <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{time}</span>
    </div>
  );
}
