import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, makeApp, newShop, table5Order } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

type Shop = Awaited<ReturnType<typeof newShop>>;
const payCash = (s: Shop, id: string, extra: object = {}) =>
  s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }], ...extra });

/** Move a document to yesterday, as if it had been issued then (the guard trigger forbids this for the app). */
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

describe('shifts', () => {
  it('refuses payment until a shift is open on the till', async () => {
    const s = await newShop(app, { shift: false });
    const id = await table5Order(s);
    const r = await payCash(s, id);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('shift_required');
    await s.call('POST', '/api/shifts', { terminalId: s.terminalId, openingFloat: 50000 });
    expect((await payCash(s, id)).status).toBe(201);
  });

  it('allows one open shift per till', async () => {
    const s = await newShop(app);
    const again = await s.call('POST', '/api/shifts', { terminalId: s.terminalId, openingFloat: 0 });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('shift_open');
  });

  it('expects float + cash sales + cash in − cash out and records the difference at close', async () => {
    const s = await newShop(app);   // float 1,000.00
    const cur = (await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body;
    const a = await table5Order(s, 0);
    await payCash(s, a);                                     // cash 360.00
    const b = await table5Order(s, 1);
    await s.call('POST', `/api/orders/${b}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'promptpay' }] });
    await s.call('POST', `/api/shifts/${cur.shift.id}/cash`, { kind: 'in', amount: 20000, reason: 'แลกเหรียญ' });
    await s.call('POST', `/api/shifts/${cur.shift.id}/cash`, { kind: 'out', amount: 15000, reason: 'ซื้อน้ำแข็ง' });

    const x = (await s.call('GET', `/api/shifts/${cur.shift.id}`)).body;
    expect(x.bills).toBe(2);
    expect(x.sales).toBe(72000);
    expect(x.cashSales).toBe(36000);
    expect(x.expectedCash).toBe(100000 + 36000 + 20000 - 15000);

    const z = await s.call('POST', `/api/shifts/${cur.shift.id}/close`, { countedCash: 140000 });
    expect(z.status).toBe(200);
    expect(z.body.shift.status).toBe('closed');
    expect(z.body.difference).toBe(-1000);

    expect((await s.call('POST', `/api/shifts/${cur.shift.id}/cash`, { kind: 'in', amount: 100, reason: 'xx' })).status).toBe(409);
    expect((await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body).toBeNull();
    const day = (await s.call('GET', '/api/shifts')).body;
    expect(day).toHaveLength(1);
  });

  it('leaves a voided bill out of the drawer total', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const doc = (await payCash(s, id)).body.document;
    await s.call('POST', `/api/documents/${doc.id}/void`, { reason: 'คิดเงินผิดโต๊ะ' });
    const x = (await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body;
    expect(x.cashSales).toBe(0);
    expect(x.expectedCash).toBe(100000);
  });
});

describe('credit notes', () => {
  it('credits an earlier day’s tax invoice, refunds cash from the drawer and reduces the sales tax report', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const doc = (await payCash(s, id)).body.document;
    await backdate(doc.id);

    const voided = await s.call('POST', `/api/documents/${doc.id}/void`, { reason: 'ลูกค้าคืนของ' });
    expect(voided.body.error).toBe('use_credit_note');

    const cn = await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'อาหารไม่ได้มาตรฐาน คืนเงินทั้งบิล' });
    expect(cn.status).toBe(201);
    expect(cn.body.doc_type).toBe('CN');
    expect(cn.body.doc_no).toMatch(/^CN-\d{4}-0001$/);
    expect(cn.body.total).toBe(36000);
    expect(cn.body.vat).toBe(2355);

    const again = await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'ซ้ำ ซ้ำ' });
    expect(again.body.error).toBe('already_credited');

    const shown = (await s.call('GET', `/api/documents/${cn.body.id}`)).body;
    expect(shown.credits.doc_no).toBe(doc.doc_no);
    expect(shown.reason).toMatch(/ไม่ได้มาตรฐาน/);
    expect((await s.call('GET', `/api/documents/${doc.id}`)).body.credit_notes[0].doc_no).toBe(cn.body.doc_no);

    const x = (await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body;
    expect(x.cashOut).toBe(36000);

    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7);
    const rep = (await s.call('GET', `/api/reports/sales-tax?month=${month}`)).body;
    const cnRow = rep.rows.find((r: any) => r.doc_type === 'CN');
    expect(cnRow.vat).toBe(-2355);
    expect(cnRow.buyer).toContain(doc.doc_no);
  });

  it('is only for tax invoices and needs a manager', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const id = await table5Order(s);
    const doc = (await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] })).body.document;
    const r = await s.call('POST', `/api/documents/${doc.id}/credit-note`, { reason: 'ทดสอบ' });
    expect(r.body.error).toBe('not_creditable');
    // a receipt from an earlier day is simply voided
    await backdate(doc.id);
    expect((await s.call('POST', `/api/documents/${doc.id}/void`, { reason: 'ลูกค้ายกเลิก' })).status).toBe(200);
  });
});

describe('kitchen tickets', () => {
  it('stamps each send as one batch and tells the ticket which station cooks it', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const first = (await s.call('POST', `/api/orders/${id}/send`)).body;
    expect(first.sent).toHaveLength(4);
    await s.call('POST', `/api/orders/${id}/lines`, { menuItemId: s.item('น้ำเปล่า'), qty: 2 });
    const second = (await s.call('POST', `/api/orders/${id}/send`)).body;
    expect(second.sent).toHaveLength(1);
    expect(second.sentAt).not.toBe(first.sentAt);
    const o = (await s.call('GET', `/api/orders/${id}`)).body;
    const water = o.lines.find((l: any) => l.name === 'น้ำเปล่า');
    expect(water.station).toBe('bar');
    expect(water.sent_at).toBe(second.sentAt);
  });
});
