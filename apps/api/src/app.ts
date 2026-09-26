import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { guard, HttpError, makeTokens, type Role } from './auth.ts';
import type { Db } from './db.ts';
import { authRoutes } from './routes/auth.ts';
import { orderRoutes } from './routes/orders.ts';
import { reportRoutes } from './routes/reports.ts';
import { shopRoutes } from './routes/shop.ts';

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  secureCookies?: boolean;
  logger?: boolean;
}

export type Ctx = AppDeps & {
  tokens: ReturnType<typeof makeTokens>;
  auth: (roles?: Role[]) => ReturnType<typeof guard>;
};

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false });
  const tokens = makeTokens(deps.jwtSecret);
  const ctx: Ctx = { ...deps, tokens, auth: (roles) => guard(tokens, roles) };

  app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_input', issues: err.issues });
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'conflict' });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.register(async (a) => authRoutes(a, ctx));
  app.register(async (a) => shopRoutes(a, ctx));
  app.register(async (a) => orderRoutes(a, ctx));
  app.register(async (a) => reportRoutes(a, ctx));
  return app;
}
