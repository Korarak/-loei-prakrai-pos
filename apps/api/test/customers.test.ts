import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

const company = { name: 'บริษัท ลูกค้า จำกัด', taxId: '0105512345671', branch: '00000', address: '99 ถ.เลย-เชียงคาน อ.เมือง จ.เลย', phone: '0812345678' };

describe('customer book', () => {
  it('saves, searches by name / tax ID / phone, and rejects an invalid tax ID', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const made = await s.call('POST', '/api/customers', company);
    expect(made.status).toBe(201);
    expect((await s.call('GET', '/api/customers?q=ลูกค้า')).body).toHaveLength(1);
    expect((await s.call('GET', '/api/customers?q=010551')).body).toHaveLength(1);
    expect((await s.call('GET', '/api/customers?q=0812')).body).toHaveLength(1);
    expect((await s.call('GET', '/api/customers?q=ไม่มี')).body).toHaveLength(0);
    expect((await s.call('POST', '/api/customers', { ...company, taxId: '0105512345678' })).status).toBe(400);
  });

  it('refuses the same tax ID and branch twice but allows another branch', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    await s.call('POST', '/api/customers', company);
    const dup = await s.call('POST', '/api/customers', company);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('customer_exists');
    expect((await s.call('POST', '/api/customers', { ...company, branch: '00001' })).status).toBe(201);
  });

  it('hides deactivated customers from the picker but keeps them for the owner', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const c = (await s.call('POST', '/api/customers', company)).body;
    const upd = await s.call('PUT', `/api/customers/${c.id}`, { ...company, active: false });
    expect(upd.status).toBe(200);
    expect((await s.call('GET', '/api/customers')).body).toHaveLength(0);
    expect((await s.call('GET', '/api/customers?all=1')).body).toHaveLength(1);
  });

  it('keeps each shop\'s customers to itself', async () => {
    const a = await newShop(app, { vat: false, posId: null });
    const b = await newShop(app, { vat: false, posId: null });
    const c = (await a.call('POST', '/api/customers', company)).body;
    expect((await b.call('GET', '/api/customers?all=1')).body).toHaveLength(0);
    expect((await b.call('PUT', `/api/customers/${c.id}`, company)).status).toBe(404);
    // the same company can be a customer of both shops
    expect((await b.call('POST', '/api/customers', company)).status).toBe(201);
  });
});
