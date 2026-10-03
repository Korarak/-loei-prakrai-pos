import type { FastifyRequest } from 'fastify';
import { DEVICE_COOKIE, hashToken } from './auth.ts';
import { one, withPlatform, type Db } from './db.ts';

export interface DeviceRow { id: string; tenant_id: string; terminal_id: string | null; name: string }

/** The registered device this request comes from, if its cookie is valid and not revoked. */
export async function deviceOf(db: Db, req: FastifyRequest): Promise<DeviceRow | null> {
  const token = req.cookies[DEVICE_COOKIE];
  if (!token) return null;
  return (await withPlatform(db, (c) => one<DeviceRow>(c,
    `SELECT id, tenant_id, terminal_id, name FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(token)]))) ?? null;
}
