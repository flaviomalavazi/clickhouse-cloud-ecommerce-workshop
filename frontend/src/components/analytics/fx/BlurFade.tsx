'use client';

// Adapted from Magic UI's Blur Fade (MIT, Copyright (c) Magic UI): a block
// rises a few pixels out of a blur the first time it scrolls into view.

import { motion, useInView } from 'motion/react';
import { useRef, type ReactNode } from 'react';

interface BlurFadeProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  offset?: number;
}

export function BlurFade({ children, className, delay = 0, duration = 0.5, offset = 10 }: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: offset, filter: 'blur(6px)' }}
      // `filter: none` once settled: a lingering blur(0px) still creates a
      // containing block, which would trap fixed-position chart tooltips.
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } } : undefined}
      transition={{ delay: 0.04 + delay, duration, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
