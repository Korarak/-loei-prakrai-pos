'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errText } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Sparkle } from '@/lib/ui';

// 0–4: length ≥ 8, length ≥ 12, mixed case/letters+digits, symbol
function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) s++;
  if (/[^a-zA-Z0-9]/.test(p)) s++;
  return s;
}
const LEVELS = ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรง'];
const COLORS = ['#B42318', '#B42318', '#B54708', '#1F7A4D', '#1F7A4D'];

const MODES = [
  { v: 'simple', title: 'แบบง่าย (แนะนำ)', desc: 'ขายของ รับเงิน ดูยอดขาย ไม่ต้องตั้งสต็อกหรือสูตร เหมาะกับร้านที่อยากเริ่มใช้ทันที' },
  { v: 'full', title: 'แบบเต็ม', desc: 'มีสต็อก สูตรต้นทุน ตัวเลือกเมนู ลูกค้าประจำ ค่าใช้จ่าย และรายงานกำไร/ภาษีครบ' },
] as const;

const TEMPLATES = [
  { v: 'aharn', title: 'อาหารตามสั่ง', desc: 'เมนูตัวอย่างพร้อมสูตรต้นทุน แก้ไขได้ทุกรายการ', simpleDesc: 'เมนูตัวอย่าง แก้ไขได้ทุกรายการ' },
  { v: 'steak', title: 'ร้านสเต็ก · ข้าวขาหมู · หมูกรอบ', desc: 'รวมเครื่องดื่มและแอลกอฮอล์ พร้อมสูตรและตัวเลือกเสริม', simpleDesc: 'รวมเครื่องดื่มและแอลกอฮอล์ แก้ไขได้ทุกรายการ' },
  { v: 'blank', title: 'เริ่มจากว่าง', desc: 'ตั้งค่าเมนูเองทั้งหมด', simpleDesc: 'ตั้งค่าเมนูเองทั้งหมด' },
];

const TRUST = [
  { icon: 'check', t: 'ใบกำกับภาษีและ VAT 7%', d: 'รองรับราคารวม/แยก VAT และตั้งค่าต่อเมนู' },
  { icon: 'key', t: 'ยืนยันตัวตนสองชั้น', d: 'เปิดใช้แอปยืนยันตัวตน (TOTP) ได้หลังสมัคร' },
  { icon: 'check', t: 'แยกข้อมูลรายร้าน', d: 'ข้อมูลของร้านคุณไม่ปะปนกับร้านอื่น' },
] as const;

export default function Signup() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [tpl, setTpl] = useState('aharn');
  const [mode, setMode] = useState<'simple' | 'full'>('simple');

  const score = strength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pw !== pw2) { setErr('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr('');
    try {
      await api('POST', '/api/auth/signup', {
        name: String(f.get('name') ?? '').trim(),
        phone: String(f.get('phone') ?? '').trim() || undefined,
        email: String(f.get('email') ?? '').trim(),
        password: pw,
        shopName: String(f.get('shopName') ?? '').trim(),
        tableCount: Number(f.get('tables') || 12),
        template: tpl,
        mode,
      });
      router.push('/pos');
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  }

  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, borderBottom: '1px solid var(--border, #E4E4E0)' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 };
  const h3: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 600 };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap' }}>
      <aside style={{ flex: '0 0 380px', background: '#14352A', color: '#E8F1EC', padding: 40, display: 'flex', flexDirection: 'column', gap: 28 }} className="no-print">
        <div className="brand" style={{ color: '#fff' }}><Sparkle /> ประกาย POS</div>
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 10px', color: '#fff' }}>ลงทะเบียนร้านค้า</h1>
          <p style={{ margin: 0, lineHeight: 1.7, opacity: 0.85 }}>
            ระบบขายหน้าร้าน ต้นทุนอาหาร และภาษีมูลค่าเพิ่มสำหรับร้านอาหาร
            ใช้เวลาตั้งค่าเบื้องต้นไม่เกิน 2 นาที
          </p>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {TRUST.map((x) => (
            <li key={x.t} style={{ display: 'flex', gap: 12 }}>
              <span style={{ marginTop: 2 }}><Icon name={x.icon} size={20} /></span>
              <span><strong style={{ display: 'block', color: '#fff' }}>{x.t}</strong><span style={{ opacity: 0.8, fontSize: 14 }}>{x.d}</span></span>
            </li>
          ))}
        </ul>
      </aside>

      <form onSubmit={submit} style={{ flex: '1 1 480px', padding: '48px clamp(20px, 5vw, 64px)', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 820 }}>
        <header>
          <h2 style={{ fontSize: 26, margin: '0 0 6px' }} className="display">สร้างบัญชีเจ้าของร้าน</h2>
          <p className="muted" style={{ margin: 0 }}>กรอกข้อมูลให้ครบ 4 ส่วน บัญชีนี้จะเป็นผู้ดูแลระบบของร้าน</p>
        </header>

        <section style={section} aria-labelledby="s1">
          <h3 id="s1" style={h3}>1. ข้อมูลผู้ดูแลระบบ</h3>
          <div style={grid}>
            <label className="field">ชื่อ–นามสกุล<input name="name" autoComplete="name" required /></label>
            <label className="field">เบอร์โทรศัพท์ (ไม่บังคับ)<input name="phone" type="tel" autoComplete="tel" placeholder="08x-xxx-xxxx" /></label>
            <label className="field">อีเมลสำหรับเข้าสู่ระบบ<input name="email" type="email" autoComplete="email" required /></label>
            <span />
            <label className="field">รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
              <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" required />
            </label>
            <label className="field">ยืนยันรหัสผ่าน
              <input type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required
                aria-invalid={mismatch} style={mismatch ? { borderColor: '#B42318' } : undefined} />
            </label>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {pw && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-live="polite">
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} style={{ width: 28, height: 6, borderRadius: 3, background: i < score ? COLORS[score] : '#D9D9D4' }} />
                  ))}
                </div>
                <span style={{ fontSize: 13, color: COLORS[score] }}>ความแข็งแรง: {LEVELS[score]}</span>
              </div>
            )}
            {mismatch && <span style={{ fontSize: 13, color: '#B42318' }}>รหัสผ่านไม่ตรงกัน</span>}
            <span className="spacer" />
            <label className="row" style={{ gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> แสดงรหัสผ่าน
            </label>
          </div>
        </section>

        <section style={section} aria-labelledby="s2">
          <h3 id="s2" style={h3}>2. ข้อมูลร้าน</h3>
          <div style={grid}>
            <label className="field">ชื่อร้าน<input name="shopName" required /></label>
            <label className="field">จำนวนโต๊ะ (แก้ไขภายหลังได้)<input name="tables" type="number" min={0} max={100} defaultValue={12} inputMode="numeric" /></label>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            ข้อมูลภาษี (ชื่อนิติบุคคล เลขประจำตัวผู้เสียภาษี และการจด VAT) ตั้งค่าได้ที่ “ตั้งค่าร้าน” หลังเข้าสู่ระบบ
          </p>
        </section>

        <section style={section} aria-labelledby="s3">
          <h3 id="s3" style={h3}>3. รูปแบบการใช้งาน</h3>
          <div role="radiogroup" aria-labelledby="s3" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {MODES.map((m) => {
              const on = mode === m.v;
              return (
                <label key={m.v} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', cursor: 'pointer',
                  borderRadius: 10, border: `1.5px solid ${on ? 'var(--accent)' : '#D9D9D4'}`,
                  background: on ? 'var(--accent-soft)' : 'transparent',
                }}>
                  <input type="radio" name="mode" value={m.v} checked={on} onChange={() => setMode(m.v)}
                    style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--accent)' }} />
                  <span><strong style={{ display: 'block' }}>{m.title}</strong><span className="muted" style={{ fontSize: 14 }}>{m.desc}</span></span>
                </label>
              );
            })}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>เปลี่ยนได้ทุกเมื่อที่ “ตั้งค่าร้าน” ข้อมูลที่กรอกไว้ไม่หาย</p>
        </section>

        <section style={{ ...section, borderBottom: 'none', paddingBottom: 0 }} aria-labelledby="s4">
          <h3 id="s4" style={h3}>4. เมนูเริ่มต้น</h3>
          <div role="radiogroup" aria-labelledby="s4" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TEMPLATES.map((t) => {
              const on = tpl === t.v;
              return (
                <label key={t.v} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', cursor: 'pointer',
                  borderRadius: 10, border: `1.5px solid ${on ? 'var(--accent)' : '#D9D9D4'}`,
                  background: on ? 'var(--accent-soft)' : 'transparent',
                }}>
                  <input type="radio" name="template" value={t.v} checked={on} onChange={() => setTpl(t.v)}
                    style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--accent)' }} />
                  <span><strong style={{ display: 'block' }}>{t.title}</strong><span className="muted" style={{ fontSize: 14 }}>{mode === 'simple' ? t.simpleDesc : t.desc}</span></span>
                </label>
              );
            })}
          </div>
        </section>

        <label className="row" style={{ minHeight: 48, alignItems: 'flex-start', gap: 10 }}>
          <input type="checkbox" required style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, lineHeight: 1.6 }}>
            ข้าพเจ้าเป็นเจ้าของหรือได้รับมอบอำนาจจากร้านนี้ และยอมรับเงื่อนไขการใช้งานกับนโยบายความเป็นส่วนตัว
            รวมถึงการเก็บและใช้ข้อมูลเพื่อให้บริการระบบ
          </span>
        </label>

        {err && <div className="error" role="alert">{err}</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Link href="/login" className="muted">มีบัญชีอยู่แล้ว? เข้าสู่ระบบ</Link>
          <span className="spacer" />
          <button className="btn btn-primary btn-lg" disabled={busy || mismatch} style={{ minWidth: 220 }}>
            {busy ? 'กำลังสร้างบัญชี…' : <><Icon name="check" size={22} /> สร้างบัญชีและเข้าสู่ระบบ</>}
          </button>
        </div>
      </form>
    </main>
  );
}
