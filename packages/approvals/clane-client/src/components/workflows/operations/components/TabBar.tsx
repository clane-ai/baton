import React, { useRef } from 'react';

export type TabItem = {
  value: string;
  label: React.ReactNode;
  count?: number | string;
  /** Shown in the tab and blocks selection, e.g. a document the workspace does not hold. */
  disabled?: boolean;
  note?: React.ReactNode;
  title?: string;
};

/**
 * Tabs in the shared design system's look (src/ds/Tabs.jsx), built as a real
 * tablist: buttons with role="tab", aria-selected, disabled, and arrow-key
 * movement. The shared Tabs renders clickable spans, which a keyboard or a
 * screen reader cannot use; this keeps its look and adds the semantics.
 */
export function TabBar({
  items,
  value,
  onChange,
  label,
  trailing,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  trailing?: React.ReactNode;
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
  // The tab that takes focus: the selected one, or the first usable one when
  // nothing is selected, so the list is always reachable by keyboard.
  const focusable = items.some((t) => t.value === value && !t.disabled) ? value : items[enabled[0]]?.value;

  const onKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const at = enabled.indexOf(i);
    const next = enabled[(at + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        borderBottom: '1px solid var(--border-default)',
        overflowX: 'auto',
      }}
    >
      <div role="tablist" aria-label={label} style={{ display: 'flex', gap: 24 }}>
        {items.map((t, i) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={t.value === focusable ? 0 : -1}
              disabled={t.disabled}
              title={t.title}
              onClick={() => !t.disabled && onChange(t.value)}
              onKeyDown={(e) => onKey(e, i)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '10px 2px 11px',
                marginBottom: -1,
                background: 'none',
                border: 0,
                borderBottom: `2px solid ${on ? 'var(--blue-500)' : 'transparent'}`,
                font: 'inherit',
                fontSize: 14,
                fontWeight: on ? 500 : 400,
                color: t.disabled ? 'var(--text-faint)' : on ? 'var(--ink)' : 'var(--text-secondary)',
                cursor: t.disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
              {t.note ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>{t.note}</span>
              ) : null}
              {t.count != null ? (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    color: on ? 'var(--blue-500)' : 'var(--text-faint)',
                    background: on ? 'var(--blue-tint)' : 'var(--bg-app)',
                    border: `1px solid ${on ? 'var(--blue-selected-border)' : 'var(--border-default)'}`,
                    borderRadius: 999,
                    padding: '1px 7px',
                  }}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {trailing ? <div style={{ marginLeft: 'auto', display: 'flex' }}>{trailing}</div> : null}
    </div>
  );
}
