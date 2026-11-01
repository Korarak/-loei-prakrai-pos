import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => { await app.close(); await db.end(); });

type Shop = Awaited<ReturnType<typeof newShop>>;

/** The customer-side URL for a table, built from the manager's printable link. */
async function linkOf(shop: Shop, idx = 0) {
  const { body } = await shop.call('GET', '/api/qr/links');
  const path = body.tables[idx].path as string;           // /t/<slug>/<tableId>?k=<sig>
  const [, , slug, rest] = path.split('/');
  const [tableId, q] = rest!.split('?');
  return { base: `/api/public/qr/${slug}/${tableId}`, q: `?${q}`, tableId: tableId!, slug: slug!, path };
}

const get = async (url: string) => { const r = await app.inject({ method: 'GET', url }); return { status: r.statusCode, body: r.body ? r.json() : null }; };
const post = async (url: string, payload: unknown) => { const r = await app.inject({ method: 'POST', url, payload: payload as any }); return { status: r.statusCode, body: r.body ? r.json() : null }; };

describe('QR ordering', () => {
  let shop: Shop;
  let other: Shop;
  beforeAll(async () => { shop = await newShop(app); other = await newShop(app); });

  it('serves the menu to a valid signed link, without internal fields', async () => {
    const l = await linkOf(shop);
    const r = await get(`${l.base}${l.q}`);
    expect(r.status).toBe(200);
    expect(r.body.shop.name).toContain('ร้านทดสอบ');
    expect(r.body.items.length).toBeGreaterThan(3);
    const first = r.body.items[0];
    expect(Object.keys(first)).not.toContain('station');
    expect(Object.keys(first)).not.toContain('vat_exempt');
  });

  it('answers every bad link with the same 404', async () => {
    const l = await linkOf(shop);
    const o = await linkOf(other);
    const bad = [
      `${l.base}?k=deadbeef`,                                      // wrong signature
      `${l.base}?k=${'0'.repeat(64)}`,
      `/api/public/qr/${l.slug}/${shop.tables[1].id}${l.q}`,       // signature of table 1 used on table 2
      `/api/public/qr/${o.slug}/${o.tableId}${l.q}`,               // another shop's table with this shop's signature
      `/api/public/qr/no-such-shop/${l.tableId}${l.q}`,
    ];
    for (const u of bad) {
      const r = await get(u);
      expect(r.status, u).toBe(404);
      expect(r.body.error).toBe('invalid_link');
    }
    expect((await get(l.base)).status).toBe(400);                  // missing signature entirely
  });

  it('never trusts prices from the browser and refuses other shops\' dishes', async () => {
    const l = await linkOf(shop);
    const menu = (await get(`${l.base}${l.q}`)).body;
    const rice = menu.items.find((i: any) => i.name === 'ข้าวผัดกุ้ง');
    const r = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: rice.id, qty: 2, price: 1, unit_price: 1 }], total: 1 });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe(rice.price * 2);

    const foreign = other.item('ข้าวผัดกุ้ง');
    const f = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: foreign, qty: 1 }] });
    expect(f.status).toBe(404);
    expect(f.body.error === 'menu_item_not_found' || f.body.error === 'invalid_link').toBe(true);
  });

  it('validates quantities, empty carts and option rules', async () => {
    const l = await linkOf(shop);
    const id = shop.item('ข้าวผัดกุ้ง');
    for (const items of [[], [{ menuItemId: id, qty: 0 }], [{ menuItemId: id, qty: 21 }], [{ menuItemId: id, qty: 1, options: ['not-a-uuid'] }]]) {
      expect((await post(`${l.base}/orders${l.q}`, { items })).status).toBe(400);
    }
    // an option id that belongs to no group of this dish
    expect((await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: id, qty: 1, options: ['11111111-1111-4111-8111-111111111111'] }] })).body.error).toBe('bad_option');
  });

  it('caps how many orders one table can leave waiting', async () => {
    const s = await newShop(app);
    const l = await linkOf(s);
    const id = s.item('ชาไทยเย็น');
    for (let i = 0; i < 5; i++) expect((await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: id, qty: 1 }] })).status).toBe(201);
    const sixth = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: id, qty: 1 }] });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('too_many_pending');
    // another table is unaffected
    const l2 = await linkOf(s, 1);
    expect((await post(`${l2.base}/orders${l2.q}`, { items: [{ menuItemId: id, qty: 1 }] })).status).toBe(201);
  });

  it('puts an accepted order on the table bill, merging with what staff already rang up', async () => {
    const s = await newShop(app);
    const l = await linkOf(s, 2);
    const tea = s.item('ชาไทยเย็น');
    // staff already opened the bill with one tea
    const o = (await s.call('POST', '/api/orders', { tableId: l.tableId, guests: 2 })).body;
    await s.call('POST', `/api/orders/${o.id}/lines`, { menuItemId: tea, qty: 1 });

    const sent = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: tea, qty: 2, note: 'หวานน้อย' }, { menuItemId: s.item('ข้าวผัดกุ้ง'), qty: 1 }], note: 'ขอช้อนเพิ่ม' });
    expect(sent.status).toBe(201);

    const pending = (await s.call('GET', '/api/qr/requests')).body;
    expect(pending).toHaveLength(1);
    expect(pending[0].table_name).toBe(s.tables[2].name);
    expect(pending[0].total).toBe(sent.body.total);

    const ok = await s.call('POST', `/api/qr/requests/${sent.body.id}/accept`);
    expect(ok.status).toBe(200);
    expect(ok.body.orderId).toBe(o.id);                             // same bill, not a new one
    const bill = (await s.call('GET', `/api/orders/${o.id}`)).body;
    expect(bill.lines.filter((x: any) => x.name === 'ชาไทยเย็น' && !x.note)).toHaveLength(1); // staff's plain tea line is untouched
    expect(bill.lines.find((x: any) => x.note === 'หวานน้อย').qty).toBe(2);
    expect(bill.lines).toHaveLength(3);
    expect((await s.call('GET', '/api/qr/requests')).body).toHaveLength(0);
    expect((await s.call('POST', `/api/qr/requests/${sent.body.id}/accept`)).status).toBe(409);   // no double-add
  });

  it('opens a bill when the table is empty, and rejecting adds nothing', async () => {
    const s = await newShop(app);
    const l = await linkOf(s, 3);
    const a = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: s.item('ชาไทยเย็น'), qty: 1 }] });
    const acc = await s.call('POST', `/api/qr/requests/${a.body.id}/accept`);
    expect(acc.status).toBe(200);
    expect((await s.call('GET', `/api/orders/${acc.body.orderId}`)).body.lines).toHaveLength(1);

    const l4 = await linkOf(s, 4);
    const b = await post(`${l4.base}/orders${l4.q}`, { items: [{ menuItemId: s.item('ชาไทยเย็น'), qty: 1 }] });
    expect((await s.call('POST', `/api/qr/requests/${b.body.id}/reject`)).status).toBe(200);
    expect((await s.call('POST', `/api/qr/requests/${b.body.id}/accept`)).status).toBe(409);
    const tables = (await s.call('GET', '/api/tables')).body;
    expect(tables.find((t: any) => t.id === l4.tableId).order_id).toBeNull();
  });

  it('keeps shops apart on the staff side', async () => {
    const s = await newShop(app);
    const o = await newShop(app);
    const l = await linkOf(s);
    const a = await post(`${l.base}/orders${l.q}`, { items: [{ menuItemId: s.item('ชาไทยเย็น'), qty: 1 }] });
    expect((await o.call('GET', '/api/qr/requests')).body).toHaveLength(0);
    expect((await o.call('POST', `/api/qr/requests/${a.body.id}/accept`)).status).toBe(404);
    expect((await o.call('POST', `/api/qr/requests/${a.body.id}/reject`)).status).toBe(409);
  });

  it('requires staff sign-in for the staff routes', async () => {
    for (const [m, u] of [['GET', '/api/qr/links'], ['GET', '/api/qr/requests'], ['POST', '/api/qr/rotate'], ['PUT', '/api/qr/enabled']] as const) {
      const r = await app.inject({ method: m, url: u });
      expect(r.statusCode, u).toBe(401);
    }
  });

  it('can be switched off, and rotating the secret kills printed links', async () => {
    const s = await newShop(app);
    const l = await linkOf(s);
    expect((await get(`${l.base}${l.q}`)).status).toBe(200);

    await s.call('PUT', '/api/qr/enabled', { enabled: false });
    const off = await get(`${l.base}${l.q}`);
    expect(off.status).toBe(403);
    expect(off.body.error).toBe('qr_disabled');
    await s.call('PUT', '/api/qr/enabled', { enabled: true });
    expect((await get(`${l.base}${l.q}`)).status).toBe(200);

    expect((await s.call('POST', '/api/qr/rotate')).status).toBe(200);
    expect((await get(`${l.base}${l.q}`)).status).toBe(404);          // old sticker is dead
    const fresh = await linkOf(s);
    expect(fresh.q).not.toBe(l.q);
    expect((await get(`${fresh.base}${fresh.q}`)).status).toBe(200);
  });

  it('hides retired tables', async () => {
    const s = await newShop(app);
    const l = await linkOf(s, 4);
    await s.call('DELETE', `/api/tables/${l.tableId}`);
    expect((await get(`${l.base}${l.q}`)).status).toBe(404);
  });
});
