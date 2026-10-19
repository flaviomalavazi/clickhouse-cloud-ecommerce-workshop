'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { LatencyMeter } from '@/components/search/LatencyMeter';
import { useInstantSearch } from '@/components/search/useInstantSearch';
import { ProductCard } from '@/components/product/ProductCard';
import { PRODUCT_GRID } from '@/components/product/productGrid';
import { SearchIcon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tally } from '@/components/ui/Tally';
import { useI18n } from '@/i18n/LocaleProvider';
import { trackEvent } from '@/hooks/useSnowplow';

function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, tn } = useI18n();

  const initialQ = searchParams.get('q') ?? '';

  const [query, setQuery] = useState(initialQ);

  const text = useInstantSearch((q, count) => {
    trackEvent({ category: 'search', action: 'text_search', label: q, value: count });
  });

  // Arriving with ?q= runs once, immediately — no debounce on a deliberate
  // navigation.
  useEffect(() => {
    if (initialQ) text.searchNow(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const handleChange = (value: string) => {
    setQuery(value);
    text.search(value);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Results are already on screen; this only makes the query shareable.
    router.replace(`/search?q=${encodeURIComponent(query)}`, { scroll: false });
    text.searchNow(query);
  };

  const results = text.results;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:py-14">
      <span className="section-rule" aria-hidden="true" />
      <h1 className="text-display-sm text-ink-900">{t('search.title')}</h1>

      <div className="mt-8">
        <form onSubmit={handleTextSubmit} className="max-w-2xl">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              value={query}
              onChange={e => handleChange(e.target.value)}
              aria-label={t('a11y.searchQuery')}
              placeholder={t('search.placeholder')}
              autoComplete="off"
              enterKeyHint="search"
              className="field h-12 pl-11 pr-4 text-base [&::-webkit-search-cancel-button]:hidden"
            />
            {/* The only sign that a request is in flight. Results stay put
                underneath, so the grid never blinks between keystrokes. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-[1px] bottom-[1px] h-[2px] overflow-hidden rounded-b-lg"
            >
              <span
                className={`block h-full w-full origin-left bg-brand-500 transition-transform duration-300 ease-out ${
                  text.pending ? 'scale-x-100' : 'scale-x-0'
                }`}
              />
            </span>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {text.pending ? t('search.searching') : ''}
          </p>
        </form>

        <p className="mt-3 max-w-measure text-xs leading-relaxed text-ink-400">{t('search.hintText')}</p>
      </div>

      <div className="mt-10">
        {text.failed && (
          <p role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {t('search.failed')}
          </p>
        )}

        {results.length > 0 ? (
          <>
            {/* The instrument row: what came back, and what it cost. */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-500">
                <span className="numeric text-base font-bold text-ink-900">
                  <Tally value={results.length} />
                </span>
                <span>{tn('search.resultsLabel', results.length)}</span>

                {text.last && (
                  <>
                    <span aria-hidden="true" className="text-ink-300">·</span>
                    <span className="numeric font-semibold text-ink-900">
                      <Tally value={Math.round(text.last.server)} suffix="ms" />
                    </span>
                    <span>{t('search.server')}</span>
                    <span aria-hidden="true" className="text-ink-300">·</span>
                    <span className="numeric text-ink-700">
                      <Tally value={Math.round(text.last.total)} suffix="ms" />
                    </span>
                    <span>{t('search.roundTrip')}</span>
                  </>
                )}
              </p>

              <LatencyMeter samples={text.samples} />
            </div>

            <div className={PRODUCT_GRID}>
              {results.map((r, i) => (
                <ProductCard
                  key={r.product_id}
                  morph
                  product={{
                    id: r.product_id,
                    category_id: 0,
                    category_slug: r.category_slug,
                    sku: '',
                    name: r.name,
                    description: '',
                    brand: r.brand ?? '',
                    price: r.price,
                    original_price: r.original_price,
                    image_url: r.image_url,
                    is_active: true,
                    attributes: {},
                  }}
                  position={i}
                />
              ))}
            </div>
          </>
        ) : text.answered ? (
          <EmptyState
            title={t('search.noResultsTitle')}
            hint={t('search.noResultsHintText')}
          />
        ) : (
          <EmptyState
            title={t('search.idleTitleText')}
            hint={t('search.idleHintText')}
          />
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}
