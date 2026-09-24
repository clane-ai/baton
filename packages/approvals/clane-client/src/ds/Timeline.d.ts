export interface TimelineItem {
  /** Node dot state: done | needsYou | running | failed | attention */
  status?: string;
  title: React.ReactNode;
  /** Mono meta, e.g. "07:01:26 · 2.4s" */
  meta?: React.ReactNode;
  /** Optional tinted body card */
  body?: React.ReactNode;
}
export interface TimelineProps {
  items: TimelineItem[];
  style?: React.CSSProperties;
}
export declare function Timeline(props: TimelineProps): JSX.Element;
