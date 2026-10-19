'use client';

// Adapted from Magic UI's Animated Beam (MIT, Copyright (c) Magic UI).
//
// The upstream beam loops forever. Here a beam is a *pulse*: each id in
// `pulses` sends one bright gradient along the curve, so the light on screen
// corresponds to real events arriving rather than decoration. The faint track
// underneath is always drawn.

import { motion } from 'motion/react';
import { useEffect, useId, useState, type RefObject } from 'react';

interface AnimatedBeamProps {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  /** One entry per pulse to send; a new id starts a new pulse. */
  pulses: number[];
  curvature?: number;
  /** Seconds a pulse takes to cross. */
  duration?: number;
  /** Seconds before each pulse starts — lets chained segments relay it. */
  delay?: number;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
}

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  pulses,
  curvature = 0,
  duration = 1.4,
  delay = 0,
  pathColor = '#9E9E9E',
  pathWidth = 2,
  pathOpacity = 0.18,
  gradientStartColor = '#FAFF69',
  gradientStopColor = '#EEED00',
}: AnimatedBeamProps) {
  const id = useId();
  const [pathD, setPathD] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => {
      const c = containerRef.current, a = fromRef.current, b = toRef.current;
      if (!c || !a || !b) return;
      const rc = c.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      setSize({ width: rc.width, height: rc.height });
      const sx = ra.left - rc.left + ra.width / 2;
      const sy = ra.top - rc.top + ra.height / 2;
      const ex = rb.left - rc.left + rb.width / 2;
      const ey = rb.top - rc.top + rb.height / 2;
      setPathD(`M ${sx},${sy} Q ${(sx + ex) / 2},${sy - curvature} ${ex},${ey}`);
    };
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    update();
    return () => ro.disconnect();
  }, [containerRef, fromRef, toRef, curvature]);

  // Horizontal-ish segments sweep in x; a vertical one (phone layout) in y.
  const vertical = size.height > size.width;

  return (
    <svg
      aria-hidden
      fill="none"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="pointer-events-none absolute left-0 top-0 transform-gpu"
    >
      <path d={pathD} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} strokeLinecap="round" />
      {pulses.map(p => (
        <g key={p}>
          <path d={pathD} strokeWidth={pathWidth + 0.5} stroke={`url(#${id}-${p})`} strokeLinecap="round" />
          <defs>
            <motion.linearGradient
              id={`${id}-${p}`}
              gradientUnits="userSpaceOnUse"
              initial={vertical
                ? { x1: '0%', x2: '0%', y1: '-10%', y2: '0%' }
                : { x1: '-10%', x2: '0%', y1: '0%', y2: '0%' }}
              animate={vertical
                ? { x1: '0%', x2: '0%', y1: '100%', y2: '110%' }
                : { x1: '100%', x2: '110%', y1: '0%', y2: '0%' }}
              transition={{ delay, duration, ease: [0.16, 1, 0.3, 1] }}
            >
              <stop stopColor={gradientStartColor} stopOpacity="0" />
              <stop stopColor={gradientStartColor} />
              <stop offset="32.5%" stopColor={gradientStopColor} />
              <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
            </motion.linearGradient>
          </defs>
        </g>
      ))}
    </svg>
  );
}
