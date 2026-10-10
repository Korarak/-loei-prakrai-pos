import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { HttpError } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant } from '../db.ts';

const Id = z.object({ id: z.string().uuid() });
const STATUSES = ['trial', 'active', 'pending', 'suspended', 'closed'] as const;
const List = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const Patch = z.object({
  status: z.enum(STATUSES).optional(),
  trialEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  adminNote: z.string().trim().max(1000).nullable().optional(),
});

const OWNER_JOIN = `LEFT JOIN LATERAL (SELECT u.name, u.email, u.phone, u.last_login_at FROM tenant_members m JOIN users u ON u.id = m.user_id
                                         WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY u.created_at LIMIT 1) o ON true`;
const FILTER = `($1::text IS NULL OR t.status = $1)
           AND ($2::text IS NULL OR t.name ILIKE $2 OR t.tax_id ILIKE $2 OR o.name ILIKE $2 OR o.email ILIKE $2 OR o.phone ILIKE $2)`;

/**
 * Platform operator tools: who signed up, what their shop is doing, suspend / unlock.
 * Only the emails listed in PLATFORM_ADMIN_EMAILS may call these; with no list configured nobody can.
 */
export async function platformRoutes(app: FastifyInstance, ctx: Ctx) {
  const only = [ctx.auth(), async (req: { session: { userId: string } }) => {
    if (!(await isPlatformAdmin(ctx, req.session.userId))) throw new HttpError(403, 'forbidden');
  }];

  app.get('/api/platform/overview', { preHandler: only }, async () =>
    withPlatform(ctx.db, async (c) => {
      const byStatus = await many(c, `SELECT status, count(*)::int AS n FROM tenants GROUP BY status`);
      const r = await one(c, `SELECT
          count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS signups_7d,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS signups_30d,
          count(*) FILTER (WHERE status = 'trial' AND trial_ends_at <= (now() + interval '7 days')::date)::int AS trial_ending
        FROM tenants`);
      const locked = await one(c, `SELECT count(*)::int AS n FROM users WHERE login_locked_until > now()`);
      return { byStatus, ...r, lockedUsers: locked.n };
    }));

  app.get('/api/platform/tenants', { preHandler: only }, async (req) => {
    const q = List.parse(req.query);
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
    return withPlatform(ctx.db, async (c) => {
      const rows = await many(c, `
        SELECT t.id, t.name, t.status, t.trial_ends_at, t.created_at, t.tax_id, t.vat_registered, t.admin_note,
               (SELECT count(*)::int FROM tenant_members m WHERE m.tenant_id = t.id AND m.active) AS members,
               o.name AS owner_name, o.email AS owner_email, o.phone AS owner_phone, o.last_login_at
          FROM tenants t ${OWNER_JOIN}
         WHERE ${FILTER}
         ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`, [q.status ?? null, like, q.limit, q.offset]);
      const total = await one(c, `SELECT count(*)::int AS n FROM tenants t ${OWNER_JOIN} WHERE ${FILTER}`, [q.status ?? null, like]);
      return { rows, total: total.n };
    });
  });

  app.get('/api/platform/tenants/:id', { preHandler: only }, async (req) => {
    const { id } = Id.parse(req.params);
    const { tenant, members } = await withPlatform(ctx.db, async (c) => {
      const t = await one(c, `SELECT id, name, slug, status, trial_ends_at, legal_name, tax_id, address, vat_registered,
                                     admin_note, status_changed_at, created_at FROM tenants WHERE id = $1`, [id]);
      if (!t) throw new HttpError(404, 'not_found');
      const m = await many(c, `SELECT u.id AS user_id, u.name, u.email, u.phone, u.last_login_at, m.role, m.active,
                                      (m.pin_hash IS NOT NULL) AS has_pin, (u.totp_secret IS NOT NULL) AS has_totp,
                                      coalesce(u.login_locked_until > now() OR m.pin_locked_until > now(), false) AS locked, u.created_at
                                 FROM tenant_members m JOIN users u ON u.id = m.user_id
                                WHERE m.tenant_id = $1 ORDER BY (m.role = 'owner') DESC, u.created_at`, [id]);
      return { tenant: t, members: m };
    });
    const usage = await withTenant(ctx.db, id, (c) => one(c, `SELECT
        (SELECT count(*)::int FROM orders WHERE status = 'paid') AS paid_orders,
        (SELECT max(closed_at) FROM orders WHERE status = 'paid') AS last_sale_at,
        (SELECT coalesce(sum(total), 0)::bigint FROM tax_documents WHERE status = 'issued') AS issued_total,
        (SELECT count(*)::int FROM menu_items WHERE active) AS menu_items,
        (SELECT count(*)::int FROM dining_tables) AS tables,
        (SELECT count(*)::int FROM devices WHERE revoked_at IS NULL) AS devices,
        (SELECT max(at) FROM audit_log) AS last_activity_at`));
    return { tenant, members, usage };
  });

  app.patch('/api/platform/tenants/:id', { preHandler: only }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Patch.parse(req.body);
    const out = await withPlatform(ctx.db, async (c) => {
      const before = await one(c, `SELECT status, trial_ends_at, admin_note FROM tenants WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw new HttpError(404, 'not_found');
      const after = await one(c, `UPDATE tenants SET
            status = coalesce($2, status),
            status_changed_at = CASE WHEN $2::text IS NOT NULL AND $2 <> status THEN now() ELSE status_changed_at END,
            trial_ends_at = CASE WHEN $3::boolean THEN $4::date ELSE trial_ends_at END,
            admin_note = CASE WHEN $5::boolean THEN $6 ELSE admin_note END
          WHERE id = $1 RETURNING id, name, status, trial_ends_at, admin_note, status_changed_at`,
        [id, b.status ?? null, b.trialEndsAt !== undefined, b.trialEndsAt ?? null, b.adminNote !== undefined, b.adminNote ?? null]);
      return { before, after };
    });
    await withTenant(ctx.db, id, (c) => audit(c, req.session.userId, 'platform.tenant.update', 'tenant', id,
      { before: out.before, after: { status: out.after.status, trial_ends_at: out.after.trial_ends_at } }));
    return out.after;
  });

  // Someone locked out of sign-in calls the operator; clearing the lock is a deliberate, recorded act.
  app.post('/api/platform/tenants/:id/members/:userId/unlock', { preHandler: only }, async (req) => {
    const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    await withPlatform(ctx.db, async (c) => {
      const m = await one(c, `SELECT 1 FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`, [id, userId]);
      if (!m) throw new HttpError(404, 'not_found');
      await c.query(`UPDATE users SET login_failed = 0, login_locked_until = NULL WHERE id = $1`, [userId]);
      await c.query(`UPDATE tenant_members SET pin_failed = 0, pin_locked_until = NULL WHERE tenant_id = $1 AND user_id = $2`, [id, userId]);
    });
    await withTenant(ctx.db, id, (c) => audit(c, req.session.userId, 'platform.user.unlock', 'user', userId));
    return { ok: true };
  });
}

export async function isPlatformAdmin(ctx: Ctx, userId: string): Promise<boolean> {
  const list = (ctx.platformAdmins ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return false;
  const u = await withPlatform(ctx.db, (c) => one<{ email: string | null }>(c, `SELECT email FROM users WHERE id = $1`, [userId]));
  return !!u?.email && list.includes(u.email.toLowerCase());
}
