import { afterAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, checkTotp, hotp } from '../src/totp.ts';
import { makeApp } from './helpers.ts';

const { app, db } = makeApp();
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('TOTP (RFC 6238)', () => {
  const key = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'],
  ])('SHA-1 test vector at T=%i', (t, code) => {
    expect(hotp(key, Math.floor(t / 30), 8)).toBe(code);
  });

  it('round-trips base32 like authenticator apps expect', () => {
    expect(base32Encode(key)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').equals(key)).toBe(true);
  });

  it('accepts one step of clock drift but not two, and never a step already used', () => {
    const secret = base32Encode(key);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const at = (s: number) => hotp(key, s);
    expect(checkTotp(secret, at(step), now)).toBe(step);
    expect(checkTotp(secret, at(step - 1), now)).toBe(step - 1);
    expect(checkTotp(secret, at(step + 1), now)).toBe(step + 1);
    expect(checkTotp(secret, at(step - 2), now)).toBeNull();
    expect(checkTotp(secret, at(step), now, step)).toBeNull();
    expect(checkTotp(secret, '12345', now)).toBeNull();
  });
});

let n = 0;
async function owner() {
  n++;
  const email = `totp${n}-${Date.now()}@test.local`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { name: 'เจ้าของ', email, password: 'password123', shopName: 'ร้าน 2FA', tableCount: 1 } });
  const token = r.json().token as string;
  const call = async (method: string, url: string, payload?: unknown, bearer = token) => {
    const x = await app.inject({ method: method as any, url, payload: payload as any, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
    return { status: x.statusCode, body: x.body ? x.json() : null };
  };
  const login = (password = 'password123') => call('POST', '/api/auth/login', { email, password }, '');
  return { call, login, email };
}

const codeAt = (secret: string, offset = 0) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + offset);

describe('two-step sign-in', () => {
  it('sets up an authenticator, then asks for its code after the password', async () => {
    const o = await owner();
    expect((await o.call('GET', '/api/auth/totp')).body).toMatchObject({ enabled: false, hasPassword: true });
    const setup = (await o.call('POST', '/api/auth/totp/setup')).body;
    expect(setup.uri).toContain('otpauth://totp/');
    expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect((await o.call('POST', '/api/auth/totp/enable', { code: '000000' })).status).toBe(400);
    const en = await o.call('POST', '/api/auth/totp/enable', { code: codeAt(setup.secret) });
    expect(en.status).toBe(200);
    expect(en.body.recoveryCodes).toHaveLength(8);

    const first = await o.login();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ totpRequired: true });
    expect(first.body.token).toBeUndefined();
    // the challenge is not a session
    expect((await o.call('GET', '/api/me', undefined, first.body.challenge)).status).toBe(401);

    expect((await o.call('POST', '/api/auth/login/totp', { challenge: first.body.challenge, code: '123456' }, '')).body.error).toBe('invalid_code');
    const code = codeAt(setup.secret, 1);
    const ok = await o.call('POST', '/api/auth/login/totp', { challenge: first.body.challenge, code }, '');
    expect(ok.status).toBe(200);
    expect((await o.call('GET', '/api/me', undefined, ok.body.token)).status).toBe(200);
    // the same code cannot be used twice
    expect((await o.call('POST', '/api/auth/login/totp', { challenge: first.body.challenge, code }, '')).status).toBe(401);

    // a recovery code works once, typed any way
    const rc = en.body.recoveryCodes[0].toUpperCase().replace('-', ' ');
    expect((await o.call('POST', '/api/auth/login/totp', { challenge: first.body.challenge, code: rc }, '')).status).toBe(200);
    expect((await o.call('POST', '/api/auth/login/totp', { challenge: first.body.challenge, code: rc }, '')).status).toBe(401);
    expect((await o.call('GET', '/api/auth/totp')).body.recoveryLeft).toBe(7);

    // turning it off needs the password and a second factor
    expect((await o.call('POST', '/api/auth/totp/disable', { password: 'wrong-pass', code: en.body.recoveryCodes[1] })).status).toBe(401);
    expect((await o.call('POST', '/api/auth/totp/disable', { password: 'password123', code: en.body.recoveryCodes[1] })).status).toBe(200);
    expect((await o.login()).body.token).toBeDefined();
  });

  it('locks sign-in for 15 minutes after 10 wrong passwords in a row', async () => {
    const o = await owner();
    for (let i = 0; i < 9; i++) expect((await o.login('wrong-pass')).status).toBe(401);
    expect((await o.login()).status).toBe(200);             // a success resets the count
    for (let i = 0; i < 10; i++) await o.login('wrong-pass');
    const locked = await o.login();
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('login_locked');
  });

  it('refuses a made-up or expired challenge', async () => {
    const o = await owner();
    expect((await o.call('POST', '/api/auth/login/totp', { challenge: 'not-a-jwt', code: '123456' }, '')).body.error).toBe('challenge_expired');
    // a real session token is not a challenge either
    const s = (await o.login()).body.token;
    expect((await o.call('POST', '/api/auth/login/totp', { challenge: s, code: '123456' }, '')).body.error).toBe('challenge_expired');
  });
});
