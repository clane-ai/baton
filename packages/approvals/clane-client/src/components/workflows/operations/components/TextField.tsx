import React from 'react';

/**
 * A single-line field in the shared Input's look (src/ds/Input.jsx) with its
 * label tied to the input by id. The shared Input renders an unassociated
 * <label>, so the field has no accessible name; this one does.
 */
export function TextField({
  id,
  label,
  hideLabel,
  ...rest
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'>): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 7, minWidth: 0 }}>
      <label
        htmlFor={id}
        style={
          hideLabel
            ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
            : {
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }
        }
      >
        {label}
      </label>
      <input
        id={id}
        {...rest}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--surface-card)',
          border: '1px solid var(--scrollbar-thumb)',
          borderRadius: 'var(--radius-input)',
          padding: '9px 12px',
          fontFamily: 'var(--font-body)',
          fontSize: 13.5,
          color: 'var(--ink)',
          ...rest.style,
        }}
      />
    </div>
  );
}
