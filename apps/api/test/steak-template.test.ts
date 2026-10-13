import { afterAll, describe, expect, it } from 'vitest';
import { STEAK_MENU } from '../src/template-steak.ts';
import { makeApp } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

async function steakShop() {
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: {
    name: 'เจ้าของ', email: `steak-${Date.now()}@test.local`, password: 'password123', shopName: 'สเต็กเฮาส์', template: 'steak', tableCount: 4,
  } });
  expect(r.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${r.json().token}` };
  const get = async (url: string) => (await app.inject({ method: 'GET', url, headers })).json();
  return { get, headers };
}

describe('steak house template', () => {
  it('creates the whole menu with a recipe and a food cost for every dish', async () => {
    const { get } = await steakShop();
    const wanted = STEAK_MENU.flatMap(([, items]) => items.map(([name]) => name));
    const costing = await get('/api/costing/menu');
    expect(costing.map((i: any) => i.name).sort()).toEqual([...wanted].sort());
    for (const i of costing) {
      expect(i.recipe_lines, `${i.name} has a recipe`).toBeGreaterThan(0);
      expect(i.cost, `${i.name} has a cost`).toBeGreaterThan(0);
      expect(i.food_cost_pct, `${i.name} food cost`).toBeLessThan(70);
    }
  });

  it('has food, drinks and alcohol with the right stations', async () => {
    const { get } = await steakShop();
    const menu = await get('/api/menu');
    const cats = menu.categories.map((c: any) => c.name);
    expect(cats).toEqual(expect.arrayContaining(['สเต็ก', 'ข้าวขาหมู', 'หมูกรอบ', 'เครื่องดื่ม', 'เบียร์', 'ไวน์', 'สุราและค็อกเทล']));
    const station = (n: string) => menu.items.find((i: any) => i.name === n).station;
    expect(station('สเต็กเนื้อริบอาย 250 ก.')).toBe('kitchen');
    expect(station('เบียร์สิงห์ (ขวดใหญ่)')).toBe('bar');
    expect(station('ไฮบอลวิสกี้')).toBe('bar');
  });

  it('asks the steak questions and requires the doneness', async () => {
    const { get, headers } = await steakShop();
    const menu = await get('/api/menu');
    const steak = menu.items.find((i: any) => i.name === 'สเต็กเนื้อสันนอก 200 ก.');
    expect(steak.group_ids.map((id: string) => menu.groups.find((g: any) => g.id === id).name))
      .toEqual(['ความสุก', 'ซอสสเต็ก', 'ของเคียง', 'เพิ่มท็อปปิ้งสเต็ก']);
    const table = (await get('/api/tables'))[0];
    const order = (await app.inject({ method: 'POST', url: '/api/orders', headers, payload: { tableId: table.id } })).json();
    const add = (options: string[]) => app.inject({ method: 'POST', url: `/api/orders/${order.id}/lines`, headers, payload: { menuItemId: steak.id, options } });
    expect((await add([])).json().error).toBe('option_required');
    const pick = (group: string, option: string) => menu.groups.find((g: any) => g.name === group).options.find((o: any) => o.name === option).id;
    const ok = await add([pick('ความสุก', 'Medium'), pick('ซอสสเต็ก', 'พริกไทยดำ'), pick('ของเคียง', 'มันบด')]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().unit_price).toBe(steak.price + 1500);
  });

  it('breaks sub-recipes down so a steak with sauce draws the sauce ingredients', async () => {
    const { get } = await steakShop();
    const ings = await get('/api/ingredients');
    const preps = ings.filter((i: any) => i.is_prep).map((i: any) => i.name).sort();
    expect(preps).toEqual(['ซอสพริกไทยดำ', 'ซอสเห็ด', 'น้ำจิ้มหมูกรอบ', 'น้ำพะโล้']);
    expect(ings.every((i: any) => i.on_hand === 0)).toBe(true);
  });
});
