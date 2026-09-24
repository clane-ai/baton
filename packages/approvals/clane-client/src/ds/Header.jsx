// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/Header.jsx (2026-09-24) so specs run against the real markup.
import React, { useState, useRef, useEffect } from 'react';
import { Avatar } from './Avatar';
import { Menu, MenuItem, MenuDivider } from './Menu';
import { useAuthOptional } from '../lib/auth';

// Inline chevron so ds stays free of any app-component dependency.
function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Fallback-chain tokens: main-app token → DS token → literal. Keeps the
// bar themed in both the app :root world and the .cl-ds builds.
const C = {
  fg: 'var(--text, var(--text-primary, #14233d))',
  dim: 'var(--text-dim, var(--text-secondary, #5a6b86))',
  border: 'var(--hair, var(--border-default, #e4eaf3))',
  accent: 'var(--accent, var(--blue-500, #3e7bfa))',
  hover: 'var(--ink-2, var(--bg-well, #f2f5fa))',
  font: 'var(--font-body, sans-serif)',
};

// Base bar colour only. The optional branded banner image + scrim is layered on
// per-theme by the host app in CSS (`.app-main > header` in styles/app.css),
// which needs a real background-image and a data-mode swap — neither of which an
// inline style can express. Keeping only the colour here means the app CSS can
// paint the image over it without an inline `background-image` winning.
const BAR_BG_COLOR = 'var(--ink-1, var(--surface-card, #ffffff))';

export function Header({
  brand,
  left,
  nav = [],
  actions,
  end,
  menuHeader,
  menu = [],
  signInLabel = 'Sign in',
  onSignIn,
  accountVariant = 'avatar',
  user: userProp,
}) {
  const auth = useAuthOptional();
  const user = userProp !== undefined ? userProp : (auth?.user ?? null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 56,
        padding: '0 16px',
        backgroundColor: BAR_BG_COLOR,
        borderBottom: `1px solid ${C.border}`,
        fontFamily: C.font,
      }}
    >
      {left}

      {!left && brand && (
        <button
          type="button"
          onClick={brand.onClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: brand.onClick ? 'pointer' : 'default',
            color: C.fg,
            font: 'inherit',
            fontWeight: 600,
          }}
        >
          {brand.mark && <img src={brand.mark} alt="" style={{ height: 24 }} />}
          <span>{brand.label}</span>
        </button>
      )}

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
        {nav.map((item) => (
          <a
            key={item.id}
            href={item.href || undefined}
            onClick={
              item.onClick
                ? (e) => {
                    if (!item.href) e.preventDefault();
                    item.onClick();
                  }
                : undefined
            }
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: 13.5,
              textDecoration: 'none',
              cursor: 'pointer',
              color: item.active ? C.accent : C.dim,
              fontWeight: item.active ? 600 : 500,
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      {actions}

      <div ref={ref} style={{ position: 'relative' }}>
        {user ? (
          <>
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: accountVariant === 'chip' ? 8 : 6,
                background: open ? C.hover : 'transparent',
                border: 'none',
                borderRadius: 999,
                padding: accountVariant === 'chip' ? '3px 8px 3px 3px' : 3,
                cursor: 'pointer',
                color: C.fg,
                font: 'inherit',
              }}
            >
              <Avatar
                name={user.name || user.email}
                src={user.avatarUrl || user.avatar}
                size={30}
              />
              {accountVariant === 'chip' && (
                <>
                  <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{user.name || user.email}</span>
                    {user.role && <span style={{ fontSize: 11, color: C.dim }}>{user.role}</span>}
                  </span>
                  <span style={{ color: C.dim, display: 'inline-flex' }}>
                    <Chevron />
                  </span>
                </>
              )}
            </button>
            {open && (
              <div
                className="cl-ds"
                style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60 }}
              >
                <Menu width={248}>
                  <div style={{ padding: '6px 10px 8px' }}>
                    {user.name && (
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                        {user.name}
                      </div>
                    )}
                    {user.email && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{user.email}</div>
                    )}
                    {menuHeader}
                  </div>
                  {menu.length > 0 && <MenuDivider />}
                  {menu.map((it, i) =>
                    it.sep ? (
                      <MenuDivider key={`sep-${i}`} />
                    ) : (
                      <MenuItem
                        key={it.label ?? i}
                        icon={it.icon}
                        label={
                          <span style={it.danger ? { color: 'var(--red-500)' } : undefined}>
                            {it.label}
                          </span>
                        }
                        onClick={() => {
                          setOpen(false);
                          it.onClick?.();
                        }}
                      />
                    ),
                  )}
                </Menu>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: 'transparent',
              color: C.fg,
              fontSize: 13.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {signInLabel}
          </button>
        )}
      </div>

      {end}
    </header>
  );
}
