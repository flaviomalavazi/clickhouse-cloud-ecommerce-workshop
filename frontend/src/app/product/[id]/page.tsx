import { notFound } from 'next/navigation';
import { ProductDetail } from '@/components/product/ProductDetail';
import { getProductById } from '@/lib/products';

// DB credentials are only available at runtime, and more importantly this stops
// Next.js from caching the rendered result. Previously the page fetched its own
// API route with `next: { revalidate: 60 }`, so a single transient Postgres error
// became a notFound() that was then cached: one blip and a perfectly good product
// was a 404 for the next full minute. That is the intermittency people hit.
export const dynamic = 'force-dynamic';

interface PageProps { params: { id: string }; }

export default async function ProductPage({ params }: PageProps) {
  const id = parseInt(params.id);
  if (isNaN(id)) notFound();

  // Deliberately not wrapped in try/catch: a database failure must propagate to
  // the error boundary as a 500, not be flattened into "this product does not
  // exist". Only a genuinely absent row reaches notFound().
  const product = await getProductById(id);
  if (!product) notFound();

  // The page fetches; ProductDetail renders. It has to be a client component to
  // read the locale, and an async server component cannot be one.
  return <ProductDetail product={product} />;
}
