'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sparkle } from '@/lib/ui';

type LoginResult = { totpRequired: true; challenge: string } | { token: string };

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Set after a correct password when the account uses an authenticator app.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr('');
    try {
      const r = await api<LoginResult>('POST', '/api/auth/login', { email: f.get('email'), password: f.get('password') });
      if ('totpRequired' in r) { setChallenge(r.challenge); setBusy(false); return; }
      router.push('/pos');
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('POST', '/api/auth/login/totp', { challenge, code });
      router.push('/pos');
    } catch (x) {
      setErr(errText(x));
      setCode('');
      setBusy(false);
      if ((x as { code?: string }).code === 'challenge_expired') setChallenge(null);
    }
  }

  const card: React.CSSProperties = { width: '100%', maxWidth: 420, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 };
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      {!challenge ? (
        <form onSubmit={submit} className="card" style={card}>
          <div className="row"><Sparkle /><h1 style={{ margin: 0, fontSize: 28 }}>ประกาย POS</h1></div>
          <label className="field">อีเมล<input name="email" type="email" autoComplete="email" required /></label>
          <label className="field">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
          <div className="muted" style={{ textAlign: 'center' }}>ยังไม่มีร้าน? <Link href="/signup">เปิดร้านกับเรา</Link></div>
        </form>
      ) : (
        <form onSubmit={submitCode} className="card" style={card}>
          <div className="row"><Sparkle /><h1 style={{ margin: 0, fontSize: 24 }}>ยืนยันตัวตน</h1></div>
          <p className="muted" style={{ margin: 0 }}>
            {recovery ? 'ใส่รหัสกู้คืนหนึ่งรหัส (ใช้ได้ครั้งเดียว)' : 'เปิดแอปยืนยันตัวตนในโทรศัพท์ แล้วใส่รหัส 6 หลักของ ประกาย POS'}
          </p>
          <label className="field">{recovery ? 'รหัสกู้คืน' : 'รหัส 6 หลัก'}
            {recovery
              ? <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxx-xxxx" autoComplete="off" autoFocus required />
              : <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
                  autoComplete="one-time-code" pattern="\d{6}" placeholder="123456" autoFocus required
                  style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }} />}
          </label>
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy || (!recovery && code.length !== 6)}>{busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน'}</button>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn" onClick={() => { setRecovery(!recovery); setCode(''); setErr(''); }}>
              {recovery ? 'ใช้รหัสจากแอป' : 'ไม่มีโทรศัพท์? ใช้รหัสกู้คืน'}</button>
            <button type="button" className="btn" onClick={() => { setChallenge(null); setCode(''); setErr(''); }}>ย้อนกลับ</button>
          </div>
        </form>
      )}
    </main>
  );
}
