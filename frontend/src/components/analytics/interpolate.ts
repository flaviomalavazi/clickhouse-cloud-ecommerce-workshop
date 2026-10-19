/**
 * The tween engine behind the canvas charts.
 *
 * ── Why interpolate instead of redraw ────────────────────────────────────────
 * The dashboard polls on a timer, so a tile receives a whole new array every
 * few seconds. Handing that array straight to a renderer replaces the picture,
 * and the eye reads a replaced picture as a flash — you cannot tell whether a
 * bar grew, shrank, or is a different bar altogether, because nothing connected
 * the two frames. Worse, the numbers usually barely move: a 20s poll on a
 * "today" aggregate mostly redraws the same shape, so every flash carries no
 * information at all.
 *
 * Tweening puts the change itself on screen. A bucket that gained views rises;
 * a new bucket grows out of the axis; a bucket that fell off the window sinks
 * back into it. The reader gets the delta for free, and a tile that did not
 * change visibly does not move — which is the honest rendering of "no news".
 *
 * ── How identity works ───────────────────────────────────────────────────────
 * Interpolation only means something if we can say *which* point moved, so
 * every datum carries a stable `key`: the bucket timestamp, the category slug,
 * the event name. Array position is not identity — a top-N list reorders
 * constantly, and lerping by index would slide the values of one page into the
 * bar of another.
 *
 *   · key in both states  → its value and its layout slot both tween
 *   · key only in the new → enters at its target slot, from the baseline, alpha 0→1
 *   · key only in the old → sinks to the baseline in place, alpha 1→0, then is dropped
 *
 * ── Re-targeting mid-flight ──────────────────────────────────────────────────
 * A payload can land while the previous tween is still running. `retarget()`
 * therefore samples the *current* interpolated state and uses that as the new
 * origin, rather than the last committed data. Without that, a fast second
 * refresh would snap back to where the first one started.
 */

import { TWEEN_MS } from './theme';

/** One x-slot of a chart: an identity, an axis label, and a value per series. */
export interface Datum {
  /** Stable across refreshes. Bucket timestamp, category slug, page path… */
  key: string;
  /** What the axis and the tooltip print for this slot. */
  label: string;
  /** One entry per series, in series order. */
  values: number[];
}

/**
 * One series, in the same order as the numbers in `Datum.values`.
 *
 * `name` arrives already translated — nothing in this folder reaches for the
 * dictionary, so the renderer stays a renderer and the strings stay on the page.
 */
export interface SeriesSpec {
  name: string;
  /** Hex from `theme.ts`. Also used for the readout swatch. */
  color: string;
}

/** A datum as it exists on one frame, part-way between two states. */
export interface LiveDatum {
  key: string;
  label: string;
  values: number[];
  /**
   * Fractional layout position. Charts map this through their own x scale, so a
   * point that moved from index 4 to index 3 slides rather than jumps.
   */
  slot: number;
  /** 0 while entering or leaving, 1 once settled. Multiplies stroke/fill alpha. */
  alpha: number;
}

export interface Frame {
  /** Sorted by `slot`, so a polyline stays monotonic in x mid-tween. */
  data: LiveDatum[];
  /** The axis ceiling for *this* frame — gridlines glide instead of jumping. */
  ceiling: number;
  /**
   * The settled ceiling. Tick *values* are derived from this one so the printed
   * numbers never churn through intermediate values while the scale is moving;
   * only their pixel positions are animated.
   */
  targetCeiling: number;
  /** Tick values for `targetCeiling`, ascending, always including 0. */
  ticks: number[];
  /** True while anything above is still in motion — the caller keeps the loop alive. */
  moving: boolean;
}

interface Track {
  key: string;
  label: string;
  fromValues: number[];
  toValues: number[];
  fromSlot: number;
  toSlot: number;
  fromAlpha: number;
  toAlpha: number;
  /** Absent from the newest payload; removed once the tween lands. */
  leaving: boolean;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Exponential ease-out: fast off the mark, then a long settle.
 *
 * The right curve for a value *arriving*. The bulk of the distance is covered
 * in the first third, which is what makes the movement read as "the number
 * changed" rather than "something is animating"; the tail then lands softly
 * enough that the final pixel does not click into place. Same family as
 * `--ease-out-quint` in globals.css, one degree sharper.
 */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/**
 * A rounded axis ceiling and its tick values.
 *
 * Picks a 1/2/2.5/5/10 × 10ⁿ step no smaller than `max / count`, then takes the
 * ceiling as `step × count`. Choosing the step first (rather than rounding the
 * maximum and dividing) is what keeps the printed ticks whole: rounding first
 * gives ceilings like 1500 and then ticks of 375.
 */
export function niceScale(max: number, count = 4): { ceiling: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) {
    return { ceiling: 1, ticks: [0, 1] };
  }
  const rough = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step =
    [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(candidate => candidate >= rough - 1e-9) ??
    10 * magnitude;
  const ceiling = step * count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Number((step * i).toPrecision(12)));
  return { ceiling, ticks };
}

/** Same keys, same order, same numbers. */
function sameState(a: readonly Datum[], b: readonly Datum[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].label !== b[i].label) return false;
    const left = a[i].values;
    const right = b[i].values;
    if (left.length !== right.length) return false;
    for (let j = 0; j < left.length; j++) if (left[j] !== right[j]) return false;
  }
  return true;
}

/** Largest value across every series of every datum. */
export function peakOf(data: readonly Datum[]): number {
  let peak = 0;
  for (const d of data) for (const v of d.values) if (v > peak) peak = v;
  return peak;
}

export interface SeriesTweenOptions {
  /** Ticks on the value axis. 4 for the tall tiles, fewer for short ones. */
  tickCount?: number;
  /**
   * Value-axis ceiling. Omit to derive it from the data; pass a fixed number
   * for charts whose scale is not a magnitude (the pie's total, for instance).
   */
  ceilingFor?: (data: readonly Datum[]) => number;
}

/**
 * Holds the two states a chart is between, and samples the frame in between.
 *
 * Deliberately not React state: this mutates many times a second and nothing in
 * the tree needs to re-render for it. The owning component keeps one of these
 * in a ref, calls `retarget()` when props change, and reads `sample()` inside
 * the draw callback.
 */
export class SeriesTween {
  private tracks: Track[] = [];
  private fromCeiling = 0;
  private toCeiling = 1;
  private ticks: number[] = [0, 1];
  private startedAt = 0;
  private duration = 0;
  private primed = false;
  private committed: readonly Datum[] = [];
  private readonly tickCount: number;
  private readonly ceilingFor: (data: readonly Datum[]) => number;

  constructor(options: SeriesTweenOptions = {}) {
    this.tickCount = options.tickCount ?? 4;
    this.ceilingFor = options.ceilingFor ?? peakOf;
  }

  /**
   * Aim at a new state.
   *
   * `animate` false (reduced motion, or a tab that was hidden through the whole
   * previous tween) sets a zero duration, so the very next `sample()` returns
   * the target exactly — one static frame, no loop.
   */
  retarget(next: readonly Datum[], now: number, animate: boolean): void {
    // A poll that re-serves identical numbers — the common case on a "today"
    // aggregate refreshed every 20s — must not restart the tween. It would
    // animate from a value to itself, which is invisible but still spends 37
    // frames doing it, on every tile, forever. The comparison is over a handful
    // of rows and runs once per payload.
    if (this.primed && sameState(this.committed, next)) return;
    this.committed = next;

    const live = this.sample(now);
    const origin = new Map(live.data.map(d => [d.key, d]));

    const tracks: Track[] = next.map((datum, index) => {
      const previous = origin.get(datum.key);
      return {
        key: datum.key,
        label: datum.label,
        // An unseen key starts flat on the baseline and fully transparent, so
        // it grows *out of* the axis instead of popping in at full height. Its
        // slot starts at its destination — a new point sliding in from
        // somewhere it never was would be a lie about the data.
        fromValues: previous ? previous.values.slice() : datum.values.map(() => 0),
        toValues: datum.values.slice(),
        fromSlot: previous ? previous.slot : index,
        toSlot: index,
        fromAlpha: previous ? previous.alpha : 0,
        toAlpha: 1,
        leaving: false,
      };
    });

    const arriving = new Set(next.map(d => d.key));
    for (const datum of live.data) {
      if (arriving.has(datum.key)) continue;
      // Sinks where it stands. Moving a departing point sideways would imply it
      // became one of the points that stayed.
      tracks.push({
        key: datum.key,
        label: datum.label,
        fromValues: datum.values.slice(),
        toValues: datum.values.map(() => 0),
        fromSlot: datum.slot,
        toSlot: datum.slot,
        fromAlpha: datum.alpha,
        toAlpha: 0,
        leaving: true,
      });
    }

    const { ceiling, ticks } = niceScale(this.ceilingFor(next), this.tickCount);
    // First payload: no scale tween. The bars still grow from zero (their
    // `fromValues` are zero), but the gridlines are already where they belong,
    // so the axis labels do not slide in from nothing on a cold load.
    this.fromCeiling = this.primed ? live.ceiling : ceiling;
    this.toCeiling = ceiling;
    this.ticks = ticks;

    this.tracks = tracks;
    this.startedAt = now;
    this.duration = animate ? TWEEN_MS : 0;
    this.primed = true;
  }

  /** The frame at `now`. Cheap enough to call from inside the draw loop. */
  sample(now: number): Frame {
    const progress =
      this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.startedAt) / this.duration));
    const eased = easeOutExpo(progress);
    const landed = progress >= 1;

    // Pruning on the frame that lands, not on a timer: a tab that was hidden for
    // a minute comes back with `now` far past the end, samples straight at t=1,
    // and drops its ghosts in the same pass. No catch-up animation.
    if (landed && this.tracks.some(track => track.leaving)) {
      this.tracks = this.tracks.filter(track => !track.leaving);
    }

    const data: LiveDatum[] = this.tracks.map(track => ({
      key: track.key,
      label: track.label,
      values: track.toValues.map((to, i) => lerp(track.fromValues[i] ?? 0, to, eased)),
      slot: lerp(track.fromSlot, track.toSlot, eased),
      alpha: lerp(track.fromAlpha, track.toAlpha, eased),
    }));
    // Departing points keep their old slot, which can be anywhere in the range;
    // sorting keeps x monotonic so a line does not fold back on itself.
    data.sort((a, b) => a.slot - b.slot);

    return {
      data,
      ceiling: Math.max(1e-6, lerp(this.fromCeiling, this.toCeiling, eased)),
      targetCeiling: Math.max(1e-6, this.toCeiling),
      ticks: this.ticks,
      moving: !landed,
    };
  }
}
