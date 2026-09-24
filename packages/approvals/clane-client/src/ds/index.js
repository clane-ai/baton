// STAGING STUB — not copied to the platform: clane-client/src/ds/index.js verbatim, plus the
// promoted exports that PATCHES.md appends there.
// Scoped Clane design system for the main /app SPA. Import tokens.css once at a
// mount point, wrap the subtree in <div className="cl-ds">, and compose from these.
// Tokens are scoped under .cl-ds (see tokens.css) so they never touch the rest of
// the app's --ink/--accent token set.
export { Tabs } from './Tabs.jsx';
export { StatCard } from './StatCard.jsx';
export { Card } from './Card.jsx';
export { EmptyState } from './EmptyState.jsx';
export { Button } from './Button.jsx';
export { FileRow } from './FileRow.jsx';
export { BadgeTile } from './BadgeTile.jsx';
export { StatusChip } from './StatusChip.jsx';
export { StatusDot } from './StatusDot.jsx';
export { Eyebrow } from './Eyebrow.jsx';
export { Menu, MenuItem, MenuDivider } from './Menu.jsx';
// 2026-08-05 — vendored for the Skill Studio: the three steps, the
// folders/files pane, and the delete confirmation. Same rule as the rest
// of this folder: plain React, tokens only.
//
// TreeView is the one copy that diverges from src/projects/ds — it gained
// an optional `node.trailing` slot (mirroring the existing `meta` slot)
// so a row can carry an action. Additive, so nodes written for the
// original still render identically.
export { TreeView } from './TreeView.jsx';
export { Stepper } from './Stepper.jsx';
export { Input } from './Input.jsx';
export { Modal } from './Modal.jsx';
export { Avatar } from './Avatar.jsx';
export { Logo } from './Logo.jsx';
export { Header } from './Header.jsx';
export { Footer } from './Footer.jsx';

// Promoted from src/hr/ds/components for the Workflow screens (2026-09).
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
