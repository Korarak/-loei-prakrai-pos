import { isValidThaiTaxId } from '@prakai/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, HttpError } from '../auth.ts';
import { audit, many, one, withTenant } from '../db.ts';

const Id = z.object({ id: z.string().uuid() });
const Customer = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().refine(isValidThaiTaxId, 'invalid Thai tax ID').transform((v) => v.replace(/[\s-]/g, '')),
  branch: z.string().trim().regex(/^\d{5}$/).default('00000'),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().max(30).nullish().transform((v) => v || null),
  note: z.string().trim().max(300).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
});
const Query = z.object({ q: z.string().trim().max(60).optional(), all: z.enum(['1']).optional() });

const isDup = (e: unknown) => (e as { code?: string }).code === '23505';
const DUP = 'มีลูกค้าเลขผู้เสียภาษีและสาขานี้แล้ว';

/** The shop's regular tax-invoice buyers, so a full-form invoice is a tap instead of retyping 13 digits. */
export async function customerRoutes(app: FastifyInstance, ctx: Ctx) {
  const cashier = ctx.auth(atLeast('cashier'));

  app.get('/api/customers', { preHandler: cashier }, async (req) => {
    const { q, all } = Query.parse(req.query);
    return withTenant(ctx.db, req.session.tenantId, (c) => many(c,
      `SELECT * FROM customers WHERE ($1::boolean OR active)
          AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR tax_id LIKE $2 || '%' OR phone LIKE '%' || $2 || '%')
        ORDER BY active DESC, name LIMIT 200`, [all === '1', q || null]));
  });

  app.post('/api/customers', { preHandler: cashier }, async (req, reply) => {
    const b = Customer.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      try {
        const row = await one(c,
          `INSERT INTO customers (name, tax_id, branch, address, phone, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [b.name, b.taxId, b.branch, b.address, b.phone, b.note]);
        await audit(c, req.session.userId, 'customer.create', 'customer', row.id, { name: b.name, taxId: b.taxId });
        reply.status(201);
        return row;
      } catch (e) {
        if (isDup(e)) throw new HttpError(409, 'customer_exists', DUP);
        throw e;
      }
    });
  });

  app.put('/api/customers/:id', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Customer.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      try {
        const row = await one(c,
          `UPDATE customers SET name = $2, tax_id = $3, branch = $4, address = $5, phone = $6, note = $7, active = $8 WHERE id = $1 RETURNING *`,
          [id, b.name, b.taxId, b.branch, b.address, b.phone, b.note, b.active]);
        if (!row) throw new HttpError(404, 'not_found');
        await audit(c, req.session.userId, 'customer.update', 'customer', id, { name: b.name, active: b.active });
        return row;
      } catch (e) {
        if (isDup(e)) throw new HttpError(409, 'customer_exists', DUP);
        throw e;
      }
    });
  });
}
