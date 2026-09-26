import pg from 'pg';
import { migrate } from '../src/migrate.ts';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:devpass@127.0.0.1:5433';

/** Fresh database per run so tests never depend on leftovers. */
export default async function setup() {
  const c = new pg.Client({ connectionString: `${ADMIN}/postgres` });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS prakai_test WITH (FORCE)`);
  await c.query(`CREATE DATABASE prakai_test`);
  await c.end();
  await migrate(`${ADMIN}/prakai_test`, 'apppass');
}
