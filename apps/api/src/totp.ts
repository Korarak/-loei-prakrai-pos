import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238) with the settings every authenticator app understands: SHA-1, 6 digits, 30 s steps.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digits).padStart(digits, '0');
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

/**
 * The time step `code` belongs to, or null. One step either side is accepted for phone clocks that drift;
 * a step at or before `lastStep` is refused so an observed code cannot be used again.
 */
export function checkTotp(secret: string, code: string, now = Date.now(), lastStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const step = Math.floor(now / 1000 / STEP);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) return s;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer = 'Prakai POS') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

/** Recovery codes look like `k7m2-q9xa`; stored as sha256 so a database copy does not reveal them. */
export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
}
export const hashRecovery = (code: string) => createHash('sha256').update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
