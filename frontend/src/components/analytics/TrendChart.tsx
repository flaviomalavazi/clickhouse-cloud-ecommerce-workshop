'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { CanvasChart, type DrawFrame, type Readout } from './CanvasChart';
import { SeriesTween, type Datum, type SeriesSpec } from './interpolate';
import {
  drawCrosshair, drawGridlines, drawValueTicks, font, gutterFor, monotonePath, plotBox,
  thinLabels, withAlpha, type Box, type NumberFormats,
} from './plot';
import { AXIS_FONT_PX, CHART_COLORS, SERIES_DASH } from './theme';

/**
 * A multi-series trend line, interpolated between refreshes.
 *
 * Replaces the `<LineChart>` on the analytics dashboard: same monotone curve,
 * same dashed secondary series, same dashed gridlines and 10px tick labels. The
 * difference is that a refresh moves the curve instead of replacing it — see
 * `interpolate.ts` for why that matters on a polling dashboard.
 */

export interface TrendChartProps {
  /** Ordered oldest-first. `key` must be the bucket, not the array index. */
  data: Datum[];
  series: SeriesSpec[];
  height?: number;
  /** Header for the label column of the text alternative. */
  labelHeader: string;
  summary: string;
  tableCaption: string;
  formats: NumberFormats;
  /** recharts equivalent, for browsers with no Canvas 2D. */
  fallback: ReactNode;
}

interface Geometry {
  box: Box;
  xOf: (slot: number) => number;
  yOf: (value: number) => number;
}

export function TrendChart({
  data, series, height = 220, labelHeader, summary, tableCaption, formats, fallback,
}: TrendChartProps) {
  const tweenRef = useRef<SeriesTween | null>(null);
  if (!tweenRef.current) tweenRef.current = new SeriesTween({ tickCount: 4 });

  // The data reference the tween is currently aimed at. Compared by identity:
  // the page replaces the array wholesale on every poll, so a new reference is
  // exactly "there is new data".
  const aimedAt = useRef<Datum[] | null>(null);

  // Written by `draw`, read by the hit-test. The pointer arrives between
  // frames, and re-deriving the layout in the event handler would need a
  // context for `measureText` and would drift from what is on screen.
  const geometry = useRef<Geometry | null>(null);

  const draw = useCallback(
    (frame: DrawFrame): boolean => {
      const tween = tweenRef.current!;
      if (aimedAt.current !== data) {
        tween.retarget(data, frame.now, frame.animated);
        aimedAt.current = data;
      }
      const state = tween.sample(frame.now);
      const { ctx } = frame;

      const numericFont = font(AXIS_FONT_PX, frame.mono);
      const labelFont = font(AXIS_FONT_PX, frame.sans);
      const box = plotBox(frame.width, frame.height, {
        left: gutterFor(ctx, state.ticks, formats.axis, numericFont),
        top: 10,
        right: 8,
        bottom: 22,
      });

      // Slots are mapped through the *target* count, so a bucket that shifted
      // left by one slides there over the tween. A single point centres rather
      // than pinning itself to the left edge.
      const span = data.length - 1;
      const xOf = (slot: number) =>
        span <= 0 ? box.x + box.width / 2 : box.x + (slot / span) * box.width;
      const yOf = (value: number) =>
        box.y + box.height - Math.min(1, Math.max(0, value / state.ceiling)) * box.height;
      geometry.current = { box, xOf, yOf };

      drawGridlines(ctx, box, state.ticks.map(yOf), 'horizontal');

      const hovered = frame.hover >= 0 && frame.hover < data.length ? frame.hover : -1;
      if (hovered >= 0) drawCrosshair(ctx, box, xOf(hovered));

      // Clipped so a point still sinking toward the baseline, or one pushed
      // above a ceiling that has not finished rising, cannot paint over the
      // axis labels.
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x - 1, box.y - 6, box.width + 2, box.height + 8);
      ctx.clip();

      series.forEach((spec, seriesIndex) => {
        const xs = state.data.map(d => xOf(d.slot));
        const ys = state.data.map(d => yOf(d.values[seriesIndex] ?? 0));
        if (!xs.length) return;

        // Per-point alpha along one continuous stroke, as a gradient keyed to
        // each point's own x. A single `globalAlpha` would be the obvious move
        // and is wrong: one arriving bucket would fade the entire 24-hour line
        // in and out on every rollover. The gradient localises it, so only the
        // few pixels around a bucket that is entering or leaving are
        // translucent and the rest of the trend holds steady.
        const faintest = state.data.reduce((lowest, d) => Math.min(lowest, d.alpha), 1);
        let stroke: string | CanvasGradient = spec.color;
        if (faintest < 0.999 && xs.length > 1) {
          // Stops must ascend, which they do: `state.data` is sorted by slot.
          const gradient = ctx.createLinearGradient(box.x, 0, box.x + box.width, 0);
          state.data.forEach((datum, i) => {
            const offset = Math.max(0, Math.min(1, (xs[i] - box.x) / box.width));
            gradient.addColorStop(offset, withAlpha(spec.color, datum.alpha));
          });
          stroke = gradient;
        }

        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = seriesIndex === 0 ? 2 : 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (seriesIndex > 0) ctx.setLineDash([...SERIES_DASH]);
        monotonePath(ctx, xs, ys);
        ctx.stroke();
        ctx.restore();

        if (hovered >= 0) {
          // The dot sits on the *target* slot, not the tweening one: a readout
          // that slid away from the pointer it belongs to would be unreadable.
          const value = data[hovered]?.values[seriesIndex] ?? 0;
          const x = xOf(hovered);
          const y = yOf(value);
          ctx.fillStyle = spec.color;
          ctx.strokeStyle = CHART_COLORS.surface;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
      ctx.restore();

      drawValueTicks(ctx, box, state.ticks, yOf, 'left', formats.axis, numericFont);

      // Category labels come from the target data — the labels are the axis,
      // and an axis that animates its own text is unreadable.
      const labels = data.map(d => d.label);
      const slotWidth = span <= 0 ? box.width : box.width / span;
      ctx.save();
      ctx.font = labelFont;
      ctx.fillStyle = CHART_COLORS.axis;
      ctx.textBaseline = 'top';
      for (const index of thinLabels(ctx, labels, labelFont, slotWidth)) {
        const x = xOf(index);
        // The first and last labels are pinned inside the plot instead of
        // centred, so neither hangs off the tile.
        ctx.textAlign = index === 0 ? 'left' : index === labels.length - 1 ? 'right' : 'center';
        ctx.fillText(labels[index], x, box.y + box.height + 6);
      }
      ctx.restore();

      return state.moving;
    },
    [data, series, formats],
  );

  const indexAt = useCallback(
    (x: number): number => {
      const geo = geometry.current;
      if (!geo || data.length === 0) return -1;
      const { box } = geo;
      // A 14px grace band past each end: the leftmost and rightmost points sit
      // exactly on the plot edge, and requiring the pointer to be inside makes
      // them effectively unhoverable.
      if (x < box.x - 14 || x > box.x + box.width + 14) return -1;
      if (data.length === 1) return 0;
      const fraction = (x - box.x) / box.width;
      return Math.max(0, Math.min(data.length - 1, Math.round(fraction * (data.length - 1))));
    },
    [data],
  );

  const readout = useCallback(
    (index: number): Readout | null => {
      const geo = geometry.current;
      const datum = data[index];
      if (!geo || !datum) return null;
      // Anchored to the topmost series value at this slot, so the box never
      // covers the readings it is describing.
      const highest = Math.max(...datum.values, 0);
      return {
        index,
        x: geo.xOf(index),
        y: geo.yOf(highest),
        label: datum.label,
        rows: series.map((spec, i) => ({
          name: spec.name,
          value: formats.full(datum.values[i] ?? 0),
          color: spec.color,
        })),
      };
    },
    [data, series, formats],
  );

  const table = useMemo(
    () => ({
      caption: tableCaption,
      columns: [labelHeader, ...series.map(s => s.name)],
      rows: data.map(d => [d.label, ...series.map((_, i) => formats.full(d.values[i] ?? 0))]),
    }),
    [data, series, formats, labelHeader, tableCaption],
  );

  return (
    <CanvasChart
      height={height}
      draw={draw}
      indexAt={indexAt}
      readout={readout}
      count={data.length}
      summary={summary}
      table={table}
      fallback={fallback}
    />
  );
}
