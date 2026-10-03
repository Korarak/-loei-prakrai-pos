import { unitCostOf } from '@prakai/core';
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

type Unit = 'g' | 'ml' | 'pc';
/** name, kind, base unit, purchase unit, base units per purchase unit, price per purchase unit (satang), yield % */
const INGREDIENTS: Array<[string, 'food' | 'beverage' | 'packaging', Unit, string, number, number, number]> = [
  ['ข้าวสวย', 'food', 'g', 'กก.', 1000, 1000, 100],
  ['กุ้งสด', 'food', 'g', 'กก.', 1000, 18000, 60],
  ['ไข่ไก่', 'food', 'pc', 'แผง', 30, 10500, 100],
  ['น้ำมันพืช', 'food', 'ml', 'ขวด 1 ลิตร', 1000, 5000, 100],
  ['ชุดเครื่องปรุง', 'food', 'pc', 'ถุง 100 ชุด', 100, 2500, 100],
  ['หมูสับ', 'food', 'g', 'กก.', 1000, 14000, 100],
  ['ใบกะเพรา', 'food', 'g', 'กก.', 1000, 8000, 80],
  ['เส้นจันท์', 'food', 'g', 'กก.', 1000, 6000, 100],
  ['เห็ดฟาง', 'food', 'g', 'กก.', 1000, 6000, 90],
  ['อกไก่', 'food', 'g', 'กก.', 1000, 9000, 100],
  ['สะโพกไก่', 'food', 'g', 'กก.', 1000, 8000, 100],
  ['กะทิ', 'food', 'ml', 'กล่อง 1 ลิตร', 1000, 7000, 100],
  ['มะละกอ', 'food', 'g', 'กก.', 1000, 2500, 85],
  ['กุ้งแห้ง', 'food', 'g', 'กก.', 1000, 60000, 100],
  ['ข้าวเหนียว', 'food', 'g', 'กก.', 1000, 4000, 100],
  ['มะม่วงน้ำดอกไม้', 'food', 'pc', 'ลูก', 1, 2500, 100],
  ['ผงชาไทย', 'beverage', 'g', 'ถุง 400 ก.', 400, 9000, 100],
  ['นมข้นหวาน', 'beverage', 'g', 'กระป๋อง 380 ก.', 380, 3000, 100],
  ['มะพร้าวน้ำหอม', 'beverage', 'pc', 'ลูก', 1, 2000, 100],
  ['น้ำดื่มขวด', 'beverage', 'pc', 'แพ็ค 12 ขวด', 12, 6000, 100],
  ['แก้วพลาสติก', 'packaging', 'pc', 'แถว 50 ใบ', 50, 6000, 100],
];

/** menu item → [ingredient, usable base units per serving] */
const RECIPES: Record<string, Array<[string, number]>> = {
  'ข้าวผัดกุ้ง': [['ข้าวสวย', 200], ['กุ้งสด', 40], ['ไข่ไก่', 1], ['น้ำมันพืช', 15], ['ชุดเครื่องปรุง', 1]],
  'กะเพราหมูสับไข่ดาว': [['ข้าวสวย', 200], ['หมูสับ', 100], ['ไข่ไก่', 1], ['น้ำมันพืช', 20], ['ใบกะเพรา', 10], ['ชุดเครื่องปรุง', 1]],
  'ผัดไทยกุ้งสด': [['เส้นจันท์', 100], ['กุ้งสด', 40], ['ไข่ไก่', 1], ['น้ำมันพืช', 20], ['ชุดเครื่องปรุง', 1]],
  'ข้าวสวย': [['ข้าวสวย', 200]],
  'ต้มยำกุ้งน้ำข้น': [['กุ้งสด', 80], ['เห็ดฟาง', 50], ['ชุดเครื่องปรุง', 2]],
  'แกงเขียวหวานไก่': [['อกไก่', 120], ['กะทิ', 150], ['ชุดเครื่องปรุง', 1]],
  'ส้มตำไทย': [['มะละกอ', 150], ['กุ้งแห้ง', 10], ['ชุดเครื่องปรุง', 1]],
  'ไก่ทอดหาดใหญ่': [['สะโพกไก่', 250], ['น้ำมันพืช', 50], ['ชุดเครื่องปรุง', 1]],
  'ข้าวเหนียวมะม่วง': [['ข้าวเหนียว', 150], ['มะม่วงน้ำดอกไม้', 1], ['กะทิ', 50]],
  'ชาไทยเย็น': [['ผงชาไทย', 15], ['นมข้นหวาน', 30], ['แก้วพลาสติก', 1]],
  'น้ำมะพร้าว': [['มะพร้าวน้ำหอม', 1]],
  'น้ำเปล่า': [['น้ำดื่มขวด', 1]],
};

/**
 * Starter ingredients priced at typical market rates so the menu shows a food cost from day one.
 * Stock starts at zero: quantities only enter through recorded deliveries, keeping the ledger whole.
 */
export async function seedCosting(c: Tx) {
  const ids = new Map<string, string>();
  for (const [name, kind, unit, pUnit, factor, price, yieldPct] of INGREDIENTS) {
    const r = await c.query(
      `INSERT INTO ingredients (name, kind, base_unit, purchase_unit, purchase_factor, yield_pct, avg_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, kind, unit, pUnit, factor, yieldPct, unitCostOf(price, factor)]);
    ids.set(name, r.rows[0].id);
  }
  const items = await c.query(`SELECT id, name FROM menu_items`);
  for (const it of items.rows) {
    for (const [ing, qty] of RECIPES[it.name] ?? []) {
      await c.query(`INSERT INTO recipe_lines (menu_item_id, ingredient_id, qty) VALUES ($1, $2, $3)`, [it.id, ids.get(ing), qty]);
    }
  }
}
