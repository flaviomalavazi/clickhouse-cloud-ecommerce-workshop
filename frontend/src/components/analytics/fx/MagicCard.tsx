'use client';

// Adapted from Magic UI's Magic Card (MIT, Copyright (c) Magic UI), gradient
// mode only: a soft spotlight follows the pointer across the card and lights
// the border under it. Theme detection is dropped — this page is always dark.

import { motion, useMotionTemplate, useMotionValue } from 'motion/react';
import { useCallback, type PointerEvent, type ReactNode } from 'react';
import { cn } from './cn';

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  gradientSize?: number;
  /** Fill of the spotlight inside the card. */
  gradientColor?: string;
  /** Colour the border takes under the pointer. */
  borderColor?: string;
}

export function MagicCard({
  children,
  className,
  gradientSize = 260,
  gradientColor = 'rgba(250, 255, 105, 0.06)',
  borderColor = 'rgba(250, 255, 105, 0.55)',
}: MagicCardProps) {
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }, [mouseX, mouseY]);

  const onLeave = useCallback(() => {
    mouseX.set(-gradientSize);
    mouseY.set(-gradientSize);
  }, [mouseX, mouseY, gradientSize]);

  const border = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${borderColor}, #2C2C2C 100%)`;
  const glow = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)`;

  return (
    <div
      className={cn('group relative isolate rounded-xl', className)}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {/* The 1px ring is the gradient showing through the gap around the fill. */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: border }} />
      <div aria-hidden className="pointer-events-none absolute inset-px rounded-[inherit] bg-ch-800" />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-px rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: glow }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
