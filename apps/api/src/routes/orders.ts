import {
  applyRate, calcBill, docPeriod, extractBase, formatDocNo, isValidThaiTaxId, roundCash, vatRateOn,
  type BillResult, type CashRounding, type Discount,
} from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError, type Session } from '../auth.ts';
import { audit, many, one, withTenant, type Tx } from '../db.ts';
import { drawRecipe } from '../stock.ts';
import { openShiftOf } from './shifts.ts';

const Id = z.object({ id: z.string().uuid() });
const LineId = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });

const NewOrder = z.object({
  tableId: z.string().uuid().nullable().default(null),
  channel: z.enum(['dine_in', 'takeaway', 'delivery']).default('dine_in'),
  guests: z.number().int().min(1).max(100).default(1),
});
const AddLine = z.object({
  menuItemId: z.string().uuid(),
  qty: z.number().int().min(1).max(999).default(1),
  note: z.string().trim().max(200).optional(),
  /** Chosen modifier ids (ระดับเผ็ด, ท็อปปิ้ง …) from the groups attached to this dish. */
  options: z.array(z.string().uuid()).max(30).default([]),
});
const SetQty = z.object({ qty: z.number().int().min(1).max(999) });
const Reason = z.object({ reason: z.string().trim().min(3).max(300) });
const SetDiscount = z.object({
  type: z.enum(['none', 'percent', 'amount']),
  value: z.number().int().min(0).default(0),
});
const Buyer = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().refine(isValidThaiTaxId, 'invalid Thai tax ID').transform((v) => v.replace(/[\s-]/g, '')),
  branch: z.string().trim().regex(/^\d{5}$/).default('00000'),
  address: z.string().trim().min(5).max(500),
});
const CreditNote = z.object({
  reason: z.string().trim().min(3).max(300),
  refund: z.enum(['cash', 'transfer', 'none']).default('cash'),
  /** Lines of the original document to credit (index into its lines); absent = everything not yet credited. */
  lines: z.array(z.object({ index: z.number().int().min(0), qty: z.number().int().positive() })).min(1).max(200).optional(),
});
const MoveTable = z.object({ tableId: z.string().uuid() });
const Merge = z.object({ fromOrderId: z.string().uuid() });
const Split = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().int().positive() })).min(1).max(100) });
const DocList = z.object({ date: z.string().date().optional(), q: z.string().trim().max(40).optional() });
const Pay = z.object({
  terminalId: z.string().uuid(),
  docType: z.enum(['ABB', 'FULL', 'RECEIPT']),
  buyer: Buyer.optional(),
  payments: z.array(z.object({
    method: z.enum(['cash', 'promptpay', 'card', 'transfer']),
    amount: z.number().int().positive().optional(),
    tendered: z.number().int().positive().optional(),
    ref: z.string().trim().max(100).optional(),
  })).min(1).max(5),
});

/** Business date in Thailand — tax periods and VAT rates follow Bangkok time, not the server's. */
export function bangkokDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
}

interface TenantRow {
  name: string; legal_name: string | null; tax_id: string | null; address: string | null;
  vat_registered: boolean; price_includes_vat: boolean; service_charge_bp: number; cash_rounding: CashRounding;
}

async function tenantOf(c: Tx, s: Session): Promise<TenantRow> {
  return (await one<TenantRow>(c, `SELECT * FROM tenants WHERE id = $1`, [s.tenantId]))!;
}

async function currentRate(c: Tx, day: string) {
  const rows = await many(c, `SELECT rate_bp, valid_from::text, valid_to::text, legal_ref FROM tax_rates`);
  return vatRateOn(day, rows.map((r) => ({ rate: r.rate_bp, from: r.valid_from, to: r.valid_to, legalRef: r.legal_ref })));
}

async function loadOrder(c: Tx, id: string, lock = false) {
  const o = await one(c, `SELECT * FROM orders WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!o) throw new HttpError(404, 'not_found');
  const lines = await many(c,
    `SELECT l.*, m.station FROM order_lines l LEFT JOIN menu_items m ON m.id = l.menu_item_id
      WHERE l.order_id = $1 ORDER BY l.created_at, l.id`, [id]);
  return { order: o, lines };
}

function discountOf(o: { discount_type: string; discount_value: number }): Discount {
  if (o.discount_type === 'percent') return { type: 'percent', value: o.discount_value };
  if (o.discount_type === 'amount') return { type: 'amount', value: o.discount_value };
  return { type: 'none' };
}

async function priced(c: Tx, s: Session, id: string, lock = false) {
  const { order, lines } = await loadOrder(c, id, lock);
  const t = await tenantOf(c, s);
  const rate = await currentRate(c, bangkokDate());
  const live = lines.filter((l) => l.status !== 'void');
  const bill: BillResult = calcBill(
    live.map((l) => ({ unitPrice: l.unit_price, qty: l.qty, vatExempt: l.vat_exempt })),
    discountOf(order),
    { vatRegistered: t.vat_registered, priceIncludesVat: t.price_includes_vat, vatRate: rate.rate, serviceChargeRate: t.service_charge_bp },
  );
  return { order, lines, live, bill, tenant: t, rate };
}

interface Option { id: string; name: string; price: number }

/** "ผัดกะเพรา (เผ็ดมาก, ไข่ดาว)" — what a tax document or ticket shows for a dish with options. */
export const withOptions = (name: string, options: Option[] | null | undefined) =>
  options?.length ? `${name} (${options.map((o) => o.name).join(', ')})` : name;

/** Check the choices against the groups attached to the dish and price them; throws a 400/404 on a bad pick. */
async function resolveOptions(c: Tx, itemId: string, ids: string[]): Promise<Option[]> {
  const uniq = [...new Set(ids)];
  const groups = await many(c,
    `SELECT g.id, g.name, g.min_select, g.max_select FROM menu_item_modifier_groups mg JOIN modifier_groups g ON g.id = mg.group_id
      WHERE mg.menu_item_id = $1 AND g.active`, [itemId]);
  const mods = uniq.length ? await many(c,
    `SELECT id, group_id, name, price FROM modifiers WHERE id = ANY($1::uuid[]) AND active`, [uniq]) : [];
  if (mods.length !== uniq.length || mods.some((m) => !groups.some((g) => g.id === m.group_id))) throw new HttpError(400, 'bad_option');
  for (const g of groups) {
    const n = mods.filter((m) => m.group_id === g.id).length;
    if (n < g.min_select) throw new HttpError(400, 'option_required', g.name);
    if (n > g.max_select) throw new HttpError(400, 'option_too_many', g.name);
  }
  // keep the order the owner arranged the groups and options in, so tickets read the same every time
  const order = new Map(ids.map((id, i) => [id, i]));
  return uniq.map((id) => mods.find((m) => m.id === id)!).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((m) => ({ id: m.id, name: m.name, price: m.price }));
}

function requireOpen(order: { status: string }) {
  if (order.status !== 'open') throw new HttpError(409, 'order_closed');
}

export async function orderRoutes(app: FastifyInstance, ctx: Ctx) {
  const anyStaff = ctx.auth();
  const tx = <T>(s: Session, fn: (c: Tx) => Promise<T>) => withTenant(ctx.db, s.tenantId, fn);

  app.post('/api/orders', { preHandler: ctx.auth(atLeast('waiter')) }, async (req, reply) => {
    const b = NewOrder.parse(req.body ?? {});
    return tx(req.session, async (c) => {
      if (b.tableId) {
        const open = await one(c, `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`, [b.tableId]);
        if (open) throw new HttpError(409, 'table_busy', open.id);
      }
      const branch = b.tableId
        ? await one(c, `SELECT branch_id AS id FROM dining_tables WHERE id = $1 AND active`, [b.tableId])
        : await one(c, `SELECT id FROM branches ORDER BY name LIMIT 1`);
      if (!branch) throw new HttpError(404, 'table_not_found');
      reply.status(201);
      return one(c, `INSERT INTO orders (branch_id, table_id, channel, guests, opened_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [branch.id, b.tableId, b.channel, b.guests, req.session.userId]);
    });
  });

  app.get('/api/orders/:id', { preHandler: anyStaff }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const p = await priced(c, req.session, id);
      const table = p.order.table_id ? await one(c, `SELECT name FROM dining_tables WHERE id = $1`, [p.order.table_id]) : null;
      const doc = await one(c, `SELECT id, doc_type, doc_no FROM tax_documents WHERE order_id = $1 AND status = 'issued' AND doc_type <> 'CN' ORDER BY issued_at DESC LIMIT 1`, [id]);
      // A split bill is named after the table it came from; the table's bill lists the bills split off it.
      const parent = p.order.split_from ? await one(c,
        `SELECT o.id, o.bill_no, t.name AS table_name FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id WHERE o.id = $1`, [p.order.split_from]) : null;
      const splits = await many(c,
        `SELECT o.id, o.bill_no, o.status,
                coalesce((SELECT sum(l.unit_price * l.qty) FROM order_lines l WHERE l.order_id = o.id AND l.status <> 'void'), 0)::bigint AS amount
           FROM orders o WHERE o.split_from = $1 ORDER BY o.opened_at`, [id]);
      return {
        order: { ...p.order, table_name: table?.name ?? null }, lines: p.lines, bill: p.bill, vatRate: p.rate.rate, document: doc ?? null,
        parent: parent ?? null, splits,
        merged_into: p.order.merged_into ?? null,
      };
    });
  });

  app.post('/api/orders/:id/lines', { preHandler: ctx.auth(atLeast('waiter')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = AddLine.parse(req.body);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      const item = await one(c, `SELECT * FROM menu_items WHERE id = $1 AND active`, [b.menuItemId]);
      if (!item) throw new HttpError(404, 'menu_item_not_found');
      const options = await resolveOptions(c, item.id, b.options);
      const unitPrice = item.price + options.reduce((s, o) => s + o.price, 0);
      const same = await one(c,
        `SELECT id FROM order_lines WHERE order_id = $1 AND menu_item_id = $2 AND status = 'new'
            AND coalesce(note, '') = $3 AND unit_price = $4 AND options = $5::jsonb`,
        [id, item.id, b.note ?? '', unitPrice, JSON.stringify(options)]);
      reply.status(201);
      if (same) return one(c, `UPDATE order_lines SET qty = qty + $2 WHERE id = $1 RETURNING *`, [same.id, b.qty]);
      return one(c,
        `INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty, vat_exempt, note, options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, item.id, item.name, unitPrice, b.qty, item.vat_exempt, b.note || null, JSON.stringify(options)]);
    });
  });

  app.patch('/api/orders/:id/lines/:lineId', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id, lineId } = LineId.parse(req.params);
    const { qty } = SetQty.parse(req.body);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      const l = await one(c, `UPDATE order_lines SET qty = $3 WHERE id = $1 AND order_id = $2 AND status = 'new' RETURNING *`, [lineId, id, qty]);
      if (!l) throw new HttpError(409, 'line_not_editable', 'only lines not yet sent to the kitchen can be changed');
      return l;
    });
  });

  // Unsent lines are simply removed; sent lines need a manager and a reason (food was made = waste).
  app.post('/api/orders/:id/lines/:lineId/void', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id, lineId } = LineId.parse(req.params);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      const l = await one(c, `SELECT * FROM order_lines WHERE id = $1 AND order_id = $2`, [lineId, id]);
      if (!l || l.status === 'void') throw new HttpError(404, 'not_found');
      if (l.status === 'new') {
        await c.query(`DELETE FROM order_lines WHERE id = $1`, [lineId]);
        return { removed: true };
      }
      if (!atLeast('manager').includes(req.session.role)) throw new HttpError(403, 'manager_required');
      const { reason } = Reason.parse(req.body);
      await c.query(`UPDATE order_lines SET status = 'void', void_reason = $2 WHERE id = $1`, [lineId, reason]);
      // The kitchen already cooked it, so its ingredients are booked as waste.
      const wasted = l.menu_item_id ? await drawRecipe(c, {
        menuItemId: l.menu_item_id, servings: l.qty, kind: 'waste', refType: 'order_line', refId: lineId,
        optionIds: l.options.map((o: Option) => o.id), reason: `ยกเลิก ${l.name}: ${reason}`, userId: req.session.userId,
      }) : 0;
      await audit(c, req.session.userId, 'line.void', 'order_line', lineId, { orderId: id, name: l.name, qty: l.qty, reason, wasted });
      return { voided: true };
    });
  });

  app.post('/api/orders/:id/send', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      // One timestamp per batch, so the ticket page can print exactly what went to the kitchen together.
      const sent = await many(c,
        `UPDATE order_lines SET status = 'sent', sent_at = now() WHERE order_id = $1 AND status = 'new' RETURNING id, name, qty, note, options, sent_at`, [id]);
      return { sent, sentAt: sent[0]?.sent_at ?? null };
    });
  });

  // ย้ายโต๊ะ: the whole bill moves to a free table.
  app.post('/api/orders/:id/move', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const { tableId } = MoveTable.parse(req.body);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      const t = await one(c, `SELECT id, branch_id, name FROM dining_tables WHERE id = $1 AND active`, [tableId]);
      if (!t) throw new HttpError(404, 'table_not_found');
      const busy = await one(c, `SELECT id FROM orders WHERE table_id = $1 AND status = 'open'`, [tableId]);
      if (busy) throw new HttpError(409, 'table_busy', busy.id);
      const from = order.table_id ? await one(c, `SELECT name FROM dining_tables WHERE id = $1`, [order.table_id]) : null;
      await c.query(`UPDATE orders SET table_id = $2, branch_id = $3, channel = 'dine_in', split_from = NULL WHERE id = $1`, [id, t.id, t.branch_id]);
      await audit(c, req.session.userId, 'order.move', 'order', id, { from: from?.name ?? null, to: t.name });
      return { ok: true };
    });
  });

  // รวมโต๊ะ: another open bill is folded into this one; it closes as void and points here.
  app.post('/api/orders/:id/merge', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const { fromOrderId } = Merge.parse(req.body);
    if (fromOrderId === id) throw new HttpError(400, 'same_order');
    return tx(req.session, async (c) => {
      // lock both in a fixed order so two merges the other way round cannot deadlock
      for (const x of [id, fromOrderId].sort()) await loadOrder(c, x, true);
      const { order } = await loadOrder(c, id);
      const { order: src } = await loadOrder(c, fromOrderId);
      requireOpen(order);
      requireOpen(src);
      const moved = await many(c, `UPDATE order_lines SET order_id = $2 WHERE order_id = $1 AND status <> 'void' RETURNING id`, [fromOrderId, id]);
      await c.query(`UPDATE orders SET guests = guests + $2 WHERE id = $1`, [id, src.guests]);
      await c.query(`UPDATE orders SET split_from = $2 WHERE split_from = $1`, [fromOrderId, id]);
      await c.query(`UPDATE orders SET status = 'void', merged_into = $2, closed_at = now() WHERE id = $1`, [fromOrderId, id]);
      await audit(c, req.session.userId, 'order.merge', 'order', id, { from: fromOrderId, fromBill: src.bill_no, lines: moved.length });
      return { ok: true, moved: moved.length };
    });
  });

  // แยกบิล: chosen lines (or part of a line's quantity) move to a new bill that is paid on its own.
  app.post('/api/orders/:id/split', { preHandler: ctx.auth(atLeast('waiter')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = Split.parse(req.body);
    return tx(req.session, async (c) => {
      const { order, lines } = await loadOrder(c, id, true);
      requireOpen(order);
      const live = lines.filter((l) => l.status !== 'void');
      const want = new Map<string, number>();
      for (const x of b.lines) want.set(x.lineId, (want.get(x.lineId) ?? 0) + x.qty);
      for (const [lineId, qty] of want) {
        const l = live.find((y) => y.id === lineId);
        if (!l) throw new HttpError(404, 'line_not_found');
        if (qty > l.qty) throw new HttpError(400, 'qty_over', `${l.name}: ${qty} > ${l.qty}`);
      }
      const left = live.reduce((s, l) => s + l.qty - (want.get(l.id) ?? 0), 0);
      if (left === 0) throw new HttpError(409, 'split_all', 'leave at least one item on the original bill');
      const child = await one(c,
        `INSERT INTO orders (branch_id, table_id, channel, guests, opened_by, split_from) VALUES ($1, NULL, $2, 1, $3, $4) RETURNING *`,
        [order.branch_id, order.channel, req.session.userId, id]);
      for (const [lineId, qty] of want) {
        const l = live.find((y) => y.id === lineId)!;
        if (qty === l.qty) {
          await c.query(`UPDATE order_lines SET order_id = $2 WHERE id = $1`, [lineId, child.id]);
        } else {
          await c.query(`UPDATE order_lines SET qty = qty - $2 WHERE id = $1`, [lineId, qty]);
          await c.query(
            `INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty, vat_exempt, note, options, status, sent_at, created_at)
             SELECT $2, menu_item_id, name, unit_price, $3, vat_exempt, note, options, status, sent_at, created_at FROM order_lines WHERE id = $1`,
            [lineId, child.id, qty]);
        }
      }
      await audit(c, req.session.userId, 'order.split', 'order', id, { to: child.id, toBill: child.bill_no, lines: b.lines });
      reply.status(201);
      return child;
    });
  });

  app.put('/api/orders/:id/discount', { preHandler: ctx.auth(atLeast('cashier')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const d = SetDiscount.parse(req.body);
    if (d.type === 'percent' && d.value > 10_000) throw new HttpError(400, 'percent_over_100');
    return tx(req.session, async (c) => {
      const p = await priced(c, req.session, id, true);
      requireOpen(p.order);
      const pctBp = d.type === 'percent' ? d.value : d.type === 'amount' && p.bill.gross > 0 ? Math.round((d.value / p.bill.gross) * 10_000) : 0;
      if (pctBp > 1000 && !atLeast('manager').includes(req.session.role)) throw new HttpError(403, 'manager_required', 'discounts over 10% need a manager');
      await c.query(`UPDATE orders SET discount_type = $2, discount_value = $3 WHERE id = $1`, [id, d.type, d.value]);
      await audit(c, req.session.userId, 'order.discount', 'order', id, d);
      return (await priced(c, req.session, id)).bill;
    });
  });

  app.post('/api/orders/:id/pay', { preHandler: ctx.auth(atLeast('cashier')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = Pay.parse(req.body);
    return tx(req.session, async (c) => {
      const p = await priced(c, req.session, id, true);
      requireOpen(p.order);
      if (p.live.length === 0) throw new HttpError(409, 'empty_order');
      if (p.live.some((l) => l.status === 'new')) {
        // Unsent lines are billed too; mark them sent so the kitchen log stays consistent.
        await c.query(`UPDATE order_lines SET status = 'sent', sent_at = now() WHERE order_id = $1 AND status = 'new'`, [id]);
      }

      const t = p.tenant;
      const term = await one(c, `SELECT * FROM terminals WHERE id = $1 FOR UPDATE`, [b.terminalId]);
      if (!term) throw new HttpError(404, 'terminal_not_found');
      const branch = await one(c, `SELECT * FROM branches WHERE id = $1`, [term.branch_id]);
      // Money goes into a drawer someone opened and will count (design doc §5, module 7).
      const shift = await openShiftOf(c, term.id);
      if (!shift) throw new HttpError(409, 'shift_required', 'open a shift on this till before taking payment');

      // Which document may this shop issue? (design doc §2.3)
      if (!t.vat_registered && b.docType !== 'RECEIPT') throw new HttpError(409, 'not_vat_registered', 'shops not registered for VAT issue receipts only');
      if (t.vat_registered && b.docType === 'RECEIPT') throw new HttpError(409, 'tax_invoice_required', 'VAT-registered shops must issue a tax invoice');
      if (t.vat_registered && (!t.tax_id || !t.legal_name)) throw new HttpError(409, 'seller_tax_info_missing');
      if (b.docType === 'ABB' && !term.rd_pos_id) throw new HttpError(409, 'pos_not_approved', 'abbreviated tax invoices need a Revenue Department POS ID');
      if (b.docType === 'FULL' && !b.buyer) throw new HttpError(400, 'buyer_required');

      // Cash rounding only when the whole bill is paid in cash.
      const allCash = b.payments.every((x) => x.method === 'cash');
      const { payable, adjustment } = allCash ? roundCash(p.bill.total, t.cash_rounding) : { payable: p.bill.total, adjustment: 0 };

      const pays = b.payments.map((x) => ({ ...x }));
      if (pays.length === 1 && pays[0]!.amount === undefined) pays[0]!.amount = payable;
      if (pays.some((x) => x.amount === undefined)) throw new HttpError(400, 'amount_required');
      const paid = pays.reduce((s, x) => s + x.amount!, 0);
      if (paid !== payable) throw new HttpError(409, 'amount_mismatch', `payments ${paid} ≠ payable ${payable}`);
      for (const x of pays) {
        if (x.tendered !== undefined && (x.method !== 'cash' || x.tendered < x.amount!)) throw new HttpError(400, 'bad_tendered');
      }
      const change = pays.reduce((s, x) => s + (x.tendered ? x.tendered - x.amount! : 0), 0);

      const doc = await issueDocument(c, {
        session: req.session, tenant: t, terminal: term, branch, orderId: id,
        docType: b.docType, bill: p.bill, rate: p.rate.rate, rounding: adjustment, buyer: b.buyer,
        lines: p.live.map((l, i) => ({ name: withOptions(l.name, l.options), qty: l.qty, unitPrice: l.unit_price, vatExempt: l.vat_exempt, ...p.bill.lines[i]! })),
      });

      // Freeze each line's pre-VAT revenue and recipe cost, and take the ingredients out of stock.
      for (const [i, l] of p.live.entries()) {
        const cost = l.menu_item_id ? await drawRecipe(c, {
          menuItemId: l.menu_item_id, servings: l.qty, kind: 'sale', refType: 'order', refId: id,
          optionIds: l.options.map((o: Option) => o.id), userId: req.session.userId,
        }) : 0;
        await c.query(`UPDATE order_lines SET net_ex_vat = $2, cost_snapshot = $3 WHERE id = $1`, [l.id, p.bill.lines[i]!.netExVat, cost]);
      }

      for (const x of pays) {
        await c.query(`INSERT INTO payments (order_id, method, amount, tendered, ref, shift_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, x.method, x.amount, x.tendered ?? null, x.ref ?? null, shift.id]);
      }
      await c.query(`UPDATE orders SET status = 'paid', closed_at = now() WHERE id = $1`, [id]);
      await audit(c, req.session.userId, 'order.pay', 'order', id, { docNo: doc.doc_no, total: doc.total, methods: pays.map((x) => x.method) });
      reply.status(201);
      return { document: doc, change };
    });
  });

  app.get('/api/documents/:id', { preHandler: anyStaff }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      // A credit note refunds rather than takes payment, so it shows the document it corrects instead.
      const pays = d.order_id && d.doc_type !== 'CN' ? await many(c, `SELECT method, amount, tendered FROM payments WHERE order_id = $1`, [d.order_id]) : [];
      let credits = null;
      if (d.credits_doc_id) {
        const o = await one(c, `SELECT id, doc_type, doc_no, issued_at, total FROM tax_documents WHERE id = $1`, [d.credits_doc_id]);
        // มูลค่าที่ถูกต้อง = original less every credit note up to and including this one
        const upTo = await one(c,
          `SELECT coalesce(sum(total), 0)::bigint AS n FROM tax_documents
            WHERE credits_doc_id = $1 AND status = 'issued'
              AND (issued_at, doc_no) <= (SELECT issued_at, doc_no FROM tax_documents WHERE id = $2)`, [d.credits_doc_id, d.id]);
        credits = { ...o, corrected_total: o.total - upTo.n };
      }
      const creditNotes = await many(c,
        `SELECT id, doc_no, issued_at, total FROM tax_documents WHERE credits_doc_id = $1 AND status = 'issued' ORDER BY issued_at`, [id]);
      const remaining = d.doc_type === 'CN' ? null : await remainingQtys(c, d);
      return { ...d, payments: pays, credits, credit_notes: creditNotes, remaining };
    });
  });

  app.post('/api/documents/:id/void', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const { reason } = Reason.parse(req.body);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      if (d.status !== 'issued') throw new HttpError(409, 'already_void');
      if (d.doc_type === 'CN') throw new HttpError(409, 'not_voidable');
      if (await one(c, `SELECT 1 FROM tax_documents WHERE credits_doc_id = $1 AND status = 'issued'`, [id])) throw new HttpError(409, 'already_credited');
      // Plain receipts are not tax invoices, so there is no credit note to issue for them.
      if (d.doc_type !== 'RECEIPT' && bangkokDate(d.issued_at) !== bangkokDate()) {
        throw new HttpError(409, 'use_credit_note', 'documents from a previous day are corrected with a credit note');
      }
      const out = await one(c, `UPDATE tax_documents SET status = 'void', void_reason = $2, voided_by = $3, voided_at = now() WHERE id = $1 RETURNING *`,
        [id, reason, req.session.userId]);
      if (d.order_id) await c.query(`UPDATE orders SET status = 'void' WHERE id = $1`, [d.order_id]);
      await c.query(`UPDATE terminals SET grand_total = grand_total - $2 WHERE id = $1`, [d.terminal_id, d.total]);
      await audit(c, req.session.userId, 'document.void', 'tax_document', id, { docNo: d.doc_no, total: d.total, reason });
      return out;
    });
  });

  // เอกสารของวัน (หรือค้นด้วยเลขที่) สำหรับหน้าหลังบ้าน: หาใบที่ต้องยกเลิกหรือออกใบลดหนี้
  app.get('/api/documents', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { date, q } = DocList.parse(req.query);
    const cols = `id, doc_type, doc_no, issued_at, total, vat, status, buyer_name, credits_doc_id`;
    return tx(req.session, (c) => q
      ? many(c, `SELECT ${cols} FROM tax_documents WHERE doc_no ILIKE '%' || $1 || '%' ORDER BY issued_at DESC LIMIT 50`, [q])
      : many(c, `SELECT ${cols} FROM tax_documents WHERE (issued_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date ORDER BY issued_at DESC`,
          [date ?? bangkokDate()]));
  });

  // ใบลดหนี้: corrects a tax invoice from an earlier day, for the whole bill or chosen lines (design doc §2.3).
  // Same-day mistakes are voided instead; the credit note is dated and reported in the month it is issued.
  app.post('/api/documents/:id/credit-note', { preHandler: ctx.auth(atLeast('manager')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = CreditNote.parse(req.body);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      if (d.status !== 'issued') throw new HttpError(409, 'already_void');
      if (d.doc_type !== 'ABB' && d.doc_type !== 'FULL') throw new HttpError(409, 'not_creditable', 'credit notes correct tax invoices only');
      const remaining = await remainingQtys(c, d);
      if (remaining.every((q) => q === 0)) throw new HttpError(409, 'already_credited');
      const want = b.lines ?? remaining.map((qty, index) => ({ index, qty })).filter((x) => x.qty > 0);
      const take = remaining.map(() => 0);
      for (const x of want) {
        if (x.index >= remaining.length) throw new HttpError(400, 'line_not_found');
        take[x.index]! += x.qty;
      }
      take.forEach((q, i) => { if (q > remaining[i]!) throw new HttpError(409, 'qty_over', `line ${i}: ${q} > ${remaining[i]}`); });
      const amounts = await creditAmounts(c, d, take, remaining);
      const orig = d.lines as Array<{ qty: number; unitPrice: number }>;
      const lines = take.flatMap((q, i) => (q > 0 ? [{ ...orig[i], qty: q, gross: orig[i]!.unitPrice * q, srcIndex: i }] : []));

      const term = await one(c, `SELECT * FROM terminals WHERE id = $1`, [d.terminal_id]);
      const branch = await one(c, `SELECT * FROM branches WHERE id = $1`, [d.branch_id]);
      // Cash handed back leaves the till's drawer, so it needs an open shift to be counted against.
      const shift = b.refund === 'cash' ? await openShiftOf(c, d.terminal_id) : null;
      if (b.refund === 'cash' && !shift) throw new HttpError(409, 'shift_required', 'open a shift on the original till to refund cash');
      const cn = await issueDocument(c, {
        session: req.session, tenant: await tenantOf(c, req.session), terminal: term, branch, orderId: d.order_id,
        docType: 'CN', rate: d.vat_rate_bp, rounding: amounts.rounding, lines, credits: id, reason: b.reason,
        buyer: d.buyer_name ? { name: d.buyer_name, taxId: d.buyer_tax_id, branch: d.buyer_branch, address: d.buyer_address } : undefined,
        bill: { ...amounts, lines: [] },
        grandTotalAlreadyCounted: true,
      });
      if (shift) {
        await c.query(`INSERT INTO cash_moves (shift_id, kind, amount, reason, ref_doc_id, created_by) VALUES ($1, 'out', $2, $3, $4, $5)`,
          [shift.id, amounts.total + amounts.rounding, `คืนเงินตามใบลดหนี้ ${cn.doc_no}`, cn.id, req.session.userId]);
      }
      await audit(c, req.session.userId, 'document.credit_note', 'tax_document', cn.id,
        { credits: d.doc_no, total: amounts.total, reason: b.reason, refund: b.refund, lines: want });
      reply.status(201);
      return cn;
    });
  });

  // Customer asks for a full tax invoice after getting an abbreviated one: cancel the ABB and reissue (design doc §2.3).
  app.post('/api/documents/:id/full', { preHandler: ctx.auth(atLeast('cashier')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const buyer = Buyer.parse((req.body as { buyer?: unknown } | undefined)?.buyer);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      if (d.doc_type !== 'ABB' || d.status !== 'issued') throw new HttpError(409, 'not_convertible');
      if (await one(c, `SELECT 1 FROM tax_documents WHERE credits_doc_id = $1 AND status = 'issued'`, [id])) throw new HttpError(409, 'already_credited');
      const reason = 'ออกใบกำกับภาษีเต็มรูปแทน';
      await c.query(`UPDATE tax_documents SET status = 'void', void_reason = $2, voided_by = $3, voided_at = now() WHERE id = $1`, [id, reason, req.session.userId]);
      const term = await one(c, `SELECT * FROM terminals WHERE id = $1`, [d.terminal_id]);
      const branch = await one(c, `SELECT * FROM branches WHERE id = $1`, [d.branch_id]);
      const doc = await issueDocument(c, {
        session: req.session, tenant: await tenantOf(c, req.session), terminal: term, branch, orderId: d.order_id,
        docType: 'FULL', rate: d.vat_rate_bp, rounding: d.rounding, buyer, lines: d.lines, replaces: id,
        bill: { gross: d.gross, discount: d.discount, vatableBase: d.vatable_base, exemptBase: d.exempt_base,
                serviceCharge: d.service_charge, vat: d.vat, total: d.total, lines: [] },
        grandTotalAlreadyCounted: true,
      });
      await audit(c, req.session.userId, 'document.convert_full', 'tax_document', doc.id, { from: d.doc_no, to: doc.doc_no });
      reply.status(201);
      return doc;
    });
  });
}

/** Quantity of each line of a tax invoice not yet credited by an issued credit note. */
async function remainingQtys(c: Tx, d: { id: string; lines: Array<{ qty: number }> }): Promise<number[]> {
  const left = d.lines.map((l) => l.qty);
  const cns = await many(c, `SELECT lines FROM tax_documents WHERE credits_doc_id = $1 AND status = 'issued'`, [d.id]);
  for (const cn of cns) {
    // credit notes from before partial crediting copied every line without srcIndex
    (cn.lines as Array<{ qty: number; srcIndex?: number }>).forEach((l, i) => { left[l.srcIndex ?? i]! -= l.qty; });
  }
  return left.map((q) => Math.max(q, 0));
}

const share = (amount: number, part: number, whole: number) => (whole === 0 ? 0 : Math.round((amount * part) / whole));

/**
 * Money on a credit note. The last credit note takes exactly what is left, so all credit notes of a
 * document add up to it to the satang. A partial one takes the VAT-inclusive value of the goods credited
 * pro rata (VAT-able and exempt goods apart, service charge over everything) and extracts VAT from it,
 * so crediting one 60-baht dish gives 60.00 = 56.07 + 3.93 VAT, never 60.01.
 */
async function creditAmounts(c: Tx, d: any, take: number[], remaining: number[]) {
  const final = take.every((q, i) => q === remaining[i]);
  if (final) {
    const prior = await one(c,
      `SELECT coalesce(sum(gross), 0)::bigint AS gross, coalesce(sum(discount), 0)::bigint AS discount,
              coalesce(sum(vatable_base), 0)::bigint AS vatable_base, coalesce(sum(exempt_base), 0)::bigint AS exempt_base,
              coalesce(sum(service_charge), 0)::bigint AS service_charge, coalesce(sum(vat), 0)::bigint AS vat,
              coalesce(sum(total), 0)::bigint AS total, coalesce(sum(rounding), 0)::bigint AS rounding
         FROM tax_documents WHERE credits_doc_id = $1 AND status = 'issued'`, [d.id]);
    return {
      gross: d.gross - prior.gross, discount: d.discount - prior.discount, vatableBase: d.vatable_base - prior.vatable_base,
      exemptBase: d.exempt_base - prior.exempt_base, serviceCharge: d.service_charge - prior.service_charge,
      vat: d.vat - prior.vat, total: d.total - prior.total, rounding: d.rounding - prior.rounding,
    };
  }
  const lines = d.lines as Array<{ qty: number; unitPrice: number; vatExempt?: boolean }>;
  const gross = (f: (l: (typeof lines)[number]) => boolean, q: (i: number) => number) =>
    lines.reduce((s, l, i) => s + (f(l) ? l.unitPrice * q(i) : 0), 0);
  const all = () => true, taxed = (l: { vatExempt?: boolean }) => !l.vatExempt, exempt = (l: { vatExempt?: boolean }) => !!l.vatExempt;
  const orig = (i: number) => lines[i]!.qty, part = (i: number) => take[i]!;
  const vatSc = d.vat > 0 ? applyRate(d.service_charge, d.vat_rate_bp) : 0;
  const withVat = share(d.vatable_base + d.vat - vatSc, gross(taxed, part), gross(taxed, orig))
    + share(d.service_charge + vatSc, gross(all, part), gross(all, orig));
  const base = d.vat > 0 ? extractBase(withVat, d.vat_rate_bp) : withVat;
  const serviceCharge = share(d.service_charge, gross(all, part), gross(all, orig));
  const exemptBase = share(d.exempt_base, gross(exempt, part), gross(exempt, orig));
  return {
    gross: gross(all, part), discount: share(d.discount, gross(all, part), gross(all, orig)),
    vatableBase: base - serviceCharge, exemptBase, serviceCharge, vat: withVat - base, total: withVat + exemptBase, rounding: 0,
  };
}

/**
 * Printed number prefix per document type. Sequences run per terminal, so from the second till on
 * the terminal code joins the prefix (RCP2-, INVP2-); otherwise two tills would print the same number.
 * P1 keeps the plain prefix so existing single-till numbering is unchanged.
 */
const withTill = (base: string) => (code: string) => (code === 'P1' ? base : `${base}${code}`);
const PREFIX: Record<string, (terminalCode: string) => string> = {
  ABB: (code) => code, FULL: withTill('INV'), RECEIPT: withTill('RC'), CN: withTill('CN'),
};

interface IssueArgs {
  session: Session; tenant: TenantRow; terminal: any; branch: any; orderId: string | null;
  docType: 'ABB' | 'FULL' | 'RECEIPT' | 'CN'; bill: BillResult; rate: number; rounding: number;
  lines: unknown[]; buyer?: z.infer<typeof Buyer>; replaces?: string; grandTotalAlreadyCounted?: boolean;
  /** Credit notes: the document corrected and why. */
  credits?: string; reason?: string;
}

/**
 * Take the next number and write the document in the caller's transaction.
 * The sequence row stays locked until commit, and a rollback returns the number,
 * so numbers are gapless and never duplicated per terminal, type and month.
 */
async function issueDocument(c: Tx, a: IssueArgs) {
  const day = bangkokDate();
  const period = docPeriod(day);
  const seq = await one<{ last_no: number }>(c,
    `INSERT INTO doc_sequences (terminal_id, doc_type, period, last_no) VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, terminal_id, doc_type, period) DO UPDATE SET last_no = doc_sequences.last_no + 1
     RETURNING last_no`, [a.terminal.id, a.docType, period]);
  const docNo = formatDocNo(PREFIX[a.docType]!(a.terminal.code), day, seq!.last_no, a.docType === 'ABB' ? 6 : 4);
  const seller = {
    name: a.tenant.legal_name ?? a.tenant.name, shopName: a.tenant.name, taxId: a.tenant.tax_id,
    address: a.branch?.address ?? a.tenant.address, branchCode: a.branch?.branch_code ?? '00000', rdPosId: a.terminal.rd_pos_id,
  };
  const vatRate = a.tenant.vat_registered ? a.rate : 0;
  const doc = await one(c,
    `INSERT INTO tax_documents (branch_id, terminal_id, order_id, doc_type, doc_no, vat_rate_bp, gross, discount,
        vatable_base, exempt_base, service_charge, vat, total, rounding, lines, seller,
        buyer_name, buyer_tax_id, buyer_branch, buyer_address, replaces_doc_id, created_by, credits_doc_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [a.terminal.branch_id, a.terminal.id, a.orderId, a.docType, docNo, vatRate, a.bill.gross, a.bill.discount,
     a.bill.vatableBase, a.bill.exemptBase, a.bill.serviceCharge, a.bill.vat, a.bill.total, a.rounding,
     JSON.stringify(a.lines), JSON.stringify(seller), a.buyer?.name ?? null, a.buyer?.taxId ?? null,
     a.buyer?.branch ?? null, a.buyer?.address ?? null, a.replaces ?? null, a.session.userId, a.credits ?? null, a.reason ?? null]);
  if (!a.grandTotalAlreadyCounted) {
    await c.query(`UPDATE terminals SET grand_total = grand_total + $2 WHERE id = $1`, [a.terminal.id, a.bill.total]);
  }
  return doc;
}
