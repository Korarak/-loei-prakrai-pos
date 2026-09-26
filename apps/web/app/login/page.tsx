'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sparkle } from '@/lib/ui';

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr('');
    try {
      await api('POST', '/api/auth/login', { email: f.get('email'), password: f.get('password') });
      router.push('/pos');
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 420, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row"><Sparkle /><h1 style={{ margin: 0, fontSize: 28 }}>ประกาย POS</h1></div>
        <label className="field">อีเมล<input name="email" type="email" autoComplete="email" required /></label>
        <label className="field">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required /></label>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        <div className="muted" style={{ textAlign: 'center' }}>ยังไม่มีร้าน? <Link href="/signup">เปิดร้านกับเรา</Link></div>
      </form>
    </main>
  );
}
