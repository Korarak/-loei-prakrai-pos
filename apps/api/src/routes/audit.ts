import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast } from '../auth.ts';
import { many, one, withTenant } from '../db.ts';

const Query = z.object({
  action: z.string().trim().max(60).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** The shop's own activity trail: who voided, discounted, adjusted stock or changed settings, and when. */
export async function auditRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/audit', { preHandler: ctx.auth(atLeast('manager')) }, async (req) => {
    const q = Query.parse(req.query);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      // Bangkok calendar days, same as every other report.
      const rows = await many(c, `
        SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail, a.user_id, u.name AS user_name
          FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE ($1::text IS NULL OR a.action = $1 OR a.action LIKE $1 || '.%')
           AND ($2::uuid IS NULL OR a.user_id = $2)
           AND ($3::date IS NULL OR a.at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Bangkok')
           AND ($4::date IS NULL OR a.at < (($4::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
           AND ($5::bigint IS NULL OR a.id < $5)
         ORDER BY a.id DESC LIMIT $6`,
        [q.action ?? null, q.userId ?? null, q.from ?? null, q.to ?? null, q.before ?? null, q.limit + 1]);
      const more = rows.length > q.limit;
      const actions = await many(c, `SELECT DISTINCT action FROM audit_log ORDER BY action`);
      const people = await many(c, `SELECT DISTINCT u.id, u.name FROM audit_log a JOIN users u ON u.id = a.user_id ORDER BY u.name`);
      return { rows: rows.slice(0, q.limit), more, actions: actions.map((a) => a.action), people };
    });
  });

  // Each entry stores a hash chained to the one before it; any edit or deletion breaks every later link.
  app.get('/api/audit/verify', { preHandler: ctx.auth(atLeast('owner')) }, async (req) =>
    withTenant(ctx.db, req.session.tenantId, async (c) => {
      const r = await one(c, `
        WITH chk AS (
          SELECT id, hash, prev_hash,
                 lag(hash) OVER (ORDER BY id) AS expect_prev,
                 encode(digest(concat_ws('|', lag(hash) OVER (ORDER BY id), tenant_id, user_id, action, entity, entity_id, detail::text, at), 'sha256'), 'hex') AS calc
            FROM audit_log)
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE calc IS DISTINCT FROM hash OR prev_hash IS DISTINCT FROM expect_prev)::int AS broken,
               min(id) FILTER (WHERE calc IS DISTINCT FROM hash OR prev_hash IS DISTINCT FROM expect_prev) AS first_broken
          FROM chk`);
      return { total: r.total, broken: r.broken, firstBroken: r.first_broken, ok: r.broken === 0 };
    }));
}
