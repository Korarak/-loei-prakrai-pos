import { createHash, randomBytes } from 'node:crypto';
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
/** Long-lived cookie that marks a device the owner registered for PIN sign-in. */
export const DEVICE_COOKIE = 'prakai_device';

export const newDeviceToken = () => randomBytes(32).toString('base64url');
/** Device tokens are 256-bit random, so a fast hash is enough (no brute force to slow down). */
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

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
        if (payload.purpose || typeof payload.tid !== 'string') return null;   // a sign-in challenge is not a session
        return { userId: payload.sub!, tenantId: payload.tid, role: payload.role as Role };
      } catch {
        return null;
      }
    },
    /** Proof that the password was right, good for 5 minutes to enter the authenticator code. */
    async signChallenge(userId: string): Promise<string> {
      return new SignJWT({ purpose: 'totp' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
        .setIssuedAt().setExpirationTime('5m').sign(key);
    },
    async verifyChallenge(token: string): Promise<string | null> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        return payload.purpose === 'totp' ? payload.sub! : null;
      } catch {
        return null;
      }
    },
  };
}

const RANK: Record<Role, number> = { kitchen: 0, waiter: 1, cashier: 2, manager: 3, owner: 4 };

/** Allowed roles, or `atLeast('manager')` for a hierarchy check. */
export const atLeast = (r: Role): Role[] => (Object.keys(RANK) as Role[]).filter((x) => RANK[x] >= RANK[r]);

/**
 * Checks the session, then that the person is still an active member with that role:
 * deactivating a staff member or changing their role takes effect on their next request.
 */
export function guard(tokens: ReturnType<typeof makeTokens>, member: (s: Session) => Promise<Role | null>, roles?: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const token = bearer ?? req.cookies[COOKIE];
    const s = token ? await tokens.verify(token) : null;
    if (!s) throw new HttpError(401, 'unauthenticated');
    const role = await member(s);
    if (!role) throw new HttpError(401, 'unauthenticated');
    s.role = role;
    if (roles && !roles.includes(s.role)) throw new HttpError(403, 'forbidden');
    req.session = s;
  };
}
