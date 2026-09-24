export interface SpinnerProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}
export declare function Spinner(props: SpinnerProps): JSX.Element;

export interface TypingDotsProps {
  color?: string;
  style?: React.CSSProperties;
}
export declare function TypingDots(props: TypingDotsProps): JSX.Element;

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}
export declare function Skeleton(props: SkeletonProps): JSX.Element;
