import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/db.ts';

export const APP_URL = 'postgres://prakai_app:apppass@127.0.0.1:5433/prakai_test';
export const ADMIN_URL = 'postgres://postgres:devpass@127.0.0.1:5433/prakai_test';

export function makeApp() {
  const db = createPool(APP_URL);
  const app = buildApp({ db, jwtSecret: 'test-secret-test-secret-test-secret', uploadDir: mkdtempSync(join(tmpdir(), 'prakai-up-')) });
  return { app, db };
}

type App = ReturnType<typeof makeApp>['app'];
let n = 0;

/** Sign up a fresh shop and return a request helper bound to its owner. */
export async function newShop(app: App, opts: { vat?: boolean; posId?: string | null; sc?: number; shift?: boolean } = {}) {
  n++;
  const email = `owner${n}-${Date.now()}@test.local`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: {
    name: 'เจ้าของ', email, password: 'password123', shopName: `ร้านทดสอบ ${n}`, tableCount: 5,
  } });
  if (res.statusCode !== 201) throw new Error(res.body);
  const { token, tenantId } = res.json();
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  if (opts.vat !== false) {
    await call('PATCH', '/api/settings', { vatRegistered: true, legalName: 'บริษัท ทดสอบ จำกัด', taxId: '0105512345671', address: 'เลย' });
  }
  if (opts.sc !== undefined) await call('PATCH', '/api/settings', { serviceChargeBp: opts.sc });
  const me = (await call('GET', '/api/me')).body;
  const terminalId: string = me.terminals[0].id;
  if (opts.posId !== null) await call('PATCH', `/api/terminals/${terminalId}`, { rdPosId: opts.posId ?? 'E0123456789' });
  // Payments need an open shift on the till.
  if (opts.shift !== false) await call('POST', '/api/shifts', { terminalId, openingFloat: 100000 });
  const menu = (await call('GET', '/api/menu')).body;
  const item = (name: string) => menu.items.find((i: any) => i.name === name).id as string;
  const tables = (await call('GET', '/api/tables')).body;
  return { call, tenantId, terminalId, item, tables, email, token };
}

/** Open an order and add the table-5 example (2 fried rice, 1 tom yum, 1 som tam, 2 Thai tea = 360.00). */
export async function table5Order(shop: Awaited<ReturnType<typeof newShop>>, tableIdx = 0) {
  const o = await shop.call('POST', '/api/orders', { tableId: shop.tables[tableIdx].id, guests: 4 });
  const id = o.body.id as string;
  for (const [name, qty] of [['ข้าวผัดกุ้ง', 2], ['ต้มยำกุ้งน้ำข้น', 1], ['ส้มตำไทย', 1], ['ชาไทยเย็น', 2]] as const) {
    await shop.call('POST', `/api/orders/${id}/lines`, { menuItemId: shop.item(name), qty });
  }
  return id;
}
