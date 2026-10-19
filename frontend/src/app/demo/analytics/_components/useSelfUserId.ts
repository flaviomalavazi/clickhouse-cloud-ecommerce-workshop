'use client';

import { useEffect, useState } from 'react';
import { getDomainUserId } from '@/lib/snowplow';

/**
 * This browser's Snowplow `domain_userid`, once the tracker has started.
 * The tracker is created by the first tracked event, which the layout's
 * page-view fires shortly after mount — so poll briefly rather than assume it.
 */
export function useSelfUserId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let tries = 0;
    const tick = () => {
      const v = getDomainUserId();
      if (v) { setId(v); return; }
      if (++tries < 20) timer = setTimeout(tick, 500);
    };
    let timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);
  return id;
}
