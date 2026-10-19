'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { t } = useI18n();

  // "/" jumps to search, the way every catalogue-heavy site people already use
  // behaves. Ignored while they are typing somewhere else, and skipped when the
  // field is not laid out — cheap insurance if this is ever rendered inside a
  // breakpoint-hidden wrapper again.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      inputRef.current?.blur();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full" role="search" aria-label={t('a11y.searchLandmark')}>
      <SearchIcon
        className={`pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2
                    transition-colors duration-200 ${focused ? 'text-brand-400' : 'text-ch-400'}`}
      />
      <input
        ref={inputRef}
        type="search"
        data-testid="search-input"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={t('a11y.searchLandmark')}
        placeholder={t('header.searchPlaceholder')}
        className="h-11 w-full rounded-xl border border-line-inverse bg-ch-800 pl-11 pr-4 text-sm text-white
                   placeholder:text-ch-400 transition-colors duration-200
                   hover:border-ch-600 focus:border-brand-400 focus:outline-none
                   focus:ring-1 focus:ring-brand-400 sm:pr-14
                   [&::-webkit-search-cancel-button]:hidden"
      />
      {/* The hint gets out of the way once the field is in use. */}
      <kbd
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded
                    border border-line-inverse bg-ch-900 px-1.5 py-0.5 font-mono text-[0.6875rem]
                    text-ch-400 transition-opacity duration-200 sm:block ${
          focused || query ? 'opacity-0' : 'opacity-100'
        }`}
      >
        /
      </kbd>
    </form>
  );
}
