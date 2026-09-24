export interface PaginationProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** Mono range caption, e.g. "41–60 of 214 runs" */
  caption?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Pagination(props: PaginationProps): JSX.Element;
