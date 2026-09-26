import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast } from '../auth.ts';
import { many, one, withTenant } from '../db.ts';
import { bangkokDate } from './orders.ts';

const Month = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
const Day = z.object({ date: z.string().date().optional() });

/** Business day in Bangkok as a timestamp range the index can use. */
const DAY_OF = `(issued_at AT TIME ZONE 'Asia/Bangkok')::date`;

export async function reportRoutes(app: FastifyInstance, ctx: Ctx) {
  // รายงานภาษีขาย: ABB summarised per day and terminal, full invoices listed one by one (design doc §8).
  app.get('/api/reports/sales-tax', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { month } = Month.parse(req.query);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const rows = await many(c, `
        SELECT ${DAY_OF}::text AS day, t.code AS terminal, d.doc_type,
               CASE WHEN d.doc_type = 'ABB' THEN min(d.doc_no) || ' – ' || max(d.doc_no) ELSE min(d.doc_no) END AS doc_no,
               CASE WHEN d.doc_type = 'ABB' THEN count(*) || ' ใบ' ELSE min(d.buyer_name) || ' · ' || min(d.buyer_tax_id) || ' · ' || min(d.buyer_branch) END AS buyer,
               sum(d.vatable_base + d.exempt_base + d.service_charge)::bigint AS base,
               sum(d.vat)::bigint AS vat,
               sum(d.total)::bigint AS total
          FROM tax_documents d JOIN terminals t ON t.id = d.terminal_id
         WHERE d.status = 'issued' AND to_char(${DAY_OF}, 'YYYY-MM') = $1 AND d.doc_type IN ('ABB','FULL')
         GROUP BY 1, 2, 3, CASE WHEN d.doc_type = 'ABB' THEN NULL ELSE d.id END
         ORDER BY 1, 2, 3, 4`, [month]);
      const totals = rows.reduce((s, r) => ({ base: s.base + r.base, vat: s.vat + r.vat, total: s.total + r.total }), { base: 0, vat: 0, total: 0 });
      const voided = await one(c, `SELECT count(*)::int AS n FROM tax_documents WHERE status = 'void' AND to_char(${DAY_OF}, 'YYYY-MM') = $1`, [month]);
      return { month, rows, totals, voidedCount: voided.n };
    });
  });

  // สรุปการขายประจำวัน (Z-report) per terminal.
  app.get('/api/reports/daily', { preHandler: ctx.auth(atLeast('cashier')) }, async (req) => {
    const date = Day.parse(req.query).date ?? bangkokDate();
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const docs = await many(c, `
        SELECT t.code AS terminal, t.grand_total, d.doc_type, count(*) FILTER (WHERE d.status = 'issued')::int AS issued,
               count(*) FILTER (WHERE d.status = 'void')::int AS voided,
               min(d.doc_no) AS first_no, max(d.doc_no) AS last_no,
               coalesce(sum(d.total) FILTER (WHERE d.status = 'issued'), 0)::bigint AS total,
               coalesce(sum(d.vat) FILTER (WHERE d.status = 'issued'), 0)::bigint AS vat
          FROM tax_documents d JOIN terminals t ON t.id = d.terminal_id
         WHERE ${DAY_OF} = $1::date
         GROUP BY t.code, t.grand_total, d.doc_type ORDER BY 1, 3`, [date]);
      const methods = await many(c, `
        SELECT p.method, sum(p.amount)::bigint AS amount, count(*)::int AS n
          FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE o.status = 'paid' AND (p.created_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date
         GROUP BY 1 ORDER BY 1`, [date]);
      const bills = await one(c, `SELECT count(*)::int AS n FROM orders WHERE status = 'paid' AND (closed_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date`, [date]);
      return { date, docs, methods, bills: bills.n };
    });
  });
}
