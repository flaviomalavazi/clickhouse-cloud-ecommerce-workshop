'use client';

import { useI18n } from '@/i18n/LocaleProvider';
import { formatMoney } from '@/i18n/config';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import { parseUtc } from './format';
import { fillTemplate } from './template';
import type { FeedEvent } from './types';

const KNOWN = new Set([
  'product_click', 'cart_add_to_cart', 'checkout_start',
  'checkout_payment_confirmed', 'search_text_search',
]);

/** One glyph per kind of event, so the stream scans by shape before text. */
function EventIcon({ name }: { name: string }) {
  const common = 'h-4 w-4 fill-none stroke-current';
  switch (name) {
    case 'checkout_payment_confirmed':
      return <svg viewBox="0 0 24 24" className={`${common} text-ch-900`} strokeWidth={2.4}><path d="m5 12 5 5 9-10" /></svg>;
    case 'cart_add_to_cart':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth={1.8}><path d="M3 4h2l2.4 11h10.2L20 8H7" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></svg>;
    case 'checkout_start':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth={1.8}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
    case 'search_text_search':
      return <svg viewBox="0 0 24 24" className={common} strokeWidth={1.8}><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>;
    default:
      return <svg viewBox="0 0 24 24" className={common} strokeWidth={1.8}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  }
}

interface LiveFeedProps {
  events: FeedEvent[];
  selfId: string | null;
  /** Wall clock for the "Ns ago" labels, advanced by the poll. */
  now: number;
  max?: number;
}

export function LiveFeed({ events, selfId, now, max = 7 }: LiveFeedProps) {
  const { a } = useAnalyticsStrings();
  const { locale } = useI18n();
  const shown = events.filter(e => KNOWN.has(e.event_name)).slice(0, max);

  if (shown.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <span aria-hidden className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400/60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-400" />
        </span>
        {a('feed.empty')}
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-live="polite" aria-relevant="additions">
        {shown.map(e => {
          const isYou = !!selfId && e.domain_userid === selfId;
          const paid = e.event_name === 'checkout_payment_confirmed';
          const who = isYou
            ? <span className="rounded bg-brand-400 px-1.5 py-px font-semibold text-ch-900">{a('feed.youActor')}</span>
            : <span className="text-gray-300">{a('feed.someone')}</span>;
          const product = <span className="font-semibold text-white">{e.product || a('feed.aProduct')}</span>;
          const value = <span className="font-semibold text-brand-400">{formatMoney(e.value, locale)}</span>;
          const query = <span className="font-semibold text-white">{e.search_query}</span>;
          const ago = Math.max(0, Math.round((now - parseUtc(e.ts)) / 1000));

          return (
            <li
              key={e.id}
              className={`flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 ${
                isYou ? 'bg-brand-400/10 ring-brand-400/50' : paid ? 'bg-ch-900/70 ring-brand-400/25' : 'bg-ch-900/60 ring-ch-700'
              }`}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                paid ? 'bg-brand-400' : 'bg-ch-800 text-brand-400 ring-1 ring-ch-600'
              }`}>
                <EventIcon name={e.event_name} />
              </span>
              <span className="min-w-0 flex-1 leading-snug text-gray-400">
                {fillTemplate(a(`feed.${e.event_name}` as AnalyticsKey), { who, product, value, query })}
              </span>
              <span className="numeric shrink-0 pt-0.5 text-[11px] text-gray-600">{a('feed.ago', { s: ago })}</span>
            </li>
          );
        })}
    </ul>
  );
}
