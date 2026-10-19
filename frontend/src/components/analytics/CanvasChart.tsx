'use client';

import {
  useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react';
import { CHART_COLORS } from './theme';

/**
 * The shell every canvas chart in this folder is drawn into.
 *
 * It owns everything that is not the picture itself: the backing store and its
 * device-pixel scaling, the frame loop and the four things that are allowed to
 * stop it, pointer and keyboard hit-testing, the HTML hover readout, the text
 * alternative, and the fallback swap. A chart type then supplies three pure
 * functions — `draw`, `indexAt`, `readout` — and no lifecycle code of its own.
 *
 * ── The fallback chain ───────────────────────────────────────────────────────
 *   1. Canvas 2D, interpolated. The normal path.
 *   2. Canvas 2D, static. `prefers-reduced-motion: reduce` sets `animated`
 *      false, which makes the tween duration zero: new data lands as one frame
 *      with no movement, and the loop stops immediately after drawing it.
 *   3. recharts, via `fallback`. Mounted only if `getContext('2d')` gives us
 *      nothing — an ancient browser, a hardened one, or a canvas-disabled
 *      privacy extension. The canvas markup renders on the server and on the
 *      first client pass either way, so there is no hydration mismatch and no
 *      layout shift; the swap costs one frame in the case where it happens.
 *   4. The sr-only table, always present in every one of the above.
 *
 * ── Why the loop is demand-driven ───────────────────────────────────────────
 * `draw` returns whether it wants another frame. A settled chart returns false
 * and the loop stops dead, so six idle tiles cost zero rAF callbacks — which
 * matters here because the page is already polling ClickHouse on three timers.
 * `invalidate()` restarts it, and the loop additionally refuses to run when the
 * canvas is scrolled out of view or the tab is hidden.
 */

export interface DrawFrame {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels. The context is pre-scaled, so all drawing is in these units. */
  width: number;
  height: number;
  /** `performance.now()` for this frame. */
  now: number;
  /** Resolved font stacks, so canvas text matches the page's own faces. */
  sans: string;
  mono: string;
  /** False under reduced motion: skip the tween, draw the destination. */
  animated: boolean;
  /** Slot the pointer or keyboard is on, or -1. */
  hover: number;
}

export interface ReadoutRow {
  name: string;
  value: string;
  /** Swatch colour — the same hex the series is drawn in. */
  color: string;
}

export interface Readout {
  index: number;
  /** Tooltip anchor, CSS pixels within the frame. */
  x: number;
  y: number;
  label: string;
  rows: ReadoutRow[];
}

export interface ChartTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

export interface CanvasChartProps {
  /** CSS height of the plot, matching what the recharts container had. */
  height: number;
  draw: (frame: DrawFrame) => boolean;
  /** Nearest hoverable slot for a pointer position, or -1 for none. */
  indexAt: (x: number, y: number, width: number, height: number) => number;
  /** Tooltip content and anchor for a slot. */
  readout: (index: number, width: number, height: number) => Readout | null;
  /** Hoverable slot count, for keyboard stepping. */
  count: number;
  /** One-line description of the chart, read before the table. */
  summary: string;
  /** The data, as text. The real accessible rendering of the chart. */
  table: ChartTable;
  /** recharts equivalent, mounted only when Canvas 2D is unavailable. */
  fallback: ReactNode;
}

export function CanvasChart({
  height, draw, indexAt, readout, count, summary, table, fallback,
}: CanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sansProbe = useRef<HTMLSpanElement>(null);
  const monoProbe = useRef<HTMLSpanElement>(null);

  const [unsupported, setUnsupported] = useState(false);
  const [hover, setHover] = useState<Readout | null>(null);

  // The loop reads these through refs so that a data change never tears down
  // and rebuilds the context — the effect below runs exactly once per mount.
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const hoverIndexRef = useRef(-1);
  const kickRef = useRef<() => void>(() => {});
  const sizeRef = useRef({ width: 0, height: 0 });

  /** Ask for a frame. Safe to call when the loop is already running. */
  const invalidate = useCallback(() => kickRef.current(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) {
      setUnsupported(true);
      return;
    }
    const context = ctx;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let frame = 0;
    let fonts = { sans: 'system-ui, sans-serif', mono: 'monospace' };

    // ── Backing store ────────────────────────────────────────────────────────
    // The element is sized in CSS pixels by Tailwind; the bitmap behind it has
    // to be devicePixelRatio times that or every hairline gridline and every
    // 10px tick label renders soft on a Retina display. Scaling the transform
    // by the same factor then lets all the drawing code stay in CSS pixels,
    // which is also what the pointer arrives in — one coordinate space, no
    // conversions at the hit-test.
    //
    // Capped at 2: a 3× store on a phone triples the fill cost of the pie for
    // no visible gain. Rounded because a fractional backing store makes the
    // browser resample the whole canvas, which is exactly the softness the DPR
    // scaling was for.
    function resize(): boolean {
      const rect = canvas!.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const cssHeight = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const storeW = Math.round(width * dpr);
      const storeH = Math.round(cssHeight * dpr);

      const changed =
        canvas!.width !== storeW ||
        canvas!.height !== storeH ||
        sizeRef.current.width !== width ||
        sizeRef.current.height !== cssHeight;

      if (canvas!.width !== storeW) canvas!.width = storeW;
      if (canvas!.height !== storeH) canvas!.height = storeH;
      // Re-asserted every time: assigning to width/height resets the transform.
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height: cssHeight };
      return changed;
    }

    // Canvas cannot resolve `var(--font-inter)`, so the stacks are read off two
    // zero-size probe spans that carry the Tailwind font classes. Reading the
    // computed value means the charts pick up whatever next/font actually
    // loaded rather than a hardcoded guess at it.
    function readFonts() {
      const sans = sansProbe.current;
      const mono = monoProbe.current;
      fonts = {
        sans: sans ? getComputedStyle(sans).fontFamily || fonts.sans : fonts.sans,
        mono: mono ? getComputedStyle(mono).fontFamily || fonts.mono : fonts.mono,
      };
    }
    readFonts();

    function render(now: number): boolean {
      const { width, height: h } = sizeRef.current;
      if (width < 2 || h < 2) return false;
      context.clearRect(0, 0, width, h);
      return drawRef.current({
        ctx: context,
        width,
        height: h,
        now,
        sans: fonts.sans,
        mono: fonts.mono,
        animated: !reduced.matches,
        hover: hoverIndexRef.current,
      });
    }

    function tick(now: number) {
      frame = 0;
      if (render(now)) frame = requestAnimationFrame(tick);
    }

    function stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function kick() {
      if (frame) return;
      // Nothing off-screen or in a background tab gets a frame. The next
      // `kick` — from becoming visible, a resize, or new data — picks it up,
      // and because the tween is sampled against the wall clock it lands
      // already finished rather than replaying a backlog.
      if (!onScreen || document.hidden) return;
      frame = requestAnimationFrame(tick);
    }
    kickRef.current = kick;

    resize();
    kick();

    const resizeObserver = new ResizeObserver(() => {
      if (resize()) {
        // Geometry moved under the pointer, so any open readout is now anchored
        // to the wrong place. Cheaper to drop it than to recompute it.
        hoverIndexRef.current = -1;
        setHover(null);
        kick();
      }
    });
    resizeObserver.observe(canvas);

    const intersectionObserver = new IntersectionObserver(
      entries => {
        onScreen = entries.some(entry => entry.isIntersecting);
        if (onScreen) kick();
        else stop();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);

    function onVisibility() {
      if (document.hidden) stop();
      else kick();
    }
    document.addEventListener('visibilitychange', onVisibility);

    function onReducedChange() {
      stop();
      kick();
    }
    reduced.addEventListener('change', onReducedChange);

    // Retina-to-standard monitor moves need a new backing store; nothing else
    // fires for a DPR change.
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onReducedChange);

    return () => {
      stop();
      kickRef.current = () => {};
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onReducedChange);
      dprQuery.removeEventListener('change', onReducedChange);
    };
  }, []);

  // A new `draw` identity is how a chart says "my data changed". The tween
  // itself is re-aimed inside the draw callback, on the first frame it gets,
  // so it is stamped with that frame's clock instead of a render's.
  useEffect(() => {
    invalidate();
  }, [draw, invalidate]);

  const applyIndex = useCallback(
    (index: number) => {
      const { width, height: h } = sizeRef.current;
      const next = index < 0 || index >= count ? null : readout(index, width, h);
      hoverIndexRef.current = next ? next.index : -1;
      setHover(next);
      invalidate();
    },
    [count, readout, invalidate],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !count) return;
      const rect = canvas.getBoundingClientRect();
      applyIndex(indexAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height));
    },
    [applyIndex, count, indexAt],
  );

  const onPointerLeave = useCallback(() => applyIndex(-1), [applyIndex]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!count) return;
      const current = hoverIndexRef.current;
      switch (event.key) {
        case 'ArrowRight':
          applyIndex(current < 0 ? 0 : Math.min(count - 1, current + 1));
          break;
        case 'ArrowLeft':
          applyIndex(current < 0 ? count - 1 : Math.max(0, current - 1));
          break;
        case 'Home':
          applyIndex(0);
          break;
        case 'End':
          applyIndex(count - 1);
          break;
        case 'Escape':
          applyIndex(-1);
          return; // no preventDefault: Escape may mean something to an ancestor
        default:
          return;
      }
      event.preventDefault();
    },
    [applyIndex, count],
  );

  const alternative = (
    <>
      {/* Zero-size, but laid out (sr-only clips rather than hides), so the
          computed font stacks above always resolve. */}
      <span ref={sansProbe} className="sr-only font-sans" aria-hidden="true" />
      <span ref={monoProbe} className="sr-only font-mono" aria-hidden="true" />
      <table className="sr-only">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column, i) => (
              <th key={i} scope="col">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );

  if (unsupported) {
    return (
      <figure className="on-dark m-0" aria-label={summary}>
        {alternative}
        {fallback}
      </figure>
    );
  }

  // The readout is placed above its anchor, and flipped below when the anchor
  // is too near the top edge for the box to fit.
  const flip = hover ? hover.y < 64 : false;

  return (
    <figure
      className="on-dark relative m-0 rounded-lg"
      style={{ height }}
      aria-label={summary}
      tabIndex={count ? 0 : -1}
      onKeyDown={onKeyDown}
      onBlur={onPointerLeave}
    >
      {alternative}
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-pan-y"
        // Decorative: the table above is the accessible rendering.
        role="presentation"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-[7rem] rounded-lg border px-2.5 py-1.5 text-xs shadow-lift"
          style={{
            background: CHART_COLORS.surface,
            borderColor: CHART_COLORS.rule,
            left: Math.min(Math.max(hover.x, 56), Math.max(56, sizeRef.current.width - 56)),
            top: hover.y,
            transform: flip ? 'translate(-50%, 8px)' : 'translate(-50%, calc(-100% - 8px))',
          }}
        >
          <p className="mb-1 font-medium" style={{ color: CHART_COLORS.label }}>{hover.label}</p>
          <ul className="space-y-0.5">
            {hover.rows.map(row => (
              <li key={row.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-ch-300">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: row.color }}
                  />
                  {row.name}
                </span>
                <span className="numeric font-semibold text-white">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}
