import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL, makeApp, newShop, table5Order } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('auth', () => {
  it('signs up a shop with a starter menu, tables and one terminal', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const me = (await s.call('GET', '/api/me')).body;
    expect(me.role).toBe('owner');
    expect(me.tenant.status).toBe('trial');
    expect(me.terminals).toHaveLength(1);
    expect(s.tables).toHaveLength(5);
  });

  it('rejects a wrong password and a duplicate email', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: 'password123' } });
    expect(ok.statusCode).toBe(200);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: {
      name: 'x', email: s.email, password: 'password123', shopName: 'x' } });
    expect(dup.statusCode).toBe(409);
  });

  it('refuses requests without a session', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/menu' });
    expect(r.statusCode).toBe(401);
  });

  it('refuses an invalid Thai tax ID in settings', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const r = await s.call('PATCH', '/api/settings', { taxId: '0105512345678' });
    expect(r.status).toBe(400);
  });
});

describe('selling and tax invoices', () => {
  it('prices the table-5 order exactly like the receipt design: 336.45 + 23.55 = 360.00', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const o = (await s.call('GET', `/api/orders/${id}`)).body;
    expect(o.bill.total).toBe(36000);
    expect(o.bill.vatableBase).toBe(33645);
    expect(o.bill.vat).toBe(2355);
  });

  it('adding the same item twice merges into one line', async () => {
    const s = await newShop(app);
    const o = (await s.call('POST', '/api/orders', { tableId: s.tables[1].id })).body;
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย') });
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย') });
    const got = (await s.call('GET', `/api/orders/${o.id}`)).body;
    expect(got.lines).toHaveLength(1);
    expect(got.lines[0].qty).toBe(2);
  });

  it('allows only one open order per table', async () => {
    const s = await newShop(app);
    await s.call('POST', '/api/orders', { tableId: s.tables[2].id });
    const again = await s.call('POST', '/api/orders', { tableId: s.tables[2].id });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('table_busy');
  });

  it('pays cash 500 → ABB P1-YYMM-000001, change 140.00, table freed', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const r = await s.call('POST', `/api/orders/${id}/pay`, {
      terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash', tendered: 50000 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.change).toBe(14000);
    expect(r.body.document.doc_no).toMatch(/^P1-\d{4}-000001$/);
    expect(r.body.document.total).toBe(36000);
    expect(r.body.document.vat).toBe(2355);
    expect(r.body.document.seller.rdPosId).toBe('E0123456789');
    const tables = (await s.call('GET', '/api/tables')).body;
    expect(tables[0].order_id).toBeNull();
    const again = await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    expect(again.status).toBe(409);
  });

  it('blocks abbreviated tax invoices until the terminal has a POS ID', async () => {
    const s = await newShop(app, { posId: null });
    const id = await table5Order(s);
    const r = await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('pos_not_approved');
    // a full tax invoice is still allowed
    const full = await s.call('POST', `/api/orders/${id}/pay`, {
      terminalId: s.terminalId, docType: 'FULL', payments: [{ method: 'transfer' }],
      buyer: { name: 'บริษัท ลูกค้า จำกัด', taxId: '0105512345671', address: '1 ถนนเจริญรัฐ เลย' },
    });
    expect(full.status).toBe(201);
    expect(full.body.document.doc_no).toMatch(/^INV-\d{4}-0001$/);
  });

  it('non-VAT shop issues a receipt with service charge and no VAT', async () => {
    const s = await newShop(app, { vat: false, posId: null, sc: 1000 });
    const id = await table5Order(s);
    const abb = await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    expect(abb.body.error).toBe('not_vat_registered');
    const r = await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'promptpay' }] });
    expect(r.status).toBe(201);
    expect(r.body.document.vat).toBe(0);
    expect(r.body.document.total).toBe(39600); // 360 + 10%
    expect(r.body.document.doc_no).toMatch(/^RC-/);
  });

  it('rejects payments that do not add up', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const r = await s.call('POST', `/api/orders/${id}/pay`, {
      terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash', amount: 20000 }, { method: 'promptpay', amount: 10000 }],
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('amount_mismatch');
    const split = await s.call('POST', `/api/orders/${id}/pay`, {
      terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash', amount: 20000, tendered: 20000 }, { method: 'promptpay', amount: 16000 }],
    });
    expect(split.status).toBe(201);
  });

  it('numbers documents without gaps or duplicates under concurrent payments', async () => {
    const s = await newShop(app);
    await s.call('POST', '/api/tables', { name: 'x' });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const o = (await s.call('POST', '/api/orders', { channel: 'takeaway' })).body;
      await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('น้ำเปล่า') });
      ids.push(o.id);
    }
    const results = await Promise.all(ids.map((id) =>
      s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] })));
    const nums = results.map((r) => Number(r.body.document.doc_no.slice(-6))).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('discounts, voids and permissions', () => {
  it('applies a 10% bill discount before VAT', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const ok = await s.call('PUT', `/api/orders/${id}/discount`, { type: 'percent', value: 1000 });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(32400);
  });

  it('removes unsent lines freely but needs a reason to void a sent line', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const o = (await s.call('GET', `/api/orders/${id}`)).body;
    const rm = await s.call('POST', `/api/orders/${id}/lines/${o.lines[0].id}/void`, {});
    expect(rm.body.removed).toBe(true);
    await s.call('POST', `/api/orders/${id}/send`);
    const noReason = await s.call('POST', `/api/orders/${id}/lines/${o.lines[1].id}/void`, {});
    expect(noReason.status).toBe(400);
    const v = await s.call('POST', `/api/orders/${id}/lines/${o.lines[1].id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' });
    expect(v.body.voided).toBe(true);
    const after = (await s.call('GET', `/api/orders/${id}`)).body;
    expect(after.bill.total).toBe(36000 - 12000 - 12000);
  });

  it('voids a document once, with a reason, and frees nothing else', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const paid = (await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] })).body;
    const docId = paid.document.id;
    expect((await s.call('POST', `/api/documents/${docId}/void`, {})).status).toBe(400);
    const v = await s.call('POST', `/api/documents/${docId}/void`, { reason: 'คิดเงินผิดโต๊ะ' });
    expect(v.body.status).toBe('void');
    expect((await s.call('POST', `/api/documents/${docId}/void`, { reason: 'อีกครั้ง' })).status).toBe(409);
  });

  it('converts an ABB into a full tax invoice with the same amounts', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const abb = (await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] })).body.document;
    const bad = await s.call('POST', `/api/documents/${abb.id}/full`, { buyer: { name: 'x', taxId: '123', address: 'เลย 42000' } });
    expect(bad.status).toBe(400);
    const full = await s.call('POST', `/api/documents/${abb.id}/full`, { buyer: { name: 'บริษัท ลูกค้า จำกัด', taxId: '0105512345671', address: '1 ถนนเจริญรัฐ เลย' } });
    expect(full.status).toBe(201);
    expect(full.body.replaces_doc_id).toBe(abb.id);
    expect([full.body.total, full.body.vat]).toEqual([abb.total, abb.vat]);
    const old = (await s.call('GET', `/api/documents/${abb.id}`)).body;
    expect(old.status).toBe('void');
  });
});

describe('database guarantees (checked directly, bypassing the API)', () => {
  async function asApp<T>(tenantId: string | null, fn: (c: pg.Client) => Promise<T>) {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  }

  it('shop B cannot see or touch shop A data, through the API or raw SQL', async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    const id = await table5Order(a);
    expect((await b.call('GET', `/api/orders/${id}`)).status).toBe(404);
    expect((await b.call('POST', `/api/orders/${id}/lines`, { menuItemId: a.item('ข้าวสวย') })).status).toBe(404);

    const seenByB = await asApp(b.tenantId, (c) => c.query(`SELECT * FROM orders WHERE id = $1`, [id]));
    expect(seenByB.rowCount).toBe(0);
    const noContext = await asApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM orders`));
    expect(noContext.rows[0].n).toBe(0);
    await expect(asApp(b.tenantId, (c) =>
      c.query(`INSERT INTO menu_items (tenant_id, name, price) VALUES ($1, 'แอบใส่', 100)`, [a.tenantId]))).rejects.toThrow(/row-level security/);
  });

  it('tax documents cannot be edited or deleted, even with direct SQL', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    const doc = (await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] })).body.document;
    await expect(asApp(s.tenantId, (c) => c.query(`UPDATE tax_documents SET total = 1 WHERE id = $1`, [doc.id]))).rejects.toThrow(/immutable/);
    await expect(asApp(s.tenantId, (c) => c.query(`DELETE FROM tax_documents WHERE id = $1`, [doc.id]))).rejects.toThrow(/permission denied/);

    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await expect(admin.query(`DELETE FROM tax_documents WHERE id = $1`, [doc.id])).rejects.toThrow(/cannot be deleted/);
    await admin.end();
  });

  it('audit log is a tamper-evident hash chain', async () => {
    const s = await newShop(app);
    const id = await table5Order(s);
    await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    const rows = await asApp(s.tenantId, (c) => c.query(`SELECT prev_hash, hash FROM audit_log ORDER BY id`));
    expect(rows.rowCount).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < rows.rows.length; i++) expect(rows.rows[i].prev_hash).toBe(rows.rows[i - 1].hash);
    await expect(asApp(s.tenantId, (c) => c.query(`UPDATE audit_log SET action = 'x'`))).rejects.toThrow(/permission denied/);
  });
});

describe('reports', () => {
  it('sales-tax report sums one day of ABBs per terminal and lists full invoices separately', async () => {
    const s = await newShop(app);
    for (let i = 0; i < 3; i++) {
      const id = await table5Order(s, i);
      await s.call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    }
    const id = await table5Order(s, 3);
    await s.call('POST', `/api/orders/${id}/pay`, {
      terminalId: s.terminalId, docType: 'FULL', payments: [{ method: 'transfer' }],
      buyer: { name: 'บริษัท ลูกค้า จำกัด', taxId: '0105512345671', address: '1 ถนนเจริญรัฐ เลย' },
    });
    const me = (await s.call('GET', '/api/me')).body;
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7);
    const rep = (await s.call('GET', `/api/reports/sales-tax?month=${month}`)).body;
    expect(rep.rows).toHaveLength(2);
    const abb = rep.rows.find((r: any) => r.doc_type === 'ABB');
    expect(abb.buyer).toBe('3 ใบ');
    expect(abb.total).toBe(108000);
    expect(rep.totals.vat).toBe(2355 * 4);
    const daily = (await s.call('GET', '/api/reports/daily')).body;
    expect(daily.bills).toBe(4);
    expect(me.terminals[0].code).toBe('P1');
  });
});
