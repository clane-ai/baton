export interface ToastProps {
  /** done | needsYou | running | failed | attention */
  status?: string;
  title: React.ReactNode;
  /** Mono metadata line, e.g. "run #5126 · 51.3s · $0.10" */
  detail?: React.ReactNode;
  /** Blue action link text */
  action?: React.ReactNode;
  onAction?: () => void;
  /** Shows the ✕ when provided */
  onClose?: () => void;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;

export interface ToastStackProps {
  toasts: (ToastProps & { id: string | number })[];
  onClose?: (id: string | number) => void;
  /** Absolute instead of fixed (for embedding in demos) */
  inline?: boolean;
}
export declare function ToastStack(props: ToastStackProps): JSX.Element;
