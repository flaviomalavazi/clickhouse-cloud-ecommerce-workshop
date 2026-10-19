'use client';

import { useEffect, useState } from 'react';

/**
 * An integer that counts to its value.
 *
 * The animation is a CSS transition on a registered `<integer>` custom
 * property, printed through `counter()` — see `--tally` in globals.css. That
 * keeps every frame on the compositor: no requestAnimationFrame, no state
 * churn, nothing on the main thread while it runs.
 *
 * The digits live in `::after`, which assistive tech does not reliably read,
 * so the real value ships alongside in a visually hidden span.
 */
export function Tally({
  value,
  className = '',
  suffix,
}: {
  value: number;
  className?: string;
  /** Rendered after the digits, inside the same accessible label. */
  suffix?: string;
}) {
  // First paint starts at 0 so the very first result set counts up too, rather
  // than appearing already settled.
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDisplay(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <span className={className}>
      <span className="tally" style={{ '--tally': display } as React.CSSProperties} aria-hidden="true" />
      {suffix && <span aria-hidden="true">{suffix}</span>}
      <span className="sr-only">{value}{suffix}</span>
    </span>
  );
}
