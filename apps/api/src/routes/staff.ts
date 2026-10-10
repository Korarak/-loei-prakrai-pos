import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { checkSecret, DEVICE_COOKIE, hashSecret, hashToken, HttpError, newDeviceToken, type Role } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant } from '../db.ts';
import { deviceOf } from '../device.ts';
import { issueSession } from './auth.ts';

const Id = z.object({ id: z.string().uuid() });

/** 6 digits, and not something a colleague would guess first. */
const Pin = z.string().regex(/^\d{6}$/, 'PIN is 6 digits').refine((p) => {
  if (/^(\d)\1{5}$/.test(p)) return false;                       // 000000, 111111
  const up = '0123456789012', down = '9876543210987';
  return !up.includes(p) && !down.includes(p);                    // 123456, 654321
}, 'PIN too easy to guess');

const STAFF_ROLES = ['manager', 'cashier', 'waiter', 'kitchen'] as const;
const NewStaff = z.object({ name: z.string().trim().min(1).max(100), role: z.enum(STAFF_ROLES), pin: Pin });
const EditStaff = z.object({
  name: z.string().trim().min(1).max(100), role: z.enum(STAFF_ROLES), pin: Pin, active: z.boolean(),
}).partial();

const NewDevice = z.object({ name: z.string().trim().min(1).max(50), terminalId: z.string().uuid().nullable().default(null) });
const EditDevice = z.object({ name: z.string().trim().min(1).max(50), terminalId: z.string().uuid().nullable() }).partial();
const PinLogin = z.object({ userId: z.string().uuid(), pin: z.string().regex(/^\d{6}$/) });

const MAX_TRIES = 5;
const LOCK_MINUTES = 5;
const DEVICE_DAYS = 400;

export async function staffRoutes(app: FastifyInstance, ctx: Ctx) {
  const owner = ctx.auth(['owner']);
  // Terminals are shop data behind RLS, so the check runs in the shop's own scope.
  const requireTerminal = async (tenantId: string, id: string) => {
    const t = await withTenant(ctx.db, tenantId, (c) => one(c, `SELECT 1 FROM terminals WHERE id = $1`, [id]));
    if (!t) throw new HttpError(404, 'terminal_not_found');
  };

  // ---------- staff ----------

  app.get('/api/staff', { preHandler: owner }, async (req) => withPlatform(ctx.db, (c) => many(c,
    `SELECT u.id, u.name, u.email, m.role, m.active, m.pin_hash IS NOT NULL AS has_pin,
            (m.pin_locked_until > now()) AS locked, m.created_at
       FROM tenant_members m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = $1
      ORDER BY m.active DESC, m.role = 'owner' DESC, m.created_at`, [req.session.tenantId])));

  app.post('/api/staff', { preHandler: owner }, async (req, reply) => {
    const b = NewStaff.parse(req.body);
    const pinHash = await hashSecret(b.pin);
    const u = await withPlatform(ctx.db, async (c) => {
      const u = await one(c, `INSERT INTO users (name) VALUES ($1) RETURNING id, name`, [b.name]);
      await c.query(`INSERT INTO tenant_members (tenant_id, user_id, role, pin_hash) VALUES ($1, $2, $3, $4)`,
        [req.session.tenantId, u.id, b.role, pinHash]);
      return u;
    });
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'staff.create', 'user', u.id, { name: b.name, role: b.role }));
    reply.status(201);
    return { ...u, role: b.role, active: true, has_pin: true };
  });

  app.patch('/api/staff/:id', { preHandler: owner }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = EditStaff.parse(req.body);
    const pinHash = b.pin ? await hashSecret(b.pin) : null;
    const out = await withPlatform(ctx.db, async (c) => {
      const m = await one(c, `SELECT m.role, m.active, u.name FROM tenant_members m JOIN users u ON u.id = m.user_id
                               WHERE m.tenant_id = $1 AND m.user_id = $2 FOR UPDATE OF m`, [req.session.tenantId, id]);
      if (!m) throw new HttpError(404, 'not_found');
      // The owner can set their own name and PIN, but the shop can never be left without its owner.
      if (m.role === 'owner' && ((b.role && b.role !== ('owner' as string)) || b.active === false)) throw new HttpError(409, 'owner_locked');
      if (b.name) await c.query(`UPDATE users SET name = $2 WHERE id = $1`, [id, b.name]);
      await c.query(
        `UPDATE tenant_members SET role = $3, active = $4,
                pin_hash = coalesce($5, pin_hash),
                pin_failed = CASE WHEN $5::text IS NULL THEN pin_failed ELSE 0 END,
                pin_locked_until = CASE WHEN $5::text IS NULL THEN pin_locked_until ELSE NULL END
          WHERE tenant_id = $1 AND user_id = $2`,
        [req.session.tenantId, id, b.role ?? m.role, b.active ?? m.active, pinHash]);
      return { before: m };
    });
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'staff.update', 'user', id, {
      before: { role: out.before.role, active: out.before.active, name: out.before.name },
      after: { role: b.role, active: b.active, name: b.name, pinChanged: !!b.pin },
    }));
    return { ok: true };
  });

  // ---------- devices ----------

  app.get('/api/devices', { preHandler: owner }, async (req) => withPlatform(ctx.db, (c) => many(c,
    `SELECT d.id, d.name, d.terminal_id, d.created_at, d.last_seen_at, d.revoked_at, u.name AS created_by_name
       FROM devices d LEFT JOIN users u ON u.id = d.created_by
      WHERE d.tenant_id = $1 ORDER BY d.revoked_at IS NOT NULL, d.created_at DESC`, [req.session.tenantId])));

  // Registers the device making this request: the owner does this once on each tablet at the counter.
  app.post('/api/devices', { preHandler: owner }, async (req, reply) => {
    const b = NewDevice.parse(req.body);
    const token = newDeviceToken();
    if (b.terminalId) await requireTerminal(req.session.tenantId, b.terminalId);
    const d = await withPlatform(ctx.db, async (c) => {
      // Re-registering a device replaces its old record.
      const old = req.cookies[DEVICE_COOKIE];
      if (old) await c.query(`UPDATE devices SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(old)]);
      return one(c, `INSERT INTO devices (tenant_id, terminal_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4, $5)
                     RETURNING id, name, terminal_id, created_at`,
        [req.session.tenantId, b.terminalId, b.name, hashToken(token), req.session.userId]);
    });
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'device.register', 'device', d.id, { name: b.name }));
    reply.setCookie(DEVICE_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies ?? false, maxAge: DEVICE_DAYS * 86400,
    });
    reply.status(201);
    return d;
  });

  app.patch('/api/devices/:id', { preHandler: owner }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = EditDevice.parse(req.body);
    if (b.terminalId) await requireTerminal(req.session.tenantId, b.terminalId);
    return withPlatform(ctx.db, async (c) => {
      const d = await one(c, `SELECT * FROM devices WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [id, req.session.tenantId]);
      if (!d) throw new HttpError(404, 'not_found');
      return one(c, `UPDATE devices SET name = $2, terminal_id = $3 WHERE id = $1 RETURNING id, name, terminal_id`,
        [id, b.name ?? d.name, b.terminalId === undefined ? d.terminal_id : b.terminalId]);
    });
  });

  app.post('/api/devices/:id/revoke', { preHandler: owner }, async (req) => {
    const { id } = Id.parse(req.params);
    const d = await withPlatform(ctx.db, (c) => one(c,
      `UPDATE devices SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id, name`, [id, req.session.tenantId]));
    if (!d) throw new HttpError(404, 'not_found');
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'device.revoke', 'device', id, { name: d.name }));
    return { ok: true };
  });

  // ---------- PIN sign-in on a registered device ----------

  // The lock screen: who may sign in on this device. Names only — never roles' secrets.
  app.get('/api/auth/device', async (req) => {
    const d = await deviceOf(ctx.db, req);
    if (!d) throw new HttpError(404, 'no_device');
    return withPlatform(ctx.db, async (c) => ({
      device: { id: d.id, name: d.name },
      shop: (await one(c, `SELECT name FROM tenants WHERE id = $1`, [d.tenant_id])).name,
      staff: await many(c,
        `SELECT u.id, u.name, m.role FROM tenant_members m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.active AND m.pin_hash IS NOT NULL
          ORDER BY m.role = 'owner' DESC, u.name`, [d.tenant_id]),
    }));
  });

  app.post('/api/auth/pin', async (req, reply) => {
    const d = await deviceOf(ctx.db, req);
    if (!d) throw new HttpError(403, 'device_not_registered');
    const b = PinLogin.parse(req.body);
    const m = await withPlatform(ctx.db, (c) => one<{ role: Role; pin_hash: string | null; pin_failed: number; locked: boolean; wait_s: number }>(c,
      `SELECT m.role, m.pin_hash, m.pin_failed, coalesce(m.pin_locked_until > now(), false) AS locked,
              greatest(0, extract(epoch FROM m.pin_locked_until - now()))::int AS wait_s
         FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.active AND t.status NOT IN ('closed', 'suspended')`, [d.tenant_id, b.userId]));
    if (!m?.pin_hash) throw new HttpError(401, 'invalid_pin');
    if (m.locked) throw new HttpError(423, 'pin_locked', `try again in ${Math.ceil(m.wait_s / 60)} min`);

    if (!(await checkSecret(m.pin_hash, b.pin))) {
      const left = await withPlatform(ctx.db, async (c) => {
        const r = await one<{ pin_failed: number }>(c,
          `UPDATE tenant_members SET pin_failed = pin_failed + 1,
                  pin_locked_until = CASE WHEN pin_failed + 1 >= $3 THEN now() + make_interval(mins => $4) ELSE pin_locked_until END
            WHERE tenant_id = $1 AND user_id = $2 RETURNING pin_failed`, [d.tenant_id, b.userId, MAX_TRIES, LOCK_MINUTES]);
        if (r!.pin_failed >= MAX_TRIES) await c.query(`UPDATE tenant_members SET pin_failed = 0 WHERE tenant_id = $1 AND user_id = $2`, [d.tenant_id, b.userId]);
        return MAX_TRIES - r!.pin_failed;
      });
      if (left <= 0) {
        await withTenant(ctx.db, d.tenant_id, (c) => audit(c, b.userId, 'pin.locked', 'device', d.id, { tries: MAX_TRIES }));
        throw new HttpError(423, 'pin_locked', `try again in ${LOCK_MINUTES} min`);
      }
      throw new HttpError(401, 'invalid_pin', `${left} tries left`);
    }

    await withPlatform(ctx.db, async (c) => {
      await c.query(`UPDATE tenant_members SET pin_failed = 0, pin_locked_until = NULL WHERE tenant_id = $1 AND user_id = $2`, [d.tenant_id, b.userId]);
      await c.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [d.id]);
    });
    return issueSession(ctx, reply, { userId: b.userId, tenantId: d.tenant_id, role: m.role });
  });
}
