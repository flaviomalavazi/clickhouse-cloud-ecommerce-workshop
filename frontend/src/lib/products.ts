import { getPool } from './postgres';
import { postStorefrontJourney } from './storefront-bff';
import type { Product } from '@/types/product';

/**
 * Shared product lookup for the product page and /api/products/[id].
 *
 * The page used to reach its own API route over HTTP (fetch to a hardcoded
 * http://localhost:3000), which put a second Next.js request slot and a full
 * network round trip in front of a single-row query. Both callers now use this.
 *
 * Note the return contract: null means "no active product has this id", which is
 * a genuine 404. Anything wrong with the database *throws*, so callers can tell
 * "missing" apart from "broken" - conflating the two is what turned transient
 * Postgres blips into 404s on products that exist.
 */
const PRODUCT_BY_ID = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name,
         s.quantity AS stock_quantity,
         CASE WHEN p.original_price IS NOT NULL
              THEN ROUND((1 - p.price / p.original_price) * 100)::int
         END AS discount_pct
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN stock s ON s.product_id = p.id
  WHERE p.id = $1 AND p.is_active = TRUE
`;

export async function getProductById(id: number): Promise<Product | null> {
  // Keep the direct catalog read as the PDP's data source while awaiting its
  // BFF journey alongside it, so the same request is visible end-to-end.
  const [{ rows }] = await Promise.all([
    getPool().query(PRODUCT_BY_ID, [id]),
    postStorefrontJourney('/v1/journeys/catalog', { product_id: id }),
  ]);
  return rows.length ? (rows[0] as Product) : null;
}
