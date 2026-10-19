'use client';

import NumberFlow from '@number-flow/react';
import { useMemo } from 'react';
import { zoneOf, type StoreZone } from '@/lib/analytics-queries';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { LiveVisitor } from './types';

type MapZone = StoreZone | 'elsewhere';
const ZONES: MapZone[] = ['home', 'search', 'category', 'product', 'cart', 'checkout', 'paid', 'elsewhere'];

/** Dots shown per zone before collapsing into "+N". */
const MAX_DOTS = 36;

/**
 * Every visitor seen in the last minute is a dot in the area of the store
 * they are in now. A dot keeps its identity (layoutId = visitor id), so when
 * someone moves from Product to Cart the same dot glides across — the viewer's
 * own dot is labelled, so a phone in the audience can watch itself shop.
 */
export function StoreMap({ visitors, selfId }: { visitors: LiveVisitor[]; selfId: string | null }) {
  const { a, numberLocale } = useAnalyticsStrings();

  const byZone = useMemo(() => {
    const map = new Map<MapZone, LiveVisitor[]>(ZONES.map(z => [z, []]));
    for (const v of visitors) map.get(zoneOf(v.current_page) ?? 'elsewhere')!.push(v);
    // Self first so it is never the one folded into "+N".
    map.forEach(list => list.sort((x, y) => Number(y.domain_userid === selfId) - Number(x.domain_userid === selfId)));
    return map;
  }, [visitors, selfId]);

  if (visitors.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-500">{a('storeMap.empty')}</p>;
  }

  return (
    <>
      <ol className="grid flex-1 auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-4">
        {ZONES.map((zone, i) => {
          const list = byZone.get(zone)!;
          const shown = list.slice(0, MAX_DOTS);
          const hasSelf = list.some(v => v.domain_userid === selfId);
          return (
            <li
              key={zone}
              className={`relative min-h-[96px] rounded-xl p-3 ring-1 transition-colors ${
                hasSelf ? 'bg-brand-400/10 ring-brand-400/60' : list.length ? 'bg-ch-900/70 ring-ch-600' : 'bg-ch-900/40 ring-ch-700'
              } ${zone === 'paid' && list.length ? 'shadow-[0_0_30px_-10px_rgba(250,255,105,0.6)]' : ''}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-gray-400">
                  {zone !== 'elsewhere' && <span className="numeric text-[10px] text-gray-600">{i + 1}</span>}
                  {a(`zone.${zone}` as AnalyticsKey)}
                </span>
                <span className="tabular-nums font-semibold text-white"><NumberFlow animated={false} value={list.length} locales={numberLocale} /></span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                  {shown.map(v => {
                    const isYou = v.domain_userid === selfId;
                    return (
                      <span
                        key={v.domain_userid}
                        title={v.current_page}
                        className={isYou
                          ? 'relative flex items-center gap-1 rounded-full bg-brand-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ch-900'
                          : 'h-2.5 w-2.5 rounded-full bg-brand-400/80 shadow-[0_0_8px_rgba(250,255,105,0.6)]'}
                      >
                        {isYou && (
                          <>
                            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand-400/50" />
                            <span className="relative">{a('you')}</span>
                          </>
                        )}
                      </span>
                    );
                  })}
                {list.length > MAX_DOTS && (
                  <span className="text-[10px] text-gray-500">{a('storeMap.more', { n: list.length - MAX_DOTS })}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
