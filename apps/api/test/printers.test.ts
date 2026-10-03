import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, makeApp, newShop } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

type Shop = Awaited<ReturnType<typeof newShop>>;

const agentCall = async (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

async function setup(s: Shop, printer: Record<string, unknown> = {}) {
  const p = await s.call('POST', '/api/printers', { name: 'หน้าร้าน', host: '192.168.1.50', role: 'receipt', ...printer });
  expect(p.status).toBe(201);
  const a = await s.call('POST', '/api/print-agents', { name: 'คอมเคาน์เตอร์' });
  expect(a.status).toBe(201);
  expect(a.body.token).toMatch(/^pa_/);
  return { printer: p.body, token: a.body.token as string };
}

/** A 576 × 2 ticket: first row black, second white. */
const ticket = (printerId: string, extra: Record<string, unknown> = {}) => ({
  printerId, kind: 'receipt', width: 576, height: 2, bitmap: Buffer.concat([Buffer.alloc(72, 0xff), Buffer.alloc(72, 0)]).toString('base64'), ...extra,
});

async function age(jobId: string, sql: string) {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { await c.query(`UPDATE print_jobs SET ${sql} WHERE id = $1`, [jobId]); } finally { await c.end(); }
}

describe('LAN printers and the print agent', () => {
  it('queues a ticket, hands it to the agent with the printer address, and records the result', async () => {
    const s = await newShop(app);
    const { printer, token } = await setup(s);
    const list = (await s.call('GET', '/api/printers')).body;
    expect(list.printers).toHaveLength(1);
    expect(list.agentLastSeen).toBeNull();

    const job = await s.call('POST', '/api/print-jobs', ticket(printer.id));
    expect(job.status).toBe(201);
    expect(job.body.status).toBe('queued');

    const claim = await agentCall(token, 'GET', '/api/agent/jobs');
    expect(claim.status).toBe(200);
    expect(claim.body.jobs).toHaveLength(1);
    expect(claim.body.jobs[0]).toMatchObject({ id: job.body.id, host: '192.168.1.50', port: 9100, width: 576, height: 2, kickDrawer: false });
    expect(Buffer.from(claim.body.jobs[0].bitmap, 'base64')[0]).toBe(0xff);
    // claimed jobs are not handed out twice
    expect((await agentCall(token, 'GET', '/api/agent/jobs')).body.jobs).toHaveLength(0);

    expect((await agentCall(token, 'POST', `/api/agent/jobs/${job.body.id}`, { ok: true })).body.status).toBe('done');
    expect((await s.call('GET', `/api/print-jobs/${job.body.id}`)).body.status).toBe('done');
    expect((await s.call('GET', '/api/printers')).body.agentLastSeen).not.toBeNull();
  });

  it('retries a failed print up to three times, then gives up with the error', async () => {
    const s = await newShop(app);
    const { printer, token } = await setup(s);
    const job = (await s.call('POST', '/api/print-jobs', ticket(printer.id))).body;
    for (let i = 1; i <= 3; i++) {
      const claim = (await agentCall(token, 'GET', '/api/agent/jobs')).body;
      expect(claim.jobs).toHaveLength(1);
      const r = (await agentCall(token, 'POST', `/api/agent/jobs/${job.id}`, { ok: false, error: 'ต่อเครื่องพิมพ์ไม่ได้' })).body;
      expect(r.status).toBe(i < 3 ? 'queued' : 'failed');
    }
    const j = (await s.call('GET', `/api/print-jobs/${job.id}`)).body;
    expect(j).toMatchObject({ status: 'failed', error: 'ต่อเครื่องพิมพ์ไม่ได้', attempts: 3 });
  });

  it('drops tickets nobody picked up within 10 minutes and re-queues jobs an agent never reported', async () => {
    const s = await newShop(app);
    const { printer, token } = await setup(s);
    const old = (await s.call('POST', '/api/print-jobs', ticket(printer.id))).body;
    await age(old.id, `created_at = now() - interval '11 minutes'`);
    const stuck = (await s.call('POST', '/api/print-jobs', ticket(printer.id))).body;
    expect((await agentCall(token, 'GET', '/api/agent/jobs')).body.jobs.map((j: any) => j.id)).toEqual([stuck.id]);
    expect((await s.call('GET', `/api/print-jobs/${old.id}`)).body.status).toBe('failed');

    await age(stuck.id, `claimed_at = now() - interval '2 minutes'`);
    expect((await agentCall(token, 'GET', '/api/agent/jobs')).body.jobs.map((j: any) => j.id)).toEqual([stuck.id]);
  });

  it('opens the cash drawer only on a printer wired to one', async () => {
    const s = await newShop(app);
    const { printer, token } = await setup(s, { kickDrawer: true });
    const other = (await s.call('POST', '/api/printers', { name: 'ครัว', host: '192.168.1.51', role: 'kitchen', kickDrawer: true })).body;
    expect(other.kick_drawer).toBe(true);
    await s.call('POST', '/api/print-jobs', ticket(printer.id, { kickDrawer: true }));
    await s.call('POST', '/api/print-jobs', ticket(printer.id));
    const jobs = (await agentCall(token, 'GET', '/api/agent/jobs')).body.jobs;
    expect(jobs.map((j: any) => j.kickDrawer)).toEqual([true, false]);
  });

  it('rejects a bitmap that does not match the printer width or its own size', async () => {
    const s = await newShop(app);
    const { printer } = await setup(s, { widthPx: 384 });
    expect((await s.call('POST', '/api/print-jobs', ticket(printer.id))).status).toBe(400);
    expect((await s.call('POST', '/api/print-jobs', ticket(printer.id, { width: 384, height: 4 }))).status).toBe(400);
    expect((await s.call('POST', '/api/print-jobs', { ...ticket(printer.id), width: 384, bitmap: Buffer.alloc(96).toString('base64') })).status).toBe(201);
  });

  it("keeps each shop's jobs to its own agent, and a revoked token stops working", async () => {
    const a = await newShop(app);
    const b = await newShop(app);
    const sa = await setup(a);
    const sb = await setup(b);
    await a.call('POST', '/api/print-jobs', ticket(sa.printer.id));
    expect((await agentCall(sb.token, 'GET', '/api/agent/jobs')).body.jobs).toHaveLength(0);
    expect((await b.call('POST', '/api/print-jobs', ticket(sa.printer.id))).status).toBe(404);

    const agents = (await a.call('GET', '/api/print-agents')).body;
    await a.call('POST', `/api/print-agents/${agents[0].id}/revoke`);
    expect((await agentCall(sa.token, 'GET', '/api/agent/jobs')).status).toBe(401);
    expect((await agentCall('pa_not-a-token', 'GET', '/api/agent/jobs')).status).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/agent/jobs' })).statusCode).toBe(401);
  });

  it('validates the printer address and paper width', async () => {
    const s = await newShop(app);
    expect((await s.call('POST', '/api/printers', { name: 'x', host: 'bad host!', role: 'receipt' })).status).toBe(400);
    expect((await s.call('POST', '/api/printers', { name: 'x', host: '10.0.0.9', role: 'receipt', widthPx: 500 })).status).toBe(400);
  });
});
