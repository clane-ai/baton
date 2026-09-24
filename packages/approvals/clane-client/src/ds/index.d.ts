// Type surface of the shared clane-client/src/ds barrel (existing exports) plus the components this
// area promotes (Task 2). In the platform the .jsx files carry no types (allowJs); these declarations
// document the props the area relies on and make the staging type-check meaningful.
import type * as React from "react";

type Style = { style?: React.CSSProperties };
type Kids = { children?: React.ReactNode };

// ---- existing shared exports ----
export function Tabs(p: { tabs: (string | { value: string; label: React.ReactNode; count?: number | string })[]; value: string; onChange?: (v: string) => void } & Style): JSX.Element;
export function StatCard(p: { label: React.ReactNode; value: React.ReactNode; valueColor?: string; delta?: React.ReactNode; deltaColor?: string } & Style & Kids): JSX.Element;
export function Card(p: { app?: boolean; large?: boolean; flush?: boolean; className?: string; onClick?: () => void } & Style & Kids): JSX.Element;
export function EmptyState(p: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode } & Style): JSX.Element;
export function Button(p: { variant?: "primary" | "secondary" | "secondaryDark" | "ghost" | "ghostDark" | "danger"; size?: "sm" | "md" | "lg"; href?: string; icon?: React.ReactNode; trailing?: React.ReactNode; disabled?: boolean; fullWidth?: boolean; onClick?: (e: React.MouseEvent) => void; type?: "button" | "submit"; title?: string; "aria-label"?: string } & Style & Kids): JSX.Element;
export function FileRow(p: { badge?: React.ReactNode; badgeColor?: string; badgeInk?: string; name: React.ReactNode; meta?: React.ReactNode; onClick?: () => void }): JSX.Element;
export function BadgeTile(p: { color?: string; ink?: string; size?: number; radius?: number } & Style & Kids): JSX.Element;
export function StatusChip(p: { status?: string; pulse?: boolean; tone?: "light" | "dark"; pill?: boolean } & Style & Kids): JSX.Element;
export function StatusDot(p: { status?: string; size?: number; pulse?: boolean } & Style): JSX.Element;
export function Eyebrow(p: { dot?: boolean; dotColor?: string; tone?: "light" | "dark"; size?: "md" | "sm" } & Style & Kids): JSX.Element;
export function Menu(p: { width?: number } & Style & Kids): JSX.Element;
export function MenuItem(p: { icon?: React.ReactNode; label: React.ReactNode; description?: React.ReactNode; shortcut?: React.ReactNode; trailing?: React.ReactNode; active?: boolean; onClick?: () => void }): JSX.Element;
export function MenuDivider(): JSX.Element;
export function Input(p: { label?: string; labelRight?: React.ReactNode } & Style & React.InputHTMLAttributes<HTMLInputElement>): JSX.Element;
export function Modal(p: { open: boolean; title: React.ReactNode; onClose?: () => void; footer?: React.ReactNode; width?: number; inline?: boolean } & Kids): JSX.Element | null;
export function Avatar(p: { name?: string; src?: string; size?: number } & Style): JSX.Element;
export function Header(p: { left?: React.ReactNode; right?: React.ReactNode } & Style): JSX.Element;
export function Logo(p: { size?: number; active?: boolean; title?: string } & Style): JSX.Element;

// ---- promoted in Task 2 (from src/hr/ds/components) ----
export function Drawer(p: { open: boolean; title: React.ReactNode; headerExtra?: React.ReactNode; onClose?: () => void; width?: number; inline?: boolean } & Kids): JSX.Element | null;
export type TimelineItem = { status?: string; title: React.ReactNode; meta?: React.ReactNode; body?: React.ReactNode };
export function Timeline(p: { items: TimelineItem[] } & Style): JSX.Element;
export type SortableColumn = { key: string; label: React.ReactNode; align?: "left" | "right" | "center"; mono?: boolean; color?: string; sortable?: boolean; sortValue?: (row: Record<string, unknown>) => number | string };
export type TableFilter = { id: string; label: React.ReactNode; dot?: string; fn: (row: Record<string, unknown>) => boolean };
export function SortableTable(p: { columns: SortableColumn[]; rows: Record<string, unknown>[]; filters?: TableFilter[]; searchKeys?: string[]; footer?: React.ReactNode; pageSize?: number; onRowClick?: (row: Record<string, unknown>) => void } & Style): JSX.Element;
export function Chip(p: { active?: boolean; dot?: string; count?: number | string; onClick?: () => void; onRemove?: () => void } & Style & Kids): JSX.Element;
export type FilterDef = { id: string; label: React.ReactNode; dot?: string; count?: number | string };
export function FilterBar(p: { label?: React.ReactNode; filters: FilterDef[]; active: string[]; onChange?: (active: string[]) => void } & Style): JSX.Element;
export type DataTableColumn = { key: string; label: React.ReactNode; align?: "left" | "right" | "center"; mono?: boolean; color?: string; emphasis?: boolean };
export function DataTable(p: { columns: DataTableColumn[]; rows: Record<string, React.ReactNode>[]; footer?: React.ReactNode; footerAction?: React.ReactNode }): JSX.Element;
export function AuditLogRow(p: { actor: React.ReactNode; agent?: boolean; action: React.ReactNode; target?: React.ReactNode; status?: string; time: React.ReactNode; ip?: React.ReactNode } & Style): JSX.Element;
export function ProgressBar(p: { value?: number; max?: number; label?: React.ReactNode; color?: string; indeterminate?: boolean; formatValue?: (v: number) => string } & Style): JSX.Element;
export type ToastProps = { status?: string; title: React.ReactNode; detail?: React.ReactNode; action?: React.ReactNode; onAction?: () => void; onClose?: () => void } & Style;
export function Toast(p: ToastProps): JSX.Element;
export function ToastStack(p: { toasts: (ToastProps & { id: string | number })[]; onClose?: (id: string | number) => void; inline?: boolean }): JSX.Element;
export function Banner(p: { tone?: "info" | "success" | "attention" | "danger"; title?: React.ReactNode; action?: React.ReactNode; onAction?: () => void; onClose?: () => void } & Style & Kids): JSX.Element;
export function Breadcrumbs(p: { items: { label: React.ReactNode; href?: string; onClick?: (e: React.MouseEvent) => void }[] } & Style): JSX.Element;
export function Pagination(p: { page: number; pageCount: number; onChange: (page: number) => void; caption?: React.ReactNode } & Style): JSX.Element;
export function BarChart(p: { data: { label: React.ReactNode; value: number; color?: string }[]; height?: number; formatValue?: (v: number) => string } & Style): JSX.Element;
export function ApprovalCard(p: { title: React.ReactNode; description?: React.ReactNode; rows?: { label: React.ReactNode; value: React.ReactNode; mono?: boolean }[]; approveLabel?: string; rejectLabel?: string; editLabel?: string; onApprove?: () => void; onReject?: () => void; onEdit?: () => void; resolved?: "approved" | "rejected" } & Style): JSX.Element;
export function Spinner(p: { size?: number; color?: string } & Style): JSX.Element;
export function TypingDots(p: { color?: string } & Style): JSX.Element;
export function Skeleton(p: { width?: number | string; height?: number | string; radius?: number } & Style): JSX.Element;
export function AppHeader(p: { breadcrumb?: React.ReactNode; title: React.ReactNode; right?: React.ReactNode } & Style): JSX.Element;
