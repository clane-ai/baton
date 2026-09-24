// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/FileRow.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';
import { BadgeTile } from './BadgeTile.jsx';

// File row from the Run-context rail: badge tile, truncating name, mono size, hover border→blue.
export function FileRow({
  badge,
  badgeColor = 'var(--blue-tint)',
  badgeInk = 'var(--blue-500)',
  name,
  meta,
  onClick,
}) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseOver={() => setH(true)}
      onMouseOut={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        border: '1px solid ' + (h ? 'var(--blue-500)' : 'var(--border-app)'),
        borderRadius: 10,
        padding: '11px 13px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <BadgeTile size={30} color={badgeColor} ink={badgeInk}>
        {badge}
      </BadgeTile>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </span>
      {meta && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-faint)',
            flexShrink: 0,
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}
