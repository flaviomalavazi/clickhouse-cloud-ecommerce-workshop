export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string;
  banner_url: string;
}

export interface Product {
  id: number;
  category_id: number;
  category_slug?: string;
  sku: string;
  name: string;
  description: string;
  brand: string;
  price: number;
  original_price: number | null;
  image_url: string;
  is_active: boolean;
  attributes: Record<string, string>;
  stock_quantity?: number;
  discount_pct?: number | null;
  // Translations of name/description. Optional and nullable because the columns
  // are nullable in Postgres: a product whose translation has not landed reads
  // null and the UI falls back to the English field, so a partly translated
  // catalogue degrades product by product rather than showing blanks. English
  // stays in `name`/`description` — it is the source and the fallback, not one
  // locale among three. See localized() in lib/i18n-product.ts.
  name_pt?: string | null;
  name_es?: string | null;
  description_pt?: string | null;
  description_es?: string | null;
}

export interface SearchResult {
  product_id: number;
  name: string;
  brand: string;
  price: number;
  original_price: number | null;
  image_url: string;
  category_slug: string;
  score?: number;
}

export interface PaginatedProducts {
  products: Product[];
  total: number;
  page: number;
  page_size: number;
}
