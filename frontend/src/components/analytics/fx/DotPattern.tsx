// Adapted from Magic UI's Dot Pattern (MIT, Copyright (c) Magic UI), using a
// single SVG <pattern> rather than one element per dot.

import { useId } from 'react';
import { cn } from './cn';

interface DotPatternProps {
  className?: string;
  spacing?: number;
  radius?: number;
}

export function DotPattern({ className, spacing = 18, radius = 1 }: DotPatternProps) {
  const id = useId();
  return (
    <svg aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full fill-ch-600/50', className)}>
      <defs>
        <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          <circle cx={radius} cy={radius} r={radius} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}
