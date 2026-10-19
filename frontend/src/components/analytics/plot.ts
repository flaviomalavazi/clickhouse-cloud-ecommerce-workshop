/**
 * Plot furniture shared by the canvas charts: axes, gridlines, label thinning,
 * rounded bars and the monotone curve.
 *
 * All coordinates are CSS pixels — `CanvasChart` pre-scales the context by the
 * device pixel ratio, so nothing here has to know the ratio exists.
 */

import { CHART_COLORS, GRID_DASH } from './theme';

export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function plotBox(width: number, height: number, insets: Insets): Box {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(1, width - insets.left - insets.right),
    height: Math.max(1, height - insets.top - insets.bottom),
  };
}

export function font(px: number, family: string, weight = 400): string {
  return `${weight} ${px}px ${family}`;
}

/**
 * Locale-aware number formatting for the axes and the readout.
 *
 * Axis ticks switch to compact notation past four digits: the alternative is a
 * gutter wide enough for "1,248,300", which on a 220px tile eats the plot. The
 * readout and the sr-only table always print the full grouped number, so the
 * exact figure is never only available as "1.2M".
 */
export function makeNumberFormats(locale: string) {
  const full = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  return {
    full: (value: number) => full.format(value),
    axis: (value: number) => (Math.abs(value) >= 10_000 ? compact.format(value) : full.format(value)),
    percent: (fraction: number) =>
      new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(fraction),
  };
}

export type NumberFormats = ReturnType<typeof makeNumberFormats>;

/**
 * How wide the value gutter has to be for the widest tick this scale will
 * print. Measured rather than fixed, so a locale with a longer compact suffix
 * (or a tile that suddenly has six-figure counts) widens the gutter instead of
 * clipping the label — which is what a hardcoded width does.
 */
export function gutterFor(
  ctx: CanvasRenderingContext2D,
  ticks: readonly number[],
  format: (value: number) => string,
  numericFont: string,
): number {
  ctx.font = numericFont;
  let widest = 0;
  for (const tick of ticks) {
    const width = ctx.measureText(format(tick)).width;
    if (width > widest) widest = width;
  }
  return Math.ceil(widest) + 8;
}

/** Dashed gridlines, matching the old `<CartesianGrid strokeDasharray="3 3">`. */
export function drawGridlines(
  ctx: CanvasRenderingContext2D,
  box: Box,
  positions: readonly number[],
  axis: 'horizontal' | 'vertical',
): void {
  ctx.save();
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([...GRID_DASH]);
  ctx.beginPath();
  for (const position of positions) {
    // Half-pixel offset: a 1px line on an integer coordinate straddles two
    // device rows and renders as two grey ones.
    const snapped = Math.round(position) + 0.5;
    if (axis === 'horizontal') {
      ctx.moveTo(box.x, snapped);
      ctx.lineTo(box.x + box.width, snapped);
    } else {
      ctx.moveTo(snapped, box.y);
      ctx.lineTo(snapped, box.y + box.height);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Tick labels for the value axis. */
export function drawValueTicks(
  ctx: CanvasRenderingContext2D,
  box: Box,
  ticks: readonly number[],
  positionOf: (value: number) => number,
  axis: 'left' | 'bottom',
  format: (value: number) => string,
  numericFont: string,
): void {
  ctx.save();
  ctx.font = numericFont;
  ctx.fillStyle = CHART_COLORS.axis;
  for (const tick of ticks) {
    const position = positionOf(tick);
    if (axis === 'left') {
      // Ticks are positioned through the *live* (tweening) scale while their
      // text comes from the settled one, so the labels glide to their new spot
      // instead of counting through intermediate values. One that has been
      // pushed off the top by a rising ceiling is simply not drawn.
      if (position < box.y - 1 || position > box.y + box.height + 1) continue;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(format(tick), box.x - 8, position);
    } else {
      if (position < box.x - 1 || position > box.x + box.width + 1) continue;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(format(tick), position, box.y + box.height + 6);
    }
  }
  ctx.restore();
}

/**
 * Which category labels to print.
 *
 * A 24-bucket trend on a 300px tile has ~12px per label, so most of them have
 * to go. This is the old `interval="preserveStartEnd"`: a stride wide enough
 * that the widest label clears its neighbour, with the first and last slots
 * always kept so the reader can see what window they are looking at.
 */
export function thinLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly string[],
  labelFont: string,
  slotWidth: number,
): number[] {
  const n = labels.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  ctx.font = labelFont;
  let widest = 0;
  for (const label of labels) {
    const width = ctx.measureText(label).width;
    if (width > widest) widest = width;
  }

  const stride = Math.max(1, Math.ceil((widest + 12) / Math.max(1, slotWidth)));
  const kept: number[] = [];
  for (let i = 0; i < n; i += stride) kept.push(i);

  const last = n - 1;
  if (kept[kept.length - 1] !== last) {
    // Drop the penultimate label rather than let it collide with the last one,
    // which is the label that says where the window ends.
    if (last - kept[kept.length - 1] < stride / 2) kept.pop();
    kept.push(last);
  }
  return kept;
}

/**
 * `text`, trimmed with an ellipsis to fit `maxWidth`.
 *
 * Binary search rather than a character-by-character walk: category names on
 * the horizontal tile are re-measured every frame while the bars tween, and
 * `measureText` is the expensive call in this file.
 */
export function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low)}…` : '…';
}

/** Rounded-corner bar path. `radii` is clockwise from the top-left. */
export function barPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radii: readonly [number, number, number, number],
): void {
  const cap = Math.min(Math.abs(width), Math.abs(height)) / 2;
  const [tl, tr, br, bl] = radii.map(r => Math.max(0, Math.min(r, cap))) as [number, number, number, number];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + width - tr, y);
  if (tr) ctx.arcTo(x + width, y, x + width, y + tr, tr);
  ctx.lineTo(x + width, y + height - br);
  if (br) ctx.arcTo(x + width, y + height, x + width - br, y + height, br);
  ctx.lineTo(x + bl, y + height);
  if (bl) ctx.arcTo(x, y + height, x, y + height - bl, bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/**
 * Monotone cubic path through the points — the old `<Line type="monotone">`.
 *
 * Fritsch–Carlson tangents rather than a plain Catmull-Rom, because a smooth
 * spline through count data overshoots: a spike back to zero would dip the
 * curve *below* the axis and draw negative page views. Monotone tangents are
 * flattened at every local extremum, which makes that impossible.
 */
export function monotonePath(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
): void {
  const n = xs.length;
  if (n === 0) return;
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  if (n === 1) return;
  if (n === 2) {
    ctx.lineTo(xs[1], ys[1]);
    return;
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i];
  }

  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0; // local extremum: flat, so the curve cannot overshoot it
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    ctx.bezierCurveTo(
      xs[i] + third, ys[i] + tangent[i] * third,
      xs[i + 1] - third, ys[i + 1] - tangent[i + 1] * third,
      xs[i + 1], ys[i + 1],
    );
  }
}

/** The vertical hover rule, drawn under the series. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, box: Box, x: number): void {
  ctx.save();
  ctx.strokeStyle = CHART_COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, box.y);
  ctx.lineTo(Math.round(x) + 0.5, box.y + box.height);
  ctx.stroke();
  ctx.restore();
}

/** A palette hex at partial opacity, for gradient stops. */
export function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.split('').map(c => c + c).join('') : body;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
