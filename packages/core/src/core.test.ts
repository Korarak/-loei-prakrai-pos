import { describe, expect, it } from 'vitest';
import {
  allocate, baht, calcBill, contributionMargin, docPeriod, formatBaht, formatDocNo, isValidThaiTaxId,
  microFromBahtPerUnit, movingAverage, pct, recipeCost, roundCash, vatRateOn, type BillSettings,
} from './index.ts';

const VAT_EXCL: BillSettings = { vatRegistered: true, priceIncludesVat: false, vatRate: 700, serviceChargeRate: 1000 };
const VAT_INCL: BillSettings = { vatRegistered: true, priceIncludesVat: true, vatRate: 700, serviceChargeRate: 0 };
const NO_VAT: BillSettings = { vatRegistered: false, priceIncludesVat: true, vatRate: 700, serviceChargeRate: 1000 };

describe('allocate', () => {
  it('always sums exactly to the amount', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [12000, 12000, 5000, 7000]).reduce((a, b) => a + b)).toBe(1000);
  });
  it('handles zero weights', () => expect(allocate(50, [0, 0])).toEqual([0, 0]));
});

describe('calcBill — design doc §3 examples', () => {
  it('VAT-registered, price + VAT, 10% discount, 10% service charge → 1,059.30', () => {
    const r = calcBill([{ unitPrice: baht(1000), qty: 1 }], { type: 'percent', value: 1000 }, VAT_EXCL);
    expect(r.discount).toBe(baht(100));
    expect(r.serviceCharge).toBe(baht(90));
    expect(r.vat).toBe(6930);
    expect(r.total).toBe(105930);
  });

  it('non-VAT shop charges no VAT → 990.00', () => {
    const r = calcBill([{ unitPrice: baht(1000), qty: 1 }], { type: 'percent', value: 1000 }, NO_VAT);
    expect(r.vat).toBe(0);
    expect(r.total).toBe(baht(990));
  });

  it('VAT-inclusive 60 baht dish splits into 56.07 + 3.93', () => {
    const r = calcBill([{ unitPrice: baht(60), qty: 1 }], { type: 'none' }, VAT_INCL);
    expect(r.vatableBase).toBe(5607);
    expect(r.vat).toBe(393);
    expect(r.total).toBe(baht(60));
  });

  it('table 5 order (360 baht inclusive) matches the receipt: 336.45 + 23.55', () => {
    const r = calcBill(
      [
        { unitPrice: baht(60), qty: 2 },
        { unitPrice: baht(120), qty: 1 },
        { unitPrice: baht(50), qty: 1 },
        { unitPrice: baht(35), qty: 2 },
      ],
      { type: 'none' },
      VAT_INCL,
    );
    expect([r.vatableBase, r.vat, r.total]).toEqual([33645, 2355, 36000]);
    expect(r.lines.reduce((s, l) => s + l.netExVat, 0)).toBe(r.vatableBase);
  });

  it('VAT-exempt lines are excluded from the VAT base', () => {
    const r = calcBill(
      [{ unitPrice: baht(107), qty: 1 }, { unitPrice: baht(50), qty: 1, vatExempt: true }],
      { type: 'none' },
      VAT_INCL,
    );
    expect(r.vatableBase).toBe(baht(100));
    expect(r.exemptBase).toBe(baht(50));
    expect(r.vat).toBe(baht(7));
    expect(r.total).toBe(baht(157));
  });

  it('caps a discount at the bill value', () => {
    const r = calcBill([{ unitPrice: baht(50), qty: 1 }], { type: 'amount', value: baht(80) }, VAT_INCL);
    expect(r.total).toBe(0);
  });

  it('rejects fractional quantities and prices', () => {
    expect(() => calcBill([{ unitPrice: 10.5, qty: 1 }], { type: 'none' }, VAT_INCL)).toThrow();
    expect(() => calcBill([{ unitPrice: 100, qty: 0 }], { type: 'none' }, VAT_INCL)).toThrow();
  });
});

describe('roundCash', () => {
  it('rounds down in the customer favour and reports the adjustment', () => {
    expect(roundCash(105930, 'down-baht')).toEqual({ payable: 105900, adjustment: -30 });
    expect(roundCash(105930, 'down-25')).toEqual({ payable: 105925, adjustment: -5 });
    expect(roundCash(105930, 'none')).toEqual({ payable: 105930, adjustment: 0 });
  });
});

describe('costing — design doc §4 examples', () => {
  it('fried rice with shrimp costs 18.50 baht', () => {
    const cost = recipeCost([
      { qty: 200, unitCost: microFromBahtPerUnit(0.01) },           // rice, g
      { qty: 40, unitCost: microFromBahtPerUnit(0.18), yieldPct: 60 }, // shrimp 180/kg, 60% yield
      { qty: 1, unitCost: microFromBahtPerUnit(3.5) },               // egg
      { qty: 15, unitCost: microFromBahtPerUnit(0.05) },             // oil, ml
      { qty: 1, unitCost: microFromBahtPerUnit(0.25) },              // seasoning set
    ]);
    expect(cost).toBe(1850);
    expect(pct(cost, 5607)).toBe(33.0);
    expect(contributionMargin({ netExVat: 5607, ingredientCost: cost })).toBe(3757);
    expect(contributionMargin({ netExVat: 5607, ingredientCost: cost, packaging: 300, commission: 1800 })).toBe(1657);
  });

  it('moving average: 1.2 kg @180 + 5 kg @185 → 184.03/kg', () => {
    const avg = movingAverage(1200, microFromBahtPerUnit(0.18), 5000, microFromBahtPerUnit(0.185));
    expect(Math.round((avg * 1000) / 10_000) / 100).toBeCloseTo(184.03, 2);
  });

  it('negative on-hand does not poison the average', () => {
    expect(movingAverage(-5, 999, 10, 500)).toBe(500);
  });
});

describe('tax helpers', () => {
  const periods = [
    { rate: 700, from: '2025-10-01', to: '2026-09-30' },
    { rate: 700, from: '2026-10-01', to: '2027-09-30', legalRef: 'พ.ร.ฎ. 807' },
  ];
  it('finds the rate in force and refuses unknown dates', () => {
    expect(vatRateOn('2026-10-01T08:00:00+07:00', periods).legalRef).toBe('พ.ร.ฎ. 807');
    expect(() => vatRateOn('2027-10-01', periods)).toThrow(/no VAT rate/);
  });
  it('validates Thai tax IDs', () => {
    expect(isValidThaiTaxId('0-1055-12345-67-8')).toBe(false);
    expect(isValidThaiTaxId('0105512345671')).toBe(true);
    expect(isValidThaiTaxId('123')).toBe(false);
  });
  it('formats document numbers in the Buddhist era', () => {
    expect(formatDocNo('P1', '2026-09-26', 1228)).toBe('P1-6909-001228');
    expect(docPeriod('2026-09-26')).toBe('2569-09');
  });
  it('formats baht', () => {
    expect(formatBaht(126430000)).toBe('1,264,300.00');
    expect(formatBaht(-30)).toBe('-0.30');
  });
});
