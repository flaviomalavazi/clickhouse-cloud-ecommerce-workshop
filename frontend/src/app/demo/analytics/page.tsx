'use client';

import { useEffect, useState, useCallback, useMemo, useRef, useTransition, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import NumberFlow from '@number-flow/react';
import { MotionConfig } from 'motion/react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  CHART_NAMES, RANGE_TOKENS, type ChartName, type RangeToken,
} from '@/lib/analytics-queries';
import {
  BarSeriesChart, CATEGORICAL, CHART_COLORS, ShareChart, TrendChart,
  makeNumberFormats, type Datum, type SeriesSpec,
} from '@/components/analytics';
import { MagicCard } from '@/components/analytics/fx/MagicCard';
import { BorderBeam } from '@/components/analytics/fx/BorderBeam';
import { BlurFade } from '@/components/analytics/fx/BlurFade';
import { DotPattern } from '@/components/analytics/fx/DotPattern';
import { Marquee } from '@/components/analytics/fx/Marquee';
import { useAnalyticsStrings } from './strings';
import { QueryReceipt } from './_components/QueryReceipt';
import { Pipeline } from './_components/Pipeline';
import { LiveFeed } from './_components/LiveFeed';
import { Funnel } from './_components/Funnel';
import { Revenue } from './_components/Revenue';
import { Devices } from './_components/Devices';
import { StoreMap } from './_components/StoreMap';
import { Payments } from './_components/Payments';
import { Platforms } from './_components/Platforms';
import { Sources } from './_components/Sources';
import { Flows } from './_components/Flows';
import { ScrollDepth } from './_components/ScrollDepth';
import { ZeroSearches } from './_components/ZeroSearches';
import type { TelemetryRates } from './_components/Pipeline';
import { useSelfUserId } from './_components/useSelfUserId';
import { makeReceiptFormats } from './_components/format';
import { fillTemplate } from './_components/template';
import type {
  DeviceRow, FeedEvent, FlowRow, Freshness, FunnelRow,
  PaymentRow, PlatformRow, QueryStats, Receipt, RevenueRow, ScrollRow, SourceRow,
  TelemetrySample, ZeroSearchRow,
} from './_components/types';

// WebGL, and only in stage mode — never downloaded otherwise.
const Aurora = dynamic(() => import('@/components/analytics/fx/Aurora'), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────────
interface KPIData {
  active_users: number;
  today: { page_views: number; sessions: number; total_events: number; unique_users: number };
  dataset_rows?: number | null;
  stats?: QueryStats;
}

type HourlyView    = { hour: string; page_views: number; users: number };
type TopPage       = { page_urlpath: string; views: number; unique_users: number };
type EventBreakdown = { event_name: string; cnt: number };
type TopSearch     = { query: string; searches: number; type: string };
type CategoryView  = { category: string; views: number };
type DailySession  = { day: string; sessions: number; users: number; events: number };

interface ChartDataMap {
  hourly_views:    HourlyView[];
  top_pages:       TopPage[];
  event_breakdown: EventBreakdown[];
  top_searches:    TopSearch[];
  category_views:  CategoryView[];
  daily_sessions:  DailySession[];
  funnel:          FunnelRow[];
  revenue:         RevenueRow[];
  devices:         DeviceRow[];
  payments:        PaymentRow[];
  platforms:       PlatformRow[];
  sources:         SourceRow[];
  flows:           FlowRow[];
  scroll_depth:    ScrollRow[];
  zero_searches:   ZeroSearchRow[];
}

interface LiveVisitor {
  domain_userid: string;
  current_page: string;
  page_title: string;
  last_seen: string;
  events_in_window: number;
}

/** What the API actually served for a tile — its window may be floored. */
interface ChartMeta { range: RangeToken; bucket?: 'hour' | 'day' }

// ── Refresh tiers ────────────────────────────────────────────────────────────
// Everything used to poll every 5s, which meant the 7-day tiles re-ran twelve
// times a minute to redraw the same bars. Only the realtime widgets need that
// cadence; the rest are throttled to what their window can actually change by.
const REFRESH_MS = { live: 5_000, today: 20_000, windowed: 60_000 } as const;

const CHART_TIER: Record<ChartName, 'today' | 'windowed'> = {
  hourly_views:    'windowed',
  daily_sessions:  'windowed',
  top_searches:    'windowed',
  top_pages:       'today',
  event_breakdown: 'today',
  category_views:  'today',
  funnel:          'windowed',
  revenue:         'windowed',
  devices:         'windowed',
  payments:        'windowed',
  platforms:       'windowed',
  sources:         'windowed',
  flows:           'windowed',
  scroll_depth:    'windowed',
  zero_searches:   'windowed',
};

/** How long an event's pulse and globe arc stay on screen. */
const PULSE_MS = 3_500;

/** The store map looks back further than the visitors table's 10 seconds. */
const MAP_WINDOW_SECONDS = 60;

/** Per-second rates from two cumulative collector samples. */
function ratesBetween(prev: TelemetrySample, next: TelemetrySample): TelemetryRates | null {
  const dt = (next.at - prev.at) / 1000;
  const d = (x: number, y: number) => Math.max(0, y - x) / dt;
  // A counter going backwards means the collector restarted: rebaseline.
  if (dt <= 0 || next.received.spans < prev.received.spans) return null;
  return {
    spans: d(prev.received.spans, next.received.spans),
    logs: d(prev.received.logs, next.received.logs),
    metrics: d(prev.received.metrics, next.received.metrics),
    replays: d(prev.exported.replays, next.exported.replays),
    exported:
      d(prev.exported.spans, next.exported.spans) +
      d(prev.exported.logs, next.exported.logs) +
      d(prev.exported.metrics, next.exported.metrics) +
      d(prev.exported.replays, next.exported.replays),
    refused: next.refused,
  };
}

const TODAY_CHARTS    = CHART_NAMES.filter(n => CHART_TIER[n] === 'today');
const WINDOWED_CHARTS = CHART_NAMES.filter(n => CHART_TIER[n] === 'windowed');

// ── Palette ───────────────────────────────────────────────────────────────────
// One source now. These were literal arrays here and are the same bytes in
// `components/analytics/theme.ts`, which the canvas renderers draw from — the
// pie legend below and the recharts fallbacks read them from there too, so a
// slice, its swatch and its fallback can never disagree.
const CH_COLORS = CATEGORICAL;
const CH_YELLOW = CHART_COLORS.primary;

// ── Helpers ───────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, highlight, locale }: {
  label: string; value: number; sub?: string; highlight?: boolean; locale: string;
}) {
  const body = (
    <div className="relative p-5">
      <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${highlight ? 'text-ch-800' : 'text-gray-400'}`}>{label}</p>
      <p className={`tabular-nums text-3xl font-extrabold ${highlight ? 'text-ch-900' : 'text-white'}`}>
        <NumberFlow animated={false} value={value} locales={locale} />
      </p>
      {sub && <p className={`text-xs mt-1 ${highlight ? 'text-ch-700' : 'text-gray-500'}`}>{sub}</p>}
    </div>
  );
  if (highlight) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-brand-500 bg-brand-400 shadow-[0_0_60px_-15px_rgba(250,255,105,0.7)]">
        <BorderBeam size={90} duration={4} colorFrom="#0D0D0D" colorTo="#4A4A00" borderWidth={2} />
        {body}
      </div>
    );
  }
  return <MagicCard>{body}</MagicCard>;
}

function Section({ title, children, pulse, receipt, action, className }: {
  title: string; children: ReactNode; pulse?: boolean; receipt?: Receipt; action?: ReactNode; className?: string;
}) {
  return (
    // Full height so two tiles side by side end at the same line; the content
    // area flexes, and tiles that can use the room stretch into it.
    <MagicCard className={`h-full ${className ?? ''}`}>
      <div className="flex h-full flex-col p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {pulse && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
            )}
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider truncate">{title}</h3>
          </div>
          {action}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <QueryReceipt receipt={receipt} />
      </div>
    </MagicCard>
  );
}

function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="w-8 h-8 border-4 border-brand-400/30 border-t-brand-400 rounded-full animate-spin" />
    </div>
  );
}

// Bucket labels take the locale explicitly rather than `[]`. The empty array
// means "whatever the browser is set to", which on this page could print a
// Portuguese axis under Spanish chrome the moment someone uses the switcher.
function formatHour(iso: string, locale: string) {
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// Day buckets arrive as "2026-10-08" or "2026-10-08 00:00:00", both UTC. Safari
// cannot parse the space-separated form at all, so normalise to ISO first, and
// format in UTC so a viewer west of Greenwich does not see the previous day.
function formatDay(s: string, locale: string) {
  const iso = s.length === 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function shortUid(uid: string) { return uid.length > 8 ? uid.slice(0, 8) : uid; }
function pageLabel(path: string) { return (!path || path === '/') ? 'Home' : path; }

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [range, setRange]             = useState<RangeToken>('24h');
  const [kpis, setKpis]               = useState<KPIData | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  // Each chart key is present in this set until its first response arrives
  const [chartsLoading, setChartsLoading] = useState<Set<ChartName>>(new Set(CHART_NAMES));
  const [charts, setCharts]           = useState<Partial<ChartDataMap>>({});
  const [chartMeta, setChartMeta]     = useState<Partial<Record<ChartName, ChartMeta>>>({});
  const [visitors, setVisitors]       = useState<LiveVisitor[]>([]);
  // Null until the first response: a timestamp taken during render differs
  // between the server pass and hydration, which React reports as a mismatch.
  const [liveTs, setLiveTs]           = useState<Date | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [, startTransition]           = useTransition();
  const { a, numberLocale }           = useAnalyticsStrings();

  // ── Live layer state ──────────────────────────────────────────────────────
  const [feed, setFeed]               = useState<FeedEvent[]>([]);
  const [pulses, setPulses]           = useState<number[]>([]);
  const [freshness, setFreshness]     = useState<Freshness | null>(null);
  const [mapVisitors, setMapVisitors] = useState<LiveVisitor[]>([]);
  const [rates, setRates]             = useState<TelemetryRates | null>(null);
  const [telemetryDown, setTelemetryDown] = useState(false);
  const lastSample                    = useRef<TelemetrySample | null>(null);
  const [now, setNow]                 = useState(0);
  const [receipts, setReceipts]       = useState<Record<string, Receipt>>({});
  const [rowsRead, setRowsRead]       = useState(0);
  const [stage, setStage]             = useState(false);
  const selfId                        = useSelfUserId();
  const pulseSeq                      = useRef(0);

  // Guards against overlapping polls. Without this, a slow round of queries kept
  // being re-issued every 5s on top of the previous one, so ClickHouse ended up
  // running several copies of the same aggregation concurrently.
  const inFlight = useRef<Set<string>>(new Set());

  /** Files a response's receipt under its tile and adds to the page total. */
  const record = useCallback((key: string, stats?: QueryStats, sql?: string) => {
    if (!stats) return;
    setReceipts(prev => ({ ...prev, [key]: { stats, sql } }));
    setRowsRead(n => n + stats.rows);
  }, []);

  // ── Stage mode: ?stage=1, read after mount so the server render is neutral
  useEffect(() => {
    setStage(new URLSearchParams(window.location.search).get('stage') === '1');
  }, []);

  const toggleStage = useCallback(() => {
    setStage(prev => {
      const next = !prev;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('stage', '1'); else url.searchParams.delete('stage');
      window.history.replaceState(null, '', url);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleStage(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, toggleStage]);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchKpis = useCallback(async (background = false) => {
    if (inFlight.current.has('kpis')) return;
    inFlight.current.add('kpis');
    if (!background) setKpisLoading(true);
    try {
      const res = await fetch('/api/demo/analytics/kpis');
      if (!res.ok) throw new Error(await res.text());
      const json: KPIData = await res.json();
      setKpis(json);
      record('kpis', json.stats);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      if (!background) setError(String(e));
    } finally {
      inFlight.current.delete('kpis');
      if (!background) setKpisLoading(false);
    }
  }, [record]);

  // One function handles every chart — fired independently per name
  const fetchChart = useCallback(async (name: ChartName, background = false) => {
    if (inFlight.current.has(name)) return;
    inFlight.current.add(name);
    try {
      const res = await fetch(`/api/demo/analytics/chart/${name}?range=${range}`);
      if (!res.ok) return;
      const json = await res.json();
      const meta: ChartMeta = { range: json.range ?? range, bucket: json.bucket };
      record(name, json.stats, json.sql);
      if (background) {
        startTransition(() => {
          setCharts(prev => ({ ...prev, [name]: json.data }));
          setChartMeta(prev => ({ ...prev, [name]: meta }));
        });
      } else {
        setCharts(prev => ({ ...prev, [name]: json.data }));
        setChartMeta(prev => ({ ...prev, [name]: meta }));
        setChartsLoading(prev => { const s = new Set(prev); s.delete(name); return s; });
      }
    } catch { /* silent — chart keeps showing skeleton or stale data */ }
    finally { inFlight.current.delete(name); }
  }, [range, startTransition, record]);

  const fetchLive = useCallback(async () => {
    if (inFlight.current.has('live')) return;
    inFlight.current.add('live');
    try {
      const res = await fetch('/api/demo/analytics/live-visitors');
      if (!res.ok) return;
      const d = await res.json();
      setVisitors(d.visitors ?? []);
      record('live', d.stats);
      setLiveTs(new Date());
    } catch { /* silent */ }
    finally { inFlight.current.delete('live'); }
  }, [record]);

  const fetchFeed = useCallback(async () => {
    if (inFlight.current.has('feed')) return;
    inFlight.current.add('feed');
    try {
      const res = await fetch('/api/demo/analytics/live-feed');
      if (!res.ok) return;
      const d: {
        events: FeedEvent[];
        freshness: Freshness | null; stats?: QueryStats;
      } = await res.json();
      const events = d.events ?? [];
      setFeed(events);
      setFreshness(d.freshness ?? null);
      setNow(Date.now());
      record('feed', d.stats);
    } catch { /* silent */ }
    finally { inFlight.current.delete('feed'); }
  }, [record]);

  // The ClickStack pipeline: collector counters, turned into rates. A poll
  // that saw signals arrive sends pulses down the pipe — more for more.
  const fetchTelemetry = useCallback(async () => {
    if (inFlight.current.has('telemetry')) return;
    inFlight.current.add('telemetry');
    try {
      const res = await fetch('/api/demo/analytics/telemetry');
      if (!res.ok) { setTelemetryDown(true); return; }
      const sample: TelemetrySample = await res.json();
      setTelemetryDown(false);
      const prev = lastSample.current;
      lastSample.current = sample;
      if (!prev) return;
      const r = ratesBetween(prev, sample);
      setRates(r);
      const perSecond = r ? r.spans + r.logs + r.metrics : 0;
      if (perSecond <= 0) return;
      const n = perSecond > 100 ? 3 : perSecond > 10 ? 2 : 1;
      Array.from({ length: n }, () => ++pulseSeq.current).forEach((id, i) => {
        setTimeout(() => setPulses(p => [...p, id]), i * 350);
        setTimeout(() => setPulses(p => p.filter(x => x !== id)), i * 350 + PULSE_MS);
      });
    } catch { setTelemetryDown(true); }
    finally { inFlight.current.delete('telemetry'); }
  }, []);

  const fetchMap = useCallback(async () => {
    if (inFlight.current.has('map')) return;
    inFlight.current.add('map');
    try {
      const res = await fetch(`/api/demo/analytics/live-visitors?window=${MAP_WINDOW_SECONDS}`);
      if (!res.ok) return;
      const d = await res.json();
      setMapVisitors(d.visitors ?? []);
      record('map', d.stats);
    } catch { /* silent */ }
    finally { inFlight.current.delete('map'); }
  }, [record]);

  // ── Initial load, and a full reload whenever the range changes ────────────
  useEffect(() => {
    fetchKpis();
    fetchLive();
    fetchFeed();
    fetchMap();
    fetchTelemetry();
    CHART_NAMES.forEach(name => fetchChart(name));
  }, [fetchKpis, fetchLive, fetchFeed, fetchMap, fetchTelemetry, fetchChart]);

  // ── Background polling, one interval per tier ─────────────────────────────
  useEffect(() => {
    const timers = [
      setInterval(() => { fetchKpis(true); fetchLive(); fetchFeed(); fetchMap(); fetchTelemetry(); }, REFRESH_MS.live),
      setInterval(() => { TODAY_CHARTS.forEach(n => fetchChart(n, true)); }, REFRESH_MS.today),
      setInterval(() => { WINDOWED_CHARTS.forEach(n => fetchChart(n, true)); }, REFRESH_MS.windowed),
    ];
    return () => timers.forEach(clearInterval);
  }, [fetchKpis, fetchLive, fetchFeed, fetchMap, fetchTelemetry, fetchChart]);

  const handleManualRefresh = () => {
    fetchKpis();
    fetchLive();
    fetchFeed();
    fetchMap();
    CHART_NAMES.forEach(name => fetchChart(name));
  };

  const isChartLoading = (name: ChartName) => chartsLoading.has(name);
  const labelFor = (name: ChartName) => a(`range.${chartMeta[name]?.range ?? range}`);
  const totalEvents = (charts.event_breakdown ?? []).reduce((s, e) => s + Number(e.cnt), 0);
  const isInitialLoad = kpisLoading && !kpis;
  const isRefreshing  = kpisLoading && !!kpis;
  const noTrafficToday = !!kpis && Number(kpis.today.total_events) === 0;
  const receiptFormats = useMemo(() => makeReceiptFormats(numberLocale), [numberLocale]);
  // The viewer's own row goes first, so "that's me" is visible without scrolling.
  const visitorsYouFirst = useMemo(
    () => (selfId ? [...visitors].sort((x, y) => Number(y.domain_userid === selfId) - Number(x.domain_userid === selfId)) : visitors),
    [visitors, selfId],
  );
  const timeOf = (d: Date | null) => (d ? d.toLocaleTimeString(numberLocale) : '-');

  // ── Chart inputs ──────────────────────────────────────────────────────────
  // The canvas renderers interpolate between refreshes, which only works if
  // they can tell which point is which across two payloads — hence the `key`
  // on every datum. It is the bucket timestamp, the category slug or the event
  // name; never the array index, because a top-N list reorders and lerping by
  // position would slide one row's value into another row's bar.
  //
  // These memos matter for a second reason: a new array reference is how a
  // chart learns it has new data and re-aims its tween. Rebuilding them on
  // every render — the 5s live poll re-renders this component — would restart
  // all four tweens twelve times a minute.
  const formats = useMemo(() => makeNumberFormats(numberLocale), [numberLocale]);

  // The trend chart buckets by day on wide windows, so the axis formatter has to
  // follow what the API actually returned rather than assume hours.
  const hourLabel = useCallback((iso: string) => formatHour(iso, numberLocale), [numberLocale]);
  const dayLabel  = useCallback((day: string) => formatDay(day, numberLocale), [numberLocale]);
  const trendFormatter = chartMeta.hourly_views?.bucket === 'day' ? dayLabel : hourLabel;
  const revenueFormatter = chartMeta.revenue?.bucket === 'day' ? dayLabel : hourLabel;

  const trendData = useMemo<Datum[]>(
    () => (charts.hourly_views ?? []).map(row => ({
      key: row.hour,
      label: trendFormatter(row.hour),
      values: [Number(row.page_views), Number(row.users)],
    })),
    [charts.hourly_views, trendFormatter],
  );

  const sessionData = useMemo<Datum[]>(
    () => (charts.daily_sessions ?? []).map(row => ({
      key: row.day,
      label: dayLabel(row.day),
      values: [Number(row.sessions), Number(row.users)],
    })),
    [charts.daily_sessions, dayLabel],
  );

  const categoryData = useMemo<Datum[]>(
    () => (charts.category_views ?? []).map(row => ({
      key: row.category,
      label: row.category,
      values: [Number(row.views)],
    })),
    [charts.category_views],
  );

  const eventData = useMemo<Datum[]>(
    () => (charts.event_breakdown ?? []).map(row => ({
      key: row.event_name,
      label: row.event_name,
      values: [Number(row.cnt)],
    })),
    [charts.event_breakdown],
  );

  // Series colours are the same hexes the recharts version passed inline, so
  // the fallback and the canvas render identically.
  const trendSeries = useMemo<SeriesSpec[]>(() => [
    { name: a('series.pageViews'), color: CHART_COLORS.primary },
    { name: a('series.users'),     color: CHART_COLORS.secondaryLine },
  ], [a]);

  const sessionSeries = useMemo<SeriesSpec[]>(() => [
    { name: a('series.sessions'), color: CHART_COLORS.primary },
    { name: a('series.users'),    color: CHART_COLORS.secondaryBar },
  ], [a]);

  const categorySeries = useMemo<SeriesSpec[]>(() => [
    { name: a('series.views'), color: CHART_COLORS.primary },
  ], [a]);

  const trendTitle    = a('title.pageViews', { range: labelFor('hourly_views') });
  const sessionTitle  = a('title.sessions',  { range: labelFor('daily_sessions') });
  const eventTitle    = a('title.eventTypes');
  const categoryTitle = a('title.categories');

  /** The one-line description a screen reader hears before the data table. */
  const summaryFor = (title: string, points: number, series: SeriesSpec[]) =>
    a('a11y.summary', { title, n: points, series: series.map(s => s.name).join(', ') });

  const page = (
    <div className={`relative min-h-screen bg-ch-900 text-white ${stage ? 'text-[17px]' : ''}`}>
      {/* Atmosphere: a dot field fading out below the header, plus an aurora on stage. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
        <DotPattern className="[mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_30%,transparent_100%)]" />
        <div className="absolute left-1/2 top-[-180px] h-[360px] w-[720px] -translate-x-1/2 rounded-full bg-brand-400/10 blur-[120px]" />
      </div>
      {stage && (
        <div aria-hidden className="pointer-events-none fixed inset-0 opacity-40">
          <Aurora />
        </div>
      )}

      {/* Header */}
      <div className={`relative z-20 border-b border-ch-700 bg-ch-900/80 backdrop-blur-md ${stage ? 'sticky top-0' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
              <h1 className={`${stage ? 'text-3xl' : 'text-xl'} font-bold text-white`}>Analytics</h1>
              <span className="text-xs bg-ch-700 text-gray-300 px-2 py-0.5 rounded-full">retail-demo</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {a('page.subtitle', { time: timeOf(lastRefresh) })}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
              {kpis?.dataset_rows != null && (
                <span>
                  {fillTemplate(a('header.dataset'), {
                    rows: (
                      <span className="numeric font-semibold text-brand-400">
                        <NumberFlow animated={false} value={kpis.dataset_rows} locales={numberLocale} format={{ notation: 'compact', maximumFractionDigits: 1 }} />
                      </span>
                    ),
                  })}
                </span>
              )}
              <span title={receiptFormats.rows(rowsRead)}>
                <span className="numeric font-semibold text-white">
                  <NumberFlow animated={false} value={rowsRead} locales={numberLocale} format={{ notation: 'compact', maximumFractionDigits: 1 }} />
                </span>{' '}
                {a('session.read')}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Range selector — bounds the window every non-"today" tile queries */}
            <div className="flex rounded-lg overflow-hidden border border-ch-700">
              {RANGE_TOKENS.map(token => (
                <button
                  key={token}
                  onClick={() => setRange(token)}
                  className={`text-xs px-2.5 py-1.5 font-semibold transition-colors ${
                    range === token
                      ? 'bg-brand-400 text-ch-900'
                      : 'bg-ch-800 text-gray-400 hover:text-white hover:bg-ch-700'
                  }`}
                >
                  {token}
                </button>
              ))}
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="text-xs bg-brand-400 hover:bg-brand-500 text-ch-900 font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isRefreshing ? a('header.refreshing') : a('header.refresh')}
            </button>
            <button
              onClick={toggleStage}
              aria-pressed={stage}
              className="text-xs border border-ch-600 text-gray-200 hover:border-brand-400 hover:text-brand-400 font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              {stage ? a('header.exitStage') : a('header.stage')}
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {isInitialLoad ? (
          <div className="flex justify-center py-32">
            <div className="w-10 h-10 border-4 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {noTrafficToday && (
              <div className="flex flex-col gap-3 rounded-xl border border-brand-400/30 bg-brand-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-brand-400">{a('emptyToday.title')}</p>
                  <p className="mt-0.5 text-sm text-gray-400">{a('emptyToday.body')}</p>
                </div>
                {range === '24h' && (
                  <button
                    onClick={() => setRange('7d')}
                    className="shrink-0 rounded-lg bg-brand-400 px-3 py-1.5 text-xs font-semibold text-ch-900 hover:bg-brand-500"
                  >
                    {a('emptyToday.cta')}
                  </button>
                )}
              </div>
            )}

            {/* Row 1: KPI cards — arrive from /kpis (2 queries, ~100ms) */}
            {kpis && (
              <BlurFade>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="col-span-2 lg:col-span-1">
                    <StatCard label={a('kpi.active')} value={Number(kpis.active_users)} sub={a('kpi.activeSub')} highlight locale={numberLocale} />
                  </div>
                  <StatCard label={a('kpi.pageViews')} value={Number(kpis.today.page_views)}   sub={a('kpi.today')} locale={numberLocale} />
                  <StatCard label={a('kpi.sessions')}  value={Number(kpis.today.sessions)}     sub={a('kpi.today')} locale={numberLocale} />
                  <StatCard label={a('kpi.users')}     value={Number(kpis.today.unique_users)} sub={a('kpi.today')} locale={numberLocale} />
                  <StatCard label={a('kpi.events')}    value={Number(kpis.today.total_events)} sub={a('kpi.today')} locale={numberLocale} />
                </div>
              </BlurFade>
            )}

            {/* Live layer: the shop's own telemetry, where people are, what they do */}
            <BlurFade delay={0.05}>
              <Section title={a('title.pipeline')} pulse>
                <Pipeline pulses={pulses} rates={rates} unavailable={telemetryDown} />
              </Section>
            </BlurFade>

            <div className="grid gap-6 lg:grid-cols-5">
              <BlurFade className="h-full lg:col-span-3">
                <Section title={a('title.storeMap')} pulse receipt={receipts.map}>
                  <StoreMap visitors={mapVisitors} selfId={selfId} />
                </Section>
              </BlurFade>
              <BlurFade className="h-full lg:col-span-2" delay={0.05}>
                <Section title={a('title.feed')} pulse receipt={receipts.feed}>
                  <LiveFeed events={feed} selfId={selfId} now={now} max={stage ? 8 : 7} />
                  {freshness && (
                    <p className="numeric mt-3 text-[11px] text-gray-500">
                      {a('feed.freshness', {
                        s: (Number(freshness.since_last_ms) / 1000).toFixed(1),
                        p50: receiptFormats.ms(Number(freshness.latency_ms?.[0] ?? 0)),
                      })}
                    </p>
                  )}
                </Section>
              </BlurFade>
            </div>

            {/* Row 2: Live visitors */}
            <Section title={a('title.visitors')} pulse receipt={receipts.live}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500">
                  {visitors.length === 0
                    ? a('visitors.none')
                    : a('visitors.count', { n: visitors.length })}
                </p>
                <span className="text-xs text-gray-600">{a('visitors.asOf', { time: timeOf(liveTs) })}</span>
              </div>
              {visitors.length === 0 ? (
                <div className="text-center py-6 text-gray-600 text-sm">
                  {a('visitors.waiting')}
                </div>
              ) : (
                // Capped height: with the generator on there are dozens of rows,
                // which pushed everything below off the projector.
                <div className="max-h-[22rem] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-ch-800">
                      <tr className="text-xs text-gray-500 border-b border-ch-700">
                        <th className="text-left pb-2 font-medium">{a('col.visitor')}</th>
                        <th className="text-left pb-2 font-medium">{a('col.currentPage')}</th>
                        <th className="text-left pb-2 font-medium hidden sm:table-cell">{a('col.pageTitle')}</th>
                        <th className="text-right pb-2 font-medium">{a('col.events')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitorsYouFirst.map(v => {
                        const isYou = !!selfId && v.domain_userid === selfId;
                        return (
                          <tr
                            key={v.domain_userid}
                            className={`border-b border-ch-700/40 transition-colors ${isYou ? 'bg-brand-400/10' : 'hover:bg-ch-700/20'}`}
                          >
                            <td className="py-2 pr-4">
                              <span className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                                <span className="font-mono text-xs text-gray-400">{shortUid(v.domain_userid)}…</span>
                                {isYou && (
                                  <span className="rounded bg-brand-400 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-ch-900">{a('you')}</span>
                                )}
                              </span>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="text-brand-400 font-medium truncate max-w-[200px] block">
                                {pageLabel(v.current_page)}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-gray-400 truncate max-w-[180px] hidden sm:table-cell">{v.page_title || '-'}</td>
                            <td className="py-2 text-right">
                              <span className="text-xs bg-ch-700 text-gray-300 px-1.5 py-0.5 rounded">
                                {v.events_in_window}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Business layer: where sessions drop off, and what they bought */}
            <div className="grid gap-6 lg:grid-cols-5">
              <BlurFade className="h-full lg:col-span-3">
                <Section title={a('title.funnel', { range: labelFor('funnel') })} receipt={receipts.funnel}>
                  {isChartLoading('funnel') ? <ChartSkeleton /> : <Funnel rows={charts.funnel ?? []} />}
                </Section>
              </BlurFade>
              <BlurFade className="h-full lg:col-span-2" delay={0.05}>
                <Section title={a('title.revenue', { range: labelFor('revenue') })} receipt={receipts.revenue}>
                  {isChartLoading('revenue') ? <ChartSkeleton /> : (
                    <Revenue
                      rows={charts.revenue ?? []}
                      bucketLabel={revenueFormatter}
                      labelHeader={chartMeta.revenue?.bucket === 'day' ? a('axis.day') : a('axis.time')}
                      fallback={
                        <ResponsiveContainer width="100%" height={130}>
                          <LineChart data={charts.revenue}>
                            <XAxis dataKey="bucket" tickFormatter={revenueFormatter} tick={{ fill: '#9E9E9E', fontSize: 10 }} interval="preserveStartEnd" />
                            <Tooltip
                              contentStyle={{ background: '#1A1A1A', border: '1px solid #424242', borderRadius: 8 }}
                              labelStyle={{ color: '#E0E0E0' }}
                              labelFormatter={revenueFormatter}
                            />
                            <Line type="monotone" dataKey="gmv" stroke={CH_YELLOW} strokeWidth={2} dot={false} name={a('series.gmv')} />
                          </LineChart>
                        </ResponsiveContainer>
                      }
                    />
                  )}
                </Section>
              </BlurFade>
            </div>

            {/* Checkout reality: which payment rails work, and where buyers come from */}
            <div className="grid gap-6 lg:grid-cols-5">
              <BlurFade className="h-full lg:col-span-3">
                <Section title={a('title.payments', { range: labelFor('payments') })} receipt={receipts.payments}>
                  {isChartLoading('payments') ? <ChartSkeleton height={160} /> : <Payments rows={charts.payments ?? []} />}
                </Section>
              </BlurFade>
              <BlurFade className="h-full lg:col-span-2" delay={0.05}>
                <Section title={a('title.sources', { range: labelFor('sources') })} receipt={receipts.sources}>
                  {isChartLoading('sources') ? <ChartSkeleton height={160} /> : <Sources rows={charts.sources ?? []} />}
                </Section>
              </BlurFade>
            </div>

            {/* Behaviour: how people move, and how far they read */}
            <div className="grid gap-6 lg:grid-cols-5">
              <BlurFade className="h-full lg:col-span-3">
                <Section title={a('title.flows', { range: labelFor('flows') })} receipt={receipts.flows}>
                  {isChartLoading('flows') ? <ChartSkeleton /> : <Flows rows={charts.flows ?? []} />}
                </Section>
              </BlurFade>
              <BlurFade className="h-full lg:col-span-2" delay={0.05}>
                <Section title={a('title.scroll', { range: labelFor('scroll_depth') })} receipt={receipts.scroll_depth}>
                  {isChartLoading('scroll_depth') ? <ChartSkeleton /> : <ScrollDepth rows={charts.scroll_depth ?? []} />}
                </Section>
              </BlurFade>
            </div>

            {/* Row 3: Hourly views + daily sessions — independent fetches */}
            <div className="grid md:grid-cols-2 gap-6">
              <Section title={trendTitle} receipt={receipts.hourly_views}>
                {isChartLoading('hourly_views') ? <ChartSkeleton /> :
                 !trendData.length ? (
                  <p className="text-gray-500 text-sm py-8 text-center">{a('empty.trend')}</p>
                ) : (
                  <TrendChart
                    data={trendData}
                    series={trendSeries}
                    height={220}
                    labelHeader={chartMeta.hourly_views?.bucket === 'day' ? a('axis.day') : a('axis.time')}
                    summary={summaryFor(trendTitle, trendData.length, trendSeries)}
                    tableCaption={a('a11y.tableCaption', { title: trendTitle })}
                    formats={formats}
                    fallback={
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={charts.hourly_views}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2C" />
                          <XAxis dataKey="hour" tickFormatter={trendFormatter} tick={{ fill: '#9E9E9E', fontSize: 10 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fill: '#9E9E9E', fontSize: 10 }} />
                          <Tooltip
                            contentStyle={{ background: '#1A1A1A', border: '1px solid #424242', borderRadius: 8 }}
                            labelStyle={{ color: '#E0E0E0' }}
                            labelFormatter={trendFormatter}
                          />
                          <Line type="monotone" dataKey="page_views" stroke={CH_YELLOW} strokeWidth={2} dot={false} name={trendSeries[0].name} />
                          <Line type="monotone" dataKey="users" stroke={CHART_COLORS.secondaryLine} strokeWidth={1.5} dot={false} name={trendSeries[1].name} strokeDasharray="4 2" />
                        </LineChart>
                      </ResponsiveContainer>
                    }
                  />
                )}
              </Section>

              <Section title={sessionTitle} receipt={receipts.daily_sessions}>
                {isChartLoading('daily_sessions') ? <ChartSkeleton /> :
                 !sessionData.length ? (
                  <p className="text-gray-500 text-sm py-8 text-center">{a('empty.trend')}</p>
                ) : (
                  <BarSeriesChart
                    data={sessionData}
                    series={sessionSeries}
                    height={220}
                    labelHeader={a('axis.day')}
                    summary={summaryFor(sessionTitle, sessionData.length, sessionSeries)}
                    tableCaption={a('a11y.tableCaption', { title: sessionTitle })}
                    formats={formats}
                    fallback={
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={charts.daily_sessions}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2C" />
                          <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: '#9E9E9E', fontSize: 10 }} />
                          <YAxis tick={{ fill: '#9E9E9E', fontSize: 10 }} />
                          <Tooltip
                            contentStyle={{ background: '#1A1A1A', border: '1px solid #424242', borderRadius: 8 }}
                            labelStyle={{ color: '#E0E0E0' }}
                            labelFormatter={dayLabel}
                          />
                          <Bar dataKey="sessions" fill={CH_YELLOW} radius={[4, 4, 0, 0]} name={sessionSeries[0].name} />
                          <Bar dataKey="users" fill={CHART_COLORS.secondaryBar} radius={[4, 4, 0, 0]} name={sessionSeries[1].name} />
                        </BarChart>
                      </ResponsiveContainer>
                    }
                  />
                )}
              </Section>
            </div>

            {/* Clients and dead ends: what people browse on, what they could not find */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Section title={a('title.platforms', { range: labelFor('platforms') })} receipt={receipts.platforms}>
                {isChartLoading('platforms') ? <ChartSkeleton height={200} /> : <Platforms rows={charts.platforms ?? []} />}
              </Section>
              <Section title={a('title.zeroSearches', { range: labelFor('zero_searches') })} receipt={receipts.zero_searches}>
                {isChartLoading('zero_searches') ? <ChartSkeleton height={200} /> : <ZeroSearches rows={charts.zero_searches ?? []} />}
              </Section>
              <Section title={a('title.devices', { range: labelFor('devices') })} receipt={receipts.devices}>
                {isChartLoading('devices') ? <ChartSkeleton height={200} /> : <Devices rows={charts.devices ?? []} />}
              </Section>
            </div>

            {/* Row 4: Event breakdown + category interest — independent fetches */}
            <div className="grid md:grid-cols-2 gap-6">
              <Section title={eventTitle} receipt={receipts.event_breakdown}>
                {isChartLoading('event_breakdown') ? <ChartSkeleton height={200} /> :
                 !eventData.length ? (
                  <p className="text-gray-500 text-sm py-8 text-center">{a('empty.events')}</p>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="sm:w-1/2 shrink-0">
                      <ShareChart
                        data={eventData}
                        height={200}
                        labelHeader={a('axis.eventType')}
                        valueHeader={a('col.count')}
                        shareHeader={a('col.share')}
                        summary={a('a11y.summary', {
                          title: eventTitle,
                          n: eventData.length,
                          series: a('col.count'),
                        })}
                        tableCaption={a('a11y.tableCaption', { title: eventTitle })}
                        formats={formats}
                        fallback={
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie data={charts.event_breakdown} dataKey="cnt" nameKey="event_name" cx="50%" cy="50%" outerRadius={80} strokeWidth={0}>
                                {(charts.event_breakdown ?? []).map((_, i) => (
                                  <Cell key={i} fill={CH_COLORS[i % CH_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ background: '#1A1A1A', border: '1px solid #424242', borderRadius: 8 }}
                                itemStyle={{ color: '#E0E0E0' }}
                                formatter={(v: number, name: string) => [
                                  `${formats.full(v)} (${formats.percent(totalEvents > 0 ? v / totalEvents : 0)})`,
                                  name,
                                ]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        }
                      />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {/* Same array, same ramp, same index as the slices — so a
                          swatch always names the wedge beside it. */}
                      {eventData.map((e, i) => (
                        <div key={e.key} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CH_COLORS[i % CH_COLORS.length] }} />
                            <span className="text-gray-300 truncate max-w-[160px]">{e.label}</span>
                          </div>
                          <span className="numeric text-white font-semibold">{formats.full(e.values[0])}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              <Section title={categoryTitle} receipt={receipts.category_views}>
                {isChartLoading('category_views') ? <ChartSkeleton height={200} /> :
                 !categoryData.length ? (
                  <p className="text-gray-500 text-sm py-8 text-center">{a('empty.categories')}</p>
                ) : (
                  <BarSeriesChart
                    data={categoryData}
                    series={categorySeries}
                    orientation="horizontal"
                    height={200}
                    labelHeader={a('axis.category')}
                    summary={summaryFor(categoryTitle, categoryData.length, categorySeries)}
                    tableCaption={a('a11y.tableCaption', { title: categoryTitle })}
                    formats={formats}
                    fallback={
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={charts.category_views} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2C" horizontal={false} />
                          <XAxis type="number" tick={{ fill: '#9E9E9E', fontSize: 10 }} />
                          <YAxis type="category" dataKey="category" tick={{ fill: '#9E9E9E', fontSize: 11 }} width={110} />
                          <Tooltip
                            contentStyle={{ background: '#1A1A1A', border: '1px solid #424242', borderRadius: 8 }}
                            labelStyle={{ color: '#E0E0E0' }}
                          />
                          <Bar dataKey="views" fill={CH_YELLOW} radius={[0, 4, 4, 0]} name={categorySeries[0].name} />
                        </BarChart>
                      </ResponsiveContainer>
                    }
                  />
                )}
              </Section>
            </div>

            {/* Row 5: Top pages + top searches — independent fetches */}
            <div className="grid md:grid-cols-2 gap-6">
              <Section title={a('title.topPages')} receipt={receipts.top_pages}>
                {isChartLoading('top_pages') ? <ChartSkeleton height={160} /> :
                 !charts.top_pages?.length ? (
                  <p className="text-gray-500 text-sm py-4 text-center">{a('empty.topPages')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-ch-700">
                        <th className="text-left pb-2 font-medium">{a('col.page')}</th>
                        <th className="text-right pb-2 font-medium">{a('col.views')}</th>
                        <th className="text-right pb-2 font-medium">{a('col.users')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charts.top_pages.map((p, i) => (
                        <tr key={i} className="border-b border-ch-700/50 hover:bg-ch-700/30 transition-colors">
                          <td className="py-2 text-gray-300 truncate max-w-[200px]">{p.page_urlpath || '/'}</td>
                          <td className="py-2 text-right text-white font-semibold">{formats.full(Number(p.views))}</td>
                          <td className="py-2 text-right text-gray-400">{formats.full(Number(p.unique_users))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title={a('title.topSearches', { range: labelFor('top_searches') })} receipt={receipts.top_searches}>
                {isChartLoading('top_searches') ? <ChartSkeleton height={160} /> :
                 !charts.top_searches?.length ? (
                  <p className="text-gray-500 text-sm py-4 text-center">{a('empty.searches')}</p>
                ) : (
                  <>
                    <Marquee className="-mx-1 mb-4" duration={35}>
                      {charts.top_searches.map(s => (
                        <span key={`${s.type}:${s.query}`} className="whitespace-nowrap rounded-full border border-ch-600 bg-ch-900 px-3 py-1 text-xs text-gray-300">
                          {s.query} <span className="numeric text-brand-400">{formats.axis(Number(s.searches))}</span>
                        </span>
                      ))}
                    </Marquee>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-ch-700">
                          <th className="text-left pb-2 font-medium">{a('col.query')}</th>
                          <th className="text-left pb-2 font-medium">{a('col.type')}</th>
                          <th className="text-right pb-2 font-medium">{a('col.count')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charts.top_searches.map((s, i) => (
                          <tr key={i} className="border-b border-ch-700/50 hover:bg-ch-700/30 transition-colors">
                            <td className="py-2 text-gray-300">{s.query}</td>
                            <td className="py-2">
                              <span className="text-xs bg-ch-700 text-gray-400 px-1.5 py-0.5 rounded">{s.type || 'text'}</span>
                            </td>
                            <td className="py-2 text-right text-white font-semibold">{formats.full(Number(s.searches))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </Section>
            </div>

            <div className="flex items-center justify-center gap-3 py-4 text-xs text-gray-600">
              <span>{a('footer.poweredBy')}</span>
              <span className="text-brand-400 font-bold">ClickHouse</span>
              <span>·</span>
              <span>{a('footer.snowplow')}</span>
            </div>
          </>
        )}
      </div>

    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {stage ? (
        // Above the storefront's own sticky header (z-50), which stays mounted.
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-ch-900">{page}</div>
      ) : page}
    </MotionConfig>
  );
}
