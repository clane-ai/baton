// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Input.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

export function Input({ label, labelRight, style, ...rest }) {
  const [f, setF] = React.useState(false);
  const field = (
    <input
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: 'var(--surface-card)',
        border: '1px solid ' + (f ? 'var(--blue-500)' : 'var(--scrollbar-thumb)'),
        borderRadius: 'var(--radius-input)',
        padding: '12px 14px',
        fontFamily: 'var(--font-body)',
        fontSize: 14.5,
        color: 'var(--ink)',
        outline: 'none',
        boxShadow: f ? '0 0 0 3px rgba(62,123,250,.18)' : 'none',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        ...style,
      }}
      {...rest}
    />
  );
  if (!label) return field;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 7,
        }}
      >
        <label
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {label}
        </label>
        {labelRight}
      </div>
      {field}
    </div>
  );
}
