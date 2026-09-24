export interface ApprovalRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Mono value (amounts, ids) */
  mono?: boolean;
}
export interface ApprovalCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Label/value detail rows */
  rows?: ApprovalRow[];
  approveLabel?: string;
  rejectLabel?: string;
  /** Optional tertiary link, e.g. "Edit before approving" */
  editLabel?: string;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  /** Collapses to a one-line receipt */
  resolved?: 'approved' | 'rejected';
  style?: React.CSSProperties;
}
export declare function ApprovalCard(props: ApprovalCardProps): JSX.Element;
