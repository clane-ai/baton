// STAGING STUB for the EXISTING shared exports of clane-client/src/ds/index.js — not copied to the
// platform (the real barrel is there). Minimal DOM output with token styles so specs can find text.
// The PROMOTED components (Task 2) are real files next to this one and are re-exported below; the
// platform's index.js gets the same export lines (PATCHES.md).
import React from 'react';

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5 };

export function Tabs({ tabs, value, onChange, style }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-default)', ...style }}>
      {tabs.map((t) => {
        const v = typeof t === 'string' ? t : t.value;
        const label = typeof t === 'string' ? t : t.label;
        const count = typeof t === 'string' ? undefined : t.count;
        const on = v === value;
        return (
          <button key={v} role="tab" aria-selected={on} type="button" onClick={() => onChange && onChange(v)}
            style={{ background: 'none', border: 0, borderBottom: on ? '2px solid var(--blue-500)' : '2px solid transparent', padding: '9px 12px', color: on ? 'var(--ink)' : 'var(--text-secondary)', fontWeight: on ? 600 : 500, cursor: 'pointer', font: 'inherit' }}>
            {label}{count !== undefined ? <span style={{ ...mono, marginLeft: 6, color: 'var(--text-tertiary)' }}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
export function StatCard({ label, value, valueColor, delta, deltaColor, children, style }) {
  return (
    <div style={{ border: '1px solid var(--border-app)', borderRadius: 'var(--radius-card)', background: 'var(--surface-card)', padding: '16px 18px', ...style }}>
      <div style={{ ...mono, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', color: valueColor || 'var(--ink)', marginTop: 6 }}>{value}</div>
      {delta ? <div style={{ ...mono, color: deltaColor || 'var(--text-secondary)', marginTop: 4 }}>{delta}</div> : null}
      {children}
    </div>
  );
}
export function Card({ app, large, flush, style, children, ...rest }) {
  return <div {...rest} style={{ background: 'var(--surface-card)', border: '1px solid var(--border-app)', borderRadius: large ? 'var(--radius-card-lg)' : 'var(--radius-card)', boxShadow: app ? 'var(--shadow-card)' : 'none', padding: flush ? 0 : 'var(--card-pad)', ...style }}>{children}</div>;
}
export function EmptyState({ icon, title, description, action, style }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)', ...style }}>
      {icon}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{title}</div>
      {description ? <div style={{ fontSize: 13, marginTop: 6 }}>{description}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
export function Button({ variant = 'primary', size = 'md', href, icon, trailing, disabled, fullWidth, onClick, style, children, ...rest }) {
  const primary = variant === 'primary';
  const s = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: fullWidth ? '100%' : undefined, font: 'inherit', fontWeight: 600, fontSize: size === 'lg' ? 15 : 14, padding: size === 'lg' ? '11px 18px' : '8px 14px', borderRadius: size === 'lg' ? 'var(--radius-btn-lg)' : 'var(--radius-btn)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, background: primary ? 'var(--cta)' : variant.startsWith('ghost') ? 'transparent' : 'var(--surface-card)', color: primary ? 'var(--cta-text)' : 'var(--ink)', border: primary || variant.startsWith('ghost') ? '1px solid transparent' : '1px solid var(--border-mid)', ...style };
  if (href) return <a href={href} style={s} {...rest}>{icon}{children}{trailing}</a>;
  return <button type="button" disabled={disabled} onClick={onClick} style={s} {...rest}>{icon}{children}{trailing}</button>;
}
export function FileRow({ badge, badgeColor, badgeInk, name, meta, onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', cursor: onClick ? 'pointer' : 'default' }}>
      <BadgeTile size={26} color={badgeColor} ink={badgeInk}>{badge}</BadgeTile>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>{name}</span>
      {meta ? <span style={{ ...mono, color: 'var(--text-faint)' }}>{meta}</span> : null}
    </div>
  );
}
export function BadgeTile({ color = 'var(--bg-well)', ink = 'var(--ink)', size = 24, radius, style, children }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: radius ?? Math.round(size / 4), background: color, color: ink, ...mono, fontWeight: 600, ...style }}>{children}</span>;
}
export function StatusDot({ status = 'done', size = 7, pulse, style }) {
  const c = { done: 'var(--green-600)', needsYou: 'var(--blue-500)', running: 'var(--amber-500)', failed: 'var(--red-500)', attention: 'var(--orange-500)' }[status] || status;
  return <span aria-hidden="true" data-status={status} style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: c, flexShrink: 0, ...style }} />;
}
export function StatusChip({ status, pulse, tone = 'light', pill = true, style, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...mono, color: 'var(--ink)', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: pill ? 'var(--radius-pill)' : 'var(--radius-sm)', padding: '5px 12px', whiteSpace: 'nowrap', ...style }}>
      {status ? <StatusDot status={status} pulse={pulse} /> : null}{children}
    </span>
  );
}
export function Eyebrow({ dot, dotColor = 'var(--blue-500)', tone, size = 'md', style, children }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...mono, fontSize: size === 'sm' ? 10 : 11, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--text-tertiary)', ...style }}>{dot ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} /> : null}{children}</span>;
}
export function Menu({ width = 262, style, children }) { return <div role="menu" style={{ width, background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-panel)', padding: 6, ...style }}>{children}</div>; }
export function MenuItem({ icon, label, description, shortcut, trailing, active, onClick }) { return <button type="button" role="menuitem" onClick={onClick} style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', background: active ? 'var(--blue-tint)' : 'none', border: 0, padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>{icon}<span style={{ flex: 1 }}>{label}{description ? <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>{description}</span> : null}</span>{shortcut}{trailing}</button>; }
export function MenuDivider() { return <hr style={{ border: 0, borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />; }
export function Input({ label, labelRight, style, ...rest }) {
  return (
    <label style={{ display: 'block', ...style }}>
      {label ? <span style={{ display: 'flex', justifyContent: 'space-between', ...mono, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--text-tertiary)', marginBottom: 6 }}>{label}{labelRight}</span> : null}
      <input {...rest} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '9px 12px', borderRadius: 'var(--radius-input)', border: '1px solid var(--border-mid)', background: 'var(--surface-card)', color: 'var(--ink)' }} />
    </label>
  );
}
export function Modal({ open, title, onClose, footer, width = 440, inline, children }) {
  if (!open) return null;
  return <div role="dialog" aria-label={typeof title === 'string' ? title : undefined} style={{ position: inline ? 'absolute' : 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(10,18,36,.35)' }}><div style={{ width, background: 'var(--surface-card)', borderRadius: 'var(--radius-card)', padding: 20 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>{title}</div>{children}{footer}<button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 8, right: 8 }}>×</button></div></div>;
}
export function Avatar({ name, src, size = 30, style }) { return src ? <img src={src} alt={name || ''} width={size} height={size} style={{ borderRadius: '50%', ...style }} /> : <BadgeTile size={size} radius={size / 2} style={style}>{(name || '??').slice(0, 2).toUpperCase()}</BadgeTile>; }
export function Header({ left, right, style }) { return <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', ...style }}>{left}{right}</header>; }
export function Logo({ size = 18, title = 'Clane', style }) { return <span role="img" aria-label={title} style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: 'var(--navy-900)', ...style }} />; }

// ---- promoted components (real files, also on the platform after the move) ----
export { Drawer } from './Drawer.jsx';
export { Timeline } from './Timeline.jsx';
export { SortableTable } from './SortableTable.jsx';
export { Chip, FilterBar } from './FilterBar.jsx';
export { DataTable } from './DataTable.jsx';
export { AuditLogRow } from './AuditLogRow.jsx';
export { ProgressBar } from './ProgressBar.jsx';
export { Toast, ToastStack } from './Toast.jsx';
export { Banner } from './Banner.jsx';
export { Breadcrumbs } from './Breadcrumbs.jsx';
export { Pagination } from './Pagination.jsx';
export { BarChart } from './BarChart.jsx';
export { ApprovalCard } from './ApprovalCard.jsx';
export { Spinner, TypingDots, Skeleton } from './Loading.jsx';
export { AppHeader } from './AppHeader.jsx';
