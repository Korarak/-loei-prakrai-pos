import type { BasisPoints } from './money.ts';

export interface TaxRatePeriod {
  rate: BasisPoints;
  /** ISO date, inclusive */
  from: string;
  /** ISO date, inclusive; null = open-ended */
  to: string | null;
  legalRef?: string;
}

/** The VAT rate in force on a given day. Throws if none — never silently fall back. */
export function vatRateOn(date: string, periods: TaxRatePeriod[]): TaxRatePeriod {
  const day = date.slice(0, 10);
  const hit = periods.find((p) => p.from <= day && (p.to === null || day <= p.to));
  if (!hit) throw new Error(`no VAT rate configured for ${day}`);
  return hit;
}

/** Thai 13-digit taxpayer / citizen ID with its mod-11 check digit. */
export function isValidThaiTaxId(raw: string): boolean {
  const d = raw.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

/** Branch code printed on tax invoices: 00000 = head office. */
export function formatBranch(code: string): string {
  return code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;
}

/**
 * Tax document number: PREFIX-YYMM-000123 using the Buddhist-era year,
 * e.g. P1-6909-001228 for September 2569.
 */
export function formatDocNo(prefix: string, isoDate: string, seq: number, width = 6): string {
  const [y, m] = isoDate.split('-');
  const be = (Number(y) + 543) % 100;
  return `${prefix}-${String(be).padStart(2, '0')}${m}-${String(seq).padStart(width, '0')}`;
}

/** Monthly sequence period key in BE, e.g. "2569-09". */
export function docPeriod(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${Number(y) + 543}-${m}`;
}
