'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CategoryMenu } from './CategoryMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SearchBar } from '@/components/search/SearchBar';
import { CartIcon } from '@/components/cart/CartIcon';
import { CloseIcon, MenuIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';
import type { TranslationKey } from '@/i18n';

const NAV: { href: string; label: TranslationKey }[] = [
  { href: '/search', label: 'header.search' },
  { href: '/demo/analytics', label: 'header.analytics' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useI18n();

  const handleNavClick = () => setMenuOpen(false);

  return (
    // A fragment, not a wrapper: `position: sticky` is clipped by its parent's
    // box, so putting these two inside one div would un-stick the header the
    // moment that div scrolled past. The utility strip is a sibling that
    // scrolls away, giving the sticky chrome back ~36px of viewport.
    <>
      <div className="on-dark hidden bg-ch-900 md:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 text-xs">
          <p className="flex items-center gap-2 text-ch-200">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
            {t('header.poweredBy')}
          </p>
          <div className="flex items-center gap-5 text-ch-300">
            <Link href="/demo/analytics" className="rounded transition-colors hover:text-brand-400">
              {t('header.liveAnalytics')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </div>

      <header className="on-dark sticky top-0 z-50 border-b border-line-inverse bg-ch-900/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4">
          {/* One flex row that wraps, not two rows with two search fields.
              Ordering does the breakpoint work: on a phone the search takes its
              own full-width line below the wordmark, from md up it sits inline
              between the wordmark and the nav. Rendering a second SearchBar per
              breakpoint — which is how this started — put two search inputs in
              the DOM, and the traffic simulator's `input[type='search']` then
              hit the hidden desktop one first and timed out waiting for it to
              become visible, so mobile sessions stopped searching entirely. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 py-3 md:h-16 md:flex-nowrap md:gap-x-6 md:py-0">
            <Link href="/" className="order-1 shrink-0" aria-label={t('a11y.homeLink')}>
              <span className="flex items-baseline text-2xl font-black tracking-[-0.04em]">
                <span className="relative text-brand-400">
                  Click
                  <span
                    className="absolute -bottom-1 left-0 h-[3px] w-full origin-left scale-x-100 bg-brand-400
                               transition-transform duration-500 ease-expo group-hover:scale-x-0"
                    aria-hidden="true"
                  />
                </span>
                <span className="text-white">Shop</span>
              </span>
            </Link>

            {/* On a 390px phone the wordmark, cart and menu left this field
                about 100px wide — "Search pro…" and nowhere to type — so it
                wraps onto its own line below md. */}
            <div className="order-3 w-full min-w-0 md:order-2 md:w-auto md:flex-1">
              <SearchBar />
            </div>

            <nav className="order-2 ml-auto hidden shrink-0 items-center gap-5 text-sm md:order-3 md:ml-0 md:flex">
              {NAV.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded px-1 py-1 font-medium transition-colors ${
                    pathname === item.href ? 'text-brand-400' : 'text-ch-200 hover:text-brand-400'
                  }`}
                >
                  {t(item.label)}
                </Link>
              ))}
              <CartIcon />
            </nav>

            <div className="order-2 ml-auto flex shrink-0 items-center gap-2 md:hidden">
              <CartIcon />
              <button
                type="button"
                aria-label={menuOpen ? t('a11y.closeMenu') : t('a11y.openMenu')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(o => !o)}
                className="rounded-lg p-2 text-ch-200 transition-colors hover:bg-ch-800 hover:text-brand-400"
              >
                {menuOpen ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
              </button>
            </div>
          </div>

          {menuOpen && (
            <div className="flex animate-rise flex-col gap-1 border-t border-line-inverse py-3 md:hidden">
              {NAV.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    pathname === item.href
                      ? 'bg-brand-400 text-ink-900'
                      : 'text-ch-200 hover:bg-ch-800 hover:text-white'
                  }`}
                >
                  {t(item.label)}
                </Link>
              ))}
              <LanguageSwitcher variant="menu" />
            </div>
          )}

          <CategoryMenu />
        </div>
      </header>
    </>
  );
}
