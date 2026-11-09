/** Montants en centimes. */

export function toCents(value: number | string): number {
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = value
    .trim()
    .replace(/\s| |€|EUR/gi, '')
    // format français 1.234,56 → 1234.56
    .replace(/^([+-]?\d{1,3}(?:\.\d{3})+),(\d+)$/, (_, a: string, b: string) => `${a.replace(/\./g, '')}.${b}`)
    .replace(/^([+-]?\d+),(\d+)$/, '$1.$2')
    .replace(/,(?=\d{3}(\D|$))/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Montant invalide : "${value}"`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = 'EUR', opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  const key = `${currency}-${decimals}-${opts.sign}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
      signDisplay: opts.sign ? 'exceptZero' : 'auto',
    });
    formatters.set(key, f);
  }
  return f.format(cents / 100);
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return part / total;
}

export function formatPct(ratio: number, decimals = 0): string {
  return `${(ratio * 100).toFixed(decimals).replace('.', ',')} %`;
}

export function sum<T>(items: T[], fn: (t: T) => number): number {
  let s = 0;
  for (const i of items) s += fn(i);
  return s;
}
