import { buildApp } from './app.ts';
import { createPool } from './db.ts';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const app = buildApp({
  db: createPool(need('DATABASE_URL')),
  jwtSecret: need('JWT_SECRET'),
  platformAdmins: (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  secureCookies: process.env.NODE_ENV === 'production',
  logger: true,
});
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 4000) });
