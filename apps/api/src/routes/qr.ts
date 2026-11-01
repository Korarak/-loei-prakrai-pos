import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant, type Tx } from '../db.ts';
import { addLine, resolveOptions } from './orders.ts';

/** Signature printed in a table's QR link; changes if the shop rotates its secret. */
export const signTable = (secret: string, slug: string, tableId: string) =>
  createHmac('sha256', secret).update(`${slug}:${tableId}`).digest('hex');

function sigOk(secret: string, slug: string, tableId: string, given: string) {
  const want = Buffer.from(signTable(secret, slug, tableId));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

const PublicParams = z.object({ slug: z.string().min(1).max(80), tableId: z.string().uuid() });
const PublicQuery = z.object({ k: z.string().min(1).max(200) });
const Cart = z.object({
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    qty: z.number().int().min(1).max(20),
    note: z.string().trim().max(200).optional(),
    options: z.array(z.string().uuid()).max(30).default([]),
  })).min(1).max(30),
  note: z.string().trim().max(300).optional(),
});
const Id = z.object({ id: z.string().uuid() });

/** At most this many orders from one table can wait for staff at the same time (stops a prank filling the screen). */
const MAX_PENDING_PER_TABLE = 5;
/** Per-table submission rate: a second line of defence in front of the pending cap. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

export async function qrRoutes(app: FastifyInstance, ctx: Ctx) {
  const hits = new Map<string, number[]>();
  const rateLimited = (key: string) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) { hits.set(key, recent); return true; }
    recent.push(now);
    hits.set(key, recent);
    return false;
  };

  /**
   * Resolve a link to its shop. Every failure (unknown shop, wrong signature, retired table) answers the same
   * 404, so the endpoint cannot be used to find out which shops or tables exist.
   */
  async function open(slug: string, tableId: string, k: string) {
    const t = await withPlatform(ctx.db, (c) => one<{ id: string; name: string; status: string; qr_secret: string; qr_order_enabled: boolean; logo_url: string | null }>(c,
      `SELECT id, name, status, qr_secret, qr_order_enabled, logo_url FROM tenants WHERE slug = $1`, [slug]));
    if (!t || !sigOk(t.qr_secret, slug, tableId, k)) throw new HttpError(404, 'invalid_link');
    if (!['trial', 'active'].includes(t.status)) throw new HttpError(404, 'invalid_link');
    if (!t.qr_order_enabled) throw new HttpError(403, 'qr_disabled');
    return t;
  }

  // ---------- customer side (no sign-in; the signed link is the credential) ----------

  app.get('/api/public/qr/:slug/:tableId', async (req) => {
    const { slug, tableId } = PublicParams.parse(req.params);
    const { k } = PublicQuery.parse(req.query);
    const shop = await open(slug, tableId, k);
    return withTenant(ctx.db, shop.id, async (c) => {
      const table = await one(c, `SELECT name FROM dining_tables WHERE id = $1 AND active`, [tableId]);
      if (!table) throw new HttpError(404, 'invalid_link');
      return {
        shop: { name: shop.name, logoUrl: shop.logo_url },
        table: { id: tableId, name: table.name as string },
        categories: await many(c, `SELECT id, name FROM menu_categories ORDER BY sort, name`),
        items: await many(c, `SELECT i.id, i.category_id, i.name, i.price, i.image_url,
                                     coalesce((SELECT array_agg(mg.group_id ORDER BY g.sort, g.name) FROM menu_item_modifier_groups mg
                                                 JOIN modifier_groups g ON g.id = mg.group_id AND g.active WHERE mg.menu_item_id = i.id), '{}') AS group_ids
                                FROM menu_items i LEFT JOIN menu_categories k ON k.id = i.category_id
                               WHERE i.active ORDER BY k.sort NULLS LAST, i.sort, i.name`),
        groups: await many(c, `SELECT g.id, g.name, g.min_select, g.max_select,
                                      coalesce((SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'price', m.price) ORDER BY m.sort, m.name)
                                                  FROM modifiers m WHERE m.group_id = g.id AND m.active), '[]') AS options
                                 FROM modifier_groups g WHERE g.active ORDER BY g.sort, g.name`),
      };
    });
  });

  app.post('/api/public/qr/:slug/:tableId/orders', async (req, reply) => {
    const { slug, tableId } = PublicParams.parse(req.params);
    const { k } = PublicQuery.parse(req.query);
    const b = Cart.parse(req.body);
    const shop = await open(slug, tableId, k);
    if (rateLimited(`${shop.id}:${tableId}`)) throw new HttpError(429, 'too_many_requests');
    return withTenant(ctx.db, shop.id, async (c) => {
      const table = await one(c, `SELECT id FROM dining_tables WHERE id = $1 AND active FOR UPDATE`, [tableId]);   // serialises the pending cap per table
      if (!table) throw new HttpError(404, 'invalid_link');
      const pending = await one(c, `SELECT count(*)::int AS n FROM qr_requests WHERE table_id = $1 AND status = 'pending'`, [tableId]);
      if (pending.n >= MAX_PENDING_PER_TABLE) throw new HttpError(429, 'too_many_pending');

      // Price everything here from the live menu: nothing the browser says about prices is believed.
      const lines: { id: string; name: string; price: number; qty: number; note: string | null; options: unknown[] }[] = [];
      for (const it of b.items) {
        const item = await one(c, `SELECT id, name, price FROM menu_items WHERE id = $1 AND active`, [it.menuItemId]);
        if (!item) throw new HttpError(404, 'menu_item_not_found');
        const options = await resolveOptions(c, item.id, it.options);
        lines.push({ id: item.id, name: item.name, price: item.price + options.reduce((s, o) => s + o.price, 0), qty: it.qty, note: it.note || null, options });
      }
      const req2 = await one(c, `INSERT INTO qr_requests (table_id, note) VALUES ($1, $2) RETURNING id`, [tableId, b.note || null]);
      for (const l of lines) {
        await c.query(`INSERT INTO qr_request_lines (request_id, menu_item_id, name, unit_price, qty, note, options) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req2.id, l.id, l.name, l.price, l.qty, l.note, JSON.stringify(l.options)]);
      }
      reply.status(201);
      return { id: req2.id as string, total: lines.reduce((s, l) => s + l.price * l.qty, 0) };
    });
  });

  // ---------- staff side ----------

  const tx = <T>(tenantId: string, fn: (c: Tx) => Promise<T>) => withTenant(ctx.db, tenantId, fn);
  const manager = ctx.auth(atLeast('manager'));
  const waiter = ctx.auth(atLeast('waiter'));

  /** Signed link paths for every active table, for printing stickers. Managers only: the paths are the credential. */
  app.get('/api/qr/links', { preHandler: manager }, async (req) => {
    const s = req.session;
    const shop = await withPlatform(ctx.db, (c) => one<{ slug: string; qr_secret: string; qr_order_enabled: boolean }>(c,
      `SELECT slug, qr_secret, qr_order_enabled FROM tenants WHERE id = $1`, [s.tenantId]));
    const tables = await tx(s.tenantId, (c) => many(c, `SELECT id, name FROM dining_tables WHERE active ORDER BY sort, name`));
    return {
      enabled: shop!.qr_order_enabled,
      tables: tables.map((t) => ({ id: t.id, name: t.name, path: `/t/${shop!.slug}/${t.id}?k=${signTable(shop!.qr_secret, shop!.slug, t.id)}` })),
    };
  });

  app.put('/api/qr/enabled', { preHandler: manager }, async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await withPlatform(ctx.db, (c) => c.query(`UPDATE tenants SET qr_order_enabled = $2 WHERE id = $1`, [req.session.tenantId, enabled]));
    await tx(req.session.tenantId, (c) => audit(c, req.session.userId, enabled ? 'qr.enable' : 'qr.disable', 'tenant', req.session.tenantId));
    return { enabled };
  });

  /** New secret = every printed sticker stops working. For a leaked or abused code. */
  app.post('/api/qr/rotate', { preHandler: ctx.auth(['owner']) }, async (req) => {
    await withPlatform(ctx.db, (c) => c.query(
      `UPDATE tenants SET qr_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE id = $1`, [req.session.tenantId]));
    await tx(req.session.tenantId, (c) => audit(c, req.session.userId, 'qr.rotate', 'tenant', req.session.tenantId));
    return { ok: true };
  });

  app.get('/api/qr/requests', { preHandler: waiter }, async (req) =>
    tx(req.session.tenantId, async (c) => {
      const reqs = await many(c,
        `SELECT r.id, r.table_id, t.name AS table_name, r.note, r.created_at,
                coalesce((SELECT json_agg(json_build_object('name', l.name, 'qty', l.qty, 'unit_price', l.unit_price, 'note', l.note, 'options', l.options) ORDER BY l.id)
                            FROM qr_request_lines l WHERE l.request_id = r.id), '[]') AS lines,
                coalesce((SELECT sum(l.unit_price * l.qty) FROM qr_request_lines l WHERE l.request_id = r.id), 0)::bigint AS total
           FROM qr_requests r JOIN dining_tables t ON t.id = r.table_id
          WHERE r.status = 'pending' ORDER BY r.created_at`);
      return reqs;
    }));

  /** Put the customer's dishes on the table's open bill (opening one if the table is empty). */
  app.post('/api/qr/requests/:id/accept', { preHandler: waiter }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session.tenantId, async (c) => {
      const r = await one(c, `SELECT * FROM qr_requests WHERE id = $1 FOR UPDATE`, [id]);
      if (!r) throw new HttpError(404, 'not_found');
      if (r.status !== 'pending') throw new HttpError(409, 'already_decided');
      const table = await one(c, `SELECT id, branch_id FROM dining_tables WHERE id = $1 AND active`, [r.table_id]);
      if (!table) throw new HttpError(409, 'table_not_found');
      let order = await one(c, `SELECT id FROM orders WHERE table_id = $1 AND status = 'open' FOR UPDATE`, [table.id]);
      order ??= await one(c, `INSERT INTO orders (branch_id, table_id, channel, guests, opened_by) VALUES ($1, $2, 'dine_in', 1, $3) RETURNING id`,
        [table.branch_id, table.id, req.session.userId]);
      const lines = await many(c, `SELECT menu_item_id, qty, note, options FROM qr_request_lines WHERE request_id = $1 ORDER BY id`, [id]);
      for (const l of lines) {
        // Re-priced from the live menu; a dish switched off since the customer ordered stops the whole accept (nothing half-added).
        await addLine(c, order!.id, { menuItemId: l.menu_item_id, qty: l.qty, note: l.note ?? undefined, options: (l.options as { id: string }[]).map((o) => o.id) });
      }
      await c.query(`UPDATE qr_requests SET status = 'accepted', decided_by = $2, decided_at = now(), order_id = $3 WHERE id = $1`, [id, req.session.userId, order!.id]);
      await audit(c, req.session.userId, 'qr.accept', 'qr_request', id, { orderId: order!.id });
      return { orderId: order!.id as string };
    });
  });

  app.post('/api/qr/requests/:id/reject', { preHandler: waiter }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session.tenantId, async (c) => {
      const r = await one(c, `UPDATE qr_requests SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id, req.session.userId]);
      if (!r) throw new HttpError(409, 'already_decided');
      await audit(c, req.session.userId, 'qr.reject', 'qr_request', id);
      return { ok: true };
    });
  });
}
