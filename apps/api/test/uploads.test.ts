import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => { await app.close(); await db.end(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('menu photos', () => {
  it('uploads, serves to the same shop only, replaces and removes', async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    const id = a.item('ข้าวผัดกุ้ง');
    const png = { ...bearer(a.token), 'content-type': 'image/png' };

    const up = await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: png, payload: PNG });
    expect(up.statusCode).toBe(200);
    const url: string = up.json().image_url;
    expect((await a.call('GET', '/api/menu')).body.items.find((i: any) => i.id === id).image_url).toBe(url);

    const got = await app.inject({ method: 'GET', url, headers: bearer(a.token) });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: bearer(b.token) })).statusCode).toBe(404);

    const again = await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: png, payload: PNG });
    expect(again.json().image_url).not.toBe(url);
    expect((await app.inject({ method: 'GET', url, headers: bearer(a.token) })).statusCode).toBe(404); // old file cleaned up

    expect((await a.call('DELETE', `/api/menu/items/${id}/image`)).status).toBe(200);
    expect((await app.inject({ method: 'GET', url: again.json().image_url, headers: bearer(a.token) })).statusCode).toBe(404);
  });

  it('rejects non-images, wrong types and oversize bodies', async () => {
    const a = await newShop(app);
    const id = a.item('ข้าวผัดกุ้ง');
    const h = { ...bearer(a.token), 'content-type': 'image/png' };
    const post = (payload: Buffer, headers: Record<string, string> = h) => app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers, payload });
    expect((await post(Buffer.from('<svg onload=alert(1)>'.repeat(5)))).statusCode).toBe(415);
    expect((await post(Buffer.alloc(3 * 1024 * 1024, 1))).statusCode).toBe(413);
    expect((await post(PNG, { ...h, 'content-type': 'text/html' })).statusCode).toBe(415);
  });

  it('accepts JPEG and WebP, and identifies them by content not by the declared type', async () => {
    const a = await newShop(app);
    const id = a.item('ข้าวผัดกุ้ง');
    const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
    const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);
    const post = (payload: Buffer, type: string) => app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: { ...bearer(a.token), 'content-type': type }, payload });
    const j = await post(JPG, 'image/jpeg');
    expect(j.statusCode).toBe(200);
    expect(j.json().image_url).toMatch(/\.jpg$/);
    const w = await post(WEBP, 'image/webp');
    expect(w.statusCode).toBe(200);
    expect(w.json().image_url).toMatch(/\.webp$/);
    const got = await app.inject({ method: 'GET', url: w.json().image_url, headers: bearer(a.token) });
    expect(got.headers['content-type']).toBe('image/webp');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    // a PNG declared as JPEG is stored by what it really is
    const mislabeled = await post(PNG, 'image/jpeg');
    expect(mislabeled.json().image_url).toMatch(/\.png$/);
    // tiny / empty bodies are not images
    expect((await post(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).statusCode).toBe(415);
    expect((await post(Buffer.alloc(0), 'image/png')).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects unknown items and bad ids without leaving files behind', async () => {
    const a = await newShop(app);
    const other = await newShop(app);
    const h = { ...bearer(a.token), 'content-type': 'image/png' };
    const ghost = '00000000-0000-4000-8000-000000000000';
    const r1 = await app.inject({ method: 'POST', url: `/api/menu/items/${ghost}/image`, headers: h, payload: PNG });
    expect(r1.statusCode).toBe(404);
    // another shop's item is invisible to this shop
    const r2 = await app.inject({ method: 'POST', url: `/api/menu/items/${other.item('ข้าวผัดกุ้ง')}/image`, headers: h, payload: PNG });
    expect(r2.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/menu/items/not-a-uuid/image`, headers: h, payload: PNG })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await a.call('DELETE', `/api/menu/items/${ghost}/image`)).status).toBe(404);
    // the other shop's item must not have been touched
    expect((await other.call('GET', '/api/menu')).body.items.every((i: any) => !i.image_url)).toBe(true);
  });

  it('only managers and above may change photos; staff can still view them', async () => {
    const s = await newShop(app);
    const id = s.item('ข้าวผัดกุ้ง');
    const png = { ...bearer(s.token), 'content-type': 'image/png' };
    const url = (await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: png, payload: PNG })).json().image_url as string;

    const dev = await s.call('POST', '/api/devices', { name: 'tab', terminalId: null });
    expect(dev.status).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: s.email, password: 'password123' } });
    const devRes = await app.inject({ method: 'POST', url: '/api/devices', payload: { name: 'x' }, headers: bearer(login.json().token) });
    const cookie = `prakai_device=${String(devRes.headers['set-cookie']).match(/prakai_device=([^;]+)/)![1]}`;

    for (const [role, pin] of [['cashier', '482913'], ['waiter', '550812'], ['kitchen', '603927']] as const) {
      const u = (await s.call('POST', '/api/staff', { name: role, role, pin })).body;
      const t = (await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { userId: u.id, pin }, headers: { cookie } })).json().token as string;
      expect((await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: { ...bearer(t), 'content-type': 'image/png' }, payload: PNG })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/api/menu/items/${id}/image`, headers: bearer(t) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url, headers: bearer(t) })).statusCode).toBe(200);
    }
    const m = (await s.call('POST', '/api/staff', { name: 'mgr', role: 'manager', pin: '731946' })).body;
    const mt = (await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { userId: m.id, pin: '731946' }, headers: { cookie } })).json().token as string;
    expect((await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: { ...bearer(mt), 'content-type': 'image/png' }, payload: PNG })).statusCode).toBe(200);
  });

  it('blocks path tricks when serving files', async () => {
    const a = await newShop(app);
    const id = a.item('ข้าวผัดกุ้ง');
    const url: string = (await app.inject({ method: 'POST', url: `/api/menu/items/${id}/image`, headers: { ...bearer(a.token), 'content-type': 'image/png' }, payload: PNG })).json().image_url;
    const [, , , tenant] = url.split('/');
    for (const bad of [`/api/uploads/${tenant}/..%2f..%2fpackage.json`, `/api/uploads/${tenant}/../x.png`, `/api/uploads/${tenant}/abc.png`, `/api/uploads/..%2f/x.png`, `/api/uploads/${tenant}/${url.split('/').pop()}.tmp`]) {
      const r = await app.inject({ method: 'GET', url: bad, headers: bearer(a.token) });
      expect([400, 404]).toContain(r.statusCode);
    }
  });
});

describe('shop logo', () => {
  it('is set by the owner, shows in /api/me, is replaced and removed, and rejects non-images', async () => {
    const a = await newShop(app);
    const png = { ...bearer(a.token), 'content-type': 'image/png' };

    expect((await a.call('GET', '/api/me')).body.tenant.logo_url).toBeNull();
    const up = await app.inject({ method: 'POST', url: '/api/settings/logo', headers: png, payload: PNG });
    expect(up.statusCode).toBe(200);
    const url: string = up.json().logo_url;
    const me = (await a.call('GET', '/api/me')).body.tenant;
    expect(me.logo_url).toBe(url);
    expect(me.logo_on_receipt).toBe(true);
    expect((await app.inject({ method: 'GET', url, headers: bearer(a.token) })).statusCode).toBe(200);

    const again = await app.inject({ method: 'POST', url: '/api/settings/logo', headers: png, payload: PNG });
    expect((await app.inject({ method: 'GET', url, headers: bearer(a.token) })).statusCode).toBe(404); // old file cleaned up

    expect((await a.call('PATCH', '/api/settings', { logoOnReceipt: false })).status).toBe(200);
    expect((await a.call('GET', '/api/me')).body.tenant.logo_on_receipt).toBe(false);

    const bad = await app.inject({ method: 'POST', url: '/api/settings/logo', headers: png, payload: Buffer.from('not an image at all') });
    expect(bad.statusCode).toBe(415);

    expect((await a.call('DELETE', '/api/settings/logo')).status).toBe(200);
    expect((await a.call('GET', '/api/me')).body.tenant.logo_url).toBeNull();
    expect((await app.inject({ method: 'GET', url: again.json().logo_url, headers: bearer(a.token) })).statusCode).toBe(404);
  });
});
