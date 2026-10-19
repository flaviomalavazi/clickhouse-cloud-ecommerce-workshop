'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { useAnalyticsStrings } from '../strings';
import { makeReceiptFormats } from './format';
import type { Receipt } from './types';

/**
 * The line under a tile that says what ClickHouse did to answer it — rows and
 * bytes read, server time — with the SQL one click away. This is the part of
 * the demo that turns "a dashboard" into "a dashboard on 24M raw events".
 */
export function QueryReceipt({ receipt }: { receipt?: Receipt }) {
  const { a, numberLocale } = useAnalyticsStrings();
  const f = useMemo(() => makeReceiptFormats(numberLocale), [numberLocale]);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!receipt) return null;
  const { stats, sql } = receipt;

  return (
    <div className="mt-4 border-t border-ch-700/60 pt-3">
      <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
        <span className="flex min-w-0 items-center gap-1.5 font-mono">
          <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0 fill-brand-400">
            <path d="M9.5 1 3 9h4l-1 6 6.5-8h-4L9.5 1Z" />
          </svg>
          <span className="truncate">
            {stats.cached
              ? `${a('receipt.cached')} · ${f.ms(stats.ms)}`
              : a('receipt.read', { rows: f.rows(stats.rows), bytes: f.bytes(stats.bytes), ms: f.ms(stats.ms) })}
          </span>
        </span>
        {sql && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-gray-400 ring-1 ring-ch-600 transition-colors hover:bg-ch-700 hover:text-brand-400"
          >
            {open ? a('receipt.hideSql') : a('receipt.sql')}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && sql && (
          <motion.pre
            id={panelId}
            key="sql"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="mt-2 max-h-72 overflow-auto rounded-lg bg-ch-900 p-3 font-mono text-[11px] leading-relaxed text-gray-300 ring-1 ring-ch-700"
          >
            <code>{sql}</code>
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}
