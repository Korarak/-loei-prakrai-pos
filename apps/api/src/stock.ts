import { valueOf } from '@prakai/core';
import { many, type Tx } from './db.ts';

export type MoveKind = 'purchase' | 'sale' | 'waste' | 'adjust';

interface Move {
  ingredientId: string;
  kind: MoveKind;
  /** Signed base units: + into stock, − out of it. */
  qty: number;
  unitCost: number;
  refType?: string;
  refId?: string | null;
  reason?: string | null;
  userId: string | null;
}

/** Four decimals, matching numeric(14,4), so the ledger and on_hand never drift apart. */
export const q4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Write one ledger row and move on_hand with it, in the caller's transaction. */
export async function move(c: Tx, m: Move): Promise<number> {
  const qty = q4(m.qty);
  const value = valueOf(qty, m.unitCost);
  await c.query(
    `INSERT INTO stock_movements (ingredient_id, kind, qty, unit_cost, value, ref_type, ref_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [m.ingredientId, m.kind, qty, m.unitCost, value, m.refType ?? null, m.refId ?? null, m.reason ?? null, m.userId]);
  await c.query(`UPDATE ingredients SET on_hand = on_hand + $2 WHERE id = $1`, [m.ingredientId, qty]);
  return value;
}

interface RecipeRow { ingredient_id: string; qty: number; yield_pct: number; avg_cost: number }

/** Stock drawn for one serving: the usable amount grossed up by yield (40 g peeled shrimp at 60% = 66.67 g bought). */
export const drawn = (r: { qty: number; yield_pct: number }) => q4((r.qty * 100) / r.yield_pct);

interface BookIngredient { id: string; name: string; yield_pct: number; avg_cost: number; is_prep: boolean; batch_yield: number | null }

/** Every ingredient and prep recipe of the shop, for expanding sub-recipes in memory. */
export interface PrepBook { ings: Map<string, BookIngredient>; preps: Map<string, Array<{ ingredient_id: string; qty: number }>> }

export async function prepBook(c: Tx): Promise<PrepBook> {
  const ings = await many<BookIngredient>(c, `SELECT id, name, yield_pct, avg_cost, is_prep, batch_yield FROM ingredients`);
  const lines = await many(c, `SELECT prep_id, ingredient_id, qty FROM prep_lines`);
  const preps = new Map<string, Array<{ ingredient_id: string; qty: number }>>();
  for (const l of lines) preps.set(l.prep_id, [...(preps.get(l.prep_id) ?? []), { ingredient_id: l.ingredient_id, qty: l.qty }]);
  return { ings: new Map(ings.map((i) => [i.id, i])), preps };
}

const MAX_DEPTH = 5;

/**
 * Replace prep items (sub-recipes) by the purchased ingredients they are made of, so stock and cost
 * only ever move on real goods. `qty` is usable base units; a prep's own yield grosses it up first,
 * then each component gets its share of one batch. Same ingredients are merged into one line.
 */
export function explode(lines: Array<{ ingredient_id: string; qty: number }>, book: PrepBook, depth = 0): RecipeRow[] {
  if (depth > MAX_DEPTH) throw new Error('sub-recipes nested too deep');
  const out = new Map<string, RecipeRow>();
  const add = (r: RecipeRow) => {
    const cur = out.get(r.ingredient_id);
    out.set(r.ingredient_id, cur ? { ...cur, qty: q4(cur.qty + r.qty) } : r);
  };
  for (const l of lines) {
    const ing = book.ings.get(l.ingredient_id);
    if (!ing) continue;
    if (!ing.is_prep) {
      add({ ingredient_id: ing.id, qty: l.qty, yield_pct: ing.yield_pct, avg_cost: ing.avg_cost });
      continue;
    }
    const made = drawn({ qty: l.qty, yield_pct: ing.yield_pct });
    const comps = (book.preps.get(ing.id) ?? []).map((p) => ({ ingredient_id: p.ingredient_id, qty: q4((made * p.qty) / ing.batch_yield!) }));
    for (const r of explode(comps, book, depth + 1)) add(r);
  }
  return [...out.values()];
}

/** Cost of one base unit of a prep item (micro-satang), from its batch recipe at today's average costs. */
export function prepUnitCost(id: string, book: PrepBook, depth = 0): number {
  const ing = book.ings.get(id);
  if (!ing) return 0;
  if (!ing.is_prep) return ing.avg_cost;
  if (depth > MAX_DEPTH) throw new Error('sub-recipes nested too deep');
  const batch = (book.preps.get(id) ?? []).reduce((s, p) => {
    const comp = book.ings.get(p.ingredient_id);
    return comp ? s + ((p.qty * 100) / comp.yield_pct) * prepUnitCost(p.ingredient_id, book, depth + 1) : s;
  }, 0);
  return Math.round(batch / ing.batch_yield!);
}

/** True when `candidate` already uses `prepId` somewhere below it — adding it would make a loop. */
export function usesPrep(candidate: string, prepId: string, book: PrepBook, depth = 0): boolean {
  if (candidate === prepId) return true;
  if (depth > MAX_DEPTH) return true;
  return (book.preps.get(candidate) ?? []).some((p) => usesPrep(p.ingredient_id, prepId, book, depth + 1));
}

async function recipeOf(c: Tx, menuItemId: string): Promise<RecipeRow[]> {
  const lines = await many<{ ingredient_id: string; qty: number }>(c,
    `SELECT ingredient_id, qty FROM recipe_lines WHERE menu_item_id = $1`, [menuItemId]);
  return lines.length ? explode(lines, await prepBook(c)) : [];
}

/**
 * Take ingredients out of stock at today's average cost and return what they cost.
 * Prep items are expanded first; the purchased ingredients are locked so concurrent sales
 * book costs one after the other.
 */
export async function drawLines(c: Tx, rows: RecipeRow[], a: {
  servings: number; kind: 'sale' | 'waste'; refType?: string; refId?: string | null; reason?: string; userId: string | null;
}): Promise<number> {
  if (rows.length === 0) return 0;
  const locked = await many<{ id: string; avg_cost: number }>(c,
    `SELECT id, avg_cost FROM ingredients WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [rows.map((r) => r.ingredient_id)]);
  const avg = new Map(locked.map((l) => [l.id, l.avg_cost]));
  let cost = 0;
  for (const r of rows) {
    cost += -(await move(c, {
      ingredientId: r.ingredient_id, kind: a.kind, qty: -drawn(r) * a.servings, unitCost: avg.get(r.ingredient_id) ?? r.avg_cost,
      refType: a.refType, refId: a.refId, reason: a.reason, userId: a.userId,
    }));
  }
  return cost;
}

/**
 * Take `servings` of a dish out of stock at today's average cost and return what it cost.
 * Used when a bill is paid (sale) and when a dish already cooked is voided (waste).
 */
export async function drawRecipe(c: Tx, a: {
  menuItemId: string; servings: number; kind: 'sale' | 'waste'; refType: string; refId: string;
  reason?: string; userId: string | null;
}): Promise<number> {
  return drawLines(c, await recipeOf(c, a.menuItemId), a);
}

/** Cost of one serving at current average costs, rounded exactly as a sale would book it. */
export const servingCostOf = (rows: Array<{ qty: number; yield_pct: number; avg_cost: number }>) =>
  rows.reduce((s, r) => s + valueOf(drawn(r), r.avg_cost), 0);

export async function servingCost(c: Tx, menuItemId: string): Promise<number> {
  return servingCostOf(await recipeOf(c, menuItemId));
}
