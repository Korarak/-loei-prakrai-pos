import { isValidPromptPayId, isValidThaiTaxId } from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant, type Tx } from '../db.ts';

const Id = z.object({ id: z.string().uuid() });

const Settings = z.object({
  name: z.string().trim().min(1).max(100),
  legalName: z.string().trim().max(200).nullable(),
  taxId: z.string().trim().nullable().refine((v) => v === null || isValidThaiTaxId(v), 'invalid Thai tax ID'),
  address: z.string().trim().max(500).nullable(),
  vatRegistered: z.boolean(),
  vatRegisteredAt: z.string().date().nullable(),
  priceIncludesVat: z.boolean(),
  serviceChargeBp: z.number().int().min(0).max(2000),
  cashRounding: z.enum(['none', 'down-baht', 'down-25']),
  /** Mobile number or tax ID the shop receives PromptPay on; the pay screen shows a QR for the bill amount. */
  promptpayId: z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).nullable()
    .refine((v) => v === null || v === '' || isValidPromptPayId(v), 'PromptPay ID is a 10-digit phone or 13-digit ID')
    .transform((v) => v || null),
}).partial();

const Terminal = z.object({
  name: z.string().trim().min(1).max(50),
  rdPosId: z.string().trim().max(50).nullable(),
  serialNo: z.string().trim().max(100).nullable(),
}).partial();

const Category = z.object({ name: z.string().trim().min(1).max(50), sort: z.number().int().default(0) });
const NewTerminal = z.object({ name: z.string().trim().min(1).max(50) });

/** Every shop table in a data export, with columns that must never leave the server removed. */
const EXPORT_TABLES = ['branches', 'terminals', 'menu_categories', 'menu_items', 'dining_tables', 'orders', 'order_lines',
  'payments', 'tax_documents', 'doc_sequences', 'ingredients', 'recipe_lines', 'purchases', 'purchase_lines',
  'stock_movements', 'stock_counts', 'stock_count_lines', 'expenses', 'prep_lines', 'shifts', 'cash_moves', 'audit_log',
  'modifier_groups', 'modifiers', 'modifier_ingredients', 'menu_item_modifier_groups', 'customers'] as const;

const Item = z.object({
  categoryId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(100),
  price: z.number().int().min(0),
  vatExempt: z.boolean().default(false),
  station: z.enum(['kitchen', 'bar']).default('kitchen'),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

const Table = z.object({ name: z.string().trim().min(1).max(20), seats: z.number().int().min(1).max(50).default(4) });
const TableCount = z.object({ count: z.number().int().min(0).max(200) });
const Branch = z.object({
  name: z.string().trim().min(1).max(100),
  branchCode: z.string().trim().regex(/^\d{5}$/, 'branch code is 5 digits (00000 = head office)'),
  address: z.string().trim().max(500).nullable(),
}).partial();

const COLS = {
  name: 'name', legalName: 'legal_name', taxId: 'tax_id', address: 'address', vatRegistered: 'vat_registered',
  vatRegisteredAt: 'vat_registered_at', priceIncludesVat: 'price_includes_vat',
  serviceChargeBp: 'service_charge_bp', cashRounding: 'cash_rounding', promptpayId: 'promptpay_id',
} as const;

export async function shopRoutes(app: FastifyInstance, ctx: Ctx) {
  app.patch('/api/settings', { preHandler: ctx.auth(['owner']) }, async (req) => {
    const b = Settings.parse(req.body);
    const entries = Object.entries(b).filter(([, v]) => v !== undefined) as [keyof typeof COLS, unknown][];
    if (entries.length === 0) throw new HttpError(400, 'nothing_to_update');
    if (b.taxId) b.taxId = b.taxId.replace(/[\s-]/g, '');
    const sets = entries.map(([k], i) => `${COLS[k]} = $${i + 2}`).join(', ');
    const values = entries.map(([k]) => (b as Record<string, unknown>)[k]);
    const t = await withPlatform(ctx.db, (c) =>
      one(c, `UPDATE tenants SET ${sets} WHERE id = $1 RETURNING *`, [req.session.tenantId, ...values]));
    // Saving VAT on without tax ID/legal name is allowed; payment refuses tax invoices until both exist.
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'settings.update', 'tenant', t.id, b));
    return t;
  });

  app.patch('/api/terminals/:id', { preHandler: ctx.auth(['owner']) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Terminal.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const t = await one(c, `UPDATE terminals SET
          name = coalesce($2, name),
          rd_pos_id = CASE WHEN $3::boolean THEN $4 ELSE rd_pos_id END,
          serial_no = CASE WHEN $5::boolean THEN $6 ELSE serial_no END
        WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.rdPosId !== undefined, b.rdPosId ?? null, b.serialNo !== undefined, b.serialNo ?? null]);
      if (!t) throw new HttpError(404, 'not_found');
      await audit(c, req.session.userId, 'terminal.update', 'terminal', id, b);
      return t;
    });
  });

  // A new till gets the next code (P2, P3…), which prefixes its abbreviated tax invoice numbers.
  app.post('/api/terminals', { preHandler: ctx.auth(['owner']) }, async (req, reply) => {
    const b = NewTerminal.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const codes = new Set((await many(c, `SELECT code FROM terminals`)).map((t) => t.code));
      let n = 1;
      while (codes.has(`P${n}`)) n++;
      const br = await one(c, `SELECT id FROM branches ORDER BY name LIMIT 1`);
      const t = await one(c, `INSERT INTO terminals (branch_id, name, code) VALUES ($1, $2, $3) RETURNING *`, [br.id, b.name, `P${n}`]);
      await audit(c, req.session.userId, 'terminal.create', 'terminal', t.id, { name: b.name, code: t.code });
      reply.status(201);
      return t;
    });
  });

  // สำรองข้อมูล: the owner can take all of the shop's data at any time (design doc §10.3).
  app.get('/api/export', { preHandler: ctx.auth(['owner']) }, async (req, reply) => {
    const data = await withTenant(ctx.db, req.session.tenantId, async (c) => {
      const out: Record<string, unknown[]> = {};
      for (const t of EXPORT_TABLES) out[t] = await many(c, `SELECT * FROM ${t}`);
      return out;
    });
    const shop = await withPlatform(ctx.db, (c) => one(c, `SELECT id, name, slug, legal_name, tax_id, address, vat_registered, vat_registered_at,
        price_includes_vat, service_charge_bp, cash_rounding, created_at FROM tenants WHERE id = $1`, [req.session.tenantId]));
    const staff = await withPlatform(ctx.db, (c) => many(c, `SELECT u.id, u.name, u.email, m.role, m.active
        FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1`, [req.session.tenantId]));
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'data.export', 'tenant', req.session.tenantId));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    reply.header('content-disposition', `attachment; filename="prakai-${shop.slug}-${day}.json"`);
    return { format: 'prakai-export/1', exportedAt: new Date().toISOString(), shop, staff, ...data };
  });

  app.get('/api/menu', { preHandler: ctx.auth() }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, async (c) => ({
      categories: await many(c, `SELECT id, name, sort FROM menu_categories ORDER BY sort, name`),
      // grouped by category order so the "all" view reads like the printed menu
      items: await many(c, `SELECT i.id, i.category_id, i.name, i.price, i.vat_exempt, i.station, i.image_url, i.active, i.sort,
                                   coalesce((SELECT array_agg(mg.group_id ORDER BY g.sort, g.name) FROM menu_item_modifier_groups mg
                                               JOIN modifier_groups g ON g.id = mg.group_id AND g.active WHERE mg.menu_item_id = i.id), '{}') AS group_ids
                              FROM menu_items i LEFT JOIN menu_categories k ON k.id = i.category_id
                             ORDER BY k.sort NULLS LAST, i.sort, i.name`),
      // option groups the till asks about when a dish is tapped (only what can still be chosen)
      groups: await many(c, `SELECT g.id, g.name, g.min_select, g.max_select,
                                    coalesce((SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'price', m.price) ORDER BY m.sort, m.name)
                                                FROM modifiers m WHERE m.group_id = g.id AND m.active), '[]') AS options
                               FROM modifier_groups g WHERE g.active ORDER BY g.sort, g.name`),
    })));

  app.post('/api/menu/categories', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const b = Category.partial({ sort: true }).parse(req.body);
    reply.status(201);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const sort = b.sort ?? (await one(c, `SELECT coalesce(max(sort), -1) + 1 AS n FROM menu_categories`)).n;
      return one(c, `INSERT INTO menu_categories (name, sort) VALUES ($1, $2) RETURNING *`, [b.name, sort]);
    });
  });

  app.patch('/api/menu/categories/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Category.partial().parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const k = await one(c, `UPDATE menu_categories SET name = coalesce($2, name), sort = coalesce($3, sort) WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.sort ?? null]);
      if (!k) throw new HttpError(404, 'not_found');
      return k;
    });
  });

  // Swap places with the neighbour above/below, so the owner can reorder with two buttons.
  app.post('/api/menu/categories/:id/move', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const { dir } = z.object({ dir: z.enum(['up', 'down']) }).parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const all = await many(c, `SELECT id FROM menu_categories ORDER BY sort, name FOR UPDATE`);
      const i = all.findIndex((k) => k.id === id);
      if (i < 0) throw new HttpError(404, 'not_found');
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < all.length) [all[i], all[j]] = [all[j]!, all[i]!];
      for (const [n, k] of all.entries()) await c.query(`UPDATE menu_categories SET sort = $2 WHERE id = $1`, [k.id, n]);
      return many(c, `SELECT id, name, sort FROM menu_categories ORDER BY sort`);
    });
  });

  app.delete('/api/menu/categories/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const used = await one(c, `SELECT count(*)::int AS n FROM menu_items WHERE category_id = $1`, [id]);
      if (used.n > 0) throw new HttpError(409, 'category_in_use', `${used.n} menu items still use this category`);
      const k = await one(c, `DELETE FROM menu_categories WHERE id = $1 RETURNING id`, [id]);
      if (!k) throw new HttpError(404, 'not_found');
      return { ok: true };
    });
  });

  app.post('/api/menu/items', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const b = Item.parse(req.body);
    reply.status(201);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const it = await one(c,
        `INSERT INTO menu_items (category_id, name, price, vat_exempt, station, active, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [b.categoryId, b.name, b.price, b.vatExempt, b.station, b.active, b.sort]);
      await audit(c, req.session.userId, 'menu.create', 'menu_item', it.id, b);
      return it;
    });
  });

  app.patch('/api/menu/items/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Item.partial().parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const before = await one(c, `SELECT * FROM menu_items WHERE id = $1`, [id]);
      if (!before) throw new HttpError(404, 'not_found');
      const it = await one(c,
        `UPDATE menu_items SET category_id = $2, name = $3, price = $4, vat_exempt = $5, station = $6, active = $7, sort = $8
          WHERE id = $1 RETURNING *`,
        [id, b.categoryId === undefined ? before.category_id : b.categoryId, b.name ?? before.name,
         b.price ?? before.price, b.vatExempt ?? before.vat_exempt, b.station ?? before.station,
         b.active ?? before.active, b.sort ?? before.sort]);
      if (b.price !== undefined && b.price !== before.price) {
        await audit(c, req.session.userId, 'menu.price', 'menu_item', id, { from: before.price, to: b.price });
      }
      return it;
    });
  });

  app.patch('/api/branches/:id', { preHandler: ctx.auth(['owner']) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Branch.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const before = await one(c, `SELECT * FROM branches WHERE id = $1`, [id]);
      if (!before) throw new HttpError(404, 'not_found');
      const br = await one(c, `UPDATE branches SET name = $2, branch_code = $3, address = $4 WHERE id = $1 RETURNING *`,
        [id, b.name ?? before.name, b.branchCode ?? before.branch_code, b.address === undefined ? before.address : b.address]);
      // Branch code and address are printed on tax invoices, so changes are audited.
      await audit(c, req.session.userId, 'branch.update', 'branch', id, { before: { code: before.branch_code, address: before.address }, after: b });
      return br;
    });
  });

  app.get('/api/tables', { preHandler: ctx.auth() }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, (c) => many(c,
      `SELECT t.id, t.name, t.seats, t.sort, o.id AS order_id, o.guests, o.opened_at, o.bill_no,
              (SELECT count(*)::int FROM orders x WHERE x.split_from = o.id AND x.status = 'open') AS splits,
              coalesce((SELECT sum(l.unit_price * l.qty) FROM order_lines l WHERE l.order_id = o.id AND l.status <> 'void'), 0)::bigint AS amount
         FROM dining_tables t
         LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
        WHERE t.active
        ORDER BY t.sort, t.name`)));

  const nameTaken = async (c: Tx, name: string, exceptId: string | null) =>
    !!(await one(c, `SELECT 1 FROM dining_tables WHERE active AND name = $1 AND id IS DISTINCT FROM $2`, [name, exceptId]));

  async function addTable(c: Tx, name: string, seats: number) {
    const br = await one(c, `SELECT id FROM branches ORDER BY name LIMIT 1`);
    const max = await one(c, `SELECT coalesce(max(sort), 0) + 1 AS n FROM dining_tables WHERE active`);
    return one(c, `INSERT INTO dining_tables (branch_id, name, seats, sort) VALUES ($1, $2, $3, $4) RETURNING *`, [br.id, name, seats, max.n]);
  }

  /** Retire a table; refused while a bill is open on it. */
  async function retireTable(c: Tx, id: string) {
    const open = await one(c, `SELECT 1 FROM orders WHERE table_id = $1 AND status = 'open'`, [id]);
    if (open) throw new HttpError(409, 'table_busy');
    await c.query(`UPDATE dining_tables SET active = false WHERE id = $1`, [id]);
  }

  app.post('/api/tables', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const b = Table.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      if (await nameTaken(c, b.name, null)) throw new HttpError(409, 'table_name_taken');
      reply.status(201);
      return addTable(c, b.name, b.seats);
    });
  });

  app.patch('/api/tables/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Table.partial().parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const t = await one(c, `SELECT * FROM dining_tables WHERE id = $1 AND active`, [id]);
      if (!t) throw new HttpError(404, 'not_found');
      if (b.name && (await nameTaken(c, b.name, id))) throw new HttpError(409, 'table_name_taken');
      return one(c, `UPDATE dining_tables SET name = $2, seats = $3 WHERE id = $1 RETURNING *`, [id, b.name ?? t.name, b.seats ?? t.seats]);
    });
  });

  app.delete('/api/tables/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const t = await one(c, `SELECT id FROM dining_tables WHERE id = $1 AND active FOR UPDATE`, [id]);
      if (!t) throw new HttpError(404, 'not_found');
      await retireTable(c, id);
      return { ok: true };
    });
  });

  // "We have 15 tables now": add numbered tables at the end, or retire the last free ones.
  app.put('/api/tables/count', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { count } = TableCount.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const rows = await many(c, `SELECT t.id, t.name, EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS busy
                                    FROM dining_tables t WHERE t.active ORDER BY t.sort DESC, t.name DESC FOR UPDATE OF t`);
      if (count > rows.length) {
        const names = new Set(rows.map((r) => r.name));
        let n = 1;
        for (let k = rows.length; k < count; k++) {
          while (names.has(String(n))) n++;
          names.add(String(n));
          await addTable(c, String(n), 4);
        }
      } else if (count < rows.length) {
        const free = rows.filter((r) => !r.busy);
        const drop = rows.length - count;
        if (free.length < drop) throw new HttpError(409, 'tables_busy', `${drop - free.length} of the tables to remove have open bills`);
        for (const r of free.slice(0, drop)) await retireTable(c, r.id);
      }
      await audit(c, req.session.userId, 'tables.count', 'tenant', req.session.tenantId, { from: rows.length, to: count });
      return many(c, `SELECT id, name, seats, sort FROM dining_tables WHERE active ORDER BY sort, name`);
    });
  });
}
