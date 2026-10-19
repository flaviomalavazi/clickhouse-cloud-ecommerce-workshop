import { ProductGridSkeleton } from '@/components/product/ProductCardSkeleton';

/**
 * Both category queries run on request (`dynamic = 'force-dynamic'`), so
 * without this the route showed a blank white page until Postgres answered.
 */
export default function CategoryLoading() {
  return (
    <>
      <div className="bg-ch-900">
        <div className="h-[3px] w-full bg-brand-400" />
        <div className="mx-auto max-w-7xl px-4 py-16 md:py-24">
          <div className="h-4 w-32 rounded bg-ch-800" />
          <div className="mt-7 h-12 w-64 rounded bg-ch-800 md:h-16" />
          <div className="mt-5 h-4 w-full max-w-md rounded bg-ch-800" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-14">
        <span className="section-rule" />
        <div className="skeleton mb-7 h-8 w-40 rounded" />
        <ProductGridSkeleton count={4} />
      </div>
    </>
  );
}
