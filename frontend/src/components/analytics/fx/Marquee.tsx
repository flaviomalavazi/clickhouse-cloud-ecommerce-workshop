// Adapted from Magic UI's Marquee (MIT, Copyright (c) Magic UI). The content is
// repeated so the loop has no seam; keyframes live in fx.module.css.

import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';
import styles from './fx.module.css';

interface MarqueeProps {
  children: ReactNode;
  className?: string;
  /** Seconds for one full loop. */
  duration?: number;
  gap?: string;
  repeat?: number;
  pauseOnHover?: boolean;
}

export function Marquee({
  children,
  className,
  duration = 40,
  gap = '0.75rem',
  repeat = 4,
  pauseOnHover = true,
}: MarqueeProps) {
  const vars = { '--duration': `${duration}s`, '--gap': gap, gap } as CSSProperties;
  return (
    <div
      className={cn('flex overflow-hidden', styles.marquee, className)}
      style={{
        ...vars,
        WebkitMaskImage: 'linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)',
        maskImage: 'linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)',
      }}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0}
          className={cn('flex shrink-0 justify-around', styles.marqueeTrack, pauseOnHover && styles.pauseOnHover)}
          style={{ gap }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
