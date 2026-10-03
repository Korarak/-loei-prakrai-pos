import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

const names = (rows: any[]) => rows.map((t) => t.name);

describe('shop manages its tables', () => {
  it('sets the number of tables: adds numbered tables, then retires the last free ones', async () => {
    const s = await newShop(app, { vat: false, posId: null }); // 5 tables
    const up = await s.call('PUT', '/api/tables/count', { count: 8 });
    expect(names(up.body)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const down = await s.call('PUT', '/api/tables/count', { count: 3 });
    expect(names(down.body)).toEqual(['1', '2', '3']);
    expect(names((await s.call('GET', '/api/tables')).body)).toEqual(['1', '2', '3']);
  });

  it('never retires a table with an open bill', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    await s.call('POST', '/api/orders', { tableId: s.tables[4].id }); // table 5 busy
    const r = await s.call('PUT', '/api/tables/count', { count: 3 });
    expect(names(r.body)).toEqual(['1', '2', '5']);
    expect((await s.call('DELETE', `/api/tables/${s.tables[4].id}`)).body.error).toBe('table_busy');
    expect((await s.call('PUT', '/api/tables/count', { count: 0 })).status).toBe(409);
  });

  it('renames, changes seats, adds and removes a table; names stay unique', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const t1 = s.tables[0].id;
    expect((await s.call('PATCH', `/api/tables/${t1}`, { name: 'VIP', seats: 10 })).body).toMatchObject({ name: 'VIP', seats: 10 });
    expect((await s.call('PATCH', `/api/tables/${s.tables[1].id}`, { name: 'VIP' })).status).toBe(409);
    expect((await s.call('POST', '/api/tables', { name: 'ระเบียง 1', seats: 2 })).status).toBe(201);
    expect((await s.call('DELETE', `/api/tables/${t1}`)).status).toBe(200);
    // the name is free again once the old table is retired
    expect((await s.call('POST', '/api/tables', { name: 'VIP' })).status).toBe(201);
    // a retired table cannot take new bills
    expect((await s.call('POST', '/api/orders', { tableId: t1 })).status).toBe(404);
  });

  it('a retired table keeps its past bills', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const o = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body;
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย') });
    await s.call('POST', `/api/orders/${o.id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] });
    expect((await s.call('DELETE', `/api/tables/${s.tables[0].id}`)).status).toBe(200);
    expect((await s.call('GET', `/api/orders/${o.id}`)).body.order.table_name).toBe('1');
  });

  it('waiters cannot change the floor plan', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const r = await app.inject({ method: 'PUT', url: '/api/tables/count', payload: { count: 1 } });
    expect(r.statusCode).toBe(401);
    expect((await s.call('PUT', '/api/tables/count', { count: 201 })).status).toBe(400);
  });
});

describe('shop and branch details', () => {
  it('renames the shop and sets the branch code printed on tax invoices', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    await s.call('PATCH', '/api/settings', { name: 'ครัวประกาย' });
    const me = (await s.call('GET', '/api/me')).body;
    expect(me.tenant.name).toBe('ครัวประกาย');
    const br = await s.call('PATCH', `/api/branches/${me.branches[0].id}`, { branchCode: '00001', address: '1 ถ.เจริญรัฐ เมืองเลย' });
    expect(br.body).toMatchObject({ branch_code: '00001' });
    expect((await s.call('PATCH', `/api/branches/${me.branches[0].id}`, { branchCode: '1' })).status).toBe(400);
  });
});
