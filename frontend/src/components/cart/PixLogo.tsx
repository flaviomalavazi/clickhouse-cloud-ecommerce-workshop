// Official Pix logo by Banco Central do Brasil
// Brand color: #32BCAD
export const PIX_TEAL = '#32BCAD';

export function PixLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Pix – Banco Central do Brasil"
    >
      {/* Top-left quadrant */}
      <path
        d="M198.4 256L105.6 163.2C91.2 148.8 91.2 125.2 105.6 110.8L198.4 18C212.8 3.6 236.4 3.6 250.8 18L343.6 110.8C358 125.2 358 148.8 343.6 163.2L250.8 256L343.6 348.8C358 363.2 358 386.8 343.6 401.2L250.8 494C236.4 508.4 212.8 508.4 198.4 494L105.6 401.2C91.2 386.8 91.2 363.2 105.6 348.8L198.4 256Z"
        fill={PIX_TEAL}
      />
      {/* Right side — lighter teal for depth */}
      <path
        d="M256 198.4L348.8 105.6C363.2 91.2 386.8 91.2 401.2 105.6L494 198.4C508.4 212.8 508.4 236.4 494 250.8L401.2 343.6C386.8 358 363.2 358 348.8 343.6L256 250.8V198.4Z"
        fill={PIX_TEAL}
        opacity="0.75"
      />
    </svg>
  );
}

/** The diamond mark on its own, for tight spots. */
export function PixMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M50 5 L72 27 L50 49 L28 27 Z" fill={PIX_TEAL} />
      <path d="M95 50 L73 72 L51 50 L73 28 Z" fill={PIX_TEAL} opacity="0.8" />
      <path d="M50 95 L28 73 L50 51 L72 73 Z" fill={PIX_TEAL} />
      <path d="M5 50 L27 28 L49 50 L27 72 Z" fill={PIX_TEAL} opacity="0.8" />
      <circle cx="50" cy="50" r="4" fill="white" opacity="0.6" />
    </svg>
  );
}

/**
 * Full Pix wordmark.
 *
 * The word used to carry an inline `fontFamily: 'sans-serif'`, which opted it
 * out of the app's typeface entirely — so "Pix" rendered in the platform
 * default next to Inter everywhere else on the checkout.
 */
export function PixWordmark({ logoSize = 40, className = '' }: { logoSize?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <PixMark size={logoSize} />
      <span
        className="font-extrabold leading-none tracking-[0.04em]"
        style={{ fontSize: logoSize * 0.66, color: PIX_TEAL }}
      >
        Pix
      </span>
      <span className="sr-only">Pix – Banco Central do Brasil</span>
    </div>
  );
}
