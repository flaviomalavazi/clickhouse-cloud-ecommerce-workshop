/** Number formatting for receipts and the session counter. */
export function makeReceiptFormats(locale: string) {
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const ms = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const msFine = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const bytesFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return {
    rows: (n: number) => compact.format(n),
    bytes: (n: number) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = n, i = 0;
      while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
      return `${bytesFmt.format(v)} ${units[i]}`;
    },
    ms: (n: number) => `${n < 10 ? msFine.format(n) : ms.format(n)} ms`,
  };
}

/** UTC "YYYY-MM-DD HH:MM:SS[.fff]" from ClickHouse → epoch ms. */
export function parseUtc(ts: string): number {
  return Date.parse(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z'));
}
