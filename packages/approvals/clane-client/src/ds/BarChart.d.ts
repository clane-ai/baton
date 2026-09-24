export interface BarDatum {
  label: string;
  value: number;
  /** Orange bar + value (attention) */
  highlight?: boolean;
}
export interface BarChartProps {
  data: BarDatum[];
  /** Total px height incl. labels, default 120 */
  height?: number;
  /** Bar color, default --blue-500 */
  color?: string;
  valueColor?: string;
  maxBarWidth?: number;
  formatValue?: (v: number) => string;
}
export declare function BarChart(props: BarChartProps): JSX.Element;
