import { HeroBanner } from '@/components/home/HeroBanner';
import { CategoryShowcase } from '@/components/home/CategoryShowcase';
import { ProductRecommendations } from '@/components/home/ProductRecommendations';
import type { Product } from '@/types/product';

async function getRecommendations(): Promise<Product[]> {
  try {
    const baseUrl = 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/products/recommendations`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const recommendations = await getRecommendations();
  return (
    <>
      <HeroBanner />
      <CategoryShowcase />
      <ProductRecommendations products={recommendations} />
    </>
  );
}
