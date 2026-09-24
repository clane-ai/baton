// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Stepper.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Horizontal wizard stepper: numbered circles, connector lines, done = green check, current = blue.
export function Stepper({ steps, current, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', ...style }}>
      {steps.map((s, i) => {
        const done = i < current,
          active = i === current,
          last = i === steps.length - 1;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              flex: last ? 'none' : 1,
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  background: done
                    ? 'var(--green-600)'
                    : active
                      ? 'var(--blue-500)'
                      : 'var(--surface-card)',
                  border: done || active ? 'none' : '1.5px solid var(--border-mid)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: done || active ? '#fff' : 'var(--text-faint)',
                }}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path
                      d="M2 6.5 5 9.5 10 3"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: active ? 500 : 400,
                  whiteSpace: 'nowrap',
                  color: active
                    ? 'var(--ink)'
                    : done
                      ? 'var(--text-secondary)'
                      : 'var(--text-faint)',
                }}
              >
                {s}
              </span>
            </div>
            {!last && (
              <span
                style={{
                  flex: 1,
                  height: 1.5,
                  background: done ? 'var(--green-600)' : 'var(--border-default)',
                  margin: '12px 10px 0',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
