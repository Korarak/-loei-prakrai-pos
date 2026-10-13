/**
 * Fills a shop with sample data so every screen has something to show: tax settings, staff, regular
 * customers, stock deliveries, expenses, waste and a day of sales (dine-in, takeaway, split bill, discount,
 * full tax invoice, voided line and document, two tables still open).
 *
 * It only talks to the HTTP API, so it works against any deployment:
 *   node --import tsx scripts/seed-demo.ts --base http://127.0.0.1:4000 --signup --email demo@example.com --password '...'
 *   node --import tsx scripts/seed-demo.ts --base https://pos.example.com --email owner@example.com --password '...'
 * With --signup it creates the shop from the `steak` template first; without it the shop must already exist
 * (create it with the steak template, otherwise the menu names below will not match).
 *
 * Run it ONCE on a fresh shop, and only on a demo shop: it issues real documents, with sample tax details.
 */
import { isValidThaiTaxId } from '@prakai/core';
import { STEAK_INGREDIENTS } from '../src/template-steak.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? undefined : process.argv[i + 1]; };
const base = (arg('base') ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const email = arg('email'); const password = arg('password');
if (!email || !password) throw new Error('usage: --email <owner email> --password <password> [--base URL] [--signup]');

let token = '';
async function call<T = any>(method: string, url: string, body?: unknown, ok = [200, 201]): Promise<T> {
  const res = await fetch(base + url, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!ok.includes(res.status)) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}
const log = (...a: unknown[]) => console.log(...a);

// ---------- helpers ----------
let seed = 20260926;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

/** A Thai tax ID with a correct check digit, built from a 12-digit prefix. */
function taxId(prefix: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(prefix[i]) * (13 - i);
  const id = prefix + String((11 - (sum % 11)) % 10);
  if (!isValidThaiTaxId(id)) throw new Error('bad tax id ' + id);
  return id;
}

async function main() {
  // ---------- shop ----------
  if (arg('signup') !== undefined) {
    const r = await call('POST', '/api/auth/signup', {
      name: 'เจ้าของร้านตัวอย่าง', email, password, shopName: 'สเต็กเฮาส์ ครัวประกาย (ร้านตัวอย่าง)', tableCount: 12, template: 'steak',
    });
    token = r.token;
    log('created shop');
  } else {
    const r = await call('POST', '/api/auth/login', { email, password });
    if (!r.token) throw new Error('login needs a second factor; turn it off for the demo shop or use --signup');
    token = r.token;
  }
  const me = await call('GET', '/api/me');
  const terminalId: string = me.terminals[0].id;
  if ((await call<any[]>('GET', '/api/customers')).length > 0) throw new Error('this shop already has customers: refusing to seed twice');

  await call('PATCH', '/api/settings', {
    legalName: 'บริษัท ครัวประกาย สเต็กเฮาส์ จำกัด (ข้อมูลตัวอย่าง)', taxId: taxId('010555100123'),
    address: '99/9 ถ.เลย-เชียงคาน ต.กุดป่อง อ.เมืองเลย จ.เลย 42000',
    vatRegistered: true, vatRegisteredAt: '2026-01-01', priceIncludesVat: true, serviceChargeBp: 1000, cashRounding: 'none',
  });
  await call('PATCH', `/api/terminals/${terminalId}`, { rdPosId: 'E0000000001', serialNo: 'DEMO-SN-0001' });
  log('settings: VAT registered, service charge 10%, POS ID set (sample values)');

  // ---------- staff ----------
  const staff: Array<[string, string, string]> = [
    ['สมชาย ใจดี', 'manager', '731946'], ['มาลี รักงาน', 'cashier', '482915'],
    ['นภา สุขใจ', 'waiter', '550812'], ['ต้น เสิร์ฟไว', 'waiter', '603927'], ['ป้าแดง ครัวร้อน', 'kitchen', '819264'],
  ];
  for (const [name, role, pin] of staff) await call('POST', '/api/staff', { name, role, pin });
  log('staff:', staff.map(([n, r, p]) => `${n} (${r}) PIN ${p}`).join(' · '));

  // ---------- customers ----------
  const customers = [
    ['บริษัท เลยพัฒนาการค้า จำกัด', '010555200001', '00000', '12 ถ.มลิวรรณ ต.กุดป่อง อ.เมืองเลย จ.เลย 42000', '042-811-001'],
    ['หจก. เลยก่อสร้างและวิศวกรรม', '030355200002', '00000', '88/1 ถ.เจริญรัฐ ต.กุดป่อง อ.เมืองเลย จ.เลย 42000', '081-000-1002'],
    ['บริษัท ภูเรือรีสอร์ท จำกัด', '010555200003', '00001', '5 หมู่ 3 ต.ลาดค่าง อ.ภูเรือ จ.เลย 42160', '042-899-003'],
    ['โรงเรียนเลยวิทยาคม', '099400200004', '00000', '1 ถ.เลย-ด่านซ้าย ต.นาอาน อ.เมืองเลย จ.เลย 42000', '042-811-004'],
    ['บริษัท เชียงคานทัวร์ จำกัด', '010555200005', '00000', '250 ถ.ชายโขง ต.เชียงคาน อ.เชียงคาน จ.เลย 42110', '087-000-1005'],
  ] as const;
  const saved: Array<{ id: string; name: string; tax_id: string; branch: string; address: string }> = [];
  for (const [name, prefix, branch, address, phone] of customers) {
    saved.push(await call('POST', '/api/customers', { name, taxId: taxId(prefix), branch, address, phone }));
  }
  log('customers:', saved.length);

  // ---------- stock deliveries ----------
  const ings: any[] = await call('GET', '/api/ingredients');
  const ing = (name: string) => { const x = ings.find((i) => i.name === name); if (!x) throw new Error('no ingredient ' + name); return x; };
  const price = new Map(STEAK_INGREDIENTS.map((r) => [r[0], r[5]]));
  const qtys = (rows: Array<[string, number]>) => rows.map(([name, qty]) => ({ ingredientId: ing(name).id, qty, amount: Math.round(qty * price.get(name)!) }));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const month = today.slice(0, 7);
  const purchases = [
    { supplierName: 'ตลาดสดเทศบาลเมืองเลย', vatMode: 'none', taxInvoice: false, note: 'ซื้อสดรายสัปดาห์ (ไม่มีใบกำกับภาษี)', lines: qtys([
      ['ขาหมูสด', 12], ['หมูสามชั้น', 12], ['สันในหมู', 6], ['อกไก่', 5], ['ปีกไก่', 5], ['ไข่ไก่', 6], ['ข้าวสวย', 30],
      ['มันฝรั่ง', 15], ['ผักสลัดรวม', 5], ['เห็ดแชมปิญอง', 4], ['บรอกโคลี', 3], ['แครอท', 3], ['คะน้า', 6], ['ใบกะเพรา', 1.5],
      ['กระเทียม', 3], ['ผักกาดดอง', 3], ['มะนาว', 3], ['สะระแหน่', 0.3], ['มะพร้าวน้ำหอม', 12],
    ]) },
    { supplierName: 'บริษัท เนื้อเลยพรีเมียม จำกัด', supplierTaxId: taxId('010555300001'), invoiceNo: 'MP-6905-0412', vatMode: 'excluded', taxInvoice: true,
      note: 'เนื้อนำเข้า', lines: qtys([['เนื้อริบอาย', 8], ['เนื้อสันนอก', 8], ['เนื้อเทนเดอร์ลอยน์', 4], ['แซลมอนสด', 4]]) },
    { supplierName: 'บริษัท เลยเครื่องดื่ม จำกัด', supplierTaxId: taxId('010555300002'), invoiceNo: 'BV-6905-8821', vatMode: 'excluded', taxInvoice: true,
      note: 'เบียร์ ไวน์ สุรา และมิกเซอร์', lines: qtys([
        ['เบียร์สิงห์ (ขวดใหญ่)', 5], ['เบียร์ช้าง (ขวดใหญ่)', 5], ['เบียร์ลีโอ (ขวดใหญ่)', 5], ['เบียร์ไฮเนเก้น (ขวด)', 3],
        ['ไวน์แดง', 6], ['ไวน์ขาว', 6], ['วิสกี้เบลนด์', 6], ['โซจู', 2], ['รัมขาว', 1], ['จิน', 1],
        ['โซดา', 4], ['โทนิค', 1], ['น้ำอัดลมกระป๋อง', 3], ['น้ำดื่มขวด', 4],
      ]) },
    { supplierName: 'ร้านวัตถุดิบแห้งเลย', supplierTaxId: taxId('010555300003'), invoiceNo: 'DR-0933', vatMode: 'included', taxInvoice: true,
      note: 'ของแห้ง เครื่องปรุง บรรจุภัณฑ์', lines: qtys([
        ['น้ำมันพืช', 10], ['เนยสด', 2], ['ครีมสด', 8], ['ซอสบาร์บีคิว', 2], ['พริกไทยดำเม็ด', 0.5], ['ผงพะโล้', 1], ['แป้งทอดกรอบ', 3],
        ['ชุดเครื่องปรุง', 3], ['ไอศกรีมวานิลลา', 4], ['บราวนี่', 20], ['ผงชาไทย', 2], ['ผงชาเขียว', 1], ['นมข้นหวาน', 12], ['นมสด', 6],
        ['เมล็ดกาแฟคั่ว', 1], ['น้ำเชื่อม', 3], ['น้ำแข็ง', 10], ['แก้วพลาสติก', 4],
      ]) },
  ];
  for (const p of purchases) await call('POST', '/api/purchases', { purchasedOn: today, ...p });
  log('stock deliveries:', purchases.length, 'invoices');

  // ---------- expenses ----------
  const exp = (category: string, description: string, total: number, extra: object = {}) =>
    call('POST', '/api/expenses', { month, paidOn: today, category, description, total, ...extra });
  await exp('rent', 'ค่าเช่าอาคาร', 1800000, { whtRateBp: 500, payeeName: 'นายสมบัติ เลยทรัพย์', payeeTaxId: taxId('310025400001') });
  await exp('labor', 'เงินเดือนพนักงาน 5 คน', 6200000);
  await exp('utilities', 'ค่าไฟฟ้า', 985000);
  await exp('utilities', 'ค่าน้ำประปา', 64000);
  await exp('utilities', 'ค่าแก๊ส LPG', 320000, { inputVat: 20935 });
  await exp('marketing', 'โฆษณา Facebook / Google Maps', 250000);
  await exp('fees', 'ค่าธรรมเนียมรูดบัตร', 118000);
  await exp('packaging', 'กล่องและถุงสำหรับสั่งกลับบ้าน', 145000, { inputVat: 9486 });
  log('expenses: 8');

  // ---------- waste ----------
  await call('POST', '/api/stock/waste', { ingredientId: ing('ผักสลัดรวม').id, qty: 400, reason: 'ผักเหี่ยว ทิ้งตอนปิดร้าน' });
  await call('POST', '/api/stock/waste', { ingredientId: ing('ขาหมูสด').id, qty: 600, reason: 'ต้มไหม้ 1 หม้อเล็ก' });

  // ---------- sales ----------
  const menu = await call('GET', '/api/menu');
  const tables: any[] = await call('GET', '/api/tables');
  const item = (name: string) => { const x = menu.items.find((i: any) => i.name === name); if (!x) throw new Error('no menu item ' + name); return x; };
  const groupsOf = (name: string) => item(name).group_ids.map((g: string) => menu.groups.find((x: any) => x.id === g));

  /** Add a dish; required option groups get the preferred answer (or a random one), optional ones only if named. */
  async function add(orderId: string, name: string, qty = 1, prefer: string[] = []) {
    const options: string[] = [];
    for (const g of groupsOf(name)) {
      const wanted = g.options.filter((o: any) => prefer.includes(o.name));
      if (wanted.length) options.push(...wanted.slice(0, g.max_select).map((o: any) => o.id));
      else if (g.min_select > 0) options.push(pick(g.options as any[]).id);
    }
    return call('POST', `/api/orders/${orderId}/lines`, { menuItemId: item(name).id, qty, options });
  }
  const open = (tableIdx: number | null, guests = 2, channel = 'dine_in') =>
    call('POST', '/api/orders', { tableId: tableIdx === null ? null : tables[tableIdx].id, guests, channel }).then((o: any) => o.id as string);
  const send = (id: string) => call('POST', `/api/orders/${id}/send`);
  const total = async (id: string) => (await call('GET', `/api/orders/${id}`)).bill.total as number;
  type Pay = { method: 'cash' | 'promptpay' | 'card' | 'transfer'; share?: number };
  async function pay(id: string, docType: 'ABB' | 'FULL', pays: Pay[], buyer?: (typeof saved)[number]) {
    const t = await total(id);
    let left = t;
    const payments = pays.map((p, i) => {
      const amount = i === pays.length - 1 ? left : Math.round(t * (p.share ?? 1 / pays.length));
      left -= amount;
      return p.method === 'cash'
        ? { method: p.method, amount, tendered: Math.ceil(amount / 10000) * 10000 }
        : { method: p.method, amount, ref: p.method === 'card' ? `****${1000 + Math.floor(rand() * 8999)}` : undefined };
    });
    return call('POST', `/api/orders/${id}/pay`, {
      terminalId, docType, payments,
      buyer: buyer ? { name: buyer.name, taxId: buyer.tax_id, branch: buyer.branch, address: buyer.address } : undefined,
    });
  }

  await call('POST', '/api/shifts', { terminalId, openingFloat: 300000 });
  log('shift opened with float ฿3,000');

  const docs: any[] = [];
  const cash: Pay[] = [{ method: 'cash' }]; const qr: Pay[] = [{ method: 'promptpay' }];
  const card: Pay[] = [{ method: 'card' }]; const xfer: Pay[] = [{ method: 'transfer' }];

  // 1 couple, ribeye + tenderloin, wine
  let o = await open(0, 2);
  await add(o, 'สเต็กเนื้อริบอาย 250 ก.', 1, ['Medium Rare', 'พริกไทยดำ', 'เฟรนช์ฟรายส์', 'ไข่ดาว']);
  await add(o, 'สเต็กเนื้อเทนเดอร์ลอยน์ 200 ก.', 1, ['Medium', 'เห็ด', 'มันบด']);
  await add(o, 'ซุปเห็ดครีม', 2); await add(o, 'ไวน์แดง (แก้ว)', 2); await send(o);
  await add(o, 'บราวนี่ไอศกรีม', 1); await send(o);
  docs.push(await pay(o, 'ABB', card));

  // 2 family, rice dishes
  o = await open(1, 4);
  await add(o, 'ข้าวขาหมู', 2, ['ไข่พะโล้']); await add(o, 'ข้าวหมูกรอบ', 1, ['ข้าวเพิ่ม']);
  await add(o, 'ผัดกะเพราหมูกรอบ', 1, ['เผ็ดกลาง', 'ไข่ดาว']); await add(o, 'ชาไทยเย็น', 2, ['หวานน้อย']); await add(o, 'น้ำเปล่า', 2); await send(o);
  docs.push(await pay(o, 'ABB', cash));

  // 3 table of 4 with beer, paid half cash half PromptPay
  o = await open(2, 4);
  await add(o, 'หมูกรอบทอดกระเทียมพริกไทย', 2); await add(o, 'ปีกไก่ทอด', 2); await add(o, 'เฟรนช์ฟรายส์', 1);
  await add(o, 'เบียร์สิงห์ (ขวดใหญ่)', 4); await send(o);
  await add(o, 'เบียร์สิงห์ (ขวดใหญ่)', 2); await send(o);
  docs.push(await pay(o, 'ABB', [{ method: 'cash', share: 0.5 }, { method: 'promptpay' }]));

  // 4 company dinner → full tax invoice for a saved customer
  o = await open(3, 6);
  await add(o, 'สเต็กเนื้อสันนอก 200 ก.', 3, ['Medium', 'พริกไทยดำ', 'สลัดผัก']);
  await add(o, 'สเต็กแซลมอน', 2, ['Medium Well', 'ไม่ใส่ซอส', 'ผักลวก']); await add(o, 'สเต็กสันในหมู', 1, ['บาร์บีคิว', 'เฟรนช์ฟรายส์']);
  await add(o, 'ไวน์ขาว (ขวด)', 1); await add(o, 'น้ำเปล่า', 6); await send(o);
  docs.push(await pay(o, 'FULL', xfer, saved[0]));

  // 5 whisky bottle with mixers, 10% discount, FULL invoice
  o = await open(4, 5);
  await add(o, 'วิสกี้ (ขวด 700 มล.)', 1, ['โซดา 2 ขวด', 'น้ำแข็ง']); await add(o, 'ปีกไก่ทอด', 2); await add(o, 'หมูกรอบทอดกระเทียมพริกไทย', 1); await send(o);
  await call('PUT', `/api/orders/${o}/discount`, { type: 'percent', value: 1000 });
  docs.push(await pay(o, 'FULL', cash, saved[2]));

  // 6 cocktails
  o = await open(5, 2);
  await add(o, 'โมฮิโต้', 2); await add(o, 'จินโทนิก', 1); await add(o, 'ไฮบอลวิสกี้', 1); await add(o, 'เฟรนช์ฟรายส์', 1); await send(o);
  docs.push(await pay(o, 'ABB', qr));

  // 7 takeaway lunch
  o = await open(null, 1, 'takeaway');
  await add(o, 'ข้าวหมูกรอบ', 2, ['ไข่ดาว']); await add(o, 'คะน้าหมูกรอบ', 1); await send(o);
  docs.push(await pay(o, 'ABB', qr));

  // 8 sent line voided by the manager (food already cooked → booked as waste)
  o = await open(6, 2);
  await add(o, 'สเต็กอกไก่', 1, ['Medium', 'เห็ด', 'สลัดผัก']);
  const wrong = await add(o, 'สเต็กสันในหมู', 1, ['บาร์บีคิว', 'เฟรนช์ฟรายส์']);
  await send(o);
  await call('POST', `/api/orders/${o}/lines/${wrong.id}/void`, { reason: 'ลูกค้าสั่งผิด ครัวทำไปแล้ว' });
  await add(o, 'ชาเขียวเย็น', 2, ['หวานปกติ']); await send(o);
  docs.push(await pay(o, 'ABB', cash));

  // 9 split bill: two friends pay separately
  o = await open(7, 2);
  const l1 = await add(o, 'ข้าวขาหมูพิเศษ (ไข่พะโล้)', 1); await add(o, 'ข้าวหมูกรอบ', 1);
  await add(o, 'เบียร์ช้าง (ขวดใหญ่)', 2); await send(o);
  const child = await call('POST', `/api/orders/${o}/split`, { lines: [{ lineId: l1.id, qty: 1 }] });
  docs.push(await pay(o, 'ABB', cash)); docs.push(await pay(child.id, 'ABB', qr));

  // 10 more mixed bills so reports have volume
  const combos: Array<{ t: number | null; g: number; dishes: Array<[string, number, string[]?]>; pay: Pay[]; type?: 'ABB' | 'FULL'; who?: number }> = [
    { t: 8, g: 2, dishes: [['สเต็กเนื้อสันนอก 200 ก.', 2, ['Medium Rare', 'พริกไทยดำ', 'เฟรนช์ฟรายส์']], ['เบียร์ลีโอ (ขวดใหญ่)', 2]], pay: card },
    { t: 9, g: 3, dishes: [['ข้าวขาหมู', 3], ['ไข่พะโล้', 3], ['น้ำอัดลม', 3]], pay: cash },
    { t: 10, g: 4, dishes: [['ขาหมูพะโล้ (จานแบ่ง)', 1], ['ข้าวสวย', 4], ['คะน้าหมูกรอบ', 1], ['เบียร์ลีโอ (ขวดใหญ่)', 3]], pay: qr },
    { t: null, g: 1, dishes: [['ผัดกะเพราหมูกรอบ', 1, ['เผ็ดมาก']], ['น้ำมะพร้าว', 1]], pay: cash },
    { t: 11, g: 5, dishes: [['โซจู (ขวด)', 2, ['โซดา 2 ขวด']], ['หมูกรอบทอดกระเทียมพริกไทย', 2], ['ปีกไก่ทอด', 1]], pay: xfer },
    { t: 0, g: 2, dishes: [['สเต็กสันในหมู', 1, ['Medium', 'เห็ด', 'มันบด']], ['สเต็กอกไก่', 1], ['กาแฟเย็น', 2, ['หวานน้อย']]], pay: card },
    { t: 1, g: 2, dishes: [['ไฮเนเก้น (ขวด)', 4], ['เฟรนช์ฟรายส์', 2], ['ปีกไก่ทอด', 1]], pay: card },
    { t: 2, g: 3, dishes: [['ข้าวหมูกรอบ', 2], ['คะน้าหมูกรอบ', 1], ['มะนาวโซดา', 3]], pay: qr },
    { t: 3, g: 8, dishes: [['สเต็กเนื้อริบอาย 250 ก.', 4, ['Medium', 'พริกไทยดำ', 'เฟรนช์ฟรายส์']], ['ไวน์แดง (ขวด)', 2], ['สลัดผัก', 3]], pay: xfer, type: 'FULL', who: 4 },
  ];
  for (const c of combos) {
    o = await open(c.t, c.g, c.t === null ? 'takeaway' : 'dine_in');
    for (const [name, qty, prefer] of c.dishes) await add(o, name, qty, prefer ?? []);
    await send(o);
    docs.push(await pay(o, c.type ?? 'ABB', c.pay, c.who === undefined ? undefined : saved[c.who]));
  }

  // 11 a mistaken document, voided with a reason (shows the "ยกเลิก" state on reports)
  o = await open(4, 1);
  await add(o, 'ชาไทยเย็น', 1, ['หวานปกติ']); await send(o);
  const mistaken = await pay(o, 'ABB', cash);
  await call('POST', `/api/documents/${mistaken.document.id}/void`, { reason: 'พนักงานกดชำระผิดโต๊ะ' });

  // two tables still being served, so the floor plan is alive
  o = await open(5, 3);
  await add(o, 'สเต็กเนื้อสันนอก 200 ก.', 2, ['Medium', 'พริกไทยดำ', 'เฟรนช์ฟรายส์']); await add(o, 'เบียร์สิงห์ (ขวดใหญ่)', 2); await send(o);
  o = await open(6, 2);
  await add(o, 'ข้าวขาหมูพิเศษ (ไข่พะโล้)', 2); await add(o, 'ชาไทยเย็น', 2, ['หวานน้อย']);

  const sum = docs.reduce((s, d) => s + d.document.total, 0);
  log(`sales: ${docs.length + 1} documents (1 voided), total ฿${(sum / 100).toLocaleString()} · 2 tables left open · shift still open`);
  log('done. owner login:', email);
}

await main();
