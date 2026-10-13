import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, many, one, withTenant, type Tx } from '../db.ts';
import { q4 } from '../stock.ts';

const Id = z.object({ id: z.string().uuid() });

const Option = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  price: z.number().int().min(0).max(10_000_000).default(0),
  active: z.boolean().default(true),
  /** Extra usable base units drawn from stock when chosen (e.g. 1 pc egg). */
  ingredients: z.array(z.object({ ingredientId: z.string().uuid(), qty: z.number().positive().max(1_000_000) })).max(20).default([]),
});
const Group = z.object({
  name: z.string().trim().min(1).max(60),
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  active: z.boolean().default(true),
  options: z.array(Option).min(1).max(40),
  /** Dishes that ask this question. */
  itemIds: z.array(z.string().uuid()).max(500).default([]),
}).refine((g) => g.minSelect <= g.maxSelect, { message: 'min_over_max' });

async function listGroups(c: Tx) {
  const groups = await many(c, `SELECT id, name, min_select, max_select, active, sort FROM modifier_groups ORDER BY active DESC, sort, name`);
  const mods = await many(c, `SELECT id, group_id, name, price, active, sort FROM modifiers ORDER BY sort, name`);
  const ings = await many(c,
    `SELECT mi.modifier_id, mi.ingredient_id, mi.qty, i.name, i.base_unit
       FROM modifier_ingredients mi JOIN ingredients i ON i.id = mi.ingredient_id`);
  const attached = await many(c, `SELECT group_id, menu_item_id FROM menu_item_modifier_groups`);
  return groups.map((g) => ({
    ...g,
    item_ids: attached.filter((a) => a.group_id === g.id).map((a) => a.menu_item_id),
    options: mods.filter((m) => m.group_id === g.id).map((m) => ({
      ...m, ingredients: ings.filter((x) => x.modifier_id === m.id).map((x) => ({ ingredient_id: x.ingredient_id, name: x.name, base_unit: x.base_unit, qty: x.qty })),
    })),
  }));
}

export async function modifierRoutes(app: FastifyInstance, ctx: Ctx) {
  const manager = ctx.auth(atLeast('manager'));

  app.get('/api/modifier-groups', { preHandler: manager }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, listGroups));

  /** Write a group, its options (matched by id; options left out are switched off, never deleted) and the dishes it is on. */
  async function save(c: Tx, userId: string, id: string | null, b: z.infer<typeof Group>) {
    if (b.options.filter((o) => o.active).length < b.minSelect) throw new HttpError(400, 'min_over_options');
    const ingIds = [...new Set(b.options.flatMap((o) => o.ingredients.map((x) => x.ingredientId)))];
    if (ingIds.length) {
      const n = await one(c, `SELECT count(*)::int AS n FROM ingredients WHERE id = ANY($1::uuid[])`, [ingIds]);
      if (n.n !== ingIds.length) throw new HttpError(400, 'ingredient_not_found');
    }
    const itemIds = [...new Set(b.itemIds)];
    if (itemIds.length) {
      const n = await one(c, `SELECT count(*)::int AS n FROM menu_items WHERE id = ANY($1::uuid[])`, [itemIds]);
      if (n.n !== itemIds.length) throw new HttpError(400, 'menu_item_not_found');
    }
    let gid = id;
    if (gid) {
      const g = await one(c,
        `UPDATE modifier_groups SET name = $2, min_select = $3, max_select = $4, active = $5 WHERE id = $1 RETURNING id`,
        [gid, b.name, b.minSelect, b.maxSelect, b.active]);
      if (!g) throw new HttpError(404, 'not_found');
    } else {
      gid = (await one(c,
        `INSERT INTO modifier_groups (name, min_select, max_select, active, sort)
         VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort), -1) + 1 FROM modifier_groups)) RETURNING id`,
        [b.name, b.minSelect, b.maxSelect, b.active])).id as string;
    }
    const keep: string[] = [];
    for (const [i, o] of b.options.entries()) {
      let mid = o.id ?? null;
      if (mid) {
        const m = await one(c, `UPDATE modifiers SET name = $3, price = $4, active = $5, sort = $6 WHERE id = $1 AND group_id = $2 RETURNING id`,
          [mid, gid, o.name, o.price, o.active, i]);
        if (!m) throw new HttpError(404, 'option_not_found');
      } else {
        mid = (await one(c, `INSERT INTO modifiers (group_id, name, price, active, sort) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [gid, o.name, o.price, o.active, i])).id as string;
      }
      keep.push(mid!);
      await c.query(`DELETE FROM modifier_ingredients WHERE modifier_id = $1`, [mid]);
      for (const x of new Map(o.ingredients.map((y) => [y.ingredientId, y])).values()) {
        await c.query(`INSERT INTO modifier_ingredients (modifier_id, ingredient_id, qty) VALUES ($1, $2, $3)`, [mid, x.ingredientId, q4(x.qty)]);
      }
    }
    await c.query(`UPDATE modifiers SET active = false WHERE group_id = $1 AND NOT (id = ANY($2::uuid[]))`, [gid, keep]);
    await c.query(`DELETE FROM menu_item_modifier_groups WHERE group_id = $1`, [gid]);
    for (const itemId of itemIds) {
      await c.query(`INSERT INTO menu_item_modifier_groups (menu_item_id, group_id) VALUES ($1, $2)`, [itemId, gid]);
    }
    await audit(c, userId, id ? 'modifier.update' : 'modifier.create', 'modifier_group', gid, { name: b.name, options: b.options.length, items: itemIds.length });
    return (await listGroups(c)).find((g) => g.id === gid)!;
  }

  app.post('/api/modifier-groups', { preHandler: manager }, async (req, reply) => {
    const b = Group.parse(req.body);
    reply.status(201);
    return withTenant(ctx.db, req.session.tenantId, (c) => save(c, req.session.userId, null, b));
  });

  app.put('/api/modifier-groups/:id', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Group.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, (c) => save(c, req.session.userId, id, b));
  });
}
