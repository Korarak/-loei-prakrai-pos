import { roundHalfUp, type Satang } from './money.ts';

/**
 * Cost per base unit (gram, ml, piece) is kept in 1/10,000 satang so that
 * 0.0033 baht/ml of oil survives; convert to satang only for totals.
 */
export type MicroCost = number;
export const MICRO = 10_000;

export const microFromBahtPerUnit = (bahtPerUnit: number): MicroCost => Math.round(bahtPerUnit * 100 * MICRO);

/** Weighted moving average after receiving stock (design doc §4.2). */
export function movingAverage(onHand: number, avg: MicroCost, qtyIn: number, costIn: MicroCost): MicroCost {
  const current = Math.max(onHand, 0);
  const qty = current + qtyIn;
  if (qty <= 0) return costIn;
  return Math.round((current * avg + qtyIn * costIn) / qty);
}

export interface RecipeLine {
  qty: number;
  /** Cost per purchased base unit. */
  unitCost: MicroCost;
  /** Usable share after trimming/peeling, 1–100. */
  yieldPct?: number;
}

/** Cost of one serving in satang. Yield raises the cost of what is actually usable. */
export function recipeCost(lines: RecipeLine[]): Satang {
  const micro = lines.reduce((sum, l) => {
    const y = l.yieldPct ?? 100;
    if (y <= 0 || y > 100) throw new RangeError('yieldPct must be in (0, 100]');
    return sum + (l.qty * l.unitCost * 100) / y;
  }, 0);
  return roundHalfUp(micro / MICRO);
}

/** Percent with one decimal, e.g. 33.0 */
export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export interface MarginInput {
  netExVat: Satang;
  ingredientCost: Satang;
  packaging?: Satang;
  /** Channel commission charged on the displayed price (e.g. delivery app GP). */
  commission?: Satang;
}

export function contributionMargin(m: MarginInput): Satang {
  return m.netExVat - m.ingredientCost - (m.packaging ?? 0) - (m.commission ?? 0);
}
