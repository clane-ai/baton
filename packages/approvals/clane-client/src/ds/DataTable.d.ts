export interface DataTableColumn {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Mono 12.5px cells (numbers, currency) */
  mono?: boolean;
  /** Force cell color, e.g. var(--orange-500) for deltas */
  color?: string;
  emphasis?: boolean;
}
export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, React.ReactNode>[];
  /** Left mono caption in the footer bar */
  footer?: React.ReactNode;
  /** Right element in the footer bar (e.g. Excel link) */
  footerAction?: React.ReactNode;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
