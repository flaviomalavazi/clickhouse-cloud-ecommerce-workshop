import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { SnowplowProvider } from '@/components/layout/SnowplowProvider';
import { HyperDXProvider } from '@/components/layout/HyperDXProvider';
import { CartProvider } from '@/context/CartContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { SkipLink } from '@/components/layout/SkipLink';
import { FlightLayer } from '@/components/cart/FlightLayer';

// tailwind.config.ts has declared these two families since the first commit,
// but nothing ever loaded them, so every page was rendering in system-ui.
// next/font ships with Next 14 — no new dependency — and self-hosts the files
// at build time, so there is no third-party request and no swap flash.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'),
  title: 'ClickShop – Find Everything You Need',
  description: 'E-commerce demo powered by ClickHouse and PostgreSQL',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'ClickShop – Find Everything You Need',
    description: 'Blazing-fast full-text search powered by ClickHouse.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickShop – Find Everything You Need',
    description: 'Blazing-fast full-text search powered by ClickHouse.',
  },
};

export const viewport = {
  themeColor: '#0D0D0D',
};

// The metadata above stays in English. Next resolves it on the server, and the
// locale lives in a client context so it cannot be read here — moving it would
// mean reading a cookie in this layout, which opts every page out of static
// rendering. The demo is `robots: noindex`, so the title is not doing SEO work.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // LocaleProvider replaces this `lang` on mount with the visitor's choice.
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col bg-paper-50">
        <SnowplowProvider />
        <HyperDXProvider />
        <LocaleProvider>
          <CartProvider>
            <SkipLink />
            <Header />
            <main id="main" className="flex-1">{children}</main>
            <Footer />
            <FlightLayer />
          </CartProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
