import pg from 'pg';

// bigint (int8) columns hold satang; well inside Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric(14,4) holds stock quantities in g/ml/pc; 4 decimals fit a double exactly enough.
pg.types.setTypeParser(1700, (v) => Number(v));
// date columns stay 'YYYY-MM-DD': a JS Date would shift Thai calendar days across the UTC boundary.
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url: string, max = 10): Db {
  return new pg.Pool({ connectionString: url, max });
}

async function inTx<T>(db: Db, tenantId: string | null, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Run with RLS scoped to one shop. Every shop-data query must go through here. */
export const withTenant = <T>(db: Db, tenantId: string, fn: (c: Tx) => Promise<T>) => inTx(db, tenantId, fn);

/** Platform-level transaction (users, tenants) — no shop data is visible. */
export const withPlatform = <T>(db: Db, fn: (c: Tx) => Promise<T>) => inTx(db, null, fn);

export async function one<T = any>(c: Tx, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await c.query(sql, params);
  return r.rows[0] as T | undefined;
}

export async function many<T = any>(c: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await c.query(sql, params);
  return r.rows as T[];
}

export async function audit(c: Tx, userId: string | null, action: string, entity: string, entityId: string | null, detail?: unknown) {
  await c.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entity, entityId, detail === undefined ? null : JSON.stringify(detail)],
  );
}
