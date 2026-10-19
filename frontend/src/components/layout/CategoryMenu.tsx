'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES } from '@/lib/constants';
import { useI18n } from '@/i18n/LocaleProvider';

export function CategoryMenu() {
  const pathname = usePathname();
  const { t, categoryName } = useI18n();

  return (
    // Set in type alone. Category links are navigation, and an icon beside a
    // word the reader is already reading is decoration — it was emoji before,
    // which was worse, but a drawn glyph here is the same mistake in a tidier
    // hand. The yellow slab carries the state instead.
    //
    // The rail scrolls horizontally on narrow screens; the mask fades both ends
    // so an off-screen category reads as continuing rather than as clipped.
    <nav
      className="edge-fade no-scrollbar -mx-4 flex overflow-x-auto px-4"
      aria-label={t('a11y.categoryNav')}
    >
      {CATEGORIES.map(cat => {
        const active = pathname === `/category/${cat.slug}`;
        return (
          <Link
            key={cat.slug}
            href={`/category/${cat.slug}`}
            aria-current={active ? 'page' : undefined}
            className={`group relative shrink-0 whitespace-nowrap px-3.5 py-3 text-sm font-medium
                        tracking-tight transition-colors ${
              active ? 'text-white' : 'text-ch-300 hover:text-white'
            }`}
          >
            {categoryName(cat.slug, cat.name)}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3.5 bottom-0 h-[3px] origin-left bg-brand-400
                          transition-transform duration-300 ease-expo ${
                active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
