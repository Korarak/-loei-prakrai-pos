import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { checkSecret, COOKIE, hashSecret, HttpError, type Session } from '../auth.ts';
import { many, one, withPlatform, withTenant } from '../db.ts';
import { seedTemplate } from '../template.ts';

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

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  async function issue(reply: FastifyReply, s: Session) {
    const token = await ctx.tokens.sign(s);
    reply.setCookie(COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: ctx.secureCookies ?? false, maxAge: 12 * 3600,
    });
    return { token, ...s };
  }

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
      if (b.template === 'aharn') await seedTemplate(c);
    });

    reply.status(201);
    return issue(reply, { userId, tenantId, role: 'owner' });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = Login.parse(req.body);
    const found = await withPlatform(ctx.db, async (c) => {
      const u = await one<{ id: string; password_hash: string | null }>(c,
        `SELECT id, password_hash FROM users WHERE email = $1`, [b.email]);
      if (!u?.password_hash || !(await checkSecret(u.password_hash, b.password))) return null;
      const m = await many<{ tenant_id: string; role: Session['role'] }>(c,
        `SELECT m.tenant_id, m.role FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
          WHERE m.user_id = $1 AND m.active AND t.status <> 'closed' ORDER BY m.role = 'owner' DESC`, [u.id]);
      return m[0] ? { userId: u.id, tenantId: m[0].tenant_id, role: m[0].role } : null;
    });
    if (!found) throw new HttpError(401, 'invalid_credentials');
    return issue(reply, found);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: ctx.auth() }, async (req) => {
    const s = req.session;
    const [user, tenant] = await withPlatform(ctx.db, (c) => Promise.all([
      one(c, `SELECT id, name, email FROM users WHERE id = $1`, [s.userId]),
      one(c, `SELECT id, name, status, trial_ends_at, legal_name, tax_id, address, vat_registered,
                     price_includes_vat, service_charge_bp, cash_rounding FROM tenants WHERE id = $1`, [s.tenantId]),
    ]));
    const [branches, terminals] = await withTenant(ctx.db, s.tenantId, (c) => Promise.all([
      many(c, `SELECT id, name, branch_code, address FROM branches ORDER BY name`),
      many(c, `SELECT id, branch_id, name, code, rd_pos_id, serial_no FROM terminals ORDER BY code`),
    ]));
    return { user, tenant, role: s.role, branches, terminals };
  });
}
