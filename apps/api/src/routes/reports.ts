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
      // Credit notes are listed one by one and reduce the month they are issued in (ภ.พ.30).
      const credits = await many(c, `
        SELECT (d.issued_at AT TIME ZONE 'Asia/Bangkok')::date::text AS day, t.code AS terminal, 'CN' AS doc_type, d.doc_no,
               'ลดหนี้ ' || o.doc_no || coalesce(' · ' || d.buyer_name, '') AS buyer,
               -(d.vatable_base + d.exempt_base + d.service_charge)::bigint AS base, -d.vat AS vat, -d.total AS total
          FROM tax_documents d JOIN terminals t ON t.id = d.terminal_id JOIN tax_documents o ON o.id = d.credits_doc_id
         WHERE d.status = 'issued' AND d.doc_type = 'CN' AND to_char(d.issued_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') = $1`, [month]);
      rows.push(...credits);
      rows.sort((a, b) => (a.day + a.terminal + a.doc_no).localeCompare(b.day + b.terminal + b.doc_no));
      const totals = rows.reduce((s, r) => ({ base: s.base + r.base, vat: s.vat + r.vat, total: s.total + r.total }), { base: 0, vat: 0, total: 0 });
      const voided = await one(c, `SELECT count(*)::int AS n FROM tax_documents WHERE status = 'void' AND to_char(${DAY_OF}, 'YYYY-MM') = $1`, [month]);
      return { month, rows, totals, voidedCount: voided.n };
    });
  });

  // รายงานภาษีซื้อ + สรุป ภ.พ.30 for one month (design doc §8). Sales count by the Bangkok day a document was
  // issued, net of credit notes; input VAT counts only purchases and expenses backed by a full tax invoice.
  app.get('/api/reports/vat-return', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { month } = Month.parse(req.query);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const sales = await one(c, `
        SELECT coalesce(sum(sign * (vatable_base + service_charge)), 0)::bigint AS vatable,
               coalesce(sum(sign * exempt_base), 0)::bigint AS exempt,
               coalesce(sum(sign * vat), 0)::bigint AS vat,
               count(*) FILTER (WHERE sign = -1)::int AS credit_notes
          FROM (SELECT *, CASE WHEN doc_type = 'CN' THEN -1 ELSE 1 END AS sign FROM tax_documents) d
         WHERE status = 'issued' AND doc_type IN ('ABB','FULL','CN') AND to_char(${DAY_OF}, 'YYYY-MM') = $1`, [month]);
      const purchases = await many(c, `
        SELECT p.purchased_on::text AS day, p.invoice_no AS doc_no, p.supplier_name AS name, p.supplier_tax_id AS tax_id,
               p.supplier_branch AS branch, p.subtotal AS base, p.input_vat AS vat, 'purchase' AS source
          FROM purchases p WHERE p.vat_claimable AND to_char(p.purchased_on, 'YYYY-MM') = $1
        UNION ALL
        SELECT e.paid_on::text, NULL, coalesce(e.payee_name, e.description), e.payee_tax_id, NULL, e.amount, e.input_vat, 'expense'
          FROM expenses e WHERE e.input_vat > 0 AND to_char(e.paid_on, 'YYYY-MM') = $1
        ORDER BY 1, 3`, [month]);
      const inputBase = purchases.reduce((t, r) => t + r.base, 0);
      const inputVat = purchases.reduce((t, r) => t + r.vat, 0);
      const net = sales.vat - inputVat;
      return {
        month, purchases,
        summary: {
          salesVatable: sales.vatable, salesExempt: sales.exempt, outputVat: sales.vat, creditNotes: sales.credit_notes,
          purchaseBase: inputBase, inputVat,
          payable: Math.max(net, 0),       // ภาษีที่ต้องชำระ
          credit: Math.max(-net, 0),       // ภาษีชำระเกิน → ยกไปเดือนถัดไปหรือขอคืน
        },
      };
    });
  });

  // รายงานสินค้าและวัตถุดิบ (ม.87(3)): per ingredient the quantity brought forward, received, issued and carried
  // forward in one month, plus its card — purchases, waste and count adjustments line by line, sales one line per day.
  app.get('/api/reports/inventory', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { month } = Month.parse(req.query);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const start = `((($1 || '-01')::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
      const end = `((($1 || '-01')::date + interval '1 month') AT TIME ZONE 'Asia/Bangkok')`;
      const items = await many(c, `
        SELECT i.id, i.name, i.kind, i.base_unit,
               coalesce(sum(m.qty) FILTER (WHERE m.at < ${start}), 0)::float8 AS open_qty,
               coalesce(sum(m.value) FILTER (WHERE m.at < ${start}), 0)::bigint AS open_value
          FROM ingredients i JOIN stock_movements m ON m.ingredient_id = i.id AND m.at < ${end}
         GROUP BY i.id ORDER BY i.kind, i.name`, [month]);
      const moves = await many(c, `
        SELECT m.ingredient_id, (m.at AT TIME ZONE 'Asia/Bangkok')::date::text AS day, m.kind, m.qty::float8 AS qty, m.value,
               m.reason, p.invoice_no, p.supplier_name, d.doc_no
          FROM stock_movements m
          LEFT JOIN purchases p ON m.ref_type = 'purchase' AND p.id = m.ref_id
          LEFT JOIN LATERAL (SELECT doc_no FROM tax_documents WHERE order_id = m.ref_id AND doc_type <> 'CN'
                              ORDER BY issued_at LIMIT 1) d ON m.ref_type = 'order'
         WHERE m.at >= ${start} AND m.at < ${end}
         ORDER BY m.id`, [month]);

      interface Line { day: string; doc: string | null; text: string; inQty: number; outQty: number; value: number; balance: number; balanceValue: number }
      const byItem = new Map<string, typeof moves>();
      for (const m of moves) byItem.set(m.ingredient_id, [...(byItem.get(m.ingredient_id) ?? []), m]);
      const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

      const rows = items.map((it) => {
        const lines: Line[] = [];
        let qty = it.open_qty, value = it.open_value;
        const tot = { received: 0, receivedValue: 0, sold: 0, soldValue: 0, waste: 0, wasteValue: 0, adjust: 0, adjustValue: 0 };
        const push = (l: Omit<Line, 'balance' | 'balanceValue'>) => {
          qty = r4(qty + l.inQty - l.outQty);
          value += l.value;
          lines.push({ ...l, balance: qty, balanceValue: value });
        };
        // Sales are summed per day (one line per business day, placed after that day's other movements).
        const sales = { day: '', qty: 0, value: 0, docs: [] as string[] };
        const flushSales = () => {
          if (!sales.day) return;
          const docs = sales.docs.sort();
          push({ day: sales.day, doc: docs.length > 1 ? `${docs[0]} – ${docs.at(-1)}` : docs[0] ?? null,
            text: `ขายตามสูตร ${docs.length} บิล`, inQty: 0, outQty: r4(-sales.qty), value: sales.value });
          Object.assign(sales, { day: '', qty: 0, value: 0, docs: [] });
        };
        for (const m of byItem.get(it.id) ?? []) {
          if (sales.day && m.day !== sales.day) flushSales();
          if (m.kind === 'sale') {
            sales.day = m.day; sales.qty += m.qty; sales.value += m.value;
            if (m.doc_no && !sales.docs.includes(m.doc_no)) sales.docs.push(m.doc_no);
            tot.sold = r4(tot.sold - m.qty); tot.soldValue -= m.value;
            continue;
          }
          const inQty = m.qty > 0 ? m.qty : 0, outQty = m.qty < 0 ? -m.qty : 0;
          if (m.kind === 'purchase') {
            tot.received = r4(tot.received + m.qty); tot.receivedValue += m.value;
            push({ day: m.day, doc: m.invoice_no, text: `ซื้อจาก ${m.supplier_name}`, inQty, outQty, value: m.value });
          } else if (m.kind === 'waste') {
            tot.waste = r4(tot.waste - m.qty); tot.wasteValue -= m.value;
            push({ day: m.day, doc: null, text: `ของเสีย: ${m.reason}`, inQty, outQty, value: m.value });
          } else {
            tot.adjust = r4(tot.adjust + m.qty); tot.adjustValue += m.value;
            push({ day: m.day, doc: null, text: m.qty > 0 ? 'นับสต็อกได้เกินยอด' : 'นับสต็อกได้ขาดยอด', inQty, outQty, value: m.value });
          }
        }
        flushSales();
        return {
          id: it.id, name: it.name, kind: it.kind, unit: it.base_unit,
          openQty: it.open_qty, openValue: it.open_value, ...tot, closeQty: qty, closeValue: value, lines,
        };
      }).filter((r) => r.openQty !== 0 || r.lines.length > 0);
      const totals = rows.reduce((s, r) => ({
        openValue: s.openValue + r.openValue, receivedValue: s.receivedValue + r.receivedValue, soldValue: s.soldValue + r.soldValue,
        wasteValue: s.wasteValue + r.wasteValue, adjustValue: s.adjustValue + r.adjustValue, closeValue: s.closeValue + r.closeValue,
      }), { openValue: 0, receivedValue: 0, soldValue: 0, wasteValue: 0, adjustValue: 0, closeValue: 0 });
      return { month, rows, totals };
    });
  });

  // เอกสารประกอบคำขอ ภ.พ.06: the tills with their serial numbers, and the latest real document of each kind
  // per till to attach as samples. Devices come from /api/devices.
  app.get('/api/reports/pp06', { preHandler: ctx.auth(['owner']) }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, async (c) => {
      const terminals = await many(c, `
        SELECT t.id, t.name, t.code, t.rd_pos_id, t.serial_no, t.grand_total, b.name AS branch_name, b.branch_code
          FROM terminals t JOIN branches b ON b.id = t.branch_id ORDER BY t.code`);
      const samples = await many(c, `
        SELECT DISTINCT ON (terminal_id, doc_type) id, terminal_id, doc_type, doc_no, issued_at
          FROM tax_documents WHERE status = 'issued'
         ORDER BY terminal_id, doc_type, issued_at DESC`);
      return { terminals, samples };
    }));

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
