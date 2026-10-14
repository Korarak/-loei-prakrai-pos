'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Sparkle } from '@/lib/ui';

interface Lock { device: { id: string; name: string }; shop: string; staff: { id: string; name: string; role: string }[] }

const ROLE: Record<string, string> = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', waiter: 'พนักงานเสิร์ฟ', kitchen: 'ครัว' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'ลบ'];

/** The lock screen of a registered till: tap your name, type your 6-digit PIN. */
export default function Pin() {
  const router = useRouter();
  const [lock, setLock] = useState<Lock | null>(null);
  const [who, setWho] = useState<Lock['staff'][number] | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Lock>('GET', '/api/auth/device').then(setLock).catch(() => router.replace('/login'));
  }, [router]);

  const submit = useCallback(async (code: string) => {
    if (!who) return;
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/auth/pin', { userId: who.id, pin: code });
      router.push('/pos');
    } catch (e) {
      setErr(errText(e)); setPin(''); setBusy(false);
    }
  }, [who, router]);

  const press = useCallback((k: string) => {
    if (busy) return;
    if (k === 'ลบ') return setPin((p) => p.slice(0, -1));
    if (!/^\d$/.test(k) || pin.length >= 6) return;
    // Submit outside the state updater: StrictMode runs updaters twice, which would send the PIN twice.
    const next = pin + k;
    setPin(next);
    if (next.length === 6) void submit(next);
  }, [busy, pin, submit]);

  // A hardware keyboard works too.
  useEffect(() => {
    if (!who) return;
    const on = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('ลบ'); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [who, press]);

  if (!lock) return <main style={{ padding: 40 }} className="muted">กำลังโหลด…</main>;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: who ? 420 : 760, padding: 28, display: 'grid', gap: 18 }}>
        <div className="row">
          <Sparkle />
          <div>
            <h1 style={{ margin: 0, fontSize: 26 }}>{lock.shop}</h1>
            <div className="muted" style={{ fontSize: 14 }}>{lock.device.name}</div>
          </div>
        </div>

        {!who ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600 }}>ใครกำลังใช้งาน</div>
            {lock.staff.length === 0 && <div className="error">ยังไม่มีพนักงานที่ตั้ง PIN ให้เจ้าของร้านเพิ่มพนักงานในหน้าหลังบ้าน</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {lock.staff.map((s) => (
                <button key={s.id} className="btn" onClick={() => { setWho(s); setPin(''); setErr(''); }}
                  style={{ height: 96, flexDirection: 'column', gap: 2, fontSize: 19, borderRadius: 16 }}>
                  {s.name}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>{ROLE[s.role]}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <button className="btn" onClick={() => { setWho(null); setErr(''); }}><Icon name="back" /> เปลี่ยนคน</button>
              <div style={{ fontSize: 18 }}><b>{who.name}</b> <span className="muted">· {ROLE[who.role]}</span></div>
            </div>
            <div aria-label={`ใส่แล้ว ${pin.length} จาก 6 หลัก`} role="status" style={{ display: 'flex', justifyContent: 'center', gap: 14, padding: '6px 0' }}>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} style={{ width: 18, height: 18, borderRadius: 9, border: '2px solid var(--accent)', background: i < pin.length ? 'var(--accent)' : 'transparent' }} />
              ))}
            </div>
            {err && <div className="error" role="alert">{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {KEYS.map((k, i) => k === '' ? <span key={i} /> : (
                <button key={i} className="btn" disabled={busy} onClick={() => press(k)} aria-label={k === 'ลบ' ? 'ลบตัวเลขสุดท้าย' : `เลข ${k}`}
                  style={{ height: 68, fontSize: 26, borderRadius: 16 }}>{k}</button>
              ))}
            </div>
          </>
        )}
        <div className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
          เจ้าของร้าน <Link href="/login">เข้าด้วยอีเมลและรหัสผ่าน</Link>
        </div>
      </div>
    </main>
  );
}
