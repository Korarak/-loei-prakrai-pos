import {
  allocate, applyRate, extractBase, isValidThaiTaxId, menuEngineering, movingAverage, pct, unitCostOf, vatRateOn,
} from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError, type Session } from '../auth.ts';
import { audit, many, one, withTenant, type Tx } from '../db.ts';
import { drawLines, drawn, explode, move, prepBook, prepUnitCost, q4, servingCostOf, usesPrep } from '../stock.ts';
import { bangkokDate } from './orders.ts';

const Id = z.object({ id: z.string().uuid() });
const Month = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
const Qty = z.number().positive().max(1e9);
const TaxId = z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).refine(isValidThaiTaxId, 'invalid Thai tax ID');

const Ingredient = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['food', 'beverage', 'packaging']).default('food'),
  baseUnit: z.enum(['g', 'ml', 'pc']),
  purchaseUnit: z.string().trim().min(1).max(20),
  purchaseFactor: Qty,
  yieldPct: z.number().int().min(1).max(100).default(100),
  reorderPoint: z.number().min(0).max(1e9).default(0),
  /** Price of one purchase unit in satang — sets the average cost before the first delivery is recorded. */
  purchasePrice: z.number().int().min(0).optional(),
  active: z.boolean().default(true),
  /** สูตรย่อย: made in the shop from other ingredients; `batchYield` = base units one batch makes. */
  isPrep: z.boolean().default(false),
  batchYield: Qty.nullable().default(null),
});

const Recipe = z.object({
  lines: z.array(z.object({ ingredientId: z.string().uuid(), qty: Qty })).max(50),
});

const Purchase = z.object({
  purchasedOn: z.string().date(),
  supplierName: z.string().trim().min(1).max(200),
  supplierTaxId: TaxId.nullable().default(null),
  supplierBranch: z.string().trim().regex(/^\d{5}$/).nullable().default(null),
  invoiceNo: z.string().trim().min(1).max(50).nullable().default(null),
  /** Full tax invoice (ม.86/4) received — only then can input VAT be claimed. */
  taxInvoice: z.boolean().default(false),
  vatMode: z.enum(['none', 'included', 'excluded']),
  /** VAT as printed on the invoice when it differs from our own rounding. */
  inputVat: z.number().int().min(0).optional(),
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({
    ingredientId: z.string().uuid(),
    qty: Qty,                                   // purchase units
    amount: z.number().int().min(0),            // satang as on the invoice
  })).min(1).max(100),
});

const Waste = z.object({ ingredientId: z.string().uuid(), qty: Qty, reason: z.string().trim().min(3).max(300) });

const Count = z.object({
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({ ingredientId: z.string().uuid(), countedQty: z.number().min(0).max(1e9) })).min(1).max(500),
});

const EXPENSE_CATS = ['labor', 'rent', 'utilities', 'packaging', 'fees', 'marketing', 'other'] as const;
const Expense = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  paidOn: z.string().date(),
  category: z.enum(EXPENSE_CATS),
  description: z.string().trim().min(1).max(200),
  total: z.number().int().min(0),               // paid before withholding tax, VAT included
  inputVat: z.number().int().min(0).default(0),
  whtRateBp: z.number().int().min(0).max(1500).default(0),
  payeeName: z.string().trim().max(200).optional(),
  payeeTaxId: TaxId.optional(),
});

/** Transactions in a Bangkok calendar month. */
const inMonth = (col: string) => `to_char((${col} AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM') = $1`;

async function vatShop(c: Tx, s: Session) {
  const t = await one<{ vat_registered: boolean; price_includes_vat: boolean }>(c,
    `SELECT vat_registered, price_includes_vat FROM tenants WHERE id = $1`, [s.tenantId]);
  return t!;
}

async function rateOn(c: Tx, day: string) {
  const rows = await many(c, `SELECT rate_bp, valid_from::text, valid_to::text, legal_ref FROM tax_rates`);
  return vatRateOn(day, rows.map((r) => ({ rate: r.rate_bp, from: r.valid_from, to: r.valid_to, legalRef: r.legal_ref }))).rate;
}

export async function costingRoutes(app: FastifyInstance, ctx: Ctx) {
  const manager = ctx.auth(atLeast('manager'));
  const tx = <T>(s: Session, fn: (c: Tx) => Promise<T>) => withTenant(ctx.db, s.tenantId, fn);

  // ---------- ingredients ----------

  app.get('/api/ingredients', { preHandler: manager }, async (req) => tx(req.session, async (c) => {
    const rows = await many(c,
      `SELECT i.*, round(i.on_hand * i.avg_cost / 10000)::bigint AS stock_value,
              (i.on_hand <= i.reorder_point AND i.reorder_point > 0 AND NOT i.is_prep) AS low,
              (SELECT count(*)::int FROM recipe_lines r WHERE r.ingredient_id = i.id)
                + (SELECT count(*)::int FROM prep_lines p WHERE p.ingredient_id = i.id) AS used_in,
              (SELECT count(*)::int FROM prep_lines p WHERE p.prep_id = i.id) AS prep_lines
         FROM ingredients i ORDER BY i.active DESC, i.is_prep, i.kind, i.name`);
    if (!rows.some((r) => r.is_prep)) return rows;
    // A prep item has no stock; its cost per unit comes from its batch recipe.
    const book = await prepBook(c);
    return rows.map((r) => (r.is_prep ? { ...r, avg_cost: prepUnitCost(r.id, book), stock_value: 0 } : r));
  }));

  app.post('/api/ingredients', { preHandler: manager }, async (req, reply) => {
    const b = Ingredient.parse(req.body);
    if (b.isPrep && !b.batchYield) throw new HttpError(400, 'batch_yield_required');
    const avg = b.purchasePrice === undefined || b.isPrep ? 0 : unitCostOf(b.purchasePrice, b.purchaseFactor);
    reply.status(201);
    return tx(req.session, async (c) => {
      const it = await one(c,
        `INSERT INTO ingredients (name, kind, base_unit, purchase_unit, purchase_factor, yield_pct, reorder_point, avg_cost, active,
                                  is_prep, batch_yield)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [b.name, b.kind, b.baseUnit, b.purchaseUnit, b.purchaseFactor, b.yieldPct, b.reorderPoint, avg, b.active,
         b.isPrep, b.isPrep ? b.batchYield : null]);
      await audit(c, req.session.userId, 'ingredient.create', 'ingredient', it.id, b);
      return it;
    });
  });

  app.patch('/api/ingredients/:id', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    // partial() keeps defaults, so only fields actually sent count as changes
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const b = Ingredient.partial().parse(req.body);
    return tx(req.session, async (c) => {
      const before = await one(c, `SELECT * FROM ingredients WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw new HttpError(404, 'not_found');
      const isPrep = 'isPrep' in raw ? b.isPrep! : before.is_prep;
      const batchYield = !isPrep ? null : 'batchYield' in raw ? b.batchYield : before.batch_yield;
      if (isPrep && !batchYield) throw new HttpError(400, 'batch_yield_required');
      // Stock already on hand would vanish from the ledger if the item became a prep.
      if (isPrep && !before.is_prep && before.on_hand !== 0) throw new HttpError(409, 'has_stock');
      if (!isPrep && before.is_prep) await c.query(`DELETE FROM prep_lines WHERE prep_id = $1`, [id]);
      const factor = b.purchaseFactor ?? before.purchase_factor;
      const avg = b.purchasePrice === undefined || isPrep ? before.avg_cost : unitCostOf(b.purchasePrice, factor);
      const it = await one(c,
        `UPDATE ingredients SET name = $2, kind = $3, base_unit = $4, purchase_unit = $5, purchase_factor = $6,
                yield_pct = $7, reorder_point = $8, avg_cost = $9, active = $10, is_prep = $11, batch_yield = $12 WHERE id = $1 RETURNING *`,
        [id, b.name ?? before.name, b.kind ?? before.kind, b.baseUnit ?? before.base_unit, b.purchaseUnit ?? before.purchase_unit,
         factor, b.yieldPct ?? before.yield_pct, b.reorderPoint ?? before.reorder_point, avg, b.active ?? before.active,
         isPrep, batchYield]);
      if (avg !== before.avg_cost) {
        await audit(c, req.session.userId, 'ingredient.cost', 'ingredient', id, { from: before.avg_cost, to: avg });
      }
      return it;
    });
  });

  app.get('/api/ingredients/:id/movements', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, (c) => many(c,
      `SELECT m.id, m.kind, m.qty, m.unit_cost, m.value, m.reason, m.ref_type, m.ref_id, m.at, u.name AS by
         FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.ingredient_id = $1 ORDER BY m.id DESC LIMIT 200`, [id]));
  });

  // ---------- sub-recipes (สูตรย่อย) ----------

  app.get('/api/ingredients/:id/prep', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const book = await prepBook(c);
      const prep = book.ings.get(id);
      if (!prep) throw new HttpError(404, 'not_found');
      const lines = await many(c,
        `SELECT p.ingredient_id, p.qty, i.name, i.base_unit, i.yield_pct, i.is_prep
           FROM prep_lines p JOIN ingredients i ON i.id = p.ingredient_id WHERE p.prep_id = $1 ORDER BY i.name`, [id]);
      const withCost = lines.map((l) => ({ ...l, cost: servingCostOf(explode([l], book)) }));
      const batchCost = withCost.reduce((s, l) => s + l.cost, 0);
      return { prep: { id, name: prep.name, batch_yield: prep.batch_yield, unit_cost: prepUnitCost(id, book) }, lines: withCost, batchCost };
    });
  });

  app.put('/api/ingredients/:id/prep', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Recipe.parse(req.body);
    const ids = b.lines.map((l) => l.ingredientId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'duplicate_ingredient');
    return tx(req.session, async (c) => {
      const prep = await one(c, `SELECT id, is_prep FROM ingredients WHERE id = $1 FOR UPDATE`, [id]);
      if (!prep) throw new HttpError(404, 'not_found');
      if (!prep.is_prep) throw new HttpError(409, 'not_prep');
      const book = await prepBook(c);
      for (const l of b.lines) {
        if (!book.ings.has(l.ingredientId)) throw new HttpError(404, 'ingredient_not_found');
        if (usesPrep(l.ingredientId, id, book)) throw new HttpError(409, 'prep_cycle', 'a sub-recipe cannot contain itself');
      }
      const before = await many(c, `SELECT ingredient_id, qty FROM prep_lines WHERE prep_id = $1 ORDER BY ingredient_id`, [id]);
      await c.query(`DELETE FROM prep_lines WHERE prep_id = $1`, [id]);
      for (const l of b.lines) {
        await c.query(`INSERT INTO prep_lines (prep_id, ingredient_id, qty) VALUES ($1, $2, $3)`, [id, l.ingredientId, q4(l.qty)]);
      }
      await audit(c, req.session.userId, 'prep.update', 'ingredient', id, { before, after: b.lines });
      return { ok: true };
    });
  });

  // ---------- recipes and live menu costing ----------

  app.get('/api/costing/menu', { preHandler: manager }, async (req) => tx(req.session, async (c) => {
    const shop = await vatShop(c, req.session);
    const rate = await rateOn(c, bangkokDate());
    const items = await many(c, `SELECT i.id, i.name, i.price, i.vat_exempt, i.active, i.category_id, k.name AS category
                                   FROM menu_items i LEFT JOIN menu_categories k ON k.id = i.category_id
                                  ORDER BY k.sort NULLS LAST, i.sort, i.name`);
    const lines = await many(c, `SELECT menu_item_id, ingredient_id, qty FROM recipe_lines`);
    const book = await prepBook(c);
    return items.map((it) => {
      const mine = lines.filter((l) => l.menu_item_id === it.id);
      const cost = servingCostOf(explode(mine, book));
      const exVat = shop.vat_registered && shop.price_includes_vat && !it.vat_exempt ? extractBase(it.price, rate) : it.price;
      return { ...it, price_ex_vat: exVat, cost, margin: exVat - cost, food_cost_pct: pct(cost, exVat), recipe_lines: mine.length };
    });
  }));

  app.get('/api/menu/items/:id/recipe', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const item = await one(c, `SELECT id, name, price, vat_exempt FROM menu_items WHERE id = $1`, [id]);
      if (!item) throw new HttpError(404, 'not_found');
      const lines = await many(c,
        `SELECT r.ingredient_id, r.qty, i.name, i.base_unit, i.yield_pct, i.avg_cost, i.kind, i.is_prep
           FROM recipe_lines r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id = $1 ORDER BY i.kind, i.name`, [id]);
      const book = await prepBook(c);
      return {
        item,
        lines: lines.map((l) => ({ ...l, avg_cost: prepUnitCost(l.ingredient_id, book), drawn: drawn(l), cost: servingCostOf(explode([l], book)) })),
        cost: servingCostOf(explode(lines, book)),
      };
    });
  });

  app.put('/api/menu/items/:id/recipe', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Recipe.parse(req.body);
    const ids = b.lines.map((l) => l.ingredientId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'duplicate_ingredient');
    return tx(req.session, async (c) => {
      const item = await one(c, `SELECT id FROM menu_items WHERE id = $1`, [id]);
      if (!item) throw new HttpError(404, 'not_found');
      const before = await many(c, `SELECT ingredient_id, qty FROM recipe_lines WHERE menu_item_id = $1 ORDER BY ingredient_id`, [id]);
      await c.query(`DELETE FROM recipe_lines WHERE menu_item_id = $1`, [id]);
      for (const l of b.lines) {
        await c.query(`INSERT INTO recipe_lines (menu_item_id, ingredient_id, qty) VALUES ($1, $2, $3)`, [id, l.ingredientId, q4(l.qty)]);
      }
      await audit(c, req.session.userId, 'recipe.update', 'menu_item', id, { before, after: b.lines });
      return { ok: true };
    });
  });

  // ---------- purchases (รับของ) ----------

  app.post('/api/purchases', { preHandler: manager }, async (req, reply) => {
    const b = Purchase.parse(req.body);
    return tx(req.session, async (c) => {
      const shop = await vatShop(c, req.session);
      const sum = b.lines.reduce((s, l) => s + l.amount, 0);
      const rate = await rateOn(c, b.purchasedOn);
      const ownVat = b.vatMode === 'included' ? sum - extractBase(sum, rate) : b.vatMode === 'excluded' ? applyRate(sum, rate) : 0;
      const vat = b.vatMode === 'none' ? 0 : b.inputVat ?? ownVat;
      const subtotal = b.vatMode === 'included' ? sum - vat : sum;
      const total = subtotal + vat;
      const claimable = shop.vat_registered && b.taxInvoice && vat > 0;
      if (claimable && (!b.supplierTaxId || !b.invoiceNo)) throw new HttpError(400, 'supplier_tax_info_required');

      const p = await one(c,
        `INSERT INTO purchases (purchased_on, supplier_name, supplier_tax_id, supplier_branch, invoice_no, vat_mode,
            vat_claimable, subtotal, input_vat, total, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [b.purchasedOn, b.supplierName, b.supplierTaxId, b.supplierBranch ?? (b.supplierTaxId ? '00000' : null), b.invoiceNo,
         b.vatMode, claimable, subtotal, vat, total, b.note ?? null, req.session.userId]);

      // Claimable VAT is credited on ภ.พ.30, so stock carries the ex-VAT cost; otherwise VAT is part of the cost (§4.2).
      const costs = allocate(claimable ? subtotal : total, b.lines.map((l) => l.amount));
      for (const [i, l] of b.lines.entries()) {
        const ing = await one(c, `SELECT * FROM ingredients WHERE id = $1 FOR UPDATE`, [l.ingredientId]);
        if (!ing) throw new HttpError(404, 'ingredient_not_found');
        if (ing.is_prep) throw new HttpError(409, 'prep_not_purchasable', 'sub-recipes are made in the shop, not bought');
        const baseQty = q4(l.qty * ing.purchase_factor);
        const unitCost = unitCostOf(costs[i]!, baseQty);
        await c.query(
          `INSERT INTO purchase_lines (purchase_id, ingredient_id, qty, base_qty, amount, cost, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [p.id, ing.id, l.qty, baseQty, l.amount, costs[i], unitCost]);
        await c.query(`UPDATE ingredients SET avg_cost = $2 WHERE id = $1`, [ing.id, movingAverage(ing.on_hand, ing.avg_cost, baseQty, unitCost)]);
        await move(c, { ingredientId: ing.id, kind: 'purchase', qty: baseQty, unitCost, refType: 'purchase', refId: p.id, userId: req.session.userId });
      }
      await audit(c, req.session.userId, 'purchase.create', 'purchase', p.id, { supplier: b.supplierName, total, vat, claimable });
      reply.status(201);
      return p;
    });
  });

  // Doubles as รายงานภาษีซื้อ: claimable rows carry supplier tax ID and branch.
  app.get('/api/purchases', { preHandler: manager }, async (req) => {
    const { month } = Month.parse(req.query);
    return tx(req.session, async (c) => {
      const rows = await many(c,
        `SELECT p.*, u.name AS by,
                (SELECT json_agg(json_build_object('name', i.name, 'qty', l.qty, 'unit', i.purchase_unit, 'amount', l.amount) ORDER BY i.name)
                   FROM purchase_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.purchase_id = p.id) AS lines
           FROM purchases p LEFT JOIN users u ON u.id = p.created_by
          WHERE to_char(p.purchased_on, 'YYYY-MM') = $1 ORDER BY p.purchased_on, p.created_at`, [month]);
      const claim = rows.filter((r) => r.vat_claimable);
      return {
        month, rows,
        totals: {
          total: rows.reduce((s, r) => s + r.total, 0),
          claimableBase: claim.reduce((s, r) => s + r.subtotal, 0),
          claimableVat: claim.reduce((s, r) => s + r.input_vat, 0),
        },
      };
    });
  });

  // ---------- waste and stock counts ----------

  app.post('/api/stock/waste', { preHandler: ctx.auth(atLeast('cashier')) }, async (req, reply) => {
    const b = Waste.parse(req.body);
    return tx(req.session, async (c) => {
      const ing = await one(c, `SELECT * FROM ingredients WHERE id = $1 FOR UPDATE`, [b.ingredientId]);
      if (!ing) throw new HttpError(404, 'not_found');
      // A spoiled batch of a prep item wastes the ingredients it was made from.
      const value = ing.is_prep
        ? await drawLines(c, explode([{ ingredient_id: ing.id, qty: (b.qty * ing.yield_pct) / 100 }], await prepBook(c)),
            { servings: 1, kind: 'waste', reason: `${ing.name}: ${b.reason}`, userId: req.session.userId })
        : -(await move(c, { ingredientId: ing.id, kind: 'waste', qty: -b.qty, unitCost: ing.avg_cost, reason: b.reason, userId: req.session.userId }));
      await audit(c, req.session.userId, 'stock.waste', 'ingredient', ing.id, { qty: b.qty, value, reason: b.reason });
      reply.status(201);
      return { value };
    });
  });

  app.post('/api/stock/counts', { preHandler: manager }, async (req, reply) => {
    const b = Count.parse(req.body);
    return tx(req.session, async (c) => {
      const count = await one(c, `INSERT INTO stock_counts (counted_by, note) VALUES ($1, $2) RETURNING *`, [req.session.userId, b.note ?? null]);
      let variance = 0;
      for (const l of b.lines) {
        const ing = await one(c, `SELECT * FROM ingredients WHERE id = $1 FOR UPDATE`, [l.ingredientId]);
        if (!ing) throw new HttpError(404, 'ingredient_not_found');
        if (ing.is_prep) continue;   // no stock of its own to count
        const counted = q4(l.countedQty);
        await c.query(`INSERT INTO stock_count_lines (count_id, ingredient_id, system_qty, counted_qty, unit_cost) VALUES ($1,$2,$3,$4,$5)`,
          [count.id, ing.id, ing.on_hand, counted, ing.avg_cost]);
        const diff = q4(counted - ing.on_hand);
        if (diff !== 0) {
          variance += await move(c, { ingredientId: ing.id, kind: 'adjust', qty: diff, unitCost: ing.avg_cost,
            refType: 'stock_count', refId: count.id, reason: 'นับสต็อก', userId: req.session.userId });
        }
      }
      await audit(c, req.session.userId, 'stock.count', 'stock_count', count.id, { lines: b.lines.length, variance });
      reply.status(201);
      return { ...count, variance };
    });
  });

  // ---------- expenses ----------

  app.get('/api/expenses', { preHandler: manager }, async (req) => {
    const { month } = Month.parse(req.query);
    return tx(req.session, (c) => many(c, `SELECT e.*, u.name AS by FROM expenses e LEFT JOIN users u ON u.id = e.created_by
                                            WHERE e.month = $1 ORDER BY e.paid_on, e.created_at`, [month]));
  });

  app.post('/api/expenses', { preHandler: ctx.auth(['owner']) }, async (req, reply) => {
    const b = Expense.parse(req.body);
    if (b.inputVat > b.total) throw new HttpError(400, 'vat_over_total');
    return tx(req.session, async (c) => {
      const shop = await vatShop(c, req.session);
      const claimable = shop.vat_registered ? b.inputVat : 0;
      const whtBase = b.total - b.inputVat;
      const e = await one(c,
        `INSERT INTO expenses (month, paid_on, category, description, amount, input_vat, wht_rate_bp, wht_amount, payee_name, payee_tax_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [b.month, b.paidOn, b.category, b.description, b.total - claimable, claimable, b.whtRateBp, applyRate(whtBase, b.whtRateBp),
         b.payeeName ?? null, b.payeeTaxId ?? null, req.session.userId]);
      await audit(c, req.session.userId, 'expense.create', 'expense', e.id, b);
      reply.status(201);
      return e;
    });
  });

  // ---------- reports ----------

  // ต้นทุนและกำไรต่อเมนู + menu engineering, from the costs frozen at payment.
  app.get('/api/reports/menu-profit', { preHandler: manager }, async (req) => {
    const { month } = Month.parse(req.query);
    return tx(req.session, async (c) => {
      const rows = await many(c,
        `SELECT coalesce(l.menu_item_id::text, l.name) AS id, l.name, sum(l.qty)::int AS qty,
                sum(coalesce(l.net_ex_vat, 0))::bigint AS revenue, sum(coalesce(l.cost_snapshot, 0))::bigint AS cost
           FROM order_lines l JOIN orders o ON o.id = l.order_id
          WHERE o.status = 'paid' AND l.status <> 'void' AND ${inMonth('o.closed_at')}
          GROUP BY 1, 2 ORDER BY revenue DESC`, [month]);
      const classes = menuEngineering(rows.map((r) => ({ id: r.id, qty: r.qty, margin: r.revenue - r.cost })));
      const items = rows.map((r) => ({
        ...r, margin: r.revenue - r.cost, food_cost_pct: pct(r.cost, r.revenue), class: classes.get(r.id) ?? null,
      }));
      const revenue = items.reduce((s, r) => s + r.revenue, 0);
      const cost = items.reduce((s, r) => s + r.cost, 0);
      return { month, items, totals: { qty: items.reduce((s, r) => s + r.qty, 0), revenue, cost, margin: revenue - cost, food_cost_pct: pct(cost, revenue) } };
    });
  });

  // กำไรขาดทุน (P&L) for one month (design doc §8).
  app.get('/api/reports/pnl', { preHandler: ctx.auth(['owner']) }, async (req) => {
    const { month } = Month.parse(req.query);
    return tx(req.session, async (c) => {
      const sales = await one(c,
        `SELECT coalesce(sum(sign * (total - vat + rounding)), 0)::bigint AS net, coalesce(sum(sign * vat), 0)::bigint AS vat,
                count(*) FILTER (WHERE sign = 1)::int AS docs
           FROM (SELECT *, CASE WHEN doc_type = 'CN' THEN -1 ELSE 1 END AS sign FROM tax_documents) d
          WHERE status = 'issued' AND ${inMonth('issued_at')}`, [month]);
      const stock = await many(c,
        `SELECT m.kind, i.kind AS ingredient_kind, coalesce(sum(-m.value), 0)::bigint AS cost
           FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
          WHERE m.kind IN ('sale','waste','adjust') AND ${inMonth('m.at')}
          GROUP BY 1, 2`, [month]);
      const sum = (f: (r: any) => boolean) => stock.filter(f).reduce((s, r) => s + r.cost, 0);
      const cogs = {
        food: sum((r) => r.kind === 'sale' && r.ingredient_kind === 'food'),
        beverage: sum((r) => r.kind === 'sale' && r.ingredient_kind === 'beverage'),
        packaging: sum((r) => r.kind === 'sale' && r.ingredient_kind === 'packaging'),
        waste: sum((r) => r.kind === 'waste'),
        countVariance: sum((r) => r.kind === 'adjust'),   // + = stock missing against the count
      };
      const cogsTotal = cogs.food + cogs.beverage + cogs.packaging + cogs.waste + cogs.countVariance;
      const exp = await many(c, `SELECT category, sum(amount)::bigint AS amount FROM expenses WHERE month = $1 GROUP BY 1`, [month]);
      const expenses = Object.fromEntries(EXPENSE_CATS.map((k) => [k, exp.find((e) => e.category === k)?.amount ?? 0])) as Record<typeof EXPENSE_CATS[number], number>;
      const expTotal = Object.values(expenses).reduce((s, v) => s + v, 0);
      const gross = sales.net - cogsTotal;
      return {
        month, netSales: sales.net, outputVat: sales.vat, docs: sales.docs, cogs, cogsTotal, grossProfit: gross,
        expenses, expensesTotal: expTotal, netProfit: gross - expTotal,
        foodCostPct: pct(cogs.food + cogs.beverage, sales.net),
        primeCostPct: pct(cogsTotal + expenses.labor, sales.net),
      };
    });
  });

  // ต้นทุนตามสูตร vs ต้นทุนจริง: what recipes say was used against what the counts found.
  app.get('/api/reports/stock-variance', { preHandler: manager }, async (req) => {
    const { month } = Month.parse(req.query);
    return tx(req.session, async (c) => {
      const rows = await many(c,
        `SELECT i.id, i.name, i.base_unit,
                coalesce(sum(-m.qty) FILTER (WHERE m.kind = 'sale'), 0)::float8 AS used_qty,
                coalesce(sum(-m.value) FILTER (WHERE m.kind = 'sale'), 0)::bigint AS used_value,
                coalesce(sum(-m.value) FILTER (WHERE m.kind = 'waste'), 0)::bigint AS waste_value,
                coalesce(sum(-m.qty) FILTER (WHERE m.kind = 'adjust'), 0)::float8 AS missing_qty,
                coalesce(sum(-m.value) FILTER (WHERE m.kind = 'adjust'), 0)::bigint AS missing_value
           FROM ingredients i JOIN stock_movements m ON m.ingredient_id = i.id AND ${inMonth('m.at')}
          GROUP BY i.id, i.name, i.base_unit
         HAVING bool_or(m.kind IN ('sale','waste','adjust'))
          ORDER BY abs(coalesce(sum(-m.value) FILTER (WHERE m.kind = 'adjust'), 0)) DESC, i.name`, [month]);
      const used = rows.reduce((s, r) => s + r.used_value, 0);
      const missing = rows.reduce((s, r) => s + r.missing_value, 0);
      return { month, rows, totals: { used, waste: rows.reduce((s, r) => s + r.waste_value, 0), missing, variancePct: pct(missing, used) } };
    });
  });
}
