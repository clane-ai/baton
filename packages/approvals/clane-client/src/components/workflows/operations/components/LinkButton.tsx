import React from 'react';
import { Link } from 'react-router-dom';

/**
 * An in-section link that looks like the design system's Button. A <Button>
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
  const primary = variant === 'primary';
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
        fontSize: 14,
        padding: '8px 14px',
        borderRadius: 'var(--radius-btn)',
        textDecoration: 'none',
        background: primary ? 'var(--cta)' : variant === 'ghost' ? 'transparent' : 'var(--surface-card)',
        color: primary ? 'var(--cta-text)' : 'var(--ink)',
        border: primary || variant === 'ghost' ? '1px solid transparent' : '1px solid var(--border-mid)',
      }}
    >
      {children}
    </Link>
  );
}
