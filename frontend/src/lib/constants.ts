export const CATEGORIES = [
  { slug: 'shoes',          name: 'Shoes',           icon: '👟' },
  { slug: 'clothing',       name: 'Clothing',        icon: '👕' },
  { slug: 'books',          name: 'Books',           icon: '📚' },
  { slug: 'it-accessories', name: 'IT Accessories',  icon: '⌨️' },
  { slug: 'electronics',    name: 'Electronics',     icon: '📺' },
] as const;

export type CategorySlug = typeof CATEGORIES[number]['slug'];

export const PAGE_SIZE = 12;

export const CATEGORY_COLORS: Record<string, string> = {
  shoes:          'from-blue-600 to-blue-400',
  clothing:       'from-purple-600 to-purple-400',
  books:          'from-amber-600 to-amber-400',
  'it-accessories': 'from-green-600 to-green-400',
  electronics:    'from-red-600 to-red-400',
};

/** Converts any image URL to the /images/{filename} path served from public/images. */
export function proxyImageUrl(url: string): string {
  if (!url) return url;
  const filename = url.split('/').pop();
  return filename ? `/images/${filename}` : url;
}

const _base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const CATEGORY_HERO_IMAGES: Record<string, string> = {
  // 127 ("Red Lace-Up Athletic Sneaker") and not 101: 101's image is gone from
  // the bucket — it 403s on the CDN and on the deployed site alike, almost
  // certainly one of the footwear photos pulled by the trademark audit that
  // deactivate_products.py records. This constant went unused until the
  // storefront rework started reading it, which is what made the dead id
  // visible. Any replacement needs its image confirmed present, not just a
  // plausible product id.
  shoes:            `${_base}/images/127.webp`,
  clothing:         `${_base}/images/144.webp`,
  books:            `${_base}/images/1.webp`,
  'it-accessories': `${_base}/images/148.webp`,
  electronics:      `${_base}/images/501.webp`,
};
