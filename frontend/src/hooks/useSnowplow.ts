'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackView, trackScrollDepth, trackEvent } from '@/lib/snowplow';

export function useSnowplow(): void {
  const pathname = usePathname();
  const scrollFired = useRef<Set<number>>(new Set());

  // Page view on route change
  useEffect(() => {
    trackView();
    // Reset scroll milestones for the new page
    scrollFired.current = new Set();
  }, [pathname]);

  // Scroll depth tracking — fires once per 25 / 50 / 75 / 90 % threshold
  useEffect(() => {
    const milestones = [25, 50, 75, 90];

    function onScroll() {
      const el          = document.documentElement;
      const scrolled    = el.scrollTop + window.innerHeight;
      const total       = el.scrollHeight;
      if (total <= window.innerHeight) return; // no scrollable content
      const pct = Math.floor((scrolled / total) * 100);

      for (const m of milestones) {
        if (pct >= m && !scrollFired.current.has(m)) {
          scrollFired.current.add(m);
          trackScrollDepth(m);
        }
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);
}

export { trackEvent };
