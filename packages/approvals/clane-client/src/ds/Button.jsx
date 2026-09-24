// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Button.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

// Migrated to the new design system's Button (Phase 3 · core). Primary is the
// system blue (monday), with secondary/ghost/danger + dark variants and the
// sm/md/lg height scale. Adapted to the tokens this .cl-ds surface already
// defines; hover uses token-agnostic filter/rgba so it holds whatever the blue
// token resolves to. Keeps href (renders <a>) and passthrough props for
// backward compatibility with existing callers.
const V = {
  primary: { background: 'var(--blue-500)', color: '#fff', border: '1px solid var(--blue-500)' },
  secondary: {
    background: 'transparent',
    color: 'var(--blue-500)',
    border: '1px solid var(--blue-500)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid transparent',
  },
  secondaryDark: {
    background: 'transparent',
    color: 'var(--text-on-dark)',
    border: '1px solid var(--border-dark-2)',
  },
  ghostDark: {
    background: 'transparent',
    color: 'var(--text-dark-mono)',
    border: '1px solid transparent',
  },
  danger: { background: 'var(--red-500)', color: '#fff', border: '1px solid var(--red-500)' },
};

const S = {
  sm: { height: 28, padding: '0 12px', fontSize: 13 },
  md: { height: 32, padding: '0 16px', fontSize: 13.5 },
  lg: { height: 40, padding: '0 20px', fontSize: 14.5 },
};

const hoverBg = (variant) => {
  if (variant === 'primary' || variant === 'danger') return { filter: 'brightness(0.93)' };
  if (variant === 'secondary') return { background: 'var(--blue-tint)' };
  if (variant === 'ghost') return { background: 'var(--bg-well)' };
  if (variant === 'secondaryDark' || variant === 'ghostDark')
    return { background: 'rgba(255,255,255,.08)' };
  return {};
};

export function Button({
  variant = 'primary',
  size = 'md',
  href,
  icon,
  trailing,
  disabled,
  fullWidth,
  onClick,
  style,
  children,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const v = V[variant] || V.primary;
  const s = S[size] || S.md;
  const hover = !disabled && h;
  const Tag = href ? 'a' : 'button';

  return (
    <Tag
      href={href}
      disabled={!href && disabled ? true : undefined}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: s.height,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 500,
        fontFamily: 'var(--font-body)',
        borderRadius: 'var(--radius-btn)',
        textDecoration: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        width: fullWidth ? '100%' : 'auto',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        boxSizing: 'border-box',
        transition:
          'background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), filter var(--dur-fast) var(--ease)',
        ...v,
        ...(hover ? hoverBg(variant) : {}),
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </Tag>
  );
}
