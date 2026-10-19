import type { QueryStats } from '@/lib/analytics-stats';

export type { QueryStats };

/** A tile's receipt: what ClickHouse did to answer it. */
export interface Receipt {
  stats: QueryStats;
  sql?: string;
}

export interface FeedEvent {
  id: string;
  ts: string;
  event_name: string;
  domain_userid: string;
  value: number;
  label: string;
  search_query: string;
  category: string;
  product: string;
}

export interface Freshness {
  latency_ms: [number, number];
  since_last_ms: number | string;
}

export interface LiveVisitor {
  domain_userid: string;
  current_page: string;
  page_title: string;
  last_seen: string;
  events_in_window: number;
}

/** Cumulative counters from the OTel Collector's own /metrics. */
export interface TelemetrySample {
  at: number;
  received: { spans: number; logs: number; metrics: number };
  refused: number;
  exported: { spans: number; logs: number; metrics: number; replays: number };
  failed: number;
}

export type FunnelRow  = { level: number; sessions: number | string };
export type RevenueRow = { bucket: string; gmv: number; orders: number | string };
export type DeviceRow  = { device: string; sessions: number | string };
export type PaymentRow  = { method: string; initiated: number | string; confirmed: number | string; revenue: number };
export type PlatformRow = { os: string; device: string; sessions: number | string };
export type SourceRow   = { source: string; sessions: number | string; orders: number | string };
export type FlowRow     = { source: string; target: string; moves: number | string };
export type ScrollRow   = { zone: string; views: number | string; d25: number | string; d50: number | string; d75: number | string };
export type ZeroSearchRow = { query: string; searches: number | string; zero_total: number | string; total_searches: number | string };
