import type { Tx } from './db.ts';

/** Starter menu for a made-to-order Thai restaurant; prices in satang, VAT-inclusive. */
const AHARN: Array<[string, Array<[string, number]>]> = [
  ['จานเดียว', [['ข้าวผัดกุ้ง', 6000], ['กะเพราหมูสับไข่ดาว', 5500], ['ผัดไทยกุ้งสด', 7000], ['ข้าวสวย', 1000]]],
  ['ต้ม/แกง', [['ต้มยำกุ้งน้ำข้น', 12000], ['แกงเขียวหวานไก่', 8000]]],
  ['ยำ/ส้มตำ', [['ส้มตำไทย', 5000]]],
  ['ของทอด', [['ไก่ทอดหาดใหญ่', 9000]]],
  ['ของหวาน', [['ข้าวเหนียวมะม่วง', 7000]]],
  ['เครื่องดื่ม', [['ชาไทยเย็น', 3500], ['น้ำมะพร้าว', 4000], ['น้ำเปล่า', 1500]]],
];

export async function seedTemplate(c: Tx) {
  let catSort = 0;
  for (const [cat, items] of AHARN) {
    const r = await c.query(`INSERT INTO menu_categories (name, sort) VALUES ($1, $2) RETURNING id`, [cat, catSort++]);
    let sort = 0;
    for (const [name, price] of items) {
      await c.query(
        `INSERT INTO menu_items (category_id, name, price, station, sort) VALUES ($1, $2, $3, $4, $5)`,
        [r.rows[0].id, name, price, cat === 'เครื่องดื่ม' ? 'bar' : 'kitchen', sort++],
      );
    }
  }
}
