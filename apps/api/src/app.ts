import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { guard, HttpError, makeTokens, type Role } from './auth.ts';
import { one, withPlatform, type Db } from './db.ts';
import { authRoutes } from './routes/auth.ts';
import { costingRoutes } from './routes/costing.ts';
import { auditRoutes } from './routes/audit.ts';
import { orderRoutes } from './routes/orders.ts';
import { platformRoutes } from './routes/platform.ts';
import { printerRoutes } from './routes/printers.ts';
import { reportRoutes } from './routes/reports.ts';
import { shiftRoutes } from './routes/shifts.ts';
import { shopRoutes } from './routes/shop.ts';
import { staffRoutes } from './routes/staff.ts';
import { uploadRoutes } from './routes/uploads.ts';

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  secureCookies?: boolean;
  /** Where menu photos live on disk; in Docker this is a named volume so photos survive redeploys. */
  uploadDir?: string;
  /** Emails allowed to use /api/platform/* (the operator who reviews sign-ups). Empty = nobody. */
  platformAdmins?: string[];
  logger?: boolean;
}

export type Ctx = AppDeps & {
  tokens: ReturnType<typeof makeTokens>;
  auth: (roles?: Role[]) => ReturnType<typeof guard>;
};

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false });
  const tokens = makeTokens(deps.jwtSecret);
  const member = (s: { userId: string; tenantId: string }) => withPlatform(deps.db, async (c) =>
    (await one<{ role: Role }>(c,
      `SELECT m.role FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.active AND t.status NOT IN ('closed', 'suspended')`, [s.tenantId, s.userId]))?.role ?? null);
  const ctx: Ctx = { ...deps, tokens, auth: (roles) => guard(tokens, member, roles) };

  app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_input', issues: err.issues });
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'conflict' });
    // Fastify's own request errors (bad JSON, body too large…) are the client's fault, not ours.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'invalid_input', message: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.register(async (a) => authRoutes(a, ctx));
  app.register(async (a) => shopRoutes(a, ctx));
  app.register(async (a) => orderRoutes(a, ctx));
  app.register(async (a) => reportRoutes(a, ctx));
  app.register(async (a) => costingRoutes(a, ctx));
  app.register(async (a) => staffRoutes(a, ctx));
  app.register(async (a) => shiftRoutes(a, ctx));
  app.register(async (a) => printerRoutes(a, ctx));
  app.register(async (a) => uploadRoutes(a, ctx));
  app.register(async (a) => auditRoutes(a, ctx));
  app.register(async (a) => platformRoutes(a, ctx));
  return app;
}
