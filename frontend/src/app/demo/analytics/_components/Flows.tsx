'use client';

import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import styles from '@/components/analytics/fx/fx.module.css';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { FlowRow } from './types';

// The store laid out left to right in the order a purchase walks it.
const NODES = ['entry', 'home', 'search', 'category', 'product', 'cart', 'checkout', 'paid'] as const;

const W = 800;
const AXIS = 150;
const H = 300;

function xOf(n: string): number | null {
  const i = NODES.indexOf(n as (typeof NODES)[number]);
  return i < 0 ? null : 40 + (i * (W - 80)) / (NODES.length - 1);
}

/**
 * An arc diagram of page-to-page moves. Moves deeper into the store arc above
 * the line, moves back arc below; thickness is volume, and dashes crawl in the
 * direction people went. Cycles (search → home → search) are what a Sankey
 * cannot draw, and they are most of real navigation.
 */
export function Flows({ rows }: { rows: FlowRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  const [hover, setHover] = useState<string | null>(null);
  const fmt = useMemo(() => new Intl.NumberFormat(numberLocale), [numberLocale]);

  const arcs = useMemo(() => {
    const max = Math.max(1, ...rows.map(r => Number(r.moves)));
    return rows.flatMap(r => {
      const x1 = xOf(r.source), x2 = xOf(r.target);
      if (x1 == null || x2 == null) return [];
      const forward = x2 > x1;
      const span = Math.abs(x2 - x1);
      const lift = Math.min(AXIS - 14, 24 + span * 0.32);
      const cy = forward ? AXIS - lift : AXIS + lift;
      const moves = Number(r.moves);
      return [{
        key: `${r.source}>${r.target}`,
        d: `M ${x1} ${AXIS} Q ${(x1 + x2) / 2} ${cy} ${x2} ${AXIS}`,
        width: 1.5 + 9 * Math.sqrt(moves / max),
        forward,
        moves,
        source: r.source,
        target: r.target,
      }];
    });
  }, [rows]);

  if (!arcs.length) return <p className="py-8 text-center text-sm text-gray-500">{a('flows.empty')}</p>;
  const active = arcs.find(x => x.key === hover);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={a('title.flows', { range: '' })}>
        <defs>
          <linearGradient id="flow-fwd" x1="0" x2="1">
            <stop offset="0%" stopColor="#EEED00" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FAFF69" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <line x1={30} x2={W - 30} y1={AXIS} y2={AXIS} stroke="#2C2C2C" strokeWidth={1} />
        {arcs.map((arc, i) => {
          const dim = hover && hover !== arc.key;
          const stroke = arc.forward ? 'url(#flow-fwd)' : '#9E9E9E';
          return (
            <g key={arc.key} onPointerEnter={() => setHover(arc.key)} onPointerLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <motion.path
                d={arc.d}
                fill="none"
                stroke={stroke}
                strokeWidth={arc.width}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: dim ? 0.12 : arc.forward ? 0.55 : 0.3 }}
                transition={{ duration: 1, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              />
              <path
                d={arc.d}
                fill="none"
                stroke={arc.forward ? '#FFFFFF' : '#E0E0E0'}
                strokeOpacity={dim ? 0.05 : 0.6}
                strokeWidth={Math.max(1, arc.width / 3)}
                strokeLinecap="round"
                className={styles.flowDash}
              />
              {/* Wide invisible hit area so thin arcs are hoverable. */}
              <path d={arc.d} fill="none" stroke="transparent" strokeWidth={Math.max(12, arc.width + 6)} />
            </g>
          );
        })}
        {NODES.map(n => {
          const x = xOf(n)!;
          const lit = active && (active.source === n || active.target === n);
          return (
            <g key={n}>
              <circle cx={x} cy={AXIS} r={lit ? 7 : 5} fill={n === 'paid' ? '#FAFF69' : lit ? '#FAFF69' : '#1A1A1A'} stroke="#FAFF69" strokeWidth={1.5} />
              <text x={x} y={H - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 13 }}>
                {a(`zone.${n}` as AnalyticsKey)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 h-4 text-center text-xs text-gray-400">
        {active
          ? `${a(`zone.${active.source}` as AnalyticsKey)} → ${a(`zone.${active.target}` as AnalyticsKey)} · ${fmt.format(active.moves)}`
          : (
            <span className="inline-flex items-center gap-4 text-gray-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-brand-400" />{a('flows.forward')}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-gray-400" />{a('flows.back')}</span>
            </span>
          )}
      </p>
    </div>
  );
}
