'use client';
import { ProductCard } from '@/components/product/ProductCard';
import { DEALS_GRID, REVEAL } from '@/components/product/productGrid';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useI18n } from '@/i18n/LocaleProvider';
import type { Product } from '@/types/product';

interface Props { products: Product[]; }

export function BestDeals({ products }: Props) {
  const { t } = useI18n();
  if (!products.length) return null;

  const deepest = Math.max(...products.map(p => p.discount_pct ?? 0));

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeading
        title={t('category.bestDeals')}
        aside={deepest > 0 ? <span>{t('category.upTo', { n: deepest })}</span> : undefined}
      />
      <div className={`${DEALS_GRID} ${REVEAL}`}>
        {products.map((p, i) => <ProductCard key={p.id} product={p} position={i} />)}
      </div>
    </section>
  );
}
