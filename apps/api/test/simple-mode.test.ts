import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { EXPORT_SKIPPED, EXPORT_TABLES } from '../src/routes/shop.ts';
import { ADMIN_URL, makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

async function signup(mode?: 'simple' | 'full', template?: string) {
  const email = `s${Date.now()}${Math.random().toString(16).slice(2)}@test.local`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: {
    name: 'เจ้าของ', email, password: 'password123', shopName: 'ร้านง่าย', tableCount: 3, mode, template,
  } });
  expect(r.statusCode).toBe(201);
  const { token } = r.json();
  const call = async (method: string, url: string, payload?: unknown) => {
    const x = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
    return { status: x.statusCode, body: x.body ? x.json() : null };
  };
  const me = (await call('GET', '/api/me')).body;
  return { call, me, terminalId: me.terminals[0].id as string };
}

async function payFirstDish(s: Awaited<ReturnType<typeof signup>>) {
  const menu = (await s.call('GET', '/api/menu')).body;
  const o = (await s.call('POST', '/api/orders', { channel: 'takeaway' })).body;
  await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: menu.items.find((i: any) => i.name === 'ข้าวสวย').id });
  return s.call('POST', `/api/orders/${o.id}/pay`, { terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash' }] });
}

describe('simple mode', () => {
  it('defaults to full, and a shop can choose simple at sign-up', async () => {
    expect((await signup()).me.tenant.ui_mode).toBe('full');
    expect((await signup('simple')).me.tenant.ui_mode).toBe('simple');
  });

  it('opens the cash shift by itself on the first payment, once', async () => {
    const s = await signup('simple');
    expect((await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body).toBeNull();
    const r = await payFirstDish(s);
    expect(r.status).toBe(201);
    const shift = (await s.call('GET', `/api/shifts/current?terminalId=${s.terminalId}`)).body;
    expect(shift.shift).toMatchObject({ opening_float: 0, status: 'open' });
    expect((await payFirstDish(s)).status).toBe(201); // reuses the open shift
  });

  it('full mode still refuses payment without a shift', async () => {
    const s = await signup('full');
    const r = await payFirstDish(s);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('shift_required');
  });

  it('sells a menu without any recipes or stock', async () => {
    const s = await signup('simple');
    const { body: ing } = await s.call('GET', '/api/ingredients');
    expect(ing).toEqual([]);
    expect((await payFirstDish(s)).status).toBe(201);
  });

  it('simple steak template brings the menu only (no recipes, no required options)', async () => {
    const s = await signup('simple', 'steak');
    const menu = (await s.call('GET', '/api/menu')).body;
    expect(menu.items.length).toBeGreaterThan(10);
    expect(menu.groups).toEqual([]);
  });

  it('switching mode keeps all data; only the owner may switch', async () => {
    const s = await signup('full');
    const before = (await s.call('GET', '/api/ingredients')).body.length;
    expect(before).toBeGreaterThan(0);
    expect((await s.call('PATCH', '/api/settings', { uiMode: 'simple' })).body.ui_mode).toBe('simple');
    expect((await s.call('GET', '/api/ingredients')).body.length).toBe(before);
    expect((await s.call('PATCH', '/api/settings', { uiMode: 'bogus' })).status).toBe(400);
  });
});

describe('per-shop bill numbers', () => {
  it('start at 1 for every shop and count up', async () => {
    const a = await newShop(app, { vat: false, posId: null });
    const b = await newShop(app, { vat: false, posId: null });
    const nos = async (s: typeof a) => {
      const out: number[] = [];
      for (let i = 0; i < 2; i++) out.push((await s.call('GET', `/api/orders/${(await s.call('POST', '/api/orders', { channel: 'takeaway' })).body.id}`)).body.order.bill_no);
      return out;
    };
    expect(await nos(a)).toEqual([1, 2]);
    expect(await nos(b)).toEqual([1, 2]);
  });
});

describe('data export', () => {
  it('covers every shop table (add new tables to EXPORT_TABLES)', async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const r = await admin.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`);
    await admin.end();
    const shopTables = r.rows.map((x) => x.relname as string);
    const missing = shopTables.filter((t) => !(EXPORT_TABLES as readonly string[]).includes(t) && !(EXPORT_SKIPPED as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });
});

describe('simple sign-up defaults', () => {
  it('leaves QR ordering off for simple shops and on for full shops', async () => {
    const simple = await signup('simple');
    const full = await signup('full');
    expect((await simple.call('GET', '/api/qr/links')).body.enabled).toBe(false);
    expect((await full.call('GET', '/api/qr/links')).body.enabled).toBe(true);
  });
});
