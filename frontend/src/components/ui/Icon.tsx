import type { SVGProps } from 'react';

/**
 * The storefront's icon set — authored, single stroke weight, one 24×24 grid.
 *
 * One rule governs where these appear: **icons mark actions, text marks
 * navigation.** Search, cart, quantity, remove and direction get a glyph;
 * category links do not. The category nav previously drew emoji (👟 👕 📚 ⌨️ 📺),
 * which rendered in the platform's own colour font — five unrelated
 * illustration styles that changed per OS and ignored the palette — and
 * replacing them with outlines only made the same navigation-with-decoration
 * mistake in a tidier hand. Categories are now set in type alone.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}
/* ── Interface marks ────────────────────────────────────────────────────── */

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4 4" />
    </Svg>
  );
}

export function CartIconMark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 3.5h1.6a1 1 0 0 1 1 .8l.4 2M6.9 8.5h13.4l-1.7 7.2a1.5 1.5 0 0 1-1.5 1.2H9.3a1.5 1.5 0 0 1-1.5-1.2L5.5 6.3" />
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12H5m0 0 5.5-5.5M5 12l5.5 5.5" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Svg>
  );
}

/**
 * Boleto, drawn as the barcode a Brazilian checkout puts next to it.
 *
 * The row used to say "BOL" in small caps, which named nothing: BOL is not an
 * abbreviation anyone uses, and it sat where Pix has a wordmark and the cards
 * have their marks, so the one row without an image looked unfinished. Every
 * Brazilian storefront marks boleto with a barcode.
 */
export function BarcodeIcon(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={1.5}>
      <path d="M4 6.5v11M7 6.5v11M10.5 6.5v11M14 6.5v11M17 6.5v11M20 6.5v11" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 12h13" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="M6.5 7l.8 11.4a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}
