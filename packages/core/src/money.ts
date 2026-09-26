/**
 * Money is always an integer number of satang (1 baht = 100 satang).
 * Rates are integer basis points (7% = 700) so no float ever touches a total.
 */
export type Satang = number;
export type BasisPoints = number;

export const baht = (b: number): Satang => Math.round(b * 100);

/** Round half away from zero — matches how Thai tax documents round to the satang. */
export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** amount × rate, rounded to the satang. */
export function applyRate(amount: Satang, rate: BasisPoints): Satang {
  return roundHalfUp((amount * rate) / 10_000);
}

/** Split a price that already includes VAT into its pre-VAT base. */
export function extractBase(inclusive: Satang, vatRate: BasisPoints): Satang {
  return roundHalfUp((inclusive * 10_000) / (10_000 + vatRate));
}

/**
 * Split `amount` across `weights` so the parts sum exactly to `amount`
 * (largest-remainder method). Used to spread a bill discount over lines.
 */
export function allocate(amount: Satang, weights: number[]): Satang[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map((r) => Math.floor(r));
  let left = amount - parts.reduce((s, p) => s + p, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
    parts[order[k]!.i]! += 1;
  }
  return parts;
}

/** 36000 → "360.00", 126430000 → "1,264,300.00" */
export function formatBaht(s: Satang): string {
  const neg = s < 0;
  const abs = Math.abs(s);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}
