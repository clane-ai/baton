export interface AppHeaderProps {
  /** Mono uppercase run line, e.g. "Run #5126 · personal-assistant" */
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  /** Right cluster — StatusChip pills */
  right?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function AppHeader(props: AppHeaderProps): JSX.Element;
