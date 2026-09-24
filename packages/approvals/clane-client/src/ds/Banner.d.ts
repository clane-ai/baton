export interface BannerProps {
  tone?: 'info' | 'success' | 'attention' | 'danger';
  title?: React.ReactNode;
  /** Action link text (colored per tone) */
  action?: React.ReactNode;
  onAction?: () => void;
  /** Shows ✕ when provided */
  onClose?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Banner(props: BannerProps): JSX.Element;
