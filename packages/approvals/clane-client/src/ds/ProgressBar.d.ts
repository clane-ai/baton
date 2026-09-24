export interface ProgressBarProps {
  value?: number;
  max?: number;
  /** Mono uppercase microlabel; % (or formatValue) shows right */
  label?: React.ReactNode;
  /** Fill color — use state colors: green done, amber running, red failed */
  color?: string;
  /** Sweeping bar when total is unknown */
  indeterminate?: boolean;
  formatValue?: (v: number) => string;
  style?: React.CSSProperties;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
