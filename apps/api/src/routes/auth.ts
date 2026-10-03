import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { checkSecret, COOKIE, hashSecret, HttpError, type Session } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant } from '../db.ts';
import { checkTotp, hashRecovery, newRecoveryCodes, newTotpSecret, otpauthUri } from '../totp.ts';
import { seedCosting, seedTemplate } from '../template.ts';
import { deviceOf } from '../device.ts';

const Signup = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8).max(200),
  shopName: z.string().trim().min(1).max(100),
  template: z.enum(['aharn', 'blank']).default('aharn'),
  tableCount: z.number().int().min(0).max(100).default(12),
});

const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
const TotpLogin = z.object({ challenge: z.string().min(1), code: z.string().trim().min(6).max(20) });

const MAX_LOGIN_TRIES = 10;
const LOCK_LOGIN_MINUTES = 15;

interface UserRow {
  id: string; email: string | null; password_hash: string | null; totp_secret: string | null; totp_last_step: number | null;
  totp_recovery: string[]; login_failed: number; login_locked_until: string | null;
}
const USER_COLS = 'id, email, password_hash, totp_secret, totp_last_step, totp_recovery, login_failed, login_locked_until';

export async function issueSession(ctx: Ctx, reply: FastifyReply, s: Session) {
  const token = await ctx.tokens.sign(s);
  reply.setCookie(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies ?? false, maxAge: 12 * 3600,
  });
  return { token, ...s };
}

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const issue = (reply: FastifyReply, s: Session) => issueSession(ctx, reply, s);

  app.post('/api/auth/signup', async (req, reply) => {
    const b = Signup.parse(req.body);
    const passwordHash = await hashSecret(b.password);
    const trialEnds = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    const { userId, tenantId } = await withPlatform(ctx.db, async (c) => {
      const exists = await one(c, `SELECT 1 FROM users WHERE email = $1`, [b.email]);
      if (exists) throw new HttpError(409, 'email_taken');
      const u = await one<{ id: string }>(c,
        `INSERT INTO users (email, phone, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
        [b.email, b.phone ?? null, b.name, passwordHash]);
      const t = await one<{ id: string }>(c,
        `INSERT INTO tenants (name, slug, trial_ends_at) VALUES ($1, $2, $3) RETURNING id`,
        [b.shopName, 'r-' + randomBytes(4).toString('hex'), trialEnds]);
      await c.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [t!.id, u!.id]);
      return { userId: u!.id, tenantId: t!.id };
    });

    await withTenant(ctx.db, tenantId, async (c) => {
      const br = await one<{ id: string }>(c, `INSERT INTO branches (name) VALUES ('สาขาหลัก') RETURNING id`);
      await c.query(`INSERT INTO terminals (branch_id, name, code) VALUES ($1, 'เครื่อง 1', 'P1')`, [br!.id]);
      for (let i = 1; i <= b.tableCount; i++) {
        await c.query(`INSERT INTO dining_tables (branch_id, name, sort) VALUES ($1, $2, $3)`, [br!.id, String(i), i]);
      }
      if (b.template === 'aharn') {
        await seedTemplate(c);
        await seedCosting(c);
      }
    });

    reply.status(201);
    return issue(reply, { userId, tenantId, role: 'owner' });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = Login.parse(req.body);
    const u = await withPlatform(ctx.db, (c) => one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE email = $1`, [b.email]));
    if (u) assertNotLocked(u);
    if (!u?.password_hash || !(await checkSecret(u.password_hash, b.password))) {
      if (u) await failed(u.id);
      throw new HttpError(401, 'invalid_credentials');
    }
    // With an authenticator app set up, the password only earns a short challenge; the code finishes sign-in.
    if (u.totp_secret) return { totpRequired: true, challenge: await ctx.tokens.signChallenge(u.id) };
    return issue(reply, await signedIn(u.id));
  });

  app.post('/api/auth/login/totp', async (req, reply) => {
    const b = TotpLogin.parse(req.body);
    const userId = await ctx.tokens.verifyChallenge(b.challenge);
    if (!userId) throw new HttpError(401, 'challenge_expired');
    const u = await withPlatform(ctx.db, (c) => one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]));
    if (!u?.totp_secret) throw new HttpError(401, 'challenge_expired');
    assertNotLocked(u);
    if (!(await useSecondFactor(u.id, b.code))) {
      await failed(u.id);
      throw new HttpError(401, 'invalid_code');
    }
    return issue(reply, await signedIn(u.id));
  });

  // ---------- authenticator app (TOTP) for the signed-in user ----------

  app.get('/api/auth/totp', { preHandler: ctx.auth() }, async (req) => {
    const u = await withPlatform(ctx.db, (c) => one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.session.userId]));
    return { enabled: !!u?.totp_secret, recoveryLeft: u?.totp_recovery.length ?? 0, hasPassword: !!u?.password_hash };
  });

  app.post('/api/auth/totp/setup', { preHandler: ctx.auth() }, async (req) => {
    const secret = newTotpSecret();
    const u = await withPlatform(ctx.db, async (c) => {
      const cur = await one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE id = $1 FOR UPDATE`, [req.session.userId]);
      if (!cur?.password_hash) throw new HttpError(409, 'no_password', 'staff who sign in with a PIN do not use an authenticator app');
      if (cur.totp_secret) throw new HttpError(409, 'totp_already_enabled');
      await c.query(`UPDATE users SET totp_pending = $2 WHERE id = $1`, [cur.id, secret]);
      return cur;
    });
    return { secret, uri: otpauthUri(secret, u.email ?? req.session.userId) };
  });

  app.post('/api/auth/totp/enable', { preHandler: ctx.auth() }, async (req) => {
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const codes = newRecoveryCodes();
    const ok = await withPlatform(ctx.db, async (c) => {
      const u = await one<UserRow & { totp_pending: string | null }>(c,
        `SELECT ${USER_COLS}, totp_pending FROM users WHERE id = $1 FOR UPDATE`, [req.session.userId]);
      if (!u?.totp_pending || u.totp_secret) return false;
      const step = checkTotp(u.totp_pending, code);
      if (step === null) return false;
      await c.query(`UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = $2, totp_recovery = $3 WHERE id = $1`,
        [u.id, step, codes.map(hashRecovery)]);
      return true;
    });
    if (!ok) throw new HttpError(400, 'invalid_code');
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'totp.enable', 'user', req.session.userId));
    return { enabled: true, recoveryCodes: codes };
  });

  app.post('/api/auth/totp/disable', { preHandler: ctx.auth() }, async (req) => {
    const b = z.object({ password: z.string().min(1), code: z.string().trim() }).parse(req.body);
    const u = await withPlatform(ctx.db, (c) => one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.session.userId]));
    if (!u?.totp_secret) throw new HttpError(409, 'totp_not_enabled');
    if (!u.password_hash || !(await checkSecret(u.password_hash, b.password))) throw new HttpError(401, 'invalid_credentials');
    if (!(await useSecondFactor(u.id, b.code))) throw new HttpError(401, 'invalid_code');
    await withPlatform(ctx.db, (c) => c.query(
      `UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL, totp_recovery = '{}' WHERE id = $1`, [u.id]));
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'totp.disable', 'user', req.session.userId));
    return { enabled: false };
  });

  // ---------- helpers ----------

  function assertNotLocked(u: UserRow) {
    if (u.login_locked_until && new Date(u.login_locked_until) > new Date()) throw new HttpError(429, 'login_locked');
  }

  /** Wrong password or code: count it, and lock sign-in for a while after too many in a row. */
  async function failed(userId: string) {
    await withPlatform(ctx.db, (c) => c.query(`
      UPDATE users SET login_failed = CASE WHEN login_failed + 1 >= ${MAX_LOGIN_TRIES} THEN 0 ELSE login_failed + 1 END,
             login_locked_until = CASE WHEN login_failed + 1 >= ${MAX_LOGIN_TRIES}
                                       THEN now() + interval '${LOCK_LOGIN_MINUTES} minutes' ELSE login_locked_until END
       WHERE id = $1`, [userId]));
  }

  /** A fresh authenticator code, or one unused recovery code (which is then spent). */
  async function useSecondFactor(userId: string, code: string): Promise<boolean> {
    return withPlatform(ctx.db, async (c) => {
      const cur = await one<UserRow>(c, `SELECT ${USER_COLS} FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (!cur?.totp_secret) return false;
      const step = checkTotp(cur.totp_secret, code.replace(/\s/g, ''), Date.now(), cur.totp_last_step);
      if (step !== null) {
        await c.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [userId, step]);
        return true;
      }
      const h = hashRecovery(code);
      if (!cur.totp_recovery.includes(h)) return false;
      await c.query(`UPDATE users SET totp_recovery = array_remove(totp_recovery, $2) WHERE id = $1`, [userId, h]);
      return true;
    });
  }

  /** Session for the shop this person belongs to (owner role first); resets the failed-login count. */
  async function signedIn(userId: string): Promise<Session> {
    const m = await withPlatform(ctx.db, async (c) => {
      await c.query(`UPDATE users SET login_failed = 0, login_locked_until = NULL WHERE id = $1`, [userId]);
      return many<{ tenant_id: string; role: Session['role'] }>(c,
        `SELECT m.tenant_id, m.role FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
          WHERE m.user_id = $1 AND m.active AND t.status <> 'closed' ORDER BY m.role = 'owner' DESC`, [userId]);
    });
    if (!m[0]) throw new HttpError(401, 'invalid_credentials');
    return { userId, tenantId: m[0].tenant_id, role: m[0].role };
  }

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: ctx.auth() }, async (req) => {
    const s = req.session;
    const [user, tenant] = await withPlatform(ctx.db, (c) => Promise.all([
      one(c, `SELECT id, name, email FROM users WHERE id = $1`, [s.userId]),
      one(c, `SELECT id, name, status, trial_ends_at, legal_name, tax_id, address, vat_registered, vat_registered_at,
                     price_includes_vat, service_charge_bp, cash_rounding, promptpay_id FROM tenants WHERE id = $1`, [s.tenantId]),
    ]));
    const [branches, terminals] = await withTenant(ctx.db, s.tenantId, (c) => Promise.all([
      many(c, `SELECT id, name, branch_code, address FROM branches ORDER BY name`),
      many(c, `SELECT id, branch_id, name, code, rd_pos_id, serial_no FROM terminals ORDER BY code`),
    ]));
    const d = await deviceOf(ctx.db, req);
    // The device's till decides which terminal numbers tax documents; only when it belongs to this shop.
    const device = d && d.tenant_id === s.tenantId ? { id: d.id, name: d.name, terminal_id: d.terminal_id } : null;
    return { user, tenant, role: s.role, branches, terminals, device };
  });
}
