import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

type Shop = Awaited<ReturnType<typeof newShop>>;

/** A shop with a required spice level, an optional topping group (+egg uses 1 pc of an ingredient) on fried rice. */
async function shopWithOptions() {
  const s = await newShop(app, { vat: false, posId: null });
  const egg = (await s.call('POST', '/api/ingredients', {
    name: 'ไข่ไก่สำหรับท็อปปิ้ง', kind: 'food', baseUnit: 'pc', purchaseUnit: 'แผง', purchaseFactor: 30, yieldPct: 100, reorderPoint: 0,
  })).body;
  const spice = (await s.call('POST', '/api/modifier-groups', {
    name: 'ระดับเผ็ด', minSelect: 1, maxSelect: 1, itemIds: [s.item('ข้าวผัดกุ้ง')],
    options: [{ name: 'ไม่เผ็ด' }, { name: 'เผ็ดมาก' }],
  })).body;
  const top = (await s.call('POST', '/api/modifier-groups', {
    name: 'ท็อปปิ้ง', minSelect: 0, maxSelect: 2, itemIds: [s.item('ข้าวผัดกุ้ง')],
    options: [{ name: 'ไข่ดาว', price: 1000, ingredients: [{ ingredientId: egg.id, qty: 1 }] }, { name: 'ไส้กรอก', price: 1500 }],
  })).body;
  return { s, egg, spice, top, opt: (g: any, name: string) => g.options.find((o: any) => o.name === name).id as string };
}

async function stockOf(s: Shop, ingredientId: string) {
  const list = (await s.call('GET', '/api/ingredients')).body;
  return list.find((i: any) => i.id === ingredientId).on_hand as number;
}

describe('menu options', () => {
  it('exposes the groups on the menu and attaches them to the dish', async () => {
    const { s, spice } = await shopWithOptions();
    const menu = (await s.call('GET', '/api/menu')).body;
    const rice = menu.items.find((i: any) => i.name === 'ข้าวผัดกุ้ง');
    expect(rice.group_ids).toHaveLength(2);
    expect(menu.groups.map((g: any) => g.name)).toEqual(['ระดับเผ็ด', 'ท็อปปิ้ง']);
    expect(menu.groups[0].options).toHaveLength(2);
    expect(menu.items.find((i: any) => i.name === 'ชาไทยเย็น').group_ids).toEqual([]);
    expect(spice.item_ids).toEqual([s.item('ข้าวผัดกุ้ง')]);
  });

  it('prices the line with its options, merges only identical picks, and shows them on the bill', async () => {
    const { s, spice, top, opt } = await shopWithOptions();
    const order = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body.id;
    const add = (options: string[], qty = 1) => s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ข้าวผัดกุ้ง'), qty, options });
    const base = (await s.call('GET', '/api/menu')).body.items.find((i: any) => i.name === 'ข้าวผัดกุ้ง').price as number;

    const a = await add([opt(spice, 'เผ็ดมาก'), opt(top, 'ไข่ดาว')]);
    expect(a.status).toBe(201);
    expect(a.body.unit_price).toBe(base + 1000);
    expect(a.body.options.map((o: any) => o.name)).toEqual(['เผ็ดมาก', 'ไข่ดาว']);
    const again = await add([opt(spice, 'เผ็ดมาก'), opt(top, 'ไข่ดาว')]);
    expect(again.body.id).toBe(a.body.id);
    expect(again.body.qty).toBe(2);
    const other = await add([opt(spice, 'ไม่เผ็ด')]);
    expect(other.body.id).not.toBe(a.body.id);
    expect(other.body.unit_price).toBe(base);
  });

  it('enforces required and maximum picks and rejects options of another dish', async () => {
    const { s, spice, top, opt } = await shopWithOptions();
    const order = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body.id;
    const add = (item: string, options: string[]) => s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item(item), options });
    expect((await add('ข้าวผัดกุ้ง', [])).body.error).toBe('option_required');
    expect((await add('ข้าวผัดกุ้ง', [opt(spice, 'ไม่เผ็ด'), opt(spice, 'เผ็ดมาก')])).body.error).toBe('option_too_many');
    expect((await add('ข้าวผัดกุ้ง', [opt(spice, 'ไม่เผ็ด'), opt(top, 'ไข่ดาว'), opt(top, 'ไส้กรอก')])).status).toBe(201);
    expect((await add('ชาไทยเย็น', [opt(spice, 'ไม่เผ็ด')])).body.error).toBe('bad_option');
  });

  it('draws the option ingredients at payment and puts the options on the tax document', async () => {
    const { s, egg, spice, top, opt } = await shopWithOptions();
    const order = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body.id;
    await s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ข้าวผัดกุ้ง'), qty: 3, options: [opt(spice, 'ไม่เผ็ด'), opt(top, 'ไข่ดาว')] });
    const before = await stockOf(s, egg.id);
    const bill = (await s.call('GET', `/api/orders/${order}`)).body.bill;
    const pay = await s.call('POST', `/api/orders/${order}/pay`, {
      terminalId: s.terminalId, docType: 'RECEIPT', payments: [{ method: 'cash', amount: bill.total, tendered: bill.total }],
    });
    expect(pay.status).toBe(201);
    expect(await stockOf(s, egg.id)).toBe(before - 3);
    expect(pay.body.document.lines[0].name).toBe('ข้าวผัดกุ้ง (ไม่เผ็ด, ไข่ดาว)');
  });

  it('copies the options when a bill is split', async () => {
    const { s, spice, opt } = await shopWithOptions();
    const order = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body.id;
    const line = (await s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ข้าวผัดกุ้ง'), qty: 2, options: [opt(spice, 'เผ็ดมาก')] })).body;
    await s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ชาไทยเย็น') });
    const split = (await s.call('POST', `/api/orders/${order}/split`, { lines: [{ lineId: line.id, qty: 1 }] })).body;
    const child = (await s.call('GET', `/api/orders/${split.id}`)).body;
    expect(child.lines[0].options[0].name).toBe('เผ็ดมาก');
    expect(child.lines[0].unit_price).toBe(line.unit_price);
  });

  it('keeps old orders readable after an option is removed from the group', async () => {
    const { s, spice, opt } = await shopWithOptions();
    const order = (await s.call('POST', '/api/orders', { tableId: s.tables[0].id })).body.id;
    await s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ข้าวผัดกุ้ง'), options: [opt(spice, 'เผ็ดมาก')] });
    const upd = await s.call('PUT', `/api/modifier-groups/${spice.id}`, {
      name: 'ระดับเผ็ด', minSelect: 1, maxSelect: 1, itemIds: spice.item_ids,
      options: [{ id: opt(spice, 'ไม่เผ็ด'), name: 'ไม่เผ็ด' }],
    });
    expect(upd.status).toBe(200);
    expect(upd.body.options.find((o: any) => o.name === 'เผ็ดมาก').active).toBe(false);
    const menu = (await s.call('GET', '/api/menu')).body;
    expect(menu.groups.find((g: any) => g.name === 'ระดับเผ็ด').options).toHaveLength(1);
    const view = (await s.call('GET', `/api/orders/${order}`)).body;
    expect(view.lines[0].options[0].name).toBe('เผ็ดมาก');
    expect((await s.call('POST', `/api/orders/${order}/lines`, { menuItemId: s.item('ข้าวผัดกุ้ง'), options: [opt(spice, 'เผ็ดมาก')] })).body.error).toBe('bad_option');
  });

  it('is manager-only to edit and isolated per shop', async () => {
    const { s, spice } = await shopWithOptions();
    const other = await newShop(app, { vat: false, posId: null });
    expect((await other.call('GET', '/api/modifier-groups')).body).toEqual([]);
    expect((await other.call('PUT', `/api/modifier-groups/${spice.id}`, { name: 'x', options: [{ name: 'a' }] })).status).toBe(404);
    expect((await s.call('POST', '/api/modifier-groups', { name: 'x', minSelect: 3, maxSelect: 1, options: [{ name: 'a' }] })).status).toBe(400);
  });

  it("sets a dish's questions from the dish editor, and lists them in costing", async () => {
    const { s, spice, top } = await shopWithOptions();
    const rice = s.item("ข้าวผัดกุ้ง");
    const set = (groupIds: string[]) => s.call("PUT", "/api/menu/items/" + rice + "/modifier-groups", { groupIds });
    expect((await set([top.id])).status).toBe(200);
    const row = (await s.call("GET", "/api/costing/menu")).body.find((i: any) => i.id === rice);
    expect(row.group_ids).toEqual([top.id]);
    expect(row.station).toBe("kitchen");
    expect((await set([top.id, spice.id])).status).toBe(200);
    expect((await set([])).status).toBe(200);
    expect((await s.call("GET", "/api/menu")).body.items.find((i: any) => i.id === rice).group_ids).toEqual([]);
    expect((await set(["00000000-0000-4000-8000-000000000000"])).status).toBe(400);
  });
});
