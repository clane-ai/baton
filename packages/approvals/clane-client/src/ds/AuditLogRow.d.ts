export interface AuditLogRowProps {
  /** Person name, or agent name with agent flag */
  actor: React.ReactNode;
  /** Blue \u25CF avatar for agent/system actors */
  agent?: boolean;
  /** Verb phrase, e.g. "approved run" */
  action: React.ReactNode;
  /** Mono chip object, e.g. "reconcile-invoices \u00B7 v0.1.1" */
  target?: React.ReactNode;
  /** Optional StatusDot state: done | needsYou | running | failed | attention */
  status?: string;
  /** Mono timestamp, right-aligned */
  time: React.ReactNode;
  /** Mono second line, e.g. "83.71.104.2 \u00B7 Dublin" */
  ip?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function AuditLogRow(props: AuditLogRowProps): JSX.Element;
