export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  onClick?: (e: any) => void;
}
export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  style?: React.CSSProperties;
}
export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
