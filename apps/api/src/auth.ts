import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';

export interface Session {
  userId: string;
  tenantId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: Session;
  }
}

export const COOKIE = 'prakai_session';

export const hashSecret = (s: string) => hash(s);
export const checkSecret = (h: string, s: string) => verify(h, s).catch(() => false);

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function makeTokens(secret: string) {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(s: Session): Promise<string> {
      return new SignJWT({ tid: s.tenantId, role: s.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(s.userId)
        .setIssuedAt()
        .setExpirationTime('12h')
        .sign(key);
    },
    async verify(token: string): Promise<Session | null> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        return { userId: payload.sub!, tenantId: payload.tid as string, role: payload.role as Role };
      } catch {
        return null;
      }
    },
  };
}

const RANK: Record<Role, number> = { kitchen: 0, waiter: 1, cashier: 2, manager: 3, owner: 4 };

/** Allowed roles, or `atLeast('manager')` for a hierarchy check. */
export const atLeast = (r: Role): Role[] => (Object.keys(RANK) as Role[]).filter((x) => RANK[x] >= RANK[r]);

export function guard(tokens: ReturnType<typeof makeTokens>, roles?: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const token = bearer ?? req.cookies[COOKIE];
    const s = token ? await tokens.verify(token) : null;
    if (!s) throw new HttpError(401, 'unauthenticated');
    if (roles && !roles.includes(s.role)) throw new HttpError(403, 'forbidden');
    req.session = s;
  };
}
