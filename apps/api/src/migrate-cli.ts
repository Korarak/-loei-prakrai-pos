import { migrate } from './migrate.ts';

const applied = await migrate(process.env.DATABASE_ADMIN_URL!, process.env.APP_DB_PASSWORD!);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
