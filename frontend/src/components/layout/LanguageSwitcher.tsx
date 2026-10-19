'use client';

import { LOCALES, LOCALE_META } from '@/i18n/config';
import { useLocale } from '@/i18n/LocaleProvider';

/**
 * Language picker. Set in type, like the category nav — three two-letter codes
 * rather than flags: a flag names a country, not a language, and picking one
 * for Spanish or Portuguese means picking a country to leave out.
 *
 * `strip` rides the dark utility bar on desktop; `menu` is the row inside the
 * mobile menu, where there is width for the language's own name.
 */
export function LanguageSwitcher({ variant = 'strip' }: { variant?: 'strip' | 'menu' }) {
  const { locale, setLocale, t } = useLocale();

  if (variant === 'menu') {
    return (
      <div className="border-t border-line-inverse pt-3">
        <p className="px-3 pb-2 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ch-500">
          {t('a11y.language')}
        </p>
        <div className="flex gap-1.5 px-1">
          {LOCALES.map(code => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                locale === code
                  ? 'bg-brand-400 text-ink-900'
                  : 'text-ch-200 hover:bg-ch-800 hover:text-white'
              }`}
            >
              {LOCALE_META[code].label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center" role="group" aria-label={t('a11y.language')}>
      {LOCALES.map((code, i) => (
        <span key={code} className="flex items-center">
          {i > 0 && <span aria-hidden="true" className="mx-0.5 h-2.5 w-px bg-ch-600" />}
          <button
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={locale === code}
            title={LOCALE_META[code].label}
            /* The hit area grows to 44px without the label growing with it.
               These sit in a dense utility bar, so padding the button until it
               is 44px tall would have pushed the bar open; the negative margin
               takes that height back out of the layout while the target keeps
               it. The visible chip is unchanged. */
            className={`-my-3 rounded px-1.5 py-3.5 font-semibold tracking-wide transition-colors ${
              locale === code ? 'text-brand-400' : 'text-ch-400 hover:text-white'
            }`}
          >
            {LOCALE_META[code].code}
          </button>
        </span>
      ))}
    </div>
  );
}
