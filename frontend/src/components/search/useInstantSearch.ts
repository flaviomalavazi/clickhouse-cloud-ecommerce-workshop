'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SearchResult } from '@/types/product';
import type { LatencySample } from './LatencyMeter';
import { useI18n } from '@/i18n/LocaleProvider';

const DEBOUNCE_MS = 140;
const MAX_SAMPLES = 30;

interface State {
  results: SearchResult[];
  /** Set once a query has actually been answered. */
  answered: boolean;
  /** The query the current results belong to. */
  query: string;
  pending: boolean;
  failed: boolean;
  samples: LatencySample[];
  last: LatencySample | null;
}
const INITIAL: State = {
  results: [], answered: false, query: '', pending: false, failed: false, samples: [], last: null,
};

/** Same-document View Transitions, when the browser has them and motion is wanted. */
function commit(apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) {
    apply();
    return;
  }
  // flushSync so React has written the new DOM before the transition captures it.
  doc.startViewTransition(() => flushSync(apply));
}

/**
 * Search that runs as the visitor types, and reports what it cost.
 *
 * Three things make this feel instant rather than merely fast:
 *
 *  · Every keystroke supersedes the last. The in-flight request is aborted, so
 *    a slow early query can never land on top of a newer one.
 *  · Results are never cleared while a new query is in flight. The previous set
 *    stays on screen under a progress line, so the grid does not blink.
 *  · The commit runs inside a View Transition, so a product that survives into
 *    the next result set slides to its new cell instead of being repainted.
 *
 * Timings come from the browser's own performance timeline rather than a
 * stopwatch around `fetch`: a PerformanceObserver reads the resource entry for
 * each request, giving `server` as time-to-first-byte (the query) and `total`
 * as the whole round trip. An observer is used instead of
 * `getEntriesByName` because the primary timing buffer caps at 250 entries and
 * would stop recording partway through a demo; observers keep delivering.
 */
export function useInstantSearch(onSettled?: (query: string, count: number) => void) {
  const [state, setState] = useState<State>(INITIAL);
  // Sent to /api/search/text so the route knows which per-locale tokenbf columns
  // to search. The locale lives only in the client, so the server cannot infer it.
  const { locale } = useI18n();

  const timings = useRef(new Map<string, LatencySample>());
  const controller = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (!entry.name.includes('/api/search/text')) continue;
        timings.current.set(entry.name, {
          total: entry.duration,
          server: Math.max(0, entry.responseStart - entry.requestStart),
        });
      }
    });
    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // Older engines reject the options form; the stopwatch fallback covers it.
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    controller.current?.abort();
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  const run = useCallback(async (query: string) => {
    const seq = ++requestSeq.current;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;

    setState(s => ({ ...s, pending: true, failed: false }));

    const url = `/api/search/text?q=${encodeURIComponent(query)}&locale=${locale}`;
    const started = performance.now();

    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      const results: SearchResult[] = Array.isArray(data?.results) ? data.results : [];

      // The observer callback is queued as its own task, so yield one frame
      // before reading the entry it will have written.
      await new Promise(requestAnimationFrame);
      if (seq !== requestSeq.current) return;

      const measured = timings.current.get(new URL(url, location.origin).href);
      const fallback = performance.now() - started;
      const sample: LatencySample = measured ?? { total: fallback, server: fallback };

      commit(() => {
        setState(s => ({
          results,
          answered: true,
          query,
          pending: false,
          failed: false,
          last: sample,
          samples: [...s.samples, sample].slice(-MAX_SAMPLES),
        }));
      });

      settled.current?.(query, results.length);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (seq !== requestSeq.current) return;
      setState(s => ({ ...s, pending: false, failed: true }));
    }
  }, [locale]);

  /** Debounced entry point for typing. */
  const search = useCallback((query: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = query.trim();

    if (!trimmed) {
      controller.current?.abort();
      requestSeq.current++;
      commit(() => setState(s => ({ ...s, results: [], answered: false, query: '', pending: false, failed: false })));
      return;
    }

    debounce.current = setTimeout(() => run(trimmed), DEBOUNCE_MS);
  }, [run]);

  /** Immediate, for an explicit submit. */
  const searchNow = useCallback((query: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = query.trim();
    if (trimmed) run(trimmed);
  }, [run]);

  const reset = useCallback(() => {
    controller.current?.abort();
    requestSeq.current++;
    if (debounce.current) clearTimeout(debounce.current);
    setState(s => ({ ...INITIAL, samples: s.samples }));
  }, []);

  return { ...state, search, searchNow, reset };
}
