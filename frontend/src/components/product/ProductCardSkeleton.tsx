'use client';
import { useI18n } from '@/i18n/LocaleProvider';

/**
 * Grid placeholder matching ProductCard's geometry.
 *
 * Every grid used to show a single centred spinner while it loaded, so the
 * layout collapsed to nothing and then snapped back. These hold the shape.
 */
export function ProductCardSkeleton() {
  return (
    <div className="card flex flex-col" aria-hidden="true">
      <div className="skeleton aspect-square" />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="skeleton h-2.5 w-1/3 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-4/5 rounded" />
        <div className="skeleton mt-1 h-5 w-1/2 rounded" />
        <div className="skeleton mt-1.5 h-8 w-full rounded-lg" />
      </div>
    </div>
  );
}
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      role="status"
      aria-label={t('a11y.loadingProducts')}
    >
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
