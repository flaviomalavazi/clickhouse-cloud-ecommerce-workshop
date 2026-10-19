'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { CanvasChart, type DrawFrame, type Readout } from './CanvasChart';
import { SeriesTween, type Datum, type SeriesSpec } from './interpolate';
import {
  barPath, drawGridlines, drawValueTicks, ellipsize, font, gutterFor, plotBox, thinLabels,
  type Box, type NumberFormats,
} from './plot';
import { AXIS_FONT_PX, CATEGORY_FONT_PX, CHART_COLORS } from './theme';

/**
 * Grouped bars, interpolated between refreshes. Both orientations the dashboard
 * used to get from recharts:
 *
 *   · `vertical`   — categories along the bottom, bars growing up. The sessions
 *                    tile: two series, rounded top corners.
 *   · `horizontal` — categories down the left, bars growing right. The category
 *                    interest tile: one series, rounded right corners, vertical
 *                    gridlines only.
 *
 * Bars are the case where interpolation pays best. A bar chart that swaps its
 * array re-plants every rectangle at a new height in one frame, which reads as
 * the whole tile blinking; tweened, a bar that gained sessions visibly grows,
 * and a day that just rolled into the window rises out of the axis.
 */

const CATEGORY_GAP = 0.2;  // fraction of the band left empty, split either side
const SERIES_GAP = 4;      // px between the bars of one group
const CORNER = 4;          // the old recharts `radius`
const MAX_CATEGORY_GUTTER = 110; // the old `<YAxis width={110}>`

export interface BarSeriesChartProps {
  data: Datum[];
  series: SeriesSpec[];
  orientation?: 'vertical' | 'horizontal';
  height?: number;
  labelHeader: string;
  summary: string;
  tableCaption: string;
  formats: NumberFormats;
  fallback: ReactNode;
}

interface Geometry {
  box: Box;
  /** Centre of a category band, along the category axis. */
  bandCentre: (slot: number) => number;
  band: number;
  /** Position along the value axis. */
  valueAt: (value: number) => number;
}

export function BarSeriesChart({
  data, series, orientation = 'vertical', height = 220,
  labelHeader, summary, tableCaption, formats, fallback,
}: BarSeriesChartProps) {
  const tweenRef = useRef<SeriesTween | null>(null);
  if (!tweenRef.current) tweenRef.current = new SeriesTween({ tickCount: 4 });

  const aimedAt = useRef<Datum[] | null>(null);
  const geometry = useRef<Geometry | null>(null);
  const vertical = orientation === 'vertical';

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
      const labelFont = font(vertical ? AXIS_FONT_PX : CATEGORY_FONT_PX, frame.sans);
      const valueGutter = gutterFor(ctx, state.ticks, formats.axis, numericFont);

      // The horizontal variant spends its left gutter on category names, so it
      // is measured against the names and capped where recharts had it fixed.
      let categoryGutter = 0;
      if (!vertical) {
        ctx.font = labelFont;
        let widest = 0;
        for (const datum of data) {
          const width = ctx.measureText(datum.label).width;
          if (width > widest) widest = width;
        }
        categoryGutter = Math.min(MAX_CATEGORY_GUTTER, Math.ceil(widest) + 10);
      }

      const box = plotBox(
        frame.width,
        frame.height,
        vertical
          ? { left: valueGutter, top: 10, right: 8, bottom: 22 }
          : { left: categoryGutter, top: 6, right: 12, bottom: 20 },
      );

      // Bands are laid out against the target count, so a category list that
      // grew from four rows to five re-spaces smoothly while every bar slides
      // to its new band.
      const count = Math.max(1, data.length);
      const bandExtent = (vertical ? box.width : box.height) / count;
      const bandOrigin = vertical ? box.x : box.y;
      const bandCentre = (slot: number) => bandOrigin + (slot + 0.5) * bandExtent;

      const valueAt = (value: number) => {
        const fraction = Math.min(1, Math.max(0, value / state.ceiling));
        return vertical
          ? box.y + box.height - fraction * box.height
          : box.x + fraction * box.width;
      };
      geometry.current = { box, bandCentre, band: bandExtent, valueAt };

      drawGridlines(
        ctx,
        box,
        state.ticks.map(valueAt),
        vertical ? 'horizontal' : 'vertical',
      );

      const inner = bandExtent * (1 - CATEGORY_GAP);
      const thickness = Math.max(1, (inner - SERIES_GAP * (series.length - 1)) / series.length);

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x - 1, box.y - 6, box.width + 2, box.height + 8);
      ctx.clip();

      const hovered = frame.hover >= 0 && frame.hover < data.length ? frame.hover : -1;

      for (const datum of state.data) {
        const centre = bandCentre(datum.slot);
        const groupStart = centre - inner / 2;
        // A bar that is entering or leaving is drawn translucent as well as
        // short, so the two motions read as one arrival rather than as a bar
        // that mysteriously has the wrong value for half a second.
        ctx.globalAlpha = Math.max(0, Math.min(1, datum.alpha));

        series.forEach((spec, seriesIndex) => {
          const value = datum.values[seriesIndex] ?? 0;
          const offset = groupStart + seriesIndex * (thickness + SERIES_GAP);
          const end = valueAt(value);
          const highlight = hovered >= 0 && data[hovered]?.key === datum.key;

          ctx.fillStyle = spec.color;
          // A hovered group brightens rather than moving: bars are read by
          // length, and nudging one would misreport its value.
          ctx.globalAlpha *= highlight ? 1 : hovered >= 0 ? 0.62 : 1;

          if (vertical) {
            const barHeight = box.y + box.height - end;
            if (barHeight >= 0.5) {
              barPath(ctx, offset, end, thickness, barHeight, [CORNER, CORNER, 0, 0]);
              ctx.fill();
            }
          } else {
            const barWidth = end - box.x;
            if (barWidth >= 0.5) {
              barPath(ctx, box.x, offset, barWidth, thickness, [0, CORNER, CORNER, 0]);
              ctx.fill();
            }
          }
          ctx.globalAlpha = Math.max(0, Math.min(1, datum.alpha));
        });
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      drawValueTicks(
        ctx,
        box,
        state.ticks,
        valueAt,
        vertical ? 'left' : 'bottom',
        formats.axis,
        numericFont,
      );

      // ── Category axis ───────────────────────────────────────────────────────
      ctx.save();
      ctx.font = labelFont;
      ctx.fillStyle = CHART_COLORS.axis;
      if (vertical) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labels = data.map(d => d.label);
        for (const index of thinLabels(ctx, labels, labelFont, bandExtent)) {
          ctx.fillText(labels[index], bandCentre(index), box.y + box.height + 6);
        }
      } else {
        // Every row is labelled — a bar chart whose rows are anonymous is a
        // decoration. Long names are trimmed to the gutter instead.
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        data.forEach((datum, index) => {
          ctx.fillText(
            ellipsize(ctx, datum.label, categoryGutter - 10),
            box.x - 8,
            bandCentre(index),
          );
        });
      }
      ctx.restore();

      return state.moving;
    },
    [data, series, formats, vertical],
  );

  const indexAt = useCallback(
    (x: number, y: number): number => {
      const geo = geometry.current;
      if (!geo || !data.length) return -1;
      const { box } = geo;
      if (x < box.x - 8 || x > box.x + box.width + 8) return -1;
      if (y < box.y - 4 || y > box.y + box.height + 4) return -1;
      // Bands, not nearest point: a bar owns its whole slice of the axis, so
      // anywhere over the band — above the bar included — hits it.
      const along = vertical ? x - box.x : y - box.y;
      return Math.max(0, Math.min(data.length - 1, Math.floor(along / geo.band)));
    },
    [data, vertical],
  );

  const readout = useCallback(
    (index: number): Readout | null => {
      const geo = geometry.current;
      const datum = data[index];
      if (!geo || !datum) return null;
      const highest = Math.max(...datum.values, 0);
      return {
        index,
        x: vertical ? geo.bandCentre(index) : geo.valueAt(highest),
        y: vertical ? geo.valueAt(highest) : geo.bandCentre(index),
        label: datum.label,
        rows: series.map((spec, i) => ({
          name: spec.name,
          value: formats.full(datum.values[i] ?? 0),
          color: spec.color,
        })),
      };
    },
    [data, series, formats, vertical],
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
