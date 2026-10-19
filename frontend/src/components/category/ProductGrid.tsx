'use client';
import { useState } from 'react';
import { ProductCard } from '@/components/product/ProductCard';
import { ProductGridSkeleton } from '@/components/product/ProductCardSkeleton';
import { PRODUCT_GRID, REVEAL } from '@/components/product/productGrid';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/EmptyState';
import { useI18n } from '@/i18n/LocaleProvider';
import type { Product } from '@/types/product';

interface Props {
  initialProducts: Product[];
  total: number;
  categorySlug: string;
  pageSize: number;
}

/**
 * Page numbers around the current one, with gaps marked by null.
 * The old version rendered every page as a button, so a category with 40 pages
 * produced a 40-button wall that wrapped across four rows.
 */
function pageWindow(current: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages = new Set<number>([1, totalPages, current]);
  for (const p of [current - 1, current + 1]) {
    if (p > 1 && p < totalPages) pages.add(p);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

export function ProductGrid({ initialProducts, total, categorySlug, pageSize }: Props) {
  const { t } = useI18n();
  const [products, setProducts] = useState(initialProducts);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadPage = async (p: number) => {
    if (p === page || p < 1 || p > totalPages) return;
    setLoading(true);
    setFailedPage(null);
    try {
      const res = await fetch(`/api/products/category/${categorySlug}?page=${p}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      // The previous version assigned data.products straight into state, so a
      // malformed payload turned the next render into a crash on .map.
      if (!Array.isArray(data?.products)) throw new Error('Unexpected payload');
      setProducts(data.products);
      setPage(p);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setFailedPage(p);
    } finally {
      setLoading(false);
    }
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <section className="mx-auto max-w-7xl px-4 pb-20">
      <SectionHeading
        title={t('category.allProducts')}
        aside={total > 0 ? <span>{t('category.range', { from, to, total })}</span> : undefined}
      />

      {failedPage !== null && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-800">
            {t('category.loadFailed', { n: failedPage })}
          </p>
          <button onClick={() => loadPage(failedPage)} className="btn-secondary !py-1.5 text-xs">
            {t('category.retry')}
          </button>
        </div>
      )}

      {loading ? (
        <ProductGridSkeleton count={pageSize} />
      ) : products.length === 0 ? (
        <EmptyState
          title={t('category.emptyTitle')}
          hint={t('category.emptyHint')}
        />
      ) : (
        <div className={`${PRODUCT_GRID} ${REVEAL}`}>
          {products.map((p, i) => <ProductCard key={p.id} product={p} position={i} />)}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-12 flex items-center justify-center gap-1.5" aria-label={t('a11y.pagination')}>
          <button
            onClick={() => loadPage(page - 1)}
            disabled={page === 1 || loading}
            aria-label={t('a11y.prevPage')}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-paper
                       text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900
                       disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>

          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-ink-400" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                onClick={() => loadPage(p)}
                disabled={loading}
                aria-current={p === page ? 'page' : undefined}
                aria-label={t('a11y.page', { n: p })}
                className={`numeric h-11 min-w-11 rounded-lg px-2 text-sm font-semibold transition-colors ${
                  p === page
                    ? 'bg-ink-900 text-paper'
                    : 'border border-line-strong bg-paper text-ink-700 hover:border-ink-900 hover:text-ink-900'
                }`}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => loadPage(page + 1)}
            disabled={page === totalPages || loading}
            aria-label={t('a11y.nextPage')}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-paper
                       text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900
                       disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </nav>
      )}
    </section>
  );
}
