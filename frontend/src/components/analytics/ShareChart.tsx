'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { CanvasChart, type DrawFrame, type Readout } from './CanvasChart';
import { SeriesTween, type Datum } from './interpolate';
import { CATEGORICAL, CHART_COLORS } from './theme';
import type { NumberFormats } from './plot';

/**
 * A pie of composition — the event-breakdown tile.
 *
 * The tween runs on the slice *values*, not on the angles, and every frame
 * re-normalises them against the live total. That falls out correctly for free:
 * a slice that appears grows from zero width while its neighbours give up
 * exactly the arc it takes, and the circle is never partly empty mid-flight.
 * Tweening the angles directly would need a rule for what an entering slice
 * does to the ones after it, and would drift out of 360° whenever the total
 * changed.
 *
 * Geometry matches the old `<Pie outerRadius={80} strokeWidth={0}>`. It starts
 * at twelve o'clock and runs clockwise, which is how a share is read; recharts
 * happened to start at three.
 */

const MAX_RADIUS = 80;
const START_ANGLE = -Math.PI / 2;
const HOVER_OFFSET = 3;

export interface ShareChartProps {
  /** Ordered largest-first by the query. One value per datum. */
  data: Datum[];
  height?: number;
  /** Header for the label column of the text alternative. */
  labelHeader: string;
  /** Header for the value column. */
  valueHeader: string;
  /** Header for the share column. */
  shareHeader: string;
  summary: string;
  tableCaption: string;
  formats: NumberFormats;
  fallback: ReactNode;
}

interface Slice {
  key: string;
  from: number;
  to: number;
}

interface Geometry {
  cx: number;
  cy: number;
  radius: number;
  /** Angles of the *settled* slices, for hit-testing. */
  slices: Slice[];
}

export function ShareChart({
  data, height = 200, labelHeader, valueHeader, shareHeader,
  summary, tableCaption, formats, fallback,
}: ShareChartProps) {
  const tweenRef = useRef<SeriesTween | null>(null);
  // No value axis, so no scale to tween and no ticks to derive.
  if (!tweenRef.current) tweenRef.current = new SeriesTween({ tickCount: 1, ceilingFor: () => 1 });

  const aimedAt = useRef<Datum[] | null>(null);
  const geometry = useRef<Geometry | null>(null);

  // Colour is assigned by position in the newest payload, then remembered by
  // key: a slice that drops out of the top seven has to keep its colour while
  // it shrinks away, or it changes identity on the way out. The HTML legend
  // beside the chart indexes the same ramp the same way, so the two agree.
  const colours = useRef<Map<string, string>>(new Map());
  const colourOf = useCallback((key: string) => colours.current.get(key) ?? CHART_COLORS.axis, []);

  const total = useMemo(() => data.reduce((sum, d) => sum + (d.values[0] ?? 0), 0), [data]);

  const draw = useCallback(
    (frame: DrawFrame): boolean => {
      const tween = tweenRef.current!;
      if (aimedAt.current !== data) {
        data.forEach((datum, index) => {
          colours.current.set(datum.key, CATEGORICAL[index % CATEGORICAL.length]);
        });
        // Bounded: without this the map grows for the life of the page as event
        // names come and go.
        if (colours.current.size > 64) {
          const live = new Set(data.map(d => d.key));
          // `Array.from` rather than iterating the map directly: the build
          // targets ES5 iteration, and deleting while iterating a live view
          // would be the wrong shape anyway.
          Array.from(colours.current.keys()).forEach(key => {
            if (!live.has(key)) colours.current.delete(key);
          });
        }
        tween.retarget(data, frame.now, frame.animated);
        aimedAt.current = data;
      }
      const state = tween.sample(frame.now);
      const { ctx } = frame;

      const cx = frame.width / 2;
      const cy = frame.height / 2;
      const radius = Math.min(MAX_RADIUS, Math.min(frame.width, frame.height) / 2 - 6);
      if (radius <= 2) return state.moving;

      const liveTotal = state.data.reduce((sum, d) => sum + Math.max(0, d.values[0] ?? 0), 0);

      // Settled angles, kept for the hit-test. Derived from the target data so
      // the slice under the pointer does not change while the pie is moving.
      const settled: Slice[] = [];
      let cursor = START_ANGLE;
      for (const datum of data) {
        const sweep = total > 0 ? ((datum.values[0] ?? 0) / total) * Math.PI * 2 : 0;
        settled.push({ key: datum.key, from: cursor, to: cursor + sweep });
        cursor += sweep;
      }
      geometry.current = { cx, cy, radius, slices: settled };

      if (liveTotal <= 0) return state.moving;

      const hoveredKey = frame.hover >= 0 ? data[frame.hover]?.key : undefined;

      let angle = START_ANGLE;
      for (const datum of state.data) {
        const value = Math.max(0, datum.values[0] ?? 0);
        const sweep = (value / liveTotal) * Math.PI * 2;
        if (sweep > 0.0005) {
          const highlighted = hoveredKey === datum.key;
          const mid = angle + sweep / 2;
          // The hovered slice steps out of the ring; the rest dim. Both are
          // reversible cues that do not touch the slice's angle, so the
          // proportion being read stays exactly what the data says.
          const offset = highlighted ? HOVER_OFFSET : 0;
          const ox = cx + Math.cos(mid) * offset;
          const oy = cy + Math.sin(mid) * offset;

          ctx.save();
          ctx.globalAlpha =
            Math.max(0, Math.min(1, datum.alpha)) * (hoveredKey && !highlighted ? 0.55 : 1);
          ctx.fillStyle = colourOf(datum.key);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.arc(ox, oy, radius, angle, angle + sweep);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        angle += sweep;
      }

      return state.moving;
    },
    [data, total, colourOf],
  );

  const indexAt = useCallback(
    (x: number, y: number): number => {
      const geo = geometry.current;
      if (!geo || !data.length) return -1;
      const dx = x - geo.cx;
      const dy = y - geo.cy;
      if (Math.hypot(dx, dy) > geo.radius + HOVER_OFFSET) return -1;

      // `atan2` returns (-π, π] measured from three o'clock; the slices start at
      // twelve, so the angle is rotated into the same frame and wrapped to a
      // single positive turn before it is compared.
      const turn = Math.PI * 2;
      const theta = (((Math.atan2(dy, dx) - START_ANGLE) % turn) + turn) % turn;
      for (let i = 0; i < geo.slices.length; i++) {
        const slice = geo.slices[i];
        const from = slice.from - START_ANGLE;
        const to = slice.to - START_ANGLE;
        if (theta >= from && theta < to) return i;
      }
      return -1;
    },
    [data],
  );

  const readout = useCallback(
    (index: number): Readout | null => {
      const geo = geometry.current;
      const datum = data[index];
      const slice = geo?.slices[index];
      if (!geo || !datum || !slice) return null;
      const mid = (slice.from + slice.to) / 2;
      const value = datum.values[0] ?? 0;
      return {
        index,
        x: geo.cx + Math.cos(mid) * geo.radius * 0.62,
        y: geo.cy + Math.sin(mid) * geo.radius * 0.62,
        label: datum.label,
        rows: [
          { name: valueHeader, value: formats.full(value), color: colourOf(datum.key) },
          {
            name: shareHeader,
            value: formats.percent(total > 0 ? value / total : 0),
            color: colourOf(datum.key),
          },
        ],
      };
    },
    [data, total, formats, valueHeader, shareHeader, colourOf],
  );

  const table = useMemo(
    () => ({
      caption: tableCaption,
      columns: [labelHeader, valueHeader, shareHeader],
      rows: data.map(d => {
        const value = d.values[0] ?? 0;
        return [
          d.label,
          formats.full(value),
          formats.percent(total > 0 ? value / total : 0),
        ];
      }),
    }),
    [data, total, formats, labelHeader, valueHeader, shareHeader, tableCaption],
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
