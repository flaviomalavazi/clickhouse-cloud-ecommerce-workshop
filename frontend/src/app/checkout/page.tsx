'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { useCart } from '@/context/CartContext';
import { PixWordmark, PixMark, PIX_TEAL } from '@/components/cart/PixLogo';
import { useFormatPrice } from '@/components/ui/Price';
import { ArrowLeftIcon, ArrowRightIcon, BarcodeIcon, CheckIcon } from '@/components/ui/Icon';
import {
  trackCheckoutStart,
  trackPaymentInitiated,
  trackPaymentConfirmed,
  type PaymentMethod,
} from '@/lib/snowplow';
import { proxyImageUrl } from '@/lib/constants';
import { useI18n } from '@/i18n/LocaleProvider';
import { Tally } from '@/components/ui/Tally';

const PIX_KEY = '00.000.000/0000-00';

// The Pix diamond, centred in the QR. The previous data URI held a malformed
// path ("L7s 28") and rendered as a broken glyph over the code.
const PIX_QR_LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<path d="M50 5 72 27 50 49 28 27Z" fill="${PIX_TEAL}"/>` +
      `<path d="M95 50 73 72 51 50 73 28Z" fill="${PIX_TEAL}" opacity=".8"/>` +
      `<path d="M50 95 28 73 50 51 72 73Z" fill="${PIX_TEAL}"/>` +
      `<path d="M5 50 27 28 49 50 27 72Z" fill="${PIX_TEAL}" opacity=".8"/>` +
    `</svg>`
  );

/**
 * Two cards on file, shown the way a wallet shows them: network, last four,
 * cardholder, expiry. Only the last four digits exist here — there is no PAN to
 * store and none is displayed, which is also how a real checkout renders a
 * stored card, so the realistic form and the safe form are the same form.
 *
 * The networks match what the synthetic generator writes into
 * credit_card_transactions (Visa, Mastercard, Elo, Amex), so a card chosen here
 * is the same kind of card the analytics tables are full of.
 */
const SAVED_CARDS = [
  { id: 'card_aurora', network: 'Aurora', last4: '6690', expiry: '01/2028',
    mark: ['#F5A524', '#E0521B'] },
  { id: 'card_nexo',   network: 'Nexo',   last4: '3054', expiry: '10/2033',
    mark: ['#3B7DD8', '#1B3E7A'] },
] as const;

/** Boleto-shaped without being a boleto: right length, right grouping, no barcode. */
const BOLETO_LINE  = '11122.22233 44455.566677 88899.900011 1 22223333444455';
const BOLETO_SHORT = '11122.22233 44455.566677';

/** The radio dot, so the four rows cannot drift apart visually. */
function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
        on ? 'border-ink-900' : 'border-line-strong'
      }`}
      aria-hidden="true"
    >
      {on && <span className="h-2 w-2 rounded-full bg-ink-900" />}
    </span>
  );
}

export default function CheckoutPage() {
  const { items, totalPrice, clearCart } = useCart();
  const router = useRouter();
  const { t } = useI18n();
  // Bound to the active locale, so the currency follows the language.
  const formatPrice = useFormatPrice();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'form' | 'qr'>('form');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [cardId, setCardId] = useState<string>(SAVED_CARDS[0].id);
  // Set when the card gateway refuses. Kept in state rather than thrown so the
  // visitor stays on the form and can pick another method, which is the whole
  // point of the scripted outage.
  const [authError, setAuthError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Track checkout start on mount
  useEffect(() => {
    if (items.length > 0) trackCheckoutStart(totalPrice, items.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two things were wrong here. The redirect used to run inside the render
  // body, which mutates the router during render and warns in React 18. And it
  // fired on the very first commit — before CartProvider's own mount effect had
  // restored the cart from localStorage — so a hard reload or a shared
  // /checkout link saw an empty cart, bounced to /cart, and unmounted the
  // provider before the restored items were persisted back. Deferring by one
  // commit lets the HYDRATE dispatch land first.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const empty = items.length === 0;
  // `paid` is what stops the guard below from eating the confirmation. Paying
  // clears the cart, which makes `empty` true, which fired router.replace('/cart')
  // in the same tick as the push to /checkout/confirmation — and replace won, so
  // a completed order landed on "your cart is empty" and the confirmation screen
  // was unreachable. The guard is for arriving with an empty cart, not for
  // leaving with one.
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    if (hydrated && empty && !paid) router.replace('/cart');
  }, [hydrated, empty, paid, router]);

  if (empty && !paid) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
        <div className="skeleton h-8 w-40 rounded" />
        <div className="mt-10 grid gap-8 lg:grid-cols-3 lg:gap-10">
          <div className="skeleton h-80 rounded-xl lg:col-span-2" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    // Keep the established Snowplow checkout event contract intact while the
    // payment UI supports more than Pix.
    trackPaymentInitiated(totalPrice, method);

    // Begin the observable start edge now and await it before this action ends.
    // The non-card screen changes immediately; card authorization runs beside it.
    const startJourney = fetch('/api/checkout/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, amount: totalPrice, item_count: items.length }),
    }).then(() => undefined, () => undefined);

    // Pix and boleto are instruments the visitor completes on their own side;
    // only a card needs an acquirer to say yes before we advance.
    if (method !== 'credit_card') {
      setStep('qr');
      await startJourney;
      return;
    }

    const card = SAVED_CARDS.find(c => c.id === cardId) ?? SAVED_CARDS[0];
    setAuthorizing(true);
    try {
      const [res] = await Promise.all([
        fetch('/api/checkout/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: totalPrice, last4: card.last4, network: card.network }),
        }),
        startJourney,
      ]);
      if (!res.ok) {
        // Left on the form on purpose. The visitor's next move is to choose
        // another method, and that switch is the moment worth watching in the
        // session replay.
        console.error('Card authorization failed:', res.status);
        setAuthError(t('checkout.cardDeclined'));
        return;
      }
      setStep('qr');
    } catch (error) {
      console.error('Card authorization request failed:', error);
      setAuthError(t('checkout.cardDeclined'));
    } finally {
      setAuthorizing(false);
    }
  }

  async function handleConfirmPayment() {
    setConfirming(true);
    setPaymentError(null);
    const processing = new Promise<void>(resolve => setTimeout(resolve, 1200));
    const paymentJourney = fetch('/api/checkout/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, amount: totalPrice, item_count: items.length }),
    });
    // The service journey is awaited beside, rather than after, the established
    // 1.2-second confirmation timing. No successful UI or Snowplow event is
    // produced until payment and order creation both complete.
    try {
      const [, response] = await Promise.all([processing, paymentJourney]);
      if (!response.ok) {
        setPaymentError(t('checkout.paymentFailed'));
        return;
      }
      trackPaymentConfirmed(totalPrice, method);
      setPaid(true);
      router.push('/checkout/confirmation');
      clearCart();
    } catch {
      setPaymentError(t('checkout.paymentFailed'));
    } finally {
      setConfirming(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(PIX_KEY);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked (insecure origin or denied permission) — the key is
         on screen either way, so there is nothing to recover from. */
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <span className="section-rule" aria-hidden="true" />
      <h1 className="text-display-sm mb-9 text-ink-900">{t('checkout.title')}</h1>

      <ol className="mb-10 flex max-w-md items-center gap-3" aria-label={t('a11y.checkoutProgress')}>
        <Step num={1} label={t('checkout.step1')} state={step === 'form' ? 'active' : 'done'} />
        <li aria-hidden="true" className="h-px flex-1 bg-line" />
        <Step
          num={2}
          label={t(method === 'pix' ? 'checkout.step2Pix'
                 : method === 'credit_card' ? 'checkout.step2Card'
                 : 'checkout.step2Boleto')}
          state={step === 'qr' ? 'active' : 'upcoming'}
        />
      </ol>

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
        <div className="lg:col-span-2">
          {/* Keyed on `step`, so React remounts the panel and the entrance
              animation runs on each change. A View Transition was tried here and
              removed: its pseudo-element renders in the top layer above every
              other element, the sticky header included, and holding the two
              snapshots at `height: 100%` stretched them to a group box larger
              than either panel — so the form was briefly painted over the header
              and outside its column. A contained entrance has none of that, and
              the two steps are different enough that there was never a shared
              shape worth morphing. */}
          {step === 'form' ? (
            <form
              key="form"
              onSubmit={handleSubmitForm}
              className="animate-rise panel space-y-6 p-6 md:p-7"
            >
              <h2 className="text-lg font-bold text-ink-900">{t('checkout.contact')}</h2>

              <div>
                <label htmlFor="checkout-name" className="mb-1.5 block text-sm font-medium text-ink-700">
                  {t('checkout.fullName')}
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('checkout.namePlaceholder')}
                  className="field"
                />
              </div>

              <div>
                <label htmlFor="checkout-email" className="mb-1.5 block text-sm font-medium text-ink-700">
                  {t('checkout.email')}
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('checkout.emailPlaceholder')}
                  className="field"
                />
                <p className="mt-1.5 text-xs text-ink-400">{t('checkout.emailNote')}</p>
              </div>

              <fieldset className="border-t border-line pt-6">
                <legend className="sr-only">{t('checkout.paymentMethod')}</legend>
                <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('checkout.paymentMethod')}</h3>
                {/* A wallet list, not three equal tiles. The saved cards are
                    the rows a returning customer scans first, so they come
                    first, in a bordered group with their own heading, with the
                    columns a wallet shows: network and last four, cardholder,
                    expiry. Pix and boleto follow as instruments rather than as
                    stored credentials, because that is what they are.
                    Real radio inputs throughout, one named group, so the whole
                    thing is one keyboard-operable choice. */}
                <div className="divide-y divide-line rounded-xl border border-line">
                  <div className="px-4 pb-1 pt-3">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-500">
                      {t('checkout.yourCards')}
                    </p>
                  </div>

                  {SAVED_CARDS.map(card => {
                    const selected = method === 'credit_card' && cardId === card.id;
                    return (
                      <label
                        key={card.id}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors ${
                          selected ? 'bg-paper-50' : 'hover:bg-paper-50'
                        }`}
                      >
                        <input
                          data-testid="payment-method-credit-card"
                          type="radio"
                          name="payment-method"
                          checked={selected}
                          onChange={() => { setMethod('credit_card'); setCardId(card.id); setAuthError(null); }}
                          className="sr-only"
                        />
                        <Radio on={selected} />
                        {/* A brand mark, because every row beside it has one and
                            the card rows looked unfinished without. Two bands
                            rather than a logo: the networks are invented, so
                            there is no mark to reproduce. */}
                        <span
                          className="h-6 w-9 shrink-0 rounded-[3px] shadow-tile"
                          style={{ background: `linear-gradient(135deg, ${card.mark[0]}, ${card.mark[1]})` }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-900">
                            <span className="font-semibold">{card.network}</span>{' '}
                            {t('checkout.endingIn')}{' '}
                            <span className="numeric">{card.last4}</span>
                          </span>
                          {/* Instalments are the first thing a Brazilian
                              shopper looks for on a card row. */}
                          <span className="block text-xs text-ink-500">
                            {t('checkout.installments')}
                            {name && <span className="uppercase"> · {name}</span>}
                          </span>
                        </span>
                        <span className="numeric shrink-0 text-xs text-ink-400">{card.expiry}</span>
                      </label>
                    );
                  })}

                  <label
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors ${
                      method === 'pix' ? 'bg-paper-50' : 'hover:bg-paper-50'
                    }`}
                  >
                    <input
                      data-testid="payment-method-pix"
                      type="radio"
                      name="payment-method"
                      checked={method === 'pix'}
                      onChange={() => { setMethod('pix'); setAuthError(null); }}
                      className="sr-only"
                    />
                    <Radio on={method === 'pix'} />
                    {/* The mark alone, in the same 36x24 slot the card and
                        boleto rows use. PixWordmark is mark *plus* the word
                        "Pix", so it overflowed the slot and pushed the row out
                        of line with its neighbours — and the row's own title
                        already says Pix, so the word was printed twice. */}
                    <span className="flex h-6 w-9 shrink-0 items-center justify-center">
                      <PixMark size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-900">{t('checkout.methodPix')}</span>
                      <span className="block text-xs text-ink-500">{t('checkout.pixInstant')}</span>
                    </span>
                  </label>

                  <label
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors ${
                      method === 'boleto' ? 'bg-paper-50' : 'hover:bg-paper-50'
                    }`}
                  >
                    <input
                      data-testid="payment-method-boleto"
                      type="radio"
                      name="payment-method"
                      checked={method === 'boleto'}
                      onChange={() => { setMethod('boleto'); setAuthError(null); }}
                      className="sr-only"
                    />
                    <Radio on={method === 'boleto'} />
                    <span className="flex h-6 w-9 shrink-0 items-center justify-center rounded-[3px] border border-line bg-paper">
                      <BarcodeIcon className="h-4 w-5 text-ink-700" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-900">{t('checkout.methodBoleto')}</span>
                      <span className="block text-xs text-ink-500">{t('checkout.boletoDesc')}</span>
                    </span>
                  </label>
                </div>

                {/* The acquirer's refusal, in the place the next decision gets
                    made. Red is not in the palette as a token, so this borrows
                    Tailwind's red the way the form's own validation states
                    already do — an error is the one case where a foreign hue is
                    the point. */}
                {authError && (
                  <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50/60 px-4 py-3 text-sm text-red-800">
                    <span aria-hidden="true" className="mt-[2px] font-bold">!</span>
                    <span>{authError}</span>
                  </p>
                )}
              </fieldset>

              <button data-testid="checkout-continue" type="submit" className="btn-primary btn-lg w-full" disabled={authorizing}>
                {authorizing ? t('checkout.authorizing') : t('checkout.continueToPayment')}
                {!authorizing && <ArrowRightIcon className="h-[18px] w-[18px]" />}
              </button>
            </form>
          ) : (
            /* The Pix step is what the demo is here to show, so it gets the
               dark treatment and the full width of the column. */
            <div key="pay" className="animate-rise on-dark overflow-hidden rounded-2xl bg-ch-900 shadow-panel">
              <div className="h-[3px] w-full" style={{ background: PIX_TEAL }} />
              <div className="px-6 py-9 text-center md:px-10">
                {method === 'pix' ? (
                  <PixWordmark logoSize={40} className="justify-center" />
                ) : (
                  <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-400">
                    {t(method === 'credit_card' ? 'checkout.methodCard' : 'checkout.methodBoleto')}
                  </p>
                )}

                <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-ch-200">
                  {t(method === 'pix' ? 'checkout.scanHint'
                   : method === 'credit_card' ? 'checkout.cardApproved'
                   : 'checkout.boletoHint')}
                </p>

{method === 'pix' && (
                                  <div className="mt-7 inline-block animate-qr-print rounded-2xl bg-white p-4 shadow-panel">
                  <QRCodeSVG
                    value="https://clickhouse.com"
                    size={216}
                    bgColor="#ffffff"
                    fgColor="#111110"
                    level="M"
                    imageSettings={{
                      src: PIX_QR_LOGO,
                      height: 36,
                      width: 36,
                      excavate: true,
                    }}
                  />
                </div>
                )}

                {method === 'credit_card' && (
                  <p className="numeric mt-7 text-3xl font-bold tracking-[0.12em] text-white">
                    •••• •••• •••• {(SAVED_CARDS.find(c => c.id === cardId) ?? SAVED_CARDS[0]).last4}
                  </p>
                )}

                {method === 'boleto' && (
                  /* Not a real barcode, and not pretending to be: 44 digits set
                     in mono with the same grouping a boleto uses, so it reads
                     as the right kind of object without encoding anything. */
                  <p className="numeric mx-auto mt-7 max-w-sm break-all text-sm leading-relaxed text-white">
                    {BOLETO_LINE}
                  </p>
                )}

                <dl className="mx-auto mt-8 max-w-sm divide-y divide-line-inverse rounded-xl border border-line-inverse bg-ch-800/70 text-left">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <dt className="text-xs uppercase tracking-wider text-ch-400">{t('checkout.amount')}</dt>
                    <dd className="numeric text-xl font-bold text-brand-400">
                      {/* Tally animates the integer part, so the currency and
                          the decimals are laid either side of it rather than
                          hardcoding a '$' that ignored the active locale. */}
                      <span aria-hidden="true">
                        {formatPrice(Math.floor(totalPrice)).replace(/[\d.,]+$/, '')}
                        <Tally value={Math.floor(totalPrice)} />
                        {formatPrice(totalPrice).slice(-3)}
                      </span>
                      <span className="sr-only">{formatPrice(totalPrice)}</span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <dt className="text-xs uppercase tracking-wider text-ch-400">
                      {t(method === 'pix' ? 'checkout.pixKey'
                       : method === 'credit_card' ? 'checkout.savedCard'
                       : 'checkout.boletoLine')}
                    </dt>
                    <dd className="flex items-center gap-2">
                      <span className="numeric text-sm text-white">
                        {method === 'pix' ? PIX_KEY
                         : method === 'credit_card' ? `•••• ${(SAVED_CARDS.find(c => c.id === cardId) ?? SAVED_CARDS[0]).last4}`
                         : BOLETO_SHORT}
                      </span>
                      <button
                        type="button"
                        onClick={copyKey}
                        className="rounded border border-line-inverse px-1.5 py-1 text-[0.6875rem] font-medium text-ch-300 transition-colors hover:border-brand-400 hover:text-brand-400"
                      >
                        {copied ? t('checkout.copied') : t('checkout.copy')}
                      </button>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <dt className="text-xs uppercase tracking-wider text-ch-400">{t('checkout.merchant')}</dt>
                    <dd className="text-sm text-white">
                      ClickShop <span className="text-ch-400">{t('checkout.demoTag')}</span>
                    </dd>
                  </div>
                </dl>

                <button
                  data-testid="checkout-confirm"
                  onClick={handleConfirmPayment}
                  disabled={confirming}
                  className="mx-auto mt-8 flex h-14 w-full max-w-sm items-center justify-center gap-2.5 rounded-xl
                             text-base font-bold text-white transition-all duration-200 ease-expo
                             hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: PIX_TEAL }}
                >
                  {confirming ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      {t('checkout.processing')}
                    </>
                  ) : (
                    <>
                      <CheckIcon className="h-5 w-5" strokeWidth={2.5} />
                      {t('checkout.confirm')}
                    </>
                  )}
                </button>

                {paymentError && (
                  <p role="alert" className="mx-auto mt-3 max-w-sm rounded-xl border border-red-300 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                    {paymentError}
                  </p>
                )}

                <div className="mt-5">
                  <button
                    onClick={() => setStep('form')}
                    className="group inline-flex items-center gap-2 rounded text-sm text-ch-400 transition-colors hover:text-white"
                  >
                    <ArrowLeftIcon className="h-4 w-4 transition-transform duration-300 ease-expo group-hover:-translate-x-1" />
                    {t('checkout.back')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="panel h-fit p-5 lg:sticky lg:top-32">
          <h2 className="mb-5 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
            {t('cart.summary')}
          </h2>

          <ul className="mb-5 space-y-3.5">
            {items.map(({ product, quantity }) => (
              <li key={product.id} className="flex items-center gap-3">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-100">
                  <Image
                    src={proxyImageUrl(product.image_url)}
                    alt={product.name}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="48px"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-xs font-medium text-ink-900">{product.name}</p>
                  <p className="numeric text-xs text-ink-400">×{quantity}</p>
                </div>
                <span className="numeric shrink-0 text-xs font-semibold text-ink-900">
                  {formatPrice(Number(product.price) * quantity)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-line pt-5 text-sm">
            <div className="flex justify-between text-ink-600">
              <span>{t('cart.subtotal')}</span>
              <span className="numeric text-ink-800">{formatPrice(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-ink-600">
              <span>{t('cart.shipping')}</span>
              <span className="font-semibold text-ink-900">{t('cart.free')}</span>
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-bold text-ink-900">{t('cart.total')}</span>
            <span className="numeric text-2xl font-bold text-ink-900">{formatPrice(totalPrice)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ num, label, state }: { num: number; label: string; state: 'active' | 'done' | 'upcoming' }) {
  const done = state === 'done';
  const active = state === 'active';

  return (
    <li className="flex items-center gap-2.5" aria-current={active ? 'step' : undefined}>
      <span
        className={`numeric flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
          done
            ? 'bg-ink-900 text-paper'
            : active
              ? 'bg-brand-400 text-ink-900'
              : 'border border-line-strong bg-paper text-ink-400'
        }`}
      >
        {done ? <CheckIcon className="h-4 w-4" strokeWidth={2.5} /> : num}
      </span>
      <span className={`text-sm font-medium ${active || done ? 'text-ink-900' : 'text-ink-400'}`}>
        {label}
      </span>
    </li>
  );
}
