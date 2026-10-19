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
  // Every id here must have a file in public/images (see assets/scripts/
  // build_images.py): a plausible product id is not enough. 127 ("Red Lace-Up
  // Athletic Sneaker") and not 101, whose photo is gone, and 605 ("Voxa
  // Webcam") and not 148, which has never had a source image.
  shoes:            `${_base}/images/127.webp`,
  clothing:         `${_base}/images/144.webp`,
  books:            `${_base}/images/1.webp`,
  'it-accessories': `${_base}/images/605.webp`,
  electronics:      `${_base}/images/501.webp`,
};
