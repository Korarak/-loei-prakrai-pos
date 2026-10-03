import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError, type Session } from '../auth.ts';
import { audit, many, one, withTenant, type Tx } from '../db.ts';
import { bangkokDate } from './orders.ts';

const Id = z.object({ id: z.string().uuid() });
const OpenShift = z.object({ terminalId: z.string().uuid(), openingFloat: z.number().int().min(0).max(10_000_000) });
const CashMove = z.object({ kind: z.enum(['in', 'out']), amount: z.number().int().positive().max(10_000_000), reason: z.string().trim().min(2).max(200) });
const CloseShift = z.object({ countedCash: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(300).optional() });
const Current = z.object({ terminalId: z.string().uuid() });
const Day = z.object({ date: z.string().date().optional() });

/** The open shift on a till, locked for the caller's transaction. */
export async function openShiftOf(c: Tx, terminalId: string) {
  return one(c, `SELECT * FROM shifts WHERE terminal_id = $1 AND status = 'open' FOR UPDATE`, [terminalId]);
}

/**
 * X-report for a shift: what the drawer should hold now.
 * Bills voided later are left out, like the daily report; their cash went back to the customer.
 */
export async function shiftSummary(c: Tx, shiftId: string) {
  const s = await one(c,
    `SELECT s.*, t.code AS terminal_code, t.name AS terminal_name, uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM shifts s JOIN terminals t ON t.id = s.terminal_id
       LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
      WHERE s.id = $1`, [shiftId]);
  if (!s) throw new HttpError(404, 'not_found');
  const methods = await many(c,
    `SELECT p.method, sum(p.amount)::bigint AS amount, count(*)::int AS n
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.shift_id = $1 AND o.status = 'paid' GROUP BY 1 ORDER BY 1`, [shiftId]);
  const bills = await one(c,
    `SELECT count(DISTINCT p.order_id)::int AS n FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.shift_id = $1 AND o.status = 'paid'`, [shiftId]);
  const moves = await many(c,
    `SELECT m.id, m.kind, m.amount, m.reason, m.created_at, u.name AS by_name
       FROM cash_moves m LEFT JOIN users u ON u.id = m.created_by WHERE m.shift_id = $1 ORDER BY m.created_at`, [shiftId]);
  const cashSales = methods.find((m) => m.method === 'cash')?.amount ?? 0;
  const cashIn = moves.filter((m) => m.kind === 'in').reduce((t, m) => t + m.amount, 0);
  const cashOut = moves.filter((m) => m.kind === 'out').reduce((t, m) => t + m.amount, 0);
  const expected = s.status === 'closed' ? s.expected_cash : s.opening_float + cashSales + cashIn - cashOut;
  return {
    shift: s, methods, bills: bills.n, moves,
    sales: methods.reduce((t, m) => t + m.amount, 0),
    cashSales, cashIn, cashOut, expectedCash: expected,
    difference: s.status === 'closed' ? s.counted_cash - s.expected_cash : null,
  };
}

export async function shiftRoutes(app: FastifyInstance, ctx: Ctx) {
  const cashier = ctx.auth(atLeast('cashier'));
  const tx = <T>(s: Session, fn: (c: Tx) => Promise<T>) => withTenant(ctx.db, s.tenantId, fn);

  app.get('/api/shifts/current', { preHandler: cashier }, async (req) => {
    const { terminalId } = Current.parse(req.query);
    return tx(req.session, async (c) => {
      const s = await one(c, `SELECT id FROM shifts WHERE terminal_id = $1 AND status = 'open'`, [terminalId]);
      return s ? shiftSummary(c, s.id) : null;
    });
  });

  app.post('/api/shifts', { preHandler: cashier }, async (req, reply) => {
    const b = OpenShift.parse(req.body);
    return tx(req.session, async (c) => {
      const term = await one(c, `SELECT id FROM terminals WHERE id = $1 FOR UPDATE`, [b.terminalId]);
      if (!term) throw new HttpError(404, 'terminal_not_found');
      if (await openShiftOf(c, b.terminalId)) throw new HttpError(409, 'shift_open', 'this till already has an open shift');
      const s = await one(c, `INSERT INTO shifts (terminal_id, opening_float, opened_by) VALUES ($1, $2, $3) RETURNING id`,
        [b.terminalId, b.openingFloat, req.session.userId]);
      await audit(c, req.session.userId, 'shift.open', 'shift', s.id, { terminalId: b.terminalId, openingFloat: b.openingFloat });
      reply.status(201);
      return shiftSummary(c, s.id);
    });
  });

  app.get('/api/shifts/:id', { preHandler: cashier }, async (req) => {
    const { id } = Id.parse(req.params);
    return tx(req.session, (c) => shiftSummary(c, id));
  });

  // นำเงินเข้า–ออกระหว่างกะ: change top-ups, paying a supplier from the drawer.
  app.post('/api/shifts/:id/cash', { preHandler: cashier }, async (req, reply) => {
    const { id } = Id.parse(req.params);
    const b = CashMove.parse(req.body);
    return tx(req.session, async (c) => {
      const s = await one(c, `SELECT * FROM shifts WHERE id = $1 FOR UPDATE`, [id]);
      if (!s) throw new HttpError(404, 'not_found');
      if (s.status !== 'open') throw new HttpError(409, 'shift_closed');
      const m = await one(c, `INSERT INTO cash_moves (shift_id, kind, amount, reason, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, b.kind, b.amount, b.reason, req.session.userId]);
      await audit(c, req.session.userId, `shift.cash_${b.kind}`, 'shift', id, b);
      reply.status(201);
      return m;
    });
  });

  // ปิดกะ: freeze what the drawer should hold against what was counted (Z-report of the shift).
  app.post('/api/shifts/:id/close', { preHandler: cashier }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = CloseShift.parse(req.body);
    return tx(req.session, async (c) => {
      const s = await one(c, `SELECT * FROM shifts WHERE id = $1 FOR UPDATE`, [id]);
      if (!s) throw new HttpError(404, 'not_found');
      if (s.status !== 'open') throw new HttpError(409, 'shift_closed');
      const open = await one(c, `SELECT count(*)::int AS n FROM orders WHERE status = 'open'`);
      const { expectedCash } = await shiftSummary(c, id);
      await c.query(
        `UPDATE shifts SET status = 'closed', expected_cash = $2, counted_cash = $3, close_note = $4, closed_by = $5, closed_at = now() WHERE id = $1`,
        [id, expectedCash, b.countedCash, b.note || null, req.session.userId]);
      await audit(c, req.session.userId, 'shift.close', 'shift', id,
        { expectedCash, countedCash: b.countedCash, difference: b.countedCash - expectedCash, openOrders: open.n });
      return { ...(await shiftSummary(c, id)), openOrders: open.n };
    });
  });

  // กะทั้งหมดของวัน สำหรับหลังบ้าน
  app.get('/api/shifts', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const date = Day.parse(req.query).date ?? bangkokDate();
    return tx(req.session, async (c) => {
      const rows = await many(c,
        `SELECT s.id FROM shifts s WHERE (s.opened_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date
            OR s.status = 'open' ORDER BY s.opened_at`, [date]);
      const out = [];
      for (const r of rows) out.push(await shiftSummary(c, r.id));
      return out;
    });
  });
}
