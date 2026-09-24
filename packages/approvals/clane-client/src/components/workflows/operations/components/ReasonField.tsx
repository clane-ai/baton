import React from 'react';

/** A labelled multi-line field with a helper line, in the design system's input style. */
export function ReasonField({
  id,
  label,
  value,
  onChange,
  helper,
  placeholder,
  rows = 2,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: React.ReactNode;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}): JSX.Element {
  const helpId = helper ? `${id}-help` : undefined;
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <label
        htmlFor={id}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          font: 'inherit',
          fontSize: 13.5,
          lineHeight: 1.5,
          padding: '9px 12px',
          color: 'var(--ink)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-mid)',
          borderRadius: 'var(--radius-input)',
        }}
      />
      {helper ? (
        <span id={helpId} style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {helper}
        </span>
      ) : null}
    </div>
  );
}
