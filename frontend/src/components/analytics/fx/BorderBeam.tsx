'use client';

// Adapted from Magic UI's Border Beam (MIT, Copyright (c) Magic UI).
// A short gradient travels around the element's border, masked to the border
// box so it never paints over the content.

import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
  reverse?: boolean;
}

export function BorderBeam({
  size = 80,
  duration = 6,
  delay = 0,
  colorFrom = '#FAFF69',
  colorTo = '#EEED00',
  borderWidth = 1.5,
  reverse = false,
}: BorderBeamProps) {
  const reduced = useReducedMotion();
  if (reduced) return null;

  // Two opaque layers, one clipped to the padding box and one to the border
  // box, excluded from each other: only the border ring stays visible.
  const mask: CSSProperties = {
    border: `${borderWidth}px solid transparent`,
    maskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
    maskClip: 'padding-box, border-box',
    maskComposite: 'exclude',
    WebkitMaskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
    WebkitMaskClip: 'padding-box, border-box',
    WebkitMaskComposite: 'xor',
  };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={mask}>
      <motion.div
        className="absolute aspect-square"
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
        }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: reverse ? ['100%', '0%'] : ['0%', '100%'] }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
      />
    </div>
  );
}
