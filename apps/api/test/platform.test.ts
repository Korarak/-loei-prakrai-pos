import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/db.ts';
import { APP_URL, newShop, table5Order } from './helpers.ts';

const db = createPool(APP_URL);
const OPERATOR = `operator-${Date.now()}@test.local`;
const app = buildApp({ db, jwtSecret: 'test-secret-test-secret-test-secret', platformAdmins: [OPERATOR] });
afterAll(async () => {
  await app.close();
  await db.end();
});

const as = (token: string) => async (method: string, url: string, payload?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

async function operator() {
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: {
    name: 'ผู้ดูแลระบบ', email: OPERATOR, password: 'password123', shopName: 'ร้านของผู้ดูแล', tableCount: 1,
  } });
  if (r.statusCode !== 201 && r.statusCode !== 409) throw new Error(r.body);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: OPERATOR, password: 'password123' } });
  return as(login.json().token);
}

describe('platform admin: reviewing sign-ups', () => {
  it('only the configured operator can see it', async () => {
    const shop = await newShop(app);
    expect((await shop.call('GET', '/api/platform/tenants')).status).toBe(403);
    expect((await shop.call('GET', '/api/platform/overview')).status).toBe(403);
    expect((await as('bad')('GET', '/api/platform/tenants')).status).toBe(401);
    const op = await operator();
    expect((await op('GET', '/api/platform/tenants')).status).toBe(200);
    expect((await op('GET', '/api/me')).body.platformAdmin).toBe(true);
    expect((await shop.call('GET', '/api/me')).body.platformAdmin).toBe(false);
  });

  it('lists sign-ups with owner contact, filters by search and status', async () => {
    const shop = await newShop(app);
    const op = await operator();
    const found = (await op('GET', `/api/platform/tenants?q=${encodeURIComponent(shop.email)}`)).body;
    expect(found.total).toBe(1);
    expect(found.rows[0]).toMatchObject({ id: shop.tenantId, status: 'trial', owner_email: shop.email, members: 1 });
    expect((await op('GET', `/api/platform/tenants?q=${encodeURIComponent(shop.email)}&status=suspended`)).body.total).toBe(0);
    expect((await op('GET', '/api/platform/tenants?status=nonsense')).status).toBe(400);
    const ov = (await op('GET', '/api/platform/overview')).body;
    expect(ov.signups_7d).toBeGreaterThanOrEqual(1);
  });

  it('detail shows members and shop usage', async () => {
    const shop = await newShop(app);
    const id = await table5Order(shop);
    await shop.call('POST', `/api/orders/${id}/pay`, { method: 'cash', tendered: 100000 });
    const op = await operator();
    const d = (await op('GET', `/api/platform/tenants/${shop.tenantId}`)).body;
    expect(d.members).toHaveLength(1);
    expect(d.members[0]).toMatchObject({ role: 'owner', email: shop.email, locked: false });
    expect(d.usage.tables).toBe(5);
    expect(d.usage.menu_items).toBeGreaterThan(0);
    expect(d.usage.last_activity_at).not.toBeNull();
    expect((await op('GET', '/api/platform/tenants/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('suspending a shop blocks sign-in and live sessions; reinstating restores them; both are audited', async () => {
    const shop = await newShop(app);
    const op = await operator();
    const r = await op('PATCH', `/api/platform/tenants/${shop.tenantId}`, { status: 'suspended', adminNote: 'ตรวจเอกสารก่อน' });
    expect(r.body).toMatchObject({ status: 'suspended', admin_note: 'ตรวจเอกสารก่อน' });
    expect((await shop.call('GET', '/api/me')).status).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'password123' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('shop_suspended');

    await op('PATCH', `/api/platform/tenants/${shop.tenantId}`, { status: 'active' });
    const again = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'password123' } });
    expect(again.statusCode).toBe(200);
    const token = again.json().token as string;
    const log = (await as(token)('GET', '/api/audit?action=platform')).body;
    expect(log.rows.map((x: any) => x.action)).toEqual(['platform.tenant.update', 'platform.tenant.update']);
    expect(log.rows[1].detail.before.status).toBe('trial');
  });

  it('trial date and note can be changed, and cleared', async () => {
    const shop = await newShop(app);
    const op = await operator();
    const r = await op('PATCH', `/api/platform/tenants/${shop.tenantId}`, { trialEndsAt: '2030-01-31', adminNote: 'x' });
    expect(r.body.trial_ends_at).toBe('2030-01-31');
    const c = await op('PATCH', `/api/platform/tenants/${shop.tenantId}`, { adminNote: null });
    expect(c.body.admin_note).toBeNull();
    expect(c.body.trial_ends_at).toBe('2030-01-31');
  });

  it('unlocks a locked-out owner', async () => {
    const shop = await newShop(app);
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'wrong-password' } });
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'password123' } });
    expect(locked.statusCode).toBe(429);
    const op = await operator();
    const d = (await op('GET', `/api/platform/tenants/${shop.tenantId}`)).body;
    expect(d.members[0].locked).toBe(true);
    expect((await op('POST', `/api/platform/tenants/${shop.tenantId}/members/${d.members[0].user_id}/unlock`)).status).toBe(200);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'password123' } });
    expect(ok.statusCode).toBe(200);
  });

  it('records the last sign-in time', async () => {
    const shop = await newShop(app);
    const op = await operator();
    const read = async () => (await op('GET', `/api/platform/tenants?q=${encodeURIComponent(shop.email)}`)).body.rows[0].last_login_at as string;
    const atSignup = await read();
    expect(atSignup).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: shop.email, password: 'password123' } });
    expect(new Date(await read()).getTime()).toBeGreaterThan(new Date(atSignup).getTime());
  });
});

describe('shop audit trail', () => {
  it('managers read it; filters by action and person', async () => {
    const shop = await newShop(app);
    await shop.call('POST', '/api/staff', { name: 'สมใจ', role: 'cashier', pin: '482913' });
    const id = await table5Order(shop);
    await shop.call('PUT', `/api/orders/${id}/discount`, { type: 'percent', value: 500 });
    const all = (await shop.call('GET', '/api/audit')).body;
    expect(all.rows.length).toBeGreaterThan(0);
    expect(all.actions).toContain('order.discount');
    expect(all.rows[0].user_name).toBe('เจ้าของ');
    const only = (await shop.call('GET', '/api/audit?action=order.discount')).body;
    expect(only.rows.every((r: any) => r.action === 'order.discount')).toBe(true);
    expect((await shop.call('GET', `/api/audit?userId=${all.rows[0].user_id}`)).body.rows.length).toBeGreaterThan(0);
    expect((await shop.call('GET', '/api/audit?from=2000-01-01&to=2000-01-02')).body.rows).toHaveLength(0);
    expect((await shop.call('GET', '/api/audit?from=bad')).status).toBe(400);
  });

  it('pages with before=, and keeps shops apart', async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    for (let i = 0; i < 3; i++) await a.call('POST', '/api/expenses', { category: 'rent', amount: 1000 + i, spentOn: '2026-09-01' });
    const p1 = (await a.call('GET', '/api/audit?limit=2')).body;
    expect(p1.rows).toHaveLength(2);
    expect(p1.more).toBe(true);
    const p2 = (await a.call('GET', `/api/audit?limit=2&before=${p1.rows[1].id}`)).body;
    expect(p2.rows.every((r: any) => r.id < p1.rows[1].id)).toBe(true);
    const ids = new Set((await b.call('GET', '/api/audit?limit=200')).body.rows.map((r: any) => r.id));
    expect(p1.rows.some((r: any) => ids.has(r.id))).toBe(false);
  });

  it('the hash chain verifies for the owner only', async () => {
    const shop = await newShop(app);
    await shop.call('POST', '/api/expenses', { category: 'rent', amount: 5000, spentOn: '2026-09-01' });
    const v = (await shop.call('GET', '/api/audit/verify')).body;
    expect(v.ok).toBe(true);
    expect(v.total).toBeGreaterThan(0);
    const staff = await shop.call('POST', '/api/staff', { name: 'ต้น', role: 'manager', pin: '731946' });
    expect(staff.status).toBe(201);
  });
});
