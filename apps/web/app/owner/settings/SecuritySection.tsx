'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';

interface Status { enabled: boolean; recoveryLeft: number; hasPassword: boolean }

/** ยืนยันตัวตนสองขั้น (แอป Google Authenticator / Microsoft Authenticator ฯลฯ) สำหรับคนที่เข้าด้วยอีเมลและรหัสผ่าน */
export function SecuritySection({ isOwner }: { isOwner: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState({ open: false, password: '', code: '' });
  const [err, setErr] = useState('');

  const load = () => api<Status>('GET', '/api/auth/totp').then(setSt).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  async function start() {
    setErr('');
    try {
      const s = await api<{ secret: string; uri: string }>('POST', '/api/auth/totp/setup');
      setSetup({ ...s, svg: await QRCode.toString(s.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
    } catch (e) { setErr(errText(e)); }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/api/auth/totp/enable', { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
    } catch (x) { setErr(errText(x)); setCode(''); }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api('POST', '/api/auth/totp/disable', { password: off.password, code: off.code });
      setOff({ open: false, password: '', code: '' });
      setCodes(null);
      load();
    } catch (x) { setErr(errText(x)); }
  }

  if (!st || !st.hasPassword) return null;
  return (
    <section className="card" style={{ padding: 18, display: 'grid', gap: 12 }} aria-labelledby="security-h">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 id="security-h" style={{ margin: 0, fontSize: 20 }}>ยืนยันตัวตนสองขั้น</h2>
        <span className="pill" style={{ background: st.enabled ? 'var(--accent-soft)' : 'var(--warn-soft)', color: st.enabled ? 'var(--accent-ink)' : 'var(--warn-ink)' }}>
          {st.enabled ? `เปิดใช้อยู่ · รหัสกู้คืนเหลือ ${st.recoveryLeft}` : 'ยังไม่เปิดใช้'}
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
        เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน แล้วใส่รหัส 6 หลักจากแอปในโทรศัพท์ (Google Authenticator, Microsoft Authenticator ฯลฯ)
        แม้รหัสผ่านหลุด คนอื่นก็เข้าไม่ได้{isOwner ? ' · แนะนำให้เจ้าของร้านเปิดใช้ก่อนเริ่มขายจริง' : ''} · พนักงานที่เข้าด้วย PIN บนเครื่องที่ลงทะเบียนไม่ต้องใช้
      </p>

      {!st.enabled && !setup && <div><button className="btn btn-outline" onClick={start}>เปิดใช้ยืนยันตัวตนสองขั้น</button></div>}

      {setup && (
        <form onSubmit={confirm} style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div role="img" aria-label="QR สำหรับเพิ่มบัญชีในแอปยืนยันตัวตน" style={{ width: 200, height: 200, background: '#fff', padding: 6, borderRadius: 10, border: '1px solid var(--line)' }}
            dangerouslySetInnerHTML={{ __html: setup.svg }} />
          <div style={{ display: 'grid', gap: 10, flex: '1 1 260px' }}>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
              <li>เปิดแอปยืนยันตัวตน กด “+” แล้วสแกน QR นี้</li>
              <li>สแกนไม่ได้? กรอกรหัสนี้เอง: <code style={{ wordBreak: 'break-all' }}>{setup.secret.match(/.{1,4}/g)!.join(' ')}</code></li>
              <li>ใส่รหัส 6 หลักที่แอปแสดง เพื่อยืนยัน</li>
            </ol>
            <label className="field" style={{ maxWidth: 220 }}>รหัส 6 หลัก
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
                style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }} autoFocus /></label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={code.length !== 6}>ยืนยันและเปิดใช้</button>
              <button type="button" className="btn" onClick={() => { setSetup(null); setCode(''); }}>ยกเลิก</button>
            </div>
          </div>
        </form>
      )}

      {codes && (
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn-ink)', display: 'grid', gap: 8 }}>
          <b>รหัสกู้คืน — จดหรือพิมพ์เก็บไว้ตอนนี้ (แสดงครั้งเดียว)</b>
          <span style={{ fontSize: 14 }}>ใช้แทนรหัสจากแอปได้รหัสละครั้ง เมื่อโทรศัพท์หายหรือเปลี่ยนเครื่อง</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6, fontFamily: 'ui-monospace, monospace', fontSize: 18, color: 'var(--ink)' }}>
            {codes.map((c) => <span key={c} style={{ background: '#fff', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>{c}</span>)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>คัดลอก</button>
            <button className="btn" onClick={() => setCodes(null)}>เก็บแล้ว</button>
          </div>
        </div>
      )}

      {st.enabled && !off.open && <div><button className="btn btn-warn" onClick={() => setOff({ ...off, open: true })}>ปิดยืนยันตัวตนสองขั้น</button></div>}
      {st.enabled && off.open && (
        <form onSubmit={disable} className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ width: 220 }}>รหัสผ่าน
            <input type="password" autoComplete="current-password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} required /></label>
          <label className="field" style={{ width: 200 }}>รหัสจากแอป หรือรหัสกู้คืน
            <input value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} autoComplete="one-time-code" required /></label>
          <button className="btn btn-warn" style={{ minHeight: 50 }}>ยืนยันปิดใช้</button>
          <button type="button" className="btn" style={{ minHeight: 50 }} onClick={() => setOff({ open: false, password: '', code: '' })}>ยกเลิก</button>
        </form>
      )}
      {err && <div className="error" role="alert">{err}</div>}
    </section>
  );
}
