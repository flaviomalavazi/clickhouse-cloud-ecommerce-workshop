/**
 * Drawing constants for the canvas charts.
 *
 * Every hex here is copied verbatim from what the recharts version of the
 * analytics dashboard passed inline, so swapping the renderer changes no colour
 * on screen. They are all Tailwind tokens from `tailwind.config.ts` — the names
 * in the comments say which — with one deliberate exception noted on
 * `CATEGORICAL`.
 *
 * Canvas cannot read a CSS custom property or a Tailwind class, so the values
 * have to be literals in JS. That is the one place in the codebase where a hex
 * is allowed to be typed twice, and the reason it is safe is that the config
 * itself documents these particular values as load-bearing.
 */

export const CHART_COLORS = {
  /** ch-700. The recharts `<CartesianGrid stroke>`. */
  grid: '#2C2C2C',
  /** ch-300. The recharts axis `tick.fill`. */
  axis: '#9E9E9E',
  /** brand-400. The primary series in every tile. */
  primary: '#FAFF69',
  /** ch-300. The secondary *line* (dashed), matching the old `<Line stroke>`. */
  secondaryLine: '#9E9E9E',
  /** ch-500. The secondary *bar*, matching the old `<Bar fill>`. */
  secondaryBar: '#616161',
  /** ch-600. The hover crosshair and the tooltip border. */
  rule: '#424242',
  /** ch-800. Tooltip ground. */
  surface: '#1A1A1A',
  /** ch-100. Tooltip heading. */
  label: '#E0E0E0',
} as const;

/**
 * The categorical ramp for the event-breakdown pie, in the order the old
 * `CH_COLORS` array had it.
 *
 * `#F0D800` is not a Tailwind token — it sits between brand-500 (#EEED00) and
 * brand-600 (#D4D400). It is kept byte-identical anyway because the HTML legend
 * next to the pie is still driven by the same array, and a pie slice that did
 * not match its own swatch would be a worse bug than an off-palette yellow.
 */
export const CATEGORICAL = [
  '#FAFF69', '#F0D800', '#BDBDBD', '#757575', '#424242', '#9E9E9E', '#E0E0E0',
] as const;

/** Line dash for gridlines — the old `strokeDasharray="3 3"`. */
export const GRID_DASH: readonly [number, number] = [3, 3];
/** Line dash for the secondary trend line — the old `strokeDasharray="4 2"`. */
export const SERIES_DASH: readonly [number, number] = [4, 2];

export const AXIS_FONT_PX = 10;
export const CATEGORY_FONT_PX = 11;

/**
 * Tween length, ms.
 *
 * Long enough that the eye tracks a point from its old height to its new one,
 * short enough to finish well inside the 20s slowest poll so a tile is never
 * still moving when its next payload lands. Roughly the duration of the
 * `.tally` transition in globals.css, which is the same idea applied to digits.
 */
export const TWEEN_MS = 620;
