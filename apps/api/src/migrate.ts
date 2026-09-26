import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Apply pending SQL migrations as the database owner, then set the app role's password. */
export async function migrate(adminUrl: string, appPassword: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(dir + f, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await client.query(`ALTER ROLE prakai_app PASSWORD ${client.escapeLiteral(appPassword)}`);
  } finally {
    await client.end();
  }
  return applied;
}
