import React from 'react';
import { Link } from 'react-router-dom';

/**
 * An in-section link that looks like the design system's Button (same
 * variants and sizes as src/ds/Button.jsx). A <Button>
 * inside a <Link> would nest one interactive element in another; this keeps a
 * single anchor, so the router handles the navigation and assistive technology
 * hears one link.
 */
export function LinkButton({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  children: React.ReactNode;
}): JSX.Element {
  const look =
    variant === 'primary'
      ? { background: 'var(--blue-500)', color: '#fff', border: '1px solid var(--blue-500)' }
      : variant === 'ghost'
        ? { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' }
        : { background: 'transparent', color: 'var(--blue-500)', border: '1px solid var(--blue-500)' };
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 32,
        padding: '0 16px',
        fontSize: 13.5,
        fontWeight: 500,
        fontFamily: 'var(--font-body)',
        borderRadius: 'var(--radius-btn)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...look,
      }}
    >
      {children}
    </Link>
  );
}
