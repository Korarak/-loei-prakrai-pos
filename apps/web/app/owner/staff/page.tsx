'use client';

import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';
import { Sheet } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

const ROLE: Record<string, string> = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', waiter: 'พนักงานเสิร์ฟ', kitchen: 'ครัว' };
const ROLE_CAN: Record<string, string> = {
  manager: 'ทุกอย่างยกเว้นตั้งค่าภาษีและพนักงาน · อนุมัติยกเลิกบิล ส่วนลดเกิน 10%',
  cashier: 'เปิดโต๊ะ สั่งอาหาร รับชำระ ออกใบเสร็จ/ใบกำกับภาษี',
  waiter: 'เปิดโต๊ะ สั่งอาหาร ส่งครัว (รับเงินไม่ได้)',
  kitchen: 'ดูผังโต๊ะและออเดอร์',
};
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
/** Same rule as the server: 6 digits, not all the same, not a straight run like 123456 or 654321. */
const pinWeak = (p: string) => /^(\d)\1{5}$/.test(p) || '0123456789012'.includes(p) || '9876543210987'.includes(p);
const pinOk = (p: string) => /^\d{6}$/.test(p) && !pinWeak(p);

type Panel = null | { staff: any | 'new' } | 'device' | 'terminal';

export default function Staff() {
  const confirm = useConfirm();
  const { me, reload } = useMe();
  const [staff, setStaff] = useState<any[] | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => Promise.all([api('GET', '/api/staff').then(setStaff), api('GET', '/api/devices').then(setDevices)])
    .catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);
  const done = (text: string) => { setPanel(null); setMsg(text); load(); reload(); };

  const owner = me?.role === 'owner';
  const termName = (id: string | null) => me?.terminals.find((t) => t.id === id)?.name ?? 'ไม่ผูก';

  async function revoke(d: any) {
    if (!(await confirm({ title: `ยกเลิกเครื่อง ${d.name}?`, body: 'เครื่องนี้จะเข้าด้วย PIN ไม่ได้อีก', confirm: 'ยกเลิกเครื่อง', tone: 'danger' }))) return;
    setErr(''); setMsg('');
    try { await api('POST', `/api/devices/${d.id}/revoke`); done(`ยกเลิกเครื่อง ${d.name} แล้ว`); } catch (e) { setErr(errText(e)); }
  }

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="staff" />
        {me && !owner && <div className="error">เฉพาะเจ้าของร้านจัดการพนักงานและเครื่องได้</div>}
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <div role="status" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>พนักงาน</h1>
            <span className="muted" style={{ fontSize: 14 }}>พนักงานเข้าระบบด้วยการแตะชื่อ + PIN 6 หลัก บนเครื่องที่ลงทะเบียนแล้วเท่านั้น · ผิด 5 ครั้งล็อก 5 นาที</span>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!owner} onClick={() => setPanel({ staff: 'new' })}>+ เพิ่มพนักงาน</button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>ชื่อ</th><th>บทบาท</th><th>PIN</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {staff?.map((s) => (
                  <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{s.name}{s.email && <div className="muted" style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.1 }}>{s.email}</div>}</td>
                    <td>{ROLE[s.role]}</td>
                    <td>{s.has_pin ? 'ตั้งแล้ว' : <span className="muted">ยังไม่ตั้ง</span>}
                      {s.locked && <span className="pill" style={{ marginLeft: 8, background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>ล็อกอยู่</span>}</td>
                    <td>{s.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                    <td className="num"><button className="btn" style={{ minHeight: 40 }} disabled={!owner} onClick={() => setPanel({ staff: s })}>แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>เครื่องที่ลงทะเบียน</h2>
            <span className="muted" style={{ fontSize: 14 }}>
              {me?.device ? <>เครื่องนี้คือ <b>{me.device.name}</b></> : 'เครื่องนี้ยังไม่ได้ลงทะเบียน พนักงานจะใช้ PIN บนเครื่องนี้ไม่ได้'}
            </span>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!owner} onClick={() => setPanel('device')}>{me?.device ? 'ลงทะเบียนเครื่องนี้ใหม่' : 'ลงทะเบียนเครื่องนี้'}</button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>ชื่อเครื่อง</th><th>ออกเอกสารในนาม</th><th>ใช้ล่าสุด</th><th>ลงทะเบียนโดย</th><th /></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} style={{ opacity: d.revoked_at ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 600 }}>{d.name}{me?.device?.id === d.id && <span className="pill" style={{ marginLeft: 8, background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>เครื่องนี้</span>}</td>
                    <td>{termName(d.terminal_id)}</td>
                    <td className="muted">{when(d.last_seen_at)}</td>
                    <td className="muted">{d.created_by_name ?? ''} · {when(d.created_at)}</td>
                    <td className="num">{d.revoked_at ? <span className="muted">ยกเลิกแล้ว</span>
                      : <button className="btn btn-warn" style={{ minHeight: 40 }} disabled={!owner} onClick={() => revoke(d)}><Icon name="ban" /> ยกเลิกเครื่อง</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {devices.length === 0 && <p className="muted">ยังไม่มีเครื่องที่ลงทะเบียน</p>}
        </section>

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>เครื่องขาย (เลขชุดเอกสาร)</h2>
            <span className="muted" style={{ fontSize: 14 }}>แต่ละเครื่องมีเลขใบกำกับภาษีอย่างย่อของตัวเอง และต้องขอ POS ID จากสรรพากรแยกกัน</span>
            <span className="spacer" />
            <button className="btn" disabled={!owner} onClick={() => setPanel('terminal')}>+ เพิ่มเครื่องขาย</button>
          </div>
          <table className="tbl">
            <thead><tr><th>รหัส</th><th>ชื่อ</th><th>POS ID สรรพากร</th></tr></thead>
            <tbody>
              {me?.terminals.map((t) => (
                <tr key={t.id}><td>{t.code}</td><td>{t.name}</td><td>{t.rd_pos_id ?? <span className="muted">ยังไม่ได้รับอนุมัติ (ตั้งในหน้าตั้งค่า)</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      {panel && typeof panel === 'object' && <StaffSheet s={panel.staff} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'device' && me && <DeviceSheet terminals={me.terminals} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'terminal' && <TerminalSheet onClose={() => setPanel(null)} onSaved={done} />}
    </>
  );
}

function StaffSheet({ s, onClose, onSaved }: { s: any | 'new'; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = s === 'new';
  const isOwner = !isNew && s.role === 'owner';
  const [f, setF] = useState({ name: isNew ? '' : s.name, role: isNew ? 'cashier' : s.role, pin: '', pin2: '', active: isNew ? true : s.active });
  const [err, setErr] = useState('');
  const pinGiven = f.pin !== '';
  const ok = f.name.trim() && (isNew ? pinOk(f.pin) : !pinGiven || pinOk(f.pin)) && f.pin === f.pin2;

  async function save() {
    setErr('');
    try {
      if (isNew) await api('POST', '/api/staff', { name: f.name.trim(), role: f.role, pin: f.pin });
      else await api('PATCH', `/api/staff/${s.id}`, {
        name: f.name.trim(), ...(isOwner ? {} : { role: f.role, active: f.active }), ...(pinGiven ? { pin: f.pin } : {}),
      });
      onSaved(isNew ? `เพิ่ม ${f.name.trim()} แล้ว` : `บันทึก ${f.name.trim()} แล้ว`);
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <Sheet title={isNew ? 'เพิ่มพนักงาน' : `แก้ไข ${s.name}`} onClose={onClose}>
      <label className="field">ชื่อที่แสดงบนหน้าล็อก<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={isNew} /></label>
      {isOwner ? <div className="muted">เจ้าของร้าน · ตั้ง PIN ไว้เพื่อสลับเข้าเครื่องหน้าร้านได้เร็ว</div> : (
        <label className="field">บทบาท
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {['manager', 'cashier', 'waiter', 'kitchen'].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 13 }}>{ROLE_CAN[f.role]}</span>
        </label>
      )}
      <div className="grid-form">
        <label className="field">{isNew ? 'PIN 6 หลัก' : 'PIN ใหม่ (เว้นว่าง = ไม่เปลี่ยน)'}
          <input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className="field">ยืนยัน PIN
          <input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '') })} />
        </label>
      </div>
      {f.pin.length === 6 && pinWeak(f.pin) && <span style={{ color: 'var(--warn-ink)' }}>PIN นี้เดาง่ายเกินไป ตั้งใหม่</span>}
      {f.pin2 !== '' && f.pin !== f.pin2 && <span style={{ color: 'var(--warn-ink)' }}>PIN สองช่องไม่ตรงกัน</span>}
      <div className="muted" style={{ fontSize: 13 }}>ห้ามใช้เลขเรียง (123456) หรือเลขซ้ำ (111111) · ตั้ง PIN ใหม่จะปลดล็อกให้ด้วย</div>
      {!isNew && !isOwner && (
        <label className="row" style={{ fontSize: 16 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} />
          ใช้งานอยู่ (เอาออก = เข้าระบบไม่ได้ทันที)
        </label>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!ok}>บันทึก</button>
    </Sheet>
  );
}

function DeviceSheet({ terminals, onClose, onSaved }: { terminals: { id: string; name: string; code: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: 'แท็บเล็ตหน้าร้าน', terminalId: terminals[0]?.id ?? '' });
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    try {
      await api('POST', '/api/devices', { name: f.name.trim(), terminalId: f.terminalId || null });
      onSaved(`ลงทะเบียน ${f.name.trim()} แล้ว พนักงานใช้ PIN บนเครื่องนี้ได้`);
    } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title="ลงทะเบียนเครื่องนี้" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>ทำบนแท็บเล็ตหรือคอมพิวเตอร์ที่จะวางหน้าร้าน ระบบจะจำเครื่องนี้ไว้ 400 วัน</p>
      <label className="field">ชื่อเครื่อง<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field">ออกเอกสารภาษีในนามเครื่องขาย
        <select value={f.terminalId} onChange={(e) => setF({ ...f, terminalId: e.target.value })}>
          {terminals.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          <option value="">ไม่ผูก (เลือกเองตอนรับเงิน)</option>
        </select>
      </label>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!f.name.trim()}>ลงทะเบียน</button>
    </Sheet>
  );
}

function TerminalSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    try {
      const t = await api('POST', '/api/terminals', { name: name.trim() });
      onSaved(`เพิ่มเครื่องขาย ${t.name} (${t.code}) แล้ว`);
    } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title="เพิ่มเครื่องขาย" onClose={onClose}>
      <label className="field">ชื่อเครื่อง<input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เครื่องบาร์น้ำ" autoFocus /></label>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>ระบบให้รหัส P2, P3… อัตโนมัติ ใช้นำหน้าเลขใบกำกับภาษีอย่างย่อของเครื่องนั้น</p>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!name.trim()}>เพิ่ม</button>
    </Sheet>
  );
}
