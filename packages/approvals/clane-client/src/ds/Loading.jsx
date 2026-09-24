import React from 'react';

// Spinner: 2px arc in blue. Sizes 14–20 inline, 28 block.
export function Spinner({ size = 18, color = 'var(--blue-500)', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'cl-spin .8s linear infinite', ...style }}>
      <circle cx="12" cy="12" r="9" stroke="var(--border-default)" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Agent-thinking dots: three 6px dots pulsing in sequence.
export function TypingDots({ color = 'var(--text-tertiary)', style }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', ...style }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: color,
        animation: 'cl-typing 1.2s ease-in-out ' + (i * 0.18) + 's infinite' }} />)}
    </span>
  );
}

// Skeleton bar/block shimmer for loading layouts.
export function Skeleton({ width = '100%', height = 14, radius = 6, style }) {
  return <span style={{ display: 'block', width, height, borderRadius: radius,
    background: 'linear-gradient(90deg, var(--border-subtle) 25%, #F6F8FC 45%, var(--border-subtle) 65%)',
    backgroundSize: '200% 100%', animation: 'cl-shimmer 1.4s ease infinite', ...style }} />;
}
