'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sparkle } from '@/lib/ui';

export default function Signup() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr('');
    try {
      await api('POST', '/api/auth/signup', {
        name: f.get('name'), phone: f.get('phone') || undefined, email: f.get('email'),
        password: f.get('password'), shopName: f.get('shopName'),
        tableCount: Number(f.get('tables') || 12), template: f.get('template'),
      });
      router.push('/pos');
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex' }}>
      <aside style={{ width: 380, background: 'var(--accent-soft)', padding: 40, display: 'flex', flexDirection: 'column', gap: 20 }} className="no-print">
        <div className="brand"><Sparkle /> prakai-pos</div>
        <h1 style={{ fontSize: 30, margin: 0 }}>เปิดร้านกับเรา</h1>
        <p style={{ color: '#1F4F37', lineHeight: 1.6 }}>เริ่มจากเมนูตัวอย่าง แก้ชื่อและราคาได้ภายหลัง ตั้งค่า VAT ได้ในหน้าตั้งค่าร้าน</p>
      </aside>
      <form onSubmit={submit} style={{ flex: 1, padding: '48px 64px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
        <h2 style={{ fontSize: 28, margin: 0 }} className="display">สร้างบัญชีเจ้าของร้าน</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <label className="field">ชื่อ–นามสกุล<input name="name" autoComplete="name" required /></label>
          <label className="field">เบอร์มือถือ<input name="phone" type="tel" autoComplete="tel" placeholder="08x-xxx-xxxx" /></label>
          <label className="field">อีเมล<input name="email" type="email" autoComplete="email" required /></label>
          <label className="field">ตั้งรหัสผ่าน (อย่างน้อย 8 ตัว)<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label className="field">ชื่อร้าน<input name="shopName" required /></label>
          <label className="field">จำนวนโต๊ะ<input name="tables" type="number" min={0} max={100} defaultValue={12} inputMode="numeric" /></label>
          <label className="field">เมนูเริ่มต้น
            <select name="template" defaultValue="aharn">
              <option value="steak">ร้านสเต็ก · ข้าวขาหมู · หมูกรอบ + เครื่องดื่ม/แอลกอฮอล์ (พร้อมสูตรและตัวเลือก)</option>
              <option value="aharn">เมนูตัวอย่าง (อาหารตามสั่ง)</option>
              <option value="blank">เริ่มจากว่าง</option>
            </select>
          </label>
        </div>
        <label className="row" style={{ minHeight: 48 }}>
          <input type="checkbox" required style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} />
          ยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
        </label>
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row">
          <Link href="/login" className="muted">มีบัญชีแล้ว? เข้าสู่ระบบ</Link>
          <span className="spacer" />
          <button className="btn btn-primary btn-lg" disabled={busy} style={{ minWidth: 220 }}>{busy ? 'กำลังสร้างร้าน…' : 'สร้างร้าน'}</button>
        </div>
      </form>
    </main>
  );
}
