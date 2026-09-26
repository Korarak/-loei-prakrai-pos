import { isValidThaiTaxId } from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant } from '../db.ts';

const Id = z.object({ id: z.string().uuid() });

const Settings = z.object({
  legalName: z.string().trim().max(200).nullable(),
  taxId: z.string().trim().nullable().refine((v) => v === null || isValidThaiTaxId(v), 'invalid Thai tax ID'),
  address: z.string().trim().max(500).nullable(),
  vatRegistered: z.boolean(),
  vatRegisteredAt: z.string().date().nullable(),
  priceIncludesVat: z.boolean(),
  serviceChargeBp: z.number().int().min(0).max(2000),
  cashRounding: z.enum(['none', 'down-baht', 'down-25']),
}).partial();

const Terminal = z.object({
  name: z.string().trim().min(1).max(50),
  rdPosId: z.string().trim().max(50).nullable(),
  serialNo: z.string().trim().max(100).nullable(),
}).partial();

const Category = z.object({ name: z.string().trim().min(1).max(50), sort: z.number().int().default(0) });

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

const COLS = {
  legalName: 'legal_name', taxId: 'tax_id', address: 'address', vatRegistered: 'vat_registered',
  vatRegisteredAt: 'vat_registered_at', priceIncludesVat: 'price_includes_vat',
  serviceChargeBp: 'service_charge_bp', cashRounding: 'cash_rounding',
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

  app.get('/api/menu', { preHandler: ctx.auth() }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, async (c) => ({
      categories: await many(c, `SELECT id, name, sort FROM menu_categories ORDER BY sort, name`),
      items: await many(c, `SELECT id, category_id, name, price, vat_exempt, station, image_url, active, sort
                              FROM menu_items ORDER BY sort, name`),
    })));

  app.post('/api/menu/categories', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const b = Category.parse(req.body);
    reply.status(201);
    return withTenant(ctx.db, req.session.tenantId, (c) =>
      one(c, `INSERT INTO menu_categories (name, sort) VALUES ($1, $2) RETURNING *`, [b.name, b.sort]));
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

  app.get('/api/tables', { preHandler: ctx.auth() }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, (c) => many(c,
      `SELECT t.id, t.name, t.seats, o.id AS order_id, o.guests, o.opened_at, o.bill_no,
              coalesce((SELECT sum(l.unit_price * l.qty) FROM order_lines l WHERE l.order_id = o.id AND l.status <> 'void'), 0)::bigint AS amount
         FROM dining_tables t
         LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
        ORDER BY t.sort, t.name`)));

  app.post('/api/tables', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const b = Table.parse(req.body);
    reply.status(201);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const br = await one(c, `SELECT id FROM branches ORDER BY name LIMIT 1`);
      const max = await one(c, `SELECT coalesce(max(sort), 0) + 1 AS n FROM dining_tables`);
      return one(c, `INSERT INTO dining_tables (branch_id, name, seats, sort) VALUES ($1, $2, $3, $4) RETURNING *`,
        [br.id, b.name, b.seats, max.n]);
    });
  });
}
