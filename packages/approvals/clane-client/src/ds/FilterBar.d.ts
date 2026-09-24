export interface ChipProps {
  active?: boolean;
  /** Leading 6px status dot color */
  dot?: string;
  /** Trailing count */
  count?: number | string;
  onClick?: () => void;
  /** Shows trailing ✕ (applied-filter style) */
  onRemove?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Chip(props: ChipProps): JSX.Element;

export interface FilterDef {
  id: string;
  label: React.ReactNode;
  dot?: string;
  count?: number | string;
}
export interface FilterBarProps {
  /** Mono microlabel prefix, e.g. "Filter" */
  label?: React.ReactNode;
  filters: FilterDef[];
  /** Active filter ids */
  active: string[];
  onChange?: (active: string[]) => void;
  style?: React.CSSProperties;
}
export declare function FilterBar(props: FilterBarProps): JSX.Element;
