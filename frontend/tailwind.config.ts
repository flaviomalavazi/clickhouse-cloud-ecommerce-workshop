import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ClickHouse signature yellow. Only ever a *surface* (with ink on top),
        // a rule, or a dot — brand-600 on white is ~1.7:1 and was being used as
        // price text, so nothing here is a legal text colour on a light ground.
        brand: {
          50:  '#FEFEF0',
          100: '#FDFDC8',
          200: '#FBFB96',
          300: '#F8F864',
          400: '#FAFF69',
          500: '#EEED00',
          600: '#D4D400',
          700: '#AAAA00',
          800: '#7A7A00',
          900: '#4A4A00',
        },
        // ClickHouse dark palette. Hex values are load-bearing: the analytics
        // dashboard hardcodes several of them in its recharts config, so they
        // stay byte-identical.
        ch: {
          50:  '#F5F5F5',
          100: '#E0E0E0',
          200: '#BDBDBD',
          300: '#9E9E9E',
          400: '#757575',
          500: '#616161',
          600: '#424242',
          700: '#2C2C2C',
          800: '#1A1A1A',
          900: '#0D0D0D',
        },
        // Light-ground semantics. Faintly warm so the neutrals sit with the
        // yellow-green brand instead of fighting it.
        ink: {
          900: '#111110',
          800: '#22221F',
          700: '#3A3A36',
          600: '#55554F',
          500: '#6E6E67',
          400: '#8C8C84',
          300: '#A9A9A0',
        },
        paper: {
          DEFAULT: '#FFFFFF',
          50:  '#FAFAF8',
          100: '#F3F3F0',
          200: '#E9E9E4',
          300: '#DDDDD6',
        },
        line: {
          DEFAULT: '#E4E4DE',
          strong:  '#CFCFC6',
          inverse: '#262624',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Display steps carry their own leading and tracking so headings can
        // never be set at body tracking by accident.
        'display-sm': ['clamp(1.75rem, 4vw, 2.5rem)',  { lineHeight: '0.98', letterSpacing: '-0.03em',  fontWeight: '800' }],
        'display':    ['clamp(2.5rem, 7vw, 4.25rem)',  { lineHeight: '0.92', letterSpacing: '-0.035em', fontWeight: '800' }],
        'display-lg': ['clamp(3rem, 9vw, 6rem)',       { lineHeight: '0.88', letterSpacing: '-0.04em',  fontWeight: '800' }],
      },
      maxWidth: {
        measure: '68ch',
      },
      boxShadow: {
        // Every shadow has an offset and a blur; none is a zero-offset halo.
        tile:  '0 1px 2px rgba(17,17,16,0.04), 0 2px 8px -2px rgba(17,17,16,0.07)',
        lift:  '0 4px 12px -2px rgba(17,17,16,0.10), 0 14px 34px -10px rgba(17,17,16,0.14)',
        panel: '0 2px 4px rgba(17,17,16,0.04), 0 18px 44px -14px rgba(17,17,16,0.16)',
        brand: '0 4px 14px -4px rgba(212,212,0,0.45)',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translate3d(0, 1.25rem, 0)' },
          to:   { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        // The yellow slab wiping in behind the headline word.
        swipe: {
          from: { transform: 'scaleX(0)' },
          to:   { transform: 'scaleX(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        // The product image settling in on arrival — the one authored moment on
        // the detail page.
        'media-in': {
          from: { opacity: '0', transform: 'scale(1.05)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        // The Pix code printing itself, top to bottom. A wipe rather than a
        // fade: a QR that fades in reads as a slow image, one that wipes reads
        // as something being generated.
        'qr-print': {
          from: { clipPath: 'inset(0 0 100% 0)' },
          to:   { clipPath: 'inset(0 0 0% 0)' },
        },
      },
      animation: {
        rise:       'rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        swipe:      'swipe 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both',
        shimmer:    'shimmer 1.6s infinite',
        'media-in': 'media-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'qr-print': 'qr-print 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both',
      },
    },
  },
  plugins: [],
};

export default config;
