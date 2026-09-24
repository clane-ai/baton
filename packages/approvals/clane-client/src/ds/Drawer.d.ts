export interface DrawerProps {
  open: boolean;
  title: React.ReactNode;
  /** Element next to the title (e.g. a Segmented control) */
  headerExtra?: React.ReactNode;
  onClose?: () => void;
  /** Panel width, default 560 */
  width?: number;
  /** Absolute positioning instead of fixed (for embedding in demos) */
  inline?: boolean;
  children: React.ReactNode;
}
export declare function Drawer(props: DrawerProps): JSX.Element | null;
