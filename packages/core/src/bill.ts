import { allocate, applyRate, extractBase, type BasisPoints, type Satang } from './money.ts';

export interface BillLineInput {
  /** Price per unit as shown on the menu (VAT-inclusive when the shop prices that way). */
  unitPrice: Satang;
  qty: number;
  vatExempt?: boolean;
}

export type Discount =
  | { type: 'none' }
  | { type: 'percent'; value: BasisPoints }
  | { type: 'amount'; value: Satang };

export interface BillSettings {
  vatRegistered: boolean;
  priceIncludesVat: boolean;
  vatRate: BasisPoints;
  serviceChargeRate: BasisPoints;
}

export interface BillLineResult {
  gross: Satang;
  discount: Satang;
  /** Line value after discount, before VAT — the figure margin reports use. */
  netExVat: Satang;
}

export interface BillResult {
  lines: BillLineResult[];
  gross: Satang;
  discount: Satang;
  /** Pre-VAT value of VAT-able goods after discount. */
  vatableBase: Satang;
  exemptBase: Satang;
  serviceCharge: Satang;
  vat: Satang;
  total: Satang;
}

/**
 * Order of operations (design doc §3): food → discount → service charge → VAT.
 * Service charge and VAT are always computed on the pre-VAT base; VAT is rounded
 * once per bill.
 */
export function calcBill(input: BillLineInput[], discount: Discount, s: BillSettings): BillResult {
  for (const l of input) {
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new RangeError('unitPrice must be non-negative satang');
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError('qty must be a positive integer');
  }
  const grossLines = input.map((l) => l.unitPrice * l.qty);
  const gross = grossLines.reduce((a, b) => a + b, 0);

  let discountTotal = 0;
  if (discount.type === 'percent') discountTotal = applyRate(gross, discount.value);
  if (discount.type === 'amount') discountTotal = discount.value;
  discountTotal = Math.min(Math.max(discountTotal, 0), gross);

  const discountLines = allocate(discountTotal, grossLines);
  const netLines = grossLines.map((g, i) => g - discountLines[i]!);

  const charged = s.vatRegistered;
  const isVatable = (i: number) => charged && !input[i]!.vatExempt;

  const vatableNet = netLines.reduce((a, n, i) => a + (isVatable(i) ? n : 0), 0);
  const exemptBase = netLines.reduce((a, n, i) => a + (isVatable(i) ? 0 : n), 0);

  const inclusive = charged && s.priceIncludesVat;
  const vatableBase = inclusive ? extractBase(vatableNet, s.vatRate) : vatableNet;
  const serviceCharge = applyRate(vatableBase + exemptBase, s.serviceChargeRate);

  let vat = 0;
  if (charged) {
    vat = inclusive
      ? vatableNet - vatableBase + applyRate(serviceCharge, s.vatRate)
      : applyRate(vatableBase + serviceCharge, s.vatRate);
  }

  // Spread the pre-VAT base back over vatable lines so per-dish margins add up.
  const vatableIdx = netLines.map((_, i) => i).filter(isVatable);
  const baseAlloc = allocate(vatableBase, vatableIdx.map((i) => netLines[i]!));
  const netExVat = netLines.slice();
  vatableIdx.forEach((i, k) => (netExVat[i] = baseAlloc[k]!));

  return {
    lines: grossLines.map((g, i) => ({ gross: g, discount: discountLines[i]!, netExVat: netExVat[i]! })),
    gross,
    discount: discountTotal,
    vatableBase,
    exemptBase,
    serviceCharge,
    vat,
    total: vatableBase + exemptBase + serviceCharge + vat,
  };
}

export type CashRounding = 'none' | 'down-baht' | 'down-25';

/** Round a cash total down in the customer's favour; the difference is a separate line, never a tax change. */
export function roundCash(total: Satang, mode: CashRounding): { payable: Satang; adjustment: Satang } {
  const step = mode === 'down-baht' ? 100 : mode === 'down-25' ? 25 : 1;
  const payable = Math.floor(total / step) * step;
  return { payable, adjustment: payable - total };
}
