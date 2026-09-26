import {
  calcBill, docPeriod, formatDocNo, isValidThaiTaxId, roundCash, vatRateOn,
  type BillResult, type CashRounding, type Discount,
} from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError, type Session } from '../auth.ts';
import { audit, many, one, withTenant, type Tx } from '../db.ts';

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
  const lines = await many(c, `SELECT * FROM order_lines WHERE order_id = $1 ORDER BY created_at, id`, [id]);
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
        ? await one(c, `SELECT branch_id AS id FROM dining_tables WHERE id = $1`, [b.tableId])
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
      const doc = await one(c, `SELECT id, doc_type, doc_no FROM tax_documents WHERE order_id = $1 AND status = 'issued' ORDER BY issued_at DESC LIMIT 1`, [id]);
      return { order: { ...p.order, table_name: table?.name ?? null }, lines: p.lines, bill: p.bill, vatRate: p.rate.rate, document: doc ?? null };
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
      const same = await one(c,
        `SELECT id FROM order_lines WHERE order_id = $1 AND menu_item_id = $2 AND status = 'new'
            AND coalesce(note, '') = $3 AND unit_price = $4`, [id, item.id, b.note ?? '', item.price]);
      reply.status(201);
      if (same) return one(c, `UPDATE order_lines SET qty = qty + $2 WHERE id = $1 RETURNING *`, [same.id, b.qty]);
      return one(c,
        `INSERT INTO order_lines (order_id, menu_item_id, name, unit_price, qty, vat_exempt, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, item.id, item.name, item.price, b.qty, item.vat_exempt, b.note || null]);
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
      await audit(c, req.session.userId, 'line.void', 'order_line', lineId, { orderId: id, name: l.name, qty: l.qty, reason });
      return { voided: true };
    });
  });

  app.post('/api/orders/:id/send', { preHandler: ctx.auth(atLeast('waiter')) }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, async (c) => {
      const { order } = await loadOrder(c, id, true);
      requireOpen(order);
      const sent = await many(c, `UPDATE order_lines SET status = 'sent' WHERE order_id = $1 AND status = 'new' RETURNING id, name, qty, note`, [id]);
      return { sent };
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
        await c.query(`UPDATE order_lines SET status = 'sent' WHERE order_id = $1 AND status = 'new'`, [id]);
      }

      const t = p.tenant;
      const term = await one(c, `SELECT * FROM terminals WHERE id = $1 FOR UPDATE`, [b.terminalId]);
      if (!term) throw new HttpError(404, 'terminal_not_found');
      const branch = await one(c, `SELECT * FROM branches WHERE id = $1`, [term.branch_id]);

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
        lines: p.live.map((l, i) => ({ name: l.name, qty: l.qty, unitPrice: l.unit_price, vatExempt: l.vat_exempt, ...p.bill.lines[i]! })),
      });

      for (const x of pays) {
        await c.query(`INSERT INTO payments (order_id, method, amount, tendered, ref) VALUES ($1, $2, $3, $4, $5)`,
          [id, x.method, x.amount, x.tendered ?? null, x.ref ?? null]);
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
      const pays = d.order_id ? await many(c, `SELECT method, amount, tendered FROM payments WHERE order_id = $1`, [d.order_id]) : [];
      return { ...d, payments: pays };
    });
  });

  app.post('/api/documents/:id/void', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const { reason } = Reason.parse(req.body);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      if (d.status !== 'issued') throw new HttpError(409, 'already_void');
      if (bangkokDate(d.issued_at) !== bangkokDate()) {
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

  // Customer asks for a full tax invoice after getting an abbreviated one: cancel the ABB and reissue (design doc §2.3).
  app.post('/api/documents/:id/full', { preHandler: ctx.auth(atLeast('cashier')) }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const buyer = Buyer.parse((req.body as { buyer?: unknown } | undefined)?.buyer);
    return tx(req.session, async (c) => {
      const d = await one(c, `SELECT * FROM tax_documents WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new HttpError(404, 'not_found');
      if (d.doc_type !== 'ABB' || d.status !== 'issued') throw new HttpError(409, 'not_convertible');
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

const PREFIX: Record<string, (terminalCode: string) => string> = {
  ABB: (code) => code, FULL: () => 'INV', RECEIPT: () => 'RC', CN: () => 'CN',
};

interface IssueArgs {
  session: Session; tenant: TenantRow; terminal: any; branch: any; orderId: string | null;
  docType: 'ABB' | 'FULL' | 'RECEIPT' | 'CN'; bill: BillResult; rate: number; rounding: number;
  lines: unknown[]; buyer?: z.infer<typeof Buyer>; replaces?: string; grandTotalAlreadyCounted?: boolean;
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
        buyer_name, buyer_tax_id, buyer_branch, buyer_address, replaces_doc_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [a.terminal.branch_id, a.terminal.id, a.orderId, a.docType, docNo, vatRate, a.bill.gross, a.bill.discount,
     a.bill.vatableBase, a.bill.exemptBase, a.bill.serviceCharge, a.bill.vat, a.bill.total, a.rounding,
     JSON.stringify(a.lines), JSON.stringify(seller), a.buyer?.name ?? null, a.buyer?.taxId ?? null,
     a.buyer?.branch ?? null, a.buyer?.address ?? null, a.replaces ?? null, a.session.userId]);
  if (!a.grandTotalAlreadyCounted) {
    await c.query(`UPDATE terminals SET grand_total = grand_total + $2 WHERE id = $1`, [a.terminal.id, a.bill.total]);
  }
  return doc;
}
