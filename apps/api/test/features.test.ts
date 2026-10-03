import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { bangkokDate } from '../src/routes/orders.ts';
import { ADMIN_URL, makeApp, newShop, table5Order } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

type Shop = Awaited<ReturnType<typeof newShop>>;
const month = bangkokDate().slice(0, 7);
const ingredient = async (s: Shop, name: string) =>
  (await s.call('GET', '/api/ingredients')).body.find((i: any) => i.name === name);
const payCash = (s: Shop, id: string) =>
  s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });

async function backdate(docId: string) {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('ALTER TABLE tax_documents DISABLE TRIGGER tax_documents_guard');
    await admin.query(`UPDATE tax_documents SET issued_at = issued_at - interval '1 day' WHERE id = $1`, [docId]);
  } finally {
    await admin.query('ALTER TABLE tax_documents ENABLE TRIGGER tax_documents_guard');
    await admin.end();
  }
}

describe('PromptPay', () => {
  it('saves a phone number without dashes and refuses anything else', async () => {
    const s = await newShop(app);
    expect((await s.call('PATCH', '/api/settings', { promptpayId: '081-234-5678' })).status).toBe(200);
    expect((await s.call('GET', '/api/me')).body.tenant.promptpay_id).toBe('0812345678');
    expect((await s.call('PATCH', '/api/settings', { promptpayId: '12345' })).status).toBe(400);
    await s.call('PATCH', '/api/settings', { promptpayId: '' });
    expect((await s.call('GET', '/api/me')).body.tenant.promptpay_id).toBeNull();
  });
});

describe('moving, merging and splitting bills', () => {
  it('moves a bill to a free table and refuses a busy one', async () => {
    const s = await newShop(app);
    const a = await table5Order(s, 0);
    await s.call('POST', '/api/orders', { tableId: s.tables[2].id });
    expect((await s.call('POST', `/api/orders/${a}/move`, { tableId: s.tables[2].id })).body.error).toBe('table_busy');
    expect((await s.call('POST', `/api/orders/${a}/move`, { tableId: s.tables[1].id })).status).toBe(200);
    const tables = (await s.call('GET', '/api/tables')).body;
    expect(tables[0].order_id).toBeNull();
    expect(tables[1].order_id).toBe(a);
  });

  it('merges another table’s bill into this one and frees that table', async () => {
    const s = await newShop(app);
    const a = await table5Order(s, 0);
    const b = (await s.call('POST', '/api/orders', { tableId: s.tables[1].id, guests: 2 })).body.id;
    await s.call('POST', `/api/orders/${b}/lines`, { menuItemId: s.item('น้ำเปล่า'), qty: 2 });
    expect((await s.call('POST', `/api/orders/${a}/merge`, { fromOrderId: b })).body.moved).toBe(1);
    const got = (await s.call('GET', `/api/orders/${a}`)).body;
    expect(got.bill.total).toBe(36000 + 3000);
    expect(got.order.guests).toBe(6);
    const src = (await s.call('GET', `/api/orders/${b}`)).body;
    expect(src.order.status).toBe('void');
    expect(src.merged_into).toBe(a);
    expect((await s.call('GET', '/api/tables')).body[1].order_id).toBeNull();
  });

  it('splits part of a line off into its own bill; both bills add up to the original', async () => {
    const s = await newShop(app);
    const a = await table5Order(s, 0);
    const lines = (await s.call('GET', `/api/orders/${a}`)).body.lines;
    const rice = lines.find((l: any) => l.name === 'ข้าวผัดกุ้ง');
    const tea = lines.find((l: any) => l.name === 'ชาไทยเย็น');
    const all = lines.map((l: any) => ({ lineId: l.id, qty: l.qty }));
    expect((await s.call('POST', `/api/orders/${a}/split`, { lines: all })).body.error).toBe('split_all');
    expect((await s.call('POST', `/api/orders/${a}/split`, { lines: [{ lineId: rice.id, qty: 3 }] })).body.error).toBe('qty_over');

    const child = await s.call('POST', `/api/orders/${a}/split`, { lines: [{ lineId: rice.id, qty: 1 }, { lineId: tea.id, qty: 2 }] });
    expect(child.status).toBe(201);
    const c = (await s.call('GET', `/api/orders/${child.body.id}`)).body;
    const p = (await s.call('GET', `/api/orders/${a}`)).body;
    expect(c.bill.total).toBe(6000 + 7000);
    expect(p.bill.total + c.bill.total).toBe(36000);
    expect(c.parent.table_name).toBe(s.tables[0].name);
    expect(p.splits).toHaveLength(1);
    expect((await s.call('GET', '/api/tables')).body[0].splits).toBe(1);

    expect((await payCash(s, child.body.id)).status).toBe(201);
    expect((await payCash(s, a)).status).toBe(201);
  });
});

describe('sub-recipes', () => {
  async function sauce(s: Shop) {
    const seasoning = await ingredient(s, 'ชุดเครื่องปรุง');   // 25.00 per 100 → 0.25 each
    const oil = await ingredient(s, 'น้ำมันพืช');              // 50.00 per litre → 0.05 per ml
    const prep = (await s.call('POST', '/api/ingredients', {
      name: 'น้ำจิ้มซีฟู้ด', baseUnit: 'ml', purchaseUnit: 'หม้อ', purchaseFactor: 500, isPrep: true, batchYield: 500,
    })).body;
    const put = await s.call('PUT', `/api/ingredients/${prep.id}/prep`, {
      lines: [{ ingredientId: seasoning.id, qty: 10 }, { ingredientId: oil.id, qty: 100 }],
    });
    expect(put.status).toBe(200);
    return { prep, seasoning, oil };
  }

  it('costs a prep item from its batch and carries it into the menu cost', async () => {
    const s = await newShop(app);
    const { prep } = await sauce(s);
    const view = (await s.call('GET', `/api/ingredients/${prep.id}/prep`)).body;
    expect(view.batchCost).toBe(750);                 // 10 × 0.25 + 100 × 0.05
    expect(view.prep.unit_cost).toBe(15_000);          // 1.5 satang per ml in micro
    await s.call('PUT', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`, { lines: [{ ingredientId: prep.id, qty: 50 }] });
    const r = (await s.call('GET', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`)).body;
    expect(r.cost).toBe(75);
    const listed = await ingredient(s, 'น้ำจิ้มซีฟู้ด');
    expect(listed.avg_cost).toBe(15_000);
  });

  it('selling draws the purchased components, never the prep item itself', async () => {
    const s = await newShop(app);
    const { prep, seasoning, oil } = await sauce(s);
    await s.call('PUT', `/api/menu/items/${s.item('ข้าวสวย')}/recipe`, { lines: [{ ingredientId: prep.id, qty: 50 }] });
    const o = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body;
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย'), qty: 2 });
    expect((await payCash(s, o.id)).status).toBe(201);
    expect((await ingredient(s, 'ชุดเครื่องปรุง')).on_hand).toBe(seasoning.on_hand - 2);
    expect((await ingredient(s, 'น้ำมันพืช')).on_hand).toBe(oil.on_hand - 20);
    expect((await ingredient(s, 'น้ำจิ้มซีฟู้ด')).on_hand).toBe(0);
    const menu = (await s.call('GET', `/api/reports/menu-profit?month=${month}`)).body;
    expect(menu.items.find((i: any) => i.name === 'ข้าวสวย').cost).toBe(150);
  });

  it('refuses loops, purchases of a prep item, and wastes its components instead', async () => {
    const s = await newShop(app);
    const { prep, oil } = await sauce(s);
    expect((await s.call('PUT', `/api/ingredients/${prep.id}/prep`, { lines: [{ ingredientId: prep.id, qty: 1 }] })).body.error).toBe('prep_cycle');
    const outer = (await s.call('POST', '/api/ingredients', {
      name: 'ซอสผัด', baseUnit: 'ml', purchaseUnit: 'หม้อ', purchaseFactor: 1000, isPrep: true, batchYield: 1000,
    })).body;
    await s.call('PUT', `/api/ingredients/${outer.id}/prep`, { lines: [{ ingredientId: prep.id, qty: 500 }] });
    expect((await s.call('PUT', `/api/ingredients/${prep.id}/prep`, { lines: [{ ingredientId: outer.id, qty: 1 }] })).body.error).toBe('prep_cycle');

    const buy = await s.call('POST', '/api/purchases', {
      purchasedOn: bangkokDate(), supplierName: 'x', vatMode: 'none', lines: [{ ingredientId: prep.id, qty: 1, amount: 100 }],
    });
    expect(buy.body.error).toBe('prep_not_purchasable');

    const w = await s.call('POST', '/api/stock/waste', { ingredientId: prep.id, qty: 250, reason: 'บูดทั้งหม้อ' });
    expect(w.status).toBe(201);
    expect(w.body.value).toBe(375);                    // half a batch
    expect((await ingredient(s, 'น้ำมันพืช')).on_hand).toBe(oil.on_hand - 50);
  });
});

describe('partial credit notes', () => {
  it('credits one dish at its VAT-inclusive price, then the rest exactly', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const doc = (await payCash(s, id)).body.document;
    await backdate(doc.id);
    const riceIdx = doc.lines.findIndex((l: any) => l.name === 'ข้าวผัดกุ้ง');

    const one = await s.call('POST', `/api/documents/${doc.id}/credit-note`, {
      reason: 'ข้าวผัดจานหนึ่งไม่ได้เสิร์ฟ', refund: 'none', lines: [{ index: riceIdx, qty: 1 }],
    });
    expect(one.status).toBe(201);
    expect(one.body).toMatchObject({ total: 6000, vat: 393, vatable_base: 5607 });
    expect(one.body.lines).toHaveLength(1);

    const over = await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'เกินจำนวน', lines: [{ index: riceIdx, qty: 2 }] });
    expect(over.body.error).toBe('qty_over');

    const shown = (await s.call('GET', `/api/documents/${doc.id}`)).body;
    expect(shown.remaining[riceIdx]).toBe(1);
    expect(shown.credit_notes).toHaveLength(1);
    expect((await s.call('GET', `/api/documents/${one.body.id}`)).body.credits.corrected_total).toBe(30000);

    const rest = await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'ลูกค้าคืนที่เหลือ', refund: 'none' });
    expect(rest.body).toMatchObject({ total: 30000, vat: 2355 - 393 });
    expect((await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'อีกครั้ง' })).body.error).toBe('already_credited');
  });
});

describe('ภ.พ.30', () => {
  it('nets output VAT after credit notes against claimable input VAT', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const doc = (await payCash(s, id)).body.document;            // VAT 23.55
    await backdate(doc.id);
    const riceIdx = doc.lines.findIndex((l: any) => l.name === 'ข้าวผัดกุ้ง');
    await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'คืนหนึ่งจาน', refund: 'none', lines: [{ index: riceIdx, qty: 1 }] });
    const shrimp = await ingredient(s, 'กุ้งสด');
    await s.call('POST', '/api/purchases', {
      purchasedOn: bangkokDate(), supplierName: 'ตลาดไท', supplierTaxId: '0105512345671', invoiceNo: 'IV-9', taxInvoice: true,
      vatMode: 'included', lines: [{ ingredientId: shrimp.id, qty: 1, amount: 10700 }],
    });                                                          // input VAT 7.00
    await s.call('POST', '/api/purchases', {
      purchasedOn: bangkokDate(), supplierName: 'ร้านชำ', vatMode: 'included', lines: [{ ingredientId: shrimp.id, qty: 1, amount: 10700 }],
    });                                                          // no tax invoice: not claimable
    const r = (await s.call('GET', `/api/reports/vat-return?month=${month}`)).body;
    // the backdated sale may fall in last month on the 1st; the credit note is always this month
    const sameMonth = bangkokDate(new Date(Date.now() - 86_400_000)).slice(0, 7) === month;
    expect(r.summary.outputVat).toBe(sameMonth ? 2355 - 393 : -393);
    expect(r.summary.inputVat).toBe(700);
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]).toMatchObject({ tax_id: '0105512345671', doc_no: 'IV-9', vat: 700 });
    expect(r.summary.creditNotes).toBe(1);
    const net = r.summary.outputVat - 700;
    expect(r.summary.payable).toBe(Math.max(net, 0));
    expect(r.summary.credit).toBe(Math.max(-net, 0));
  });
});
