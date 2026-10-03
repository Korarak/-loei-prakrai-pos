import { afterAll, describe, expect, it } from 'vitest';
import { bangkokDate } from '../src/routes/orders.ts';
import { makeApp, newShop } from './helpers.ts';

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

async function sellRice(s: Shop, qty: number) {
  const o = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body;
  await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย'), qty });
  const r = await s.call('POST', `/api/orders/${o.id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] });
  expect(r.status).toBe(201);
}

describe('รายงานสินค้าและวัตถุดิบ (ม.87(3))', () => {
  it('lists received, issued and carried-forward stock with a card per ingredient', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const rice = await ingredient(s, 'ข้าวสวย');
    await s.call('POST', '/api/purchases', {
      purchasedOn: today, supplierName: 'โรงสี', invoiceNo: 'INV-9', vatMode: 'none', lines: [{ ingredientId: rice.id, qty: 5, amount: 5000 }],
    });
    await sellRice(s, 6);   // 1200 g
    await sellRice(s, 4);   //  800 g
    await s.call('POST', '/api/stock/waste', { ingredientId: rice.id, qty: 500, reason: 'ข้าวบูด' });
    await s.call('POST', '/api/stock/counts', { lines: [{ ingredientId: rice.id, countedQty: 2300 }] });

    const r = await s.call('GET', `/api/reports/inventory?month=${month}`);
    expect(r.status).toBe(200);
    const row = r.body.rows.find((x: any) => x.id === rice.id);
    expect(row).toMatchObject({
      unit: 'g', openQty: 0, received: 5000, receivedValue: 5000, sold: 2000, soldValue: 2000,
      waste: 500, wasteValue: 500, adjust: -200, adjustValue: -200, closeQty: 2300, closeValue: 2300,
    });
    expect(row.closeQty).toBe((await ingredient(s, 'ข้าวสวย')).on_hand);

    // purchase, waste and count one by one; both bills of the day on one sales line at the end of the day
    expect(row.lines.map((l: any) => [l.text, l.inQty, l.outQty, l.balance])).toEqual([
      ['ซื้อจาก โรงสี', 5000, 0, 5000],
      ['ของเสีย: ข้าวบูด', 0, 500, 4500],
      ['นับสต็อกได้ขาดยอด', 0, 200, 4300],
      ['ขายตามสูตร 2 บิล', 0, 2000, 2300],
    ]);
    expect(row.lines[0].doc).toBe('INV-9');
    expect(row.lines[3].doc).toMatch(/ – /);
    expect(r.body.totals.closeValue).toBe(r.body.rows.reduce((t: number, x: any) => t + x.closeValue, 0));
  });

  it('carries the closing stock forward and leaves untouched ingredients out', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const rice = await ingredient(s, 'ข้าวสวย');
    await s.call('POST', '/api/purchases', { purchasedOn: today, supplierName: 'โรงสี', vatMode: 'none', lines: [{ ingredientId: rice.id, qty: 1, amount: 1000 }] });
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const r = (await s.call('GET', `/api/reports/inventory?month=${next}`)).body;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'ข้าวสวย', openQty: 1000, openValue: 1000, closeQty: 1000, lines: [] });
    expect((await s.call('GET', '/api/reports/inventory?month=2000-01')).body.rows).toEqual([]);
  });

  it('rejects a malformed month', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    expect((await s.call('GET', '/api/reports/inventory?month=bad')).status).toBe(400);
  });
});

describe('เอกสารประกอบ ภ.พ.06', () => {
  it('returns the tills and the latest document of each kind as samples', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    await sellRice(s, 1);
    const r = await s.call('GET', '/api/reports/pp06');
    expect(r.status).toBe(200);
    expect(r.body.terminals).toHaveLength(1);
    expect(r.body.terminals[0]).toMatchObject({ code: 'P1', branch_code: '00000' });
    expect(r.body.samples).toHaveLength(1);
    expect(r.body.samples[0]).toMatchObject({ doc_type: 'RECEIPT', terminal_id: s.terminalId });
  });
});
