'use client';
import { ProductCard } from '@/components/product/ProductCard';
import { PRODUCT_GRID, REVEAL } from '@/components/product/productGrid';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useI18n } from '@/i18n/LocaleProvider';
import type { Product } from '@/types/product';

interface Props { products: Product[]; }

export function ProductRecommendations({ products }: Props) {
  const { t } = useI18n();
  if (!products.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
      <SectionHeading
        title={t('home.recommended')}
        aside={<span>{t('home.picks', { n: products.length })}</span>}
      />
      <div className={`${PRODUCT_GRID} ${REVEAL}`}>
        {products.map((p, i) => <ProductCard key={p.id} product={p} position={i} />)}
      </div>
    </section>
  );
}
