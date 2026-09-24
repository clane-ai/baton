export interface SortableColumn {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  color?: string;
  /** Disable sorting on this column */
  sortable?: boolean;
  /** Numeric/comparable value for sorting when the cell holds JSX or formatted strings */
  sortValue?: (row: any) => number | string;
}
export interface TableFilter {
  id: string;
  /** Chip label */
  label: React.ReactNode;
  /** Status dot color on the chip */
  dot?: string;
  /** Row predicate applied when active */
  fn: (row: any) => boolean;
}
export interface SortableTableProps {
  columns: SortableColumn[];
  rows: Record<string, any>[];
  /** Toggleable filter chips above the table */
  filters?: TableFilter[];
  /** Row keys to text-search; omits the search box when absent */
  searchKeys?: string[];
  footer?: React.ReactNode;
  pageSize?: number;
  style?: React.CSSProperties;
}
export declare function SortableTable(props: SortableTableProps): JSX.Element;
