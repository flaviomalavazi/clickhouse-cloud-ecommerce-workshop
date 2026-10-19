/**
 * Translating the product attribute table.
 *
 * The table read "Color / Black", "Connectivity / Wired" in every locale while
 * the name and description beside it were translated, which is worse than a
 * fully English page: it looks like the translation ran out halfway.
 *
 * Keys are a closed set of fourteen and are translated outright.
 *
 * Values are not a closed set, and the interesting part is which ones are
 * vocabulary and which are data. "Black" is a word. "USB-C", "PC/Mac",
 * "1133", "Félicité" are not — the first two are technical tokens, the third a
 * number, the last an author's name, and translating any of them would be
 * wrong. So this does not map values; it substitutes WORDS from a small lexicon
 * and leaves everything it does not recognise exactly as it found it.
 *
 * Word level, not value level, because the values compose: "navy blue", "gray
 * and white", "mesh and synthetic leather", "wired USB 2.0". A value-keyed map
 * would need every combination and would still miss the next one; a lexicon of
 * about sixty words covers all of them, and "USB 2.0" survives inside "wired
 * USB 2.0" because neither "usb" nor "2.0" is in the lexicon.
 *
 * The keys it applies to are whitelisted. `author` and `features` are free text
 * and never touched, so no author is ever renamed by a colour that happens to
 * share their name.
 */
import type { Locale } from '@/i18n/config';

/** Attribute keys whose values are vocabulary rather than data. */
const TRANSLATABLE_VALUES = new Set([
  'color',
  'material',
  'connectivity',
  'gender',
  'format',
  'language',
]);

const KEY_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    color: 'Color', material: 'Material', size: 'Size', connectivity: 'Connectivity',
    compatibility: 'Compatibility', gender: 'Gender', pages: 'Pages', author: 'Author',
    format: 'Format', language: 'Language', warranty_years: 'Warranty',
    wattage: 'Power', capacity: 'Capacity', features: 'Features',
  },
  pt: {
    color: 'Cor', material: 'Material', size: 'Tamanho', connectivity: 'Conexão',
    compatibility: 'Compatibilidade', gender: 'Gênero', pages: 'Páginas', author: 'Autor',
    format: 'Formato', language: 'Idioma', warranty_years: 'Garantia',
    wattage: 'Potência', capacity: 'Capacidade', features: 'Características',
  },
  es: {
    color: 'Color', material: 'Material', size: 'Talla', connectivity: 'Conexión',
    compatibility: 'Compatibilidad', gender: 'Género', pages: 'Páginas', author: 'Autor',
    format: 'Formato', language: 'Idioma', warranty_years: 'Garantía',
    wattage: 'Potencia', capacity: 'Capacidad', features: 'Características',
  },
};

/**
 * Every word that actually occurs in the translatable values, drawn from the
 * catalogue rather than guessed. Anything absent here passes through, which is
 * how "usb", "hdmi", "ghz", "mm" and the author names stay untouched.
 */
const LEXICON: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  pt: {
    // Colours
    black: 'preto', white: 'branco', gray: 'cinza', grey: 'cinza', blue: 'azul',
    red: 'vermelho', green: 'verde', silver: 'prata', gold: 'dourado',
    beige: 'bege', navy: 'marinho', cream: 'creme', olive: 'oliva',
    forest: 'floresta', sage: 'salva', champagne: 'champanhe', space: 'espacial',
    royal: 'royal', dark: 'escuro', light: 'claro',
    // Materials and construction
    cotton: 'algodão', leather: 'couro', suede: 'camurça', canvas: 'lona',
    denim: 'jeans', mesh: 'mesh', synthetic: 'sintético', blend: 'misto',
    wool: 'lã', linen: 'linho', knit: 'tricô', fleece: 'fleece',
    flannel: 'flanela', textile: 'têxtil', rubber: 'borracha',
    sole: 'sola', upper: 'cabedal', stripe: 'listra', stripes: 'listras',
    accents: 'detalhes', overlays: 'sobreposições',
    // Connectivity — only the words; USB, HDMI, Bluetooth, GHz stay as they are
    wired: 'com fio', wireless: 'sem fio', cellular: 'celular',
    jack: 'jack',
    // Gender
    unisex: 'unissex', women: 'feminino', men: 'masculino',
    female: 'feminino', male: 'masculino',
    // Format
    hardcover: 'capa dura', paperback: 'brochura', ebook: 'e-book',
    digital: 'digital',
    // Language
    english: 'inglês', spanish: 'espanhol', german: 'alemão',
    french: 'francês', deutsch: 'alemão',
    // Connectors
    and: 'e', with: 'com', to: 'para',
  },
  es: {
    black: 'negro', white: 'blanco', gray: 'gris', grey: 'gris', blue: 'azul',
    red: 'rojo', green: 'verde', silver: 'plata', gold: 'dorado',
    beige: 'beige', navy: 'marino', cream: 'crema', olive: 'oliva',
    forest: 'bosque', sage: 'salvia', champagne: 'champán', space: 'espacial',
    royal: 'royal', dark: 'oscuro', light: 'claro',
    cotton: 'algodón', leather: 'cuero', suede: 'ante', canvas: 'lona',
    denim: 'mezclilla', mesh: 'malla', synthetic: 'sintético', blend: 'mezcla',
    wool: 'lana', linen: 'lino', knit: 'tejido', fleece: 'polar',
    flannel: 'franela', textile: 'textil', rubber: 'goma',
    sole: 'suela', upper: 'empeine', stripe: 'raya', stripes: 'rayas',
    accents: 'detalles', overlays: 'sobrepuestos',
    wired: 'con cable', wireless: 'inalámbrico', cellular: 'celular',
    jack: 'jack',
    unisex: 'unisex', women: 'mujer', men: 'hombre',
    female: 'mujer', male: 'hombre',
    hardcover: 'tapa dura', paperback: 'rústica', ebook: 'e-book',
    digital: 'digital',
    english: 'inglés', spanish: 'español', german: 'alemán',
    french: 'francés', deutsch: 'alemán',
    and: 'y', with: 'con', to: 'a',
  },
};

/**
 * Adjective-noun pairs, which the word pass cannot get right on its own.
 *
 * English puts the adjective first and Portuguese and Spanish put it after, so
 * substituting word by word turns "navy blue" into "marinho azul" and
 * "synthetic leather" into "sintético couro" — vocabulary correct, grammar
 * wrong. These are matched first, longest phrase first, and the word pass then
 * handles whatever is left.
 *
 * Only the pairs that actually occur in the catalogue, and only the ones that
 * invert: "gray and white" needs nothing, because both halves are already in
 * the right order.
 */
const PHRASES: Record<Exclude<Locale, 'en'>, Array<[string, string]>> = {
  pt: [
    ['navy blue', 'azul marinho'], ['forest green', 'verde floresta'],
    ['olive green', 'verde oliva'], ['sage green', 'verde salva'],
    ['champagne gold', 'dourado champanhe'], ['space gray', 'cinza espacial'],
    ['light blue', 'azul claro'], ['royal blue', 'azul royal'],
    ['light gray', 'cinza claro'], ['light grey', 'cinza claro'],
    ['dark gray', 'cinza escuro'], ['dark grey', 'cinza escuro'],
    ['cotton blend', 'misto de algodão'], ['wool blend', 'misto de lã'],
    ['synthetic leather', 'couro sintético'], ['cotton denim', 'jeans de algodão'],
    ['rubber sole', 'sola de borracha'], ['mesh upper', 'cabedal em mesh'],
    ['wired usb', 'USB com fio'], ['usb wired', 'USB com fio'],
    ['wireless usb', 'USB sem fio'], ['usb wireless', 'USB sem fio'],
  ],
  es: [
    ['navy blue', 'azul marino'], ['forest green', 'verde bosque'],
    ['olive green', 'verde oliva'], ['sage green', 'verde salvia'],
    ['champagne gold', 'dorado champán'], ['space gray', 'gris espacial'],
    ['light blue', 'azul claro'], ['royal blue', 'azul royal'],
    ['light gray', 'gris claro'], ['light grey', 'gris claro'],
    ['dark gray', 'gris oscuro'], ['dark grey', 'gris oscuro'],
    ['cotton blend', 'mezcla de algodón'], ['wool blend', 'mezcla de lana'],
    ['synthetic leather', 'cuero sintético'], ['cotton denim', 'mezclilla de algodón'],
    ['rubber sole', 'suela de goma'], ['mesh upper', 'empeine de malla'],
    ['wired usb', 'USB con cable'], ['usb wired', 'USB con cable'],
    ['wireless usb', 'USB inalámbrico'], ['usb wireless', 'USB inalámbrico'],
  ],
};

/** Longest first, so "light gray" is never eaten by a shorter overlapping pair. */
const PHRASES_SORTED: Record<string, Array<[string, string]>> = {
  pt: [...PHRASES.pt].sort((a, b) => b[0].length - a[0].length),
  es: [...PHRASES.es].sort((a, b) => b[0].length - a[0].length),
};

/** The attribute's label in `locale`, falling back to the raw key humanised. */
export function attributeLabel(key: string, locale: Locale): string {
  return KEY_LABELS[locale]?.[key] ?? KEY_LABELS.en[key] ?? key.replace(/_/g, ' ');
}
/**
 * The attribute's value in `locale`.
 *
 * Only for whitelisted keys, and only word by word: the split keeps the
 * separators, so "gray/white" and "mesh and synthetic leather" come back with
 * their punctuation and spacing intact and any unrecognised token unchanged.
 */
export function attributeValue(key: string, value: string, locale: Locale): string {
  if (locale === 'en' || !TRANSLATABLE_VALUES.has(key)) return value;

  const lexicon = LEXICON[locale];
  if (!lexicon) return value;

  // Phrases first, longest first, so the adjective-noun inversions are settled
  // before any single word can be substituted out from under them.
  //
  // Each translated phrase is parked behind a NUL-delimited index rather than
  // left in the string. Two reasons: the word pass must not reach back into an
  // already translated span and look up "azul" inside "azul marinho"; and the
  // delimiter has to be something that cannot occur in the catalogue, which a
  // digit placeholder is not — "USB 2.0" and "1133" are real values.
  const held: string[] = [];
  let working = value;
  for (const [en, out] of PHRASES_SORTED[locale] ?? []) {
    const re = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    working = working.replace(re, () => {
      held.push(out);
      return `\u0000${held.length - 1}\u0000`;
    });
  }

  // Split on runs of non-letters but KEEP them, so punctuation and spacing
  // survive rather than being normalised into single spaces: "gray/white" stays
  // a slash and "wired USB 2.0" keeps its version number.
  const translated = working
    .split(/([^a-zA-Z\u0000]+)/)
    .map(part => (part.includes('\u0000') ? part : lexicon[part.toLowerCase()] ?? part))
    .join('')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)] ?? '');

  // Capitalise the first letter only. The English values are inconsistently
  // cased ("black" and "Black" both occur for the same colour), so normalising
  // here is what stops the table looking hand-typed.
  return translated.charAt(0).toUpperCase() + translated.slice(1);
}
