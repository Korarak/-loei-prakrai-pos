import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { bangkokDate } from '../src/routes/orders.ts';
import { APP_URL, makeApp, newShop, table5Order } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

const today = bangkokDate();
const month = today.slice(0, 7);

type Shop = Awaited<ReturnType<typeof newShop>>;
const ingredient = async (s: Shop, name: string) =>
  (await s.call('GET', '/api/ingredients')).body.find((i: any) => i.name === name);

async function pay(s: Shop, orderId: string) {
  const r = await s.call('POST', `/api/orders/${orderId}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
  expect(r.status).toBe(201);
  return r.body;
}

describe('recipes and menu costing', () => {
  it('starter fried rice costs 18.50 → 33.0% of its 56.07 pre-VAT price (design doc §4.4)', async () => {
    const s = await newShop(app);
    const menu = (await s.call('GET', '/api/costing/menu')).body;
    const rice = menu.find((m: any) => m.name === 'ข้าวผัดกุ้ง');
    expect(rice.cost).toBe(1850);
    expect(rice.price_ex_vat).toBe(5607);
    expect(rice.food_cost_pct).toBe(33.0);
    expect(rice.margin).toBe(3757);
  });

  it('replaces a recipe and shows the new cost', async () => {
    const s = await newShop(app);
    const egg = await ingredient(s, 'ไข่ไก่');
    const put = await s.call('PUT', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`, { lines: [{ ingredientId: egg.id, qty: 2 }] });
    expect(put.status).toBe(200);
    const r = (await s.call('GET', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`)).body;
    expect(r.cost).toBe(700);
    expect(r.lines).toHaveLength(1);
  });

  it('refuses the same ingredient twice in one recipe', async () => {
    const s = await newShop(app);
    const egg = await ingredient(s, 'ไข่ไก่');
    const r = await s.call('PUT', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`, { lines: [{ ingredientId: egg.id, qty: 1 }, { ingredientId: egg.id, qty: 2 }] });
    expect(r.status).toBe(400);
  });
});

describe('purchases', () => {
  it('VAT shop with a full tax invoice stocks at the ex-VAT cost and records claimable input VAT', async () => {
    const s = await newShop(app);
    const shrimp = await ingredient(s, 'กุ้งสด');
    const r = await s.call('POST', '/api/purchases', {
      purchasedOn: today, supplierName: 'ตลาดไท', supplierTaxId: '0105512345671', invoiceNo: 'IV-001', taxInvoice: true,
      vatMode: 'included', lines: [{ ingredientId: shrimp.id, qty: 2, amount: 38520 }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ subtotal: 36000, input_vat: 2520, total: 38520, vat_claimable: true });
    const after = await ingredient(s, 'กุ้งสด');
    expect(after.on_hand).toBe(2000);
    expect(after.avg_cost).toBe(180_000); // 180 baht/kg = 18 satang/g × 10,000 micro
    const report = (await s.call('GET', `/api/purchases?month=${month}`)).body;
    expect(report.totals.claimableVat).toBe(2520);
  });

  it('without a tax invoice the VAT becomes part of the cost', async () => {
    const s = await newShop(app);
    const oil = await ingredient(s, 'น้ำมันพืช');
    const r = await s.call('POST', '/api/purchases', {
      purchasedOn: today, supplierName: 'ร้านชำ', vatMode: 'included', lines: [{ ingredientId: oil.id, qty: 1, amount: 5350 }],
    });
    expect(r.body.vat_claimable).toBe(false);
    expect((await ingredient(s, 'น้ำมันพืช')).avg_cost).toBe(53_500); // 53.50 per 1000 ml
  });

  it('a claimable purchase needs the supplier tax ID and invoice number', async () => {
    const s = await newShop(app);
    const oil = await ingredient(s, 'น้ำมันพืช');
    const r = await s.call('POST', '/api/purchases', {
      purchasedOn: today, supplierName: 'x', taxInvoice: true, vatMode: 'excluded', lines: [{ ingredientId: oil.id, qty: 1, amount: 5000 }],
    });
    expect(r.status).toBe(400);
  });

  it('weighted average: 1 kg @180 on hand + 1 kg @200 → 190/kg', async () => {
    const s = await newShop(app);
    const shrimp = await ingredient(s, 'กุ้งสด');
    const buy = (amount: number) => s.call('POST', '/api/purchases', {
      purchasedOn: today, supplierName: 'ตลาด', vatMode: 'none', lines: [{ ingredientId: shrimp.id, qty: 1, amount }],
    });
    await buy(18000);
    await buy(20000);
    expect((await ingredient(s, 'กุ้งสด')).avg_cost).toBe(190_000);
  });
});

describe('selling draws stock', () => {
  it('payment takes recipe quantities out of stock and freezes each line cost', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    await pay(s, id);
    const shrimp = await ingredient(s, 'กุ้งสด');
    // 2 fried rice × 40 g + 1 tom yum × 80 g = 160 g usable, drawn at 60% yield
    expect(shrimp.on_hand).toBeCloseTo(-266.6668, 3);
    const report = (await s.call('GET', `/api/reports/menu-profit?month=${month}`)).body;
    const rice = report.items.find((i: any) => i.name === 'ข้าวผัดกุ้ง');
    expect(rice.qty).toBe(2);
    expect(rice.cost).toBe(3700);
    expect(rice.revenue).toBe(11215);
    expect(report.totals.revenue).toBe(33645);
    expect(rice.class).not.toBeNull();
  });

  it('a later price change does not rewrite the frozen cost', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    await pay(s, id);
    const shrimp = await ingredient(s, 'กุ้งสด');
    await s.call('PATCH', `/api/ingredients/${shrimp.id}`, { purchasePrice: 50000 });
    const report = (await s.call('GET', `/api/reports/menu-profit?month=${month}`)).body;
    expect(report.items.find((i: any) => i.name === 'ข้าวผัดกุ้ง').cost).toBe(3700);
  });

  it('voiding a dish the kitchen already made books its ingredients as waste', async () => {
    const s = await newShop(app);
    const o = (await s.call('POST', '/api/orders', { tableId: s.tables[3].id })).body;
    const line = (await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ส้มตำไทย') })).body;
    await s.call('POST', `/api/orders/${o.id}/send`);
    const v = await s.call('POST', `/api/orders/${o.id}/lines/${line.id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' });
    expect(v.status).toBe(200);
    const papaya = await ingredient(s, 'มะละกอ');
    const moves = (await s.call('GET', `/api/ingredients/${papaya.id}/movements`)).body;
    expect(moves[0]).toMatchObject({ kind: 'waste' });
    expect(moves[0].reason).toContain('ลูกค้าเปลี่ยนใจ');
  });
});

describe('waste, counts and P&L', () => {
  it('a stock count books the difference and the P&L adds it all up', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const rice = await ingredient(s, 'ข้าวสวย');
    await s.call('POST', '/api/purchases', { purchasedOn: today, supplierName: 'โรงสี', vatMode: 'none', lines: [{ ingredientId: rice.id, qty: 5, amount: 5000 }] });
    const o = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body;
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย'), qty: 10 }); // 10 × 200 g, sold 100.00
    await s.call('POST', `/api/orders/${o.id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] });

    const w = await s.call('POST', '/api/stock/waste', { ingredientId: rice.id, qty: 500, reason: 'ข้าวบูด' });
    expect(w.body.value).toBe(500);
    // system says 5000 − 2000 − 500 = 2500 g; the shelf has 2300 g
    const count = await s.call('POST', '/api/stock/counts', { lines: [{ ingredientId: rice.id, countedQty: 2300 }] });
    expect(count.body.variance).toBe(-200);
    expect((await ingredient(s, 'ข้าวสวย')).on_hand).toBe(2300);

    await s.call('POST', '/api/expenses', { month, paidOn: today, category: 'rent', description: 'ค่าเช่า', total: 3000, whtRateBp: 500 });
    const pnl = (await s.call('GET', `/api/reports/pnl?month=${month}`)).body;
    expect(pnl.netSales).toBe(10000);
    expect(pnl.cogs).toMatchObject({ food: 2000, waste: 500, countVariance: 200 });
    expect(pnl.grossProfit).toBe(10000 - 2700);
    expect(pnl.expenses.rent).toBe(3000);
    expect(pnl.netProfit).toBe(10000 - 2700 - 3000);

    const variance = (await s.call('GET', `/api/reports/stock-variance?month=${month}`)).body;
    expect(variance.rows[0]).toMatchObject({ name: 'ข้าวสวย', missing_qty: 200, missing_value: 200, used_value: 2000 });
    expect(variance.totals.variancePct).toBe(10);

    const exp = (await s.call('GET', `/api/expenses?month=${month}`)).body;
    expect(exp[0].wht_amount).toBe(150);
  });

  it('waste needs a reason', async () => {
    const s = await newShop(app);
    const rice = await ingredient(s, 'ข้าวสวย');
    expect((await s.call('POST', '/api/stock/waste', { ingredientId: rice.id, qty: 1, reason: '' })).status).toBe(400);
  });
});

describe('isolation and immutability', () => {
  it('one shop never sees another shop’s ingredients', async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    const rice = await ingredient(a, 'ข้าวสวย');
    expect((await b.call('GET', `/api/ingredients/${rice.id}/movements`)).body).toEqual([]);
    const patch = await b.call('PATCH', `/api/ingredients/${rice.id}`, { name: 'ของร้าน B' });
    expect(patch.status).toBe(404);
  });

  it('the stock ledger cannot be edited or deleted, even with the right tenant set', async () => {
    const s = await newShop(app);
    const rice = await ingredient(s, 'ข้าวสวย');
    await s.call('POST', '/api/stock/waste', { ingredientId: rice.id, qty: 10, reason: 'ทดสอบ' });
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [s.tenantId]);
      await expect(c.query(`UPDATE stock_movements SET qty = 0`)).rejects.toThrow();
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [s.tenantId]);
      await expect(c.query(`DELETE FROM stock_movements`)).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});
