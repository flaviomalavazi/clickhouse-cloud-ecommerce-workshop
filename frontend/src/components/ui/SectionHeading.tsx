import type { ReactNode } from 'react';

/**
 * The single section header used across the storefront. The three grids
 * (recommendations, best deals, all products) each rolled their own before, so
 * the same rank of heading appeared at three different weights and spacings.
 *
 * A short yellow slab sits above the title. It is the brand mark inside the
 * type hierarchy — deliberately not a text eyebrow, which would just repeat
 * what the heading already says.
 */
interface Props {
  title: string;
  /** Right-aligned metadata: a count, a range, a link. */
  aside?: ReactNode;
  className?: string;
}
export function SectionHeading({ title, aside, className = '' }: Props) {
  return (
    <div className={`mb-7 flex items-end justify-between gap-4 ${className}`}>
      <div>
        <span className="section-rule" aria-hidden="true" />
        <h2 className="text-display-sm text-ink-900">{title}</h2>
      </div>
      {aside && <div className="hidden shrink-0 pb-1 text-sm text-ink-500 sm:block">{aside}</div>}
    </div>
  );
}
