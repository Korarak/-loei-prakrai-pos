import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { atLeast, hashToken, HttpError, newDeviceToken } from '../auth.ts';
import { audit, many, one, withPlatform, withTenant, type Tx } from '../db.ts';

const Id = z.object({ id: z.string().uuid() });

const Printer = z.object({
  name: z.string().trim().min(1).max(50),
  host: z.string().trim().regex(/^[A-Za-z0-9.-]{1,100}$/, 'LAN IP or host name'),
  port: z.number().int().min(1).max(65535).default(9100),
  widthPx: z.union([z.literal(384), z.literal(576)]).default(576),
  role: z.enum(['receipt', 'kitchen', 'bar']),
  terminalId: z.string().uuid().nullable().default(null),
  kickDrawer: z.boolean().default(false),
  active: z.boolean().default(true),
});

const Job = z.object({
  printerId: z.string().uuid(),
  kind: z.enum(['receipt', 'kitchen', 'test']),
  width: z.number().int(),
  height: z.number().int().min(1).max(6000),
  /** base64 of the 1-bit bitmap: rows of ceil(width/8) bytes, MSB = leftmost pixel, 1 = black. */
  bitmap: z.string().max(1_200_000),
  kickDrawer: z.boolean().default(false),
});

const Result = z.object({ ok: z.boolean(), error: z.string().max(300).optional() });

/** Tickets older than this are not printed any more: a kitchen order from an hour ago only confuses the cook. */
const EXPIRE_MINUTES = 10;
/** A job claimed but never reported (agent crashed mid-print) goes back to the queue after this. */
const RECLAIM_SECONDS = 60;
const MAX_ATTEMPTS = 3;
const AGENT_PREFIX = 'pa_';

const rowOf = (p: any) => p && ({
  id: p.id, name: p.name, host: p.host, port: p.port, width_px: p.width_px, role: p.role,
  terminal_id: p.terminal_id, kick_drawer: p.kick_drawer, active: p.active,
});

export async function printerRoutes(app: FastifyInstance, ctx: Ctx) {
  const manager = ctx.auth(atLeast('manager'));
  const owner = ctx.auth(['owner']);

  // ---------- printers ----------

  // Every staff member needs the list: the till picks its receipt printer, the kitchen screen its station's.
  app.get('/api/printers', { preHandler: ctx.auth() }, async (req) => withTenant(ctx.db, req.session.tenantId, async (c) => {
    const printers = await many(c, `SELECT * FROM printers ORDER BY role, name`);
    const agents = await withPlatform(ctx.db, (p) => many(p,
      `SELECT max(last_seen_at) AS last_seen_at, count(*)::int AS n FROM print_agents WHERE tenant_id = $1 AND revoked_at IS NULL`,
      [req.session.tenantId]));
    return { printers: printers.map(rowOf), agentLastSeen: agents[0]?.last_seen_at ?? null, agents: agents[0]?.n ?? 0 };
  }));

  app.post('/api/printers', { preHandler: manager }, async (req, reply) => {
    const b = Printer.parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      if (b.terminalId && !(await one(c, `SELECT 1 FROM terminals WHERE id = $1`, [b.terminalId]))) throw new HttpError(404, 'terminal_not_found');
      const p = await one(c, `INSERT INTO printers (name, host, port, width_px, role, terminal_id, kick_drawer, active)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.name, b.host, b.port, b.widthPx, b.role, b.terminalId, b.kickDrawer, b.active]);
      await audit(c, req.session.userId, 'printer.add', 'printer', p.id, { name: b.name, host: b.host, role: b.role });
      reply.status(201);
      return rowOf(p);
    });
  });

  app.patch('/api/printers/:id', { preHandler: manager }, async (req) => {
    const { id } = Id.parse(req.params);
    const b = Printer.partial().parse(req.body);
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const cur = await one(c, `SELECT * FROM printers WHERE id = $1`, [id]);
      if (!cur) throw new HttpError(404, 'not_found');
      const p = await one(c, `UPDATE printers SET name = $2, host = $3, port = $4, width_px = $5, role = $6, terminal_id = $7,
                                     kick_drawer = $8, active = $9 WHERE id = $1 RETURNING *`,
        [id, b.name ?? cur.name, b.host ?? cur.host, b.port ?? cur.port, b.widthPx ?? cur.width_px, b.role ?? cur.role,
          b.terminalId === undefined ? cur.terminal_id : b.terminalId, b.kickDrawer ?? cur.kick_drawer, b.active ?? cur.active]);
      await audit(c, req.session.userId, 'printer.edit', 'printer', id, b);
      return rowOf(p);
    });
  });

  // ---------- print agents (one per shop PC that can reach the printers) ----------

  app.get('/api/print-agents', { preHandler: owner }, async (req) => withPlatform(ctx.db, (c) => many(c,
    `SELECT id, name, created_at, last_seen_at, revoked_at FROM print_agents
      WHERE tenant_id = $1 ORDER BY revoked_at IS NOT NULL, created_at DESC`, [req.session.tenantId])));

  // The token is shown once; only its hash is kept.
  app.post('/api/print-agents', { preHandler: owner }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(50) }).parse(req.body);
    const token = AGENT_PREFIX + newDeviceToken();
    const a = await withPlatform(ctx.db, (c) => one(c,
      `INSERT INTO print_agents (tenant_id, name, token_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at`,
      [req.session.tenantId, name, hashToken(token), req.session.userId]));
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'print_agent.add', 'print_agent', a.id, { name }));
    reply.status(201);
    return { ...a, token };
  });

  app.post('/api/print-agents/:id/revoke', { preHandler: owner }, async (req) => {
    const { id } = Id.parse(req.params);
    const a = await withPlatform(ctx.db, (c) => one(c,
      `UPDATE print_agents SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id`,
      [id, req.session.tenantId]));
    if (!a) throw new HttpError(404, 'not_found');
    await withTenant(ctx.db, req.session.tenantId, (c) => audit(c, req.session.userId, 'print_agent.revoke', 'print_agent', id));
    return { revoked: true };
  });

  // ---------- jobs, from the browser ----------

  app.post('/api/print-jobs', { preHandler: ctx.auth() }, async (req, reply) => {
    const b = Job.parse(req.body);
    const bitmap = Buffer.from(b.bitmap, 'base64');
    return withTenant(ctx.db, req.session.tenantId, async (c) => {
      const p = await one(c, `SELECT * FROM printers WHERE id = $1 AND active`, [b.printerId]);
      if (!p) throw new HttpError(404, 'printer_not_found');
      if (b.width !== p.width_px) throw new HttpError(400, 'invalid_input', `ticket must be ${p.width_px} px wide`);
      if (bitmap.length !== Math.ceil(b.width / 8) * b.height) throw new HttpError(400, 'invalid_input', 'bitmap size does not match width × height');
      const j = await one(c, `INSERT INTO print_jobs (printer_id, kind, width, height, bitmap, kick_drawer, created_by)
                              VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`,
        [p.id, b.kind, b.width, b.height, bitmap, b.kickDrawer && p.kick_drawer, req.session.userId]);
      reply.status(201);
      return j;
    });
  });

  app.get('/api/print-jobs/:id', { preHandler: ctx.auth() }, async (req) => {
    const { id } = Id.parse(req.params);
    const j = await withTenant(ctx.db, req.session.tenantId, (c) => one(c,
      `SELECT id, status, error, attempts, created_at, finished_at FROM print_jobs WHERE id = $1`, [id]));
    if (!j) throw new HttpError(404, 'not_found');
    return j;
  });

  // ---------- jobs, from the agent ----------

  async function agentOf(req: FastifyRequest) {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token.startsWith(AGENT_PREFIX)) throw new HttpError(401, 'unauthenticated');
    const a = await withPlatform(ctx.db, (c) => one<{ id: string; tenant_id: string }>(c,
      `UPDATE print_agents SET last_seen_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, tenant_id`,
      [hashToken(token)]));
    if (!a) throw new HttpError(401, 'unauthenticated');
    return a;
  }

  // Claims the next jobs. Called every couple of seconds by each agent; SKIP LOCKED lets two agents share a shop.
  app.get('/api/agent/jobs', async (req) => {
    const agent = await agentOf(req);
    return withTenant(ctx.db, agent.tenant_id, async (c: Tx) => {
      await c.query(`UPDATE print_jobs SET status = 'failed', error = 'หมดเวลา: ไม่มีเครื่องพิมพ์รับงานภายใน ${EXPIRE_MINUTES} นาที', finished_at = now()
                      WHERE status = 'queued' AND created_at < now() - interval '${EXPIRE_MINUTES} minutes'`);
      await c.query(`UPDATE print_jobs SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
                            error = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'เครื่องพิมพ์ไม่ตอบ' ELSE error END,
                            finished_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() END
                      WHERE status = 'printing' AND claimed_at < now() - interval '${RECLAIM_SECONDS} seconds'`);
      const jobs = await many(c, `
        UPDATE print_jobs j SET status = 'printing', attempts = attempts + 1, claimed_at = now(), agent_id = $1
         WHERE j.id IN (SELECT id FROM print_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED)
        RETURNING j.id, j.printer_id, j.width, j.height, j.bitmap, j.kick_drawer, j.created_at`, [agent.id]);
      // RETURNING has no order of its own; tickets must come out in the order they were sent.
      jobs.sort((a, b) => a.created_at - b.created_at);
      if (jobs.length === 0) return { jobs: [] };
      const printers = new Map((await many(c, `SELECT id, host, port FROM printers WHERE id = ANY($1::uuid[])`,
        [jobs.map((j) => j.printer_id)])).map((p) => [p.id, p]));
      return {
        jobs: jobs.map((j) => ({
          id: j.id, host: printers.get(j.printer_id)!.host, port: printers.get(j.printer_id)!.port,
          width: j.width, height: j.height, kickDrawer: j.kick_drawer, bitmap: (j.bitmap as Buffer).toString('base64'),
        })),
      };
    });
  });

  app.post('/api/agent/jobs/:id', async (req) => {
    const agent = await agentOf(req);
    const { id } = Id.parse(req.params);
    const r = Result.parse(req.body);
    return withTenant(ctx.db, agent.tenant_id, async (c) => {
      // A failed attempt goes back to the queue until it has been tried MAX_ATTEMPTS times.
      const j = await one(c, `
        UPDATE print_jobs SET
          status = CASE WHEN $2 THEN 'done' WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
          error = CASE WHEN $2 THEN NULL ELSE $3 END,
          finished_at = CASE WHEN $2 OR attempts >= ${MAX_ATTEMPTS} THEN now() END
         WHERE id = $1 AND status = 'printing' AND agent_id = $4 RETURNING id, status`,
        [id, r.ok, r.error ?? 'print failed', agent.id]);
      if (!j) throw new HttpError(409, 'job_not_claimed');
      return j;
    });
  });
}
