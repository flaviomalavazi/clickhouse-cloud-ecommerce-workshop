import type { ReactNode } from 'react';

/**
 * The one empty/zero-result treatment.
 *
 * Each surface used to draw its own full-width dashed box, which at 1440px is a
 * 1400px rectangle containing two centred lines — it reads as a container that
 * failed to load rather than as an answer. This is a narrow centred column with
 * no box at all.
 */
interface Props {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}
export function EmptyState({ title, hint, action, className = '' }: Props) {
  return (
    <div className={`mx-auto max-w-md px-4 py-20 text-center ${className}`}>
      <span className="section-rule mx-auto" aria-hidden="true" />
      <p className="text-xl font-bold tracking-tight text-ink-900">{title}</p>
      {hint && <p className="mt-2 text-sm leading-relaxed text-ink-500">{hint}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
