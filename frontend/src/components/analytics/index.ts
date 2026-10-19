/**
 * Canvas 2D chart renderers for the analytics dashboard.
 *
 * Start with `interpolate.ts` for why these tween instead of redrawing, and
 * `CanvasChart.tsx` for the fallback chain, the frame loop and the DPR handling.
 */

export { CanvasChart } from './CanvasChart';
export type { CanvasChartProps, ChartTable, DrawFrame, Readout, ReadoutRow } from './CanvasChart';

export { TrendChart } from './TrendChart';
export type { TrendChartProps } from './TrendChart';

export { BarSeriesChart } from './BarSeriesChart';
export type { BarSeriesChartProps } from './BarSeriesChart';

export { ShareChart } from './ShareChart';
export type { ShareChartProps } from './ShareChart';

export { SeriesTween, easeOutExpo, niceScale, peakOf } from './interpolate';
export type { Datum, Frame, LiveDatum, SeriesSpec } from './interpolate';

export { makeNumberFormats } from './plot';
export type { NumberFormats } from './plot';

export { CATEGORICAL, CHART_COLORS, TWEEN_MS } from './theme';
