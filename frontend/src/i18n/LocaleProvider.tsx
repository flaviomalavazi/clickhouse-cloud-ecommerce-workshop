'use client';

import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE, LOCALE_META, LOCALE_STORAGE_KEY, detectLocale, isLocale, type Locale,
} from './config';
import { makeTranslator, type Translator } from './index';

interface LocaleContextValue extends Translator {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // The server renders the default locale, then the first client commit
  // corrects it. That costs one frame of English on a cold page load, which is
  // the price of keeping the URLs — and the analytics paths — untouched. In-app
  // navigation is client-side, so it happens on a hard load only.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let next: Locale;
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      next = isLocale(stored) ? stored : detectLocale(navigator.languages ?? [navigator.language]);
    } catch {
      // Storage can throw outright in a locked-down browser.
      next = DEFAULT_LOCALE;
    }
    setLocaleState(next);
  }, []);

  // Screen readers and the browser's own hyphenation follow this, so it has to
  // track the choice rather than stay pinned to the server's guess.
  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (next: Locale) => {
      setLocaleState(next);
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // A refused write costs the choice on the next load, nothing more.
      }
    },
    ...makeTranslator(locale),
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const FALLBACK: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  ...makeTranslator(DEFAULT_LOCALE),
};

/**
 * Never throws. The error and not-found boundaries render inside the provider
 * today, but a hook that throws on a missing provider would turn any future
 * reshuffle of the tree into an unrecoverable error loop — the boundary itself
 * would crash. Falling back to the default locale degrades a translation, not
 * the page.
 */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? FALLBACK;
}

/** Shorthand for the common case: `const { t } = useI18n()`. */
export const useI18n = useLocale;
