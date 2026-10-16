import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, newShop, table5Order } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

type Shop = Awaited<ReturnType<typeof newShop>>;

/** Register a device as the owner and return its cookie. */
async function registerDevice(s: Shop, terminalId: string | null = null) {
  const r = await s.call('POST', '/api/devices', { name: 'แท็บเล็ตหน้าร้าน', terminalId });
  expect(r.status).toBe(201);
  const me = await app.inject({ method: 'POST', url: '/api/devices', payload: { name: 'x' }, headers: { authorization: `Bearer ${await ownerToken(s)}` } });
  const cookie = String(me.headers['set-cookie']).match(/prakai_device=([^;]+)/)![1]!;
  return { id: me.json().id as string, cookie: `prakai_device=${cookie}` };
}
async function ownerToken(s: Shop) {
  return (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: 'password123' } })).json().token as string;
}

const pinLogin = (cookie: string | null, userId: string, pin: string) =>
  app.inject({ method: 'POST', url: '/api/auth/pin', payload: { userId, pin }, headers: cookie ? { cookie } : {} });

const as = (token: string) => async (method: string, url: string, payload?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

describe('staff and PIN sign-in', () => {
  it('owner adds a cashier; weak PINs are refused', async () => {
    const s = await newShop(app);
    for (const pin of ['123456', '111111', '654321', '12345']) {
      expect((await s.call('POST', '/api/staff', { name: 'สมใจ', role: 'cashier', pin })).status).toBe(400);
    }
    const r = await s.call('POST', '/api/staff', { name: 'สมใจ', role: 'cashier', pin: '482913' });
    expect(r.status).toBe(201);
    const staff = (await s.call('GET', '/api/staff')).body;
    expect(staff.map((x: any) => [x.name, x.role])).toEqual([['เจ้าของ', 'owner'], ['สมใจ', 'cashier']]);
  });

  it('PIN works only on a registered device, and signs in with that role', async () => {
    const s = await newShop(app);
    const cashier = (await s.call('POST', '/api/staff', { name: 'สมใจ', role: 'cashier', pin: '482913' })).body;
    expect((await pinLogin(null, cashier.id, '482913')).statusCode).toBe(403);

    const dev = await registerDevice(s);
    const lock = await app.inject({ method: 'GET', url: '/api/auth/device', headers: { cookie: dev.cookie } });
    expect(lock.json().staff.map((x: any) => x.name)).toEqual(['สมใจ']); // the owner has no PIN yet

    const ok = await pinLogin(dev.cookie, cashier.id, '482913');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe('cashier');
    const call = as(ok.json().token);
    expect((await call('GET', '/api/staff')).status).toBe(403);
    const id = await table5Order(s);
    const paid = await call('POST', `/api/orders/${id}/pay`, { terminalId: s.terminalId, docType: 'ABB', payments: [{ method: 'cash' }] });
    expect(paid.status).toBe(201);
  });

  it('five wrong PINs lock the account for five minutes', async () => {
    const s = await newShop(app);
    const u = (await s.call('POST', '/api/staff', { name: 'ต้น', role: 'waiter', pin: '550812' })).body;
    const dev = await registerDevice(s);
    for (let i = 1; i <= 4; i++) {
      const r = await pinLogin(dev.cookie, u.id, '000001');
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toBe(`${5 - i} tries left`);
    }
    expect((await pinLogin(dev.cookie, u.id, '000001')).statusCode).toBe(423);
    expect((await pinLogin(dev.cookie, u.id, '550812')).statusCode).toBe(423); // even the right PIN waits
    expect((await s.call('GET', '/api/staff')).body.find((x: any) => x.id === u.id).locked).toBe(true);
    // the owner setting a new PIN clears the lock
    await s.call('PATCH', `/api/staff/${u.id}`, { pin: '739104' });
    expect((await pinLogin(dev.cookie, u.id, '739104')).statusCode).toBe(200);
  });

  it('deactivating or demoting someone takes effect on their very next request', async () => {
    const s = await newShop(app);
    const u = (await s.call('POST', '/api/staff', { name: 'แอน', role: 'manager', pin: '902817' })).body;
    const dev = await registerDevice(s);
    const call = as((await pinLogin(dev.cookie, u.id, '902817')).json().token);
    expect((await call('GET', '/api/reports/sales-tax?month=2026-09')).status).toBe(200);
    await s.call('PATCH', `/api/staff/${u.id}`, { role: 'waiter' });
    expect((await call('GET', '/api/reports/sales-tax?month=2026-09')).status).toBe(403);
    await s.call('PATCH', `/api/staff/${u.id}`, { active: false });
    expect((await call('GET', '/api/tables')).status).toBe(401);
    expect((await pinLogin(dev.cookie, u.id, '902817')).statusCode).toBe(401);
  });

  it('the owner cannot be demoted or switched off', async () => {
    const s = await newShop(app);
    const me = (await s.call('GET', '/api/me')).body;
    expect((await s.call('PATCH', `/api/staff/${me.user.id}`, { active: false })).status).toBe(409);
    expect((await s.call('PATCH', `/api/staff/${me.user.id}`, { role: 'manager' })).status).toBe(409);
    expect((await s.call('PATCH', `/api/staff/${me.user.id}`, { pin: '280461' })).status).toBe(200);
  });

  it('a revoked device and another shop’s device cannot sign anyone in', async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    const ua = (await a.call('POST', '/api/staff', { name: 'เอ', role: 'cashier', pin: '472819' })).body;
    const devB = await registerDevice(b);
    expect((await pinLogin(devB.cookie, ua.id, '472819')).statusCode).toBe(401);
    const devA = await registerDevice(a);
    await a.call('POST', `/api/devices/${devA.id}/revoke`);
    expect((await pinLogin(devA.cookie, ua.id, '472819')).statusCode).toBe(403);
  });
});

describe('terminals, categories and export', () => {
  it('adds a second till with the next code and binds a device to it', async () => {
    const s = await newShop(app);
    const t = await s.call('POST', '/api/terminals', { name: 'เครื่องบาร์' });
    expect(t.body.code).toBe('P2');
    const dev = await registerDevice(s, t.body.id);
    await s.call('PATCH', `/api/devices/${dev.id}`, { terminalId: t.body.id });
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${await ownerToken(s)}`, cookie: dev.cookie } });
    expect(me.json().device.terminal_id).toBe(t.body.id);
  });

  it('manages menu categories: add, rename, reorder, and refuses to delete one in use', async () => {
    const s = await newShop(app);
    const k = (await s.call('POST', '/api/menu/categories', { name: 'ของว่าง' })).body;
    await s.call('PATCH', `/api/menu/categories/${k.id}`, { name: 'ของทานเล่น' });
    const moved = (await s.call('POST', `/api/menu/categories/${k.id}/move`, { dir: 'up' })).body;
    expect(moved.at(-2).name).toBe('ของทานเล่น');
    const first = moved[0];
    expect((await s.call('DELETE', `/api/menu/categories/${first.id}`)).body.error).toBe('category_in_use');
    expect((await s.call('DELETE', `/api/menu/categories/${k.id}`)).status).toBe(200);
  });

  it('sets category and dish order in one call, and puts new or moved dishes last', async () => {
    const s = await newShop(app);
    const cats = (await s.call('GET', '/api/menu')).body.categories;
    const reversed = [...cats].reverse().map((c: any) => c.id);
    const after = (await s.call('PUT', '/api/menu/categories/order', { ids: reversed })).body;
    expect(after.map((c: any) => c.id)).toEqual(reversed);

    const menu = (await s.call('GET', '/api/menu')).body;
    const catId = cats[0].id;
    const inCat = menu.items.filter((i: any) => i.category_id === catId).map((i: any) => i.id);
    const flipped = [...inCat].reverse();
    await s.call('PUT', '/api/menu/items/order', { categoryId: catId, ids: flipped });
    const again = (await s.call('GET', '/api/menu')).body.items.filter((i: any) => i.category_id === catId).map((i: any) => i.id);
    expect(again).toEqual(flipped);

    const added = (await s.call('POST', '/api/menu/items', { categoryId: catId, name: 'เมนูใหม่', price: 5000 })).body;
    const last = (await s.call('GET', '/api/menu')).body.items.filter((i: any) => i.category_id === catId).at(-1);
    expect(last.id).toBe(added.id);
  });

  it('exports all shop data without secrets', async () => {
    const s = await newShop(app);
    await s.call('POST', '/api/staff', { name: 'สมใจ', role: 'cashier', pin: '482913' });
    const r = await app.inject({ method: 'GET', url: '/api/export', headers: { authorization: `Bearer ${await ownerToken(s)}` } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="prakai-r-/);
    const body = r.json();
    expect(body.menu_items.length).toBe(12);
    expect(body.staff).toHaveLength(2);
    expect(r.body).not.toMatch(/pin_hash|password_hash|token_hash|\$argon2/);
  });
});

describe('document numbers with several tills', () => {
  it('receipts from a second till never repeat the first till’s numbers', async () => {
    const s = await newShop(app, { vat: false, posId: null });
    const p2 = (await s.call('POST', '/api/terminals', { name: 'เครื่องบาร์' })).body;
    await s.call('POST', '/api/shifts', { terminalId: p2.id, openingFloat: 0 });
    const sell = async (terminalId: string, table: number) => {
      const o = (await s.call('POST', '/api/orders', { tableId: s.tables[table].id })).body;
      await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: s.item('ข้าวสวย') });
      return (await s.call('POST', `/api/orders/${o.id}/pay`, { terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] })).body.document.doc_no as string;
    };
    const a = await sell(s.terminalId, 0);
    const b = await sell(p2.id, 1);
    expect(a).toMatch(/^RC-\d{4}-0001$/);
    expect(b).toMatch(/^RCP2-\d{4}-0001$/);
  });
});
