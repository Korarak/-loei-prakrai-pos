'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { today } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

/** What each recorded action means in plain Thai; unknown ones show their code. */
const ACTION: Record<string, string> = {
  'line.void': 'ยกเลิกรายการที่ส่งครัวแล้ว', 'order.move': 'ย้ายโต๊ะ', 'order.merge': 'รวมโต๊ะ', 'order.split': 'แยกบิล',
  'order.discount': 'ให้ส่วนลด', 'ingredient.create': 'เพิ่มวัตถุดิบ', 'ingredient.cost': 'ต้นทุนวัตถุดิบเปลี่ยน', 'prep.update': 'แก้สูตรย่อย',
  'recipe.update': 'แก้สูตรเมนู', 'purchase.create': 'รับของเข้า', 'stock.waste': 'บันทึกของเสีย', 'stock.count': 'นับสต็อก',
  'expense.create': 'บันทึกค่าใช้จ่าย', 'totp.enable': 'เปิดยืนยัน 2 ขั้นตอน', 'totp.disable': 'ปิดยืนยัน 2 ขั้นตอน',
  'platform.tenant.update': 'ผู้ดูแลระบบแก้สถานะร้าน', 'platform.user.unlock': 'ผู้ดูแลระบบปลดล็อกบัญชี',
};
const label = (a: string) => ACTION[a] ?? a;
/** Actions a manager should look at first: money leaving, stock disappearing, security changes. */
const SENSITIVE = new Set(['line.void', 'order.discount', 'stock.waste', 'totp.disable', 'platform.tenant.update', 'platform.user.unlock']);

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' });

/** One readable sentence for the most common details; the raw JSON stays available underneath. */
function summary(a: string, d: any): string {
  if (!d) return '';
  if (a === 'line.void') return `${d.name} ×${d.qty} · เหตุผล: ${d.reason}${d.wasted ? ' · นับเป็นของเสีย' : ''}`;
  if (a === 'order.move') return `${d.from ?? 'กลับบ้าน'} → ${d.to}`;
  if (a === 'order.merge') return `รวมบิล #${d.fromBill} (${d.lines} รายการ)`;
  if (a === 'order.split') return `แยกเป็นบิล #${d.toBill}`;
  if (a === 'order.discount') return d.type === 'none' ? 'ยกเลิกส่วนลด' : d.type === 'percent' ? `ลด ${(d.value ?? 0) / 100}%` : `ลด ${(d.value ?? 0) / 100} บาท`;
  if (a === 'stock.waste') return `${d.reason} · มูลค่า ${((d.value ?? 0) / 100).toLocaleString('th-TH')} บาท`;
  if (a === 'stock.count') return `${d.lines} รายการ · ส่วนต่าง ${((d.variance ?? 0) / 100).toLocaleString('th-TH')} บาท`;
  if (a === 'purchase.create') return `${d.supplier ?? ''} · รวม ${((d.total ?? 0) / 100).toLocaleString('th-TH')} บาท`;
  if (a === 'ingredient.cost') return `${((d.from ?? 0) / 100).toFixed(2)} → ${((d.to ?? 0) / 100).toFixed(2)} บาท/หน่วย`;
  if (a === 'platform.tenant.update') return `สถานะ ${d.before?.status} → ${d.after?.status}`;
  return '';
}

interface Entry { id: number; at: string; action: string; entity: string; entity_id: string | null; detail: any; user_id: string | null; user_name: string | null }

export default function Audit() {
  const { me } = useMe();
  const [rows, setRows] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; total: number; broken: number; firstBroken: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (before?: number) => {
    setErr('');
    const p = new URLSearchParams({ limit: '50' });
    if (action) p.set('action', action);
    if (userId) p.set('userId', userId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (before) p.set('before', String(before));
    try {
      const r = await api('GET', `/api/audit?${p}`);
      setRows((cur) => (before ? [...cur, ...r.rows] : r.rows));
      setMore(r.more); setActions(r.actions); setPeople(r.people);
    } catch (e) { setErr(errText(e)); }
  }, [action, userId, from, to]);
  useEffect(() => { load(); }, [load]);

  async function check() {
    setBusy(true); setErr('');
    try { setVerify(await api('GET', '/api/audit/verify')); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  const quick = (days: number) => {
    const t = today();
    setTo(t);
    setFrom(new Date(new Date(`${t}T12:00:00Z`).getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10));
  };
  const field: React.CSSProperties = { height: 48, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line-2)', background: '#fff' };

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="audit" />
        {me && me.role !== 'owner' && me.role !== 'manager' && <div className="error">เฉพาะเจ้าของและผู้จัดการดูประวัติการใช้งานได้</div>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>ประวัติการใช้งาน</h1>
          <span className="muted">ใครทำอะไรเมื่อไหร่ แก้หรือลบย้อนหลังไม่ได้</span>
          <span className="spacer" />
          {me?.role === 'owner' && <button className="btn" onClick={check} disabled={busy}>{busy ? 'กำลังตรวจ…' : 'ตรวจความสมบูรณ์ของบันทึก'}</button>}
        </div>
        {verify && (
          <div role="status" className={verify.ok ? 'card' : 'error'} style={{ padding: '10px 16px', color: verify.ok ? 'var(--accent-ink)' : undefined, fontWeight: 600 }}>
            {verify.ok ? `บันทึกครบถ้วน ${verify.total.toLocaleString()} รายการ ไม่พบการแก้ไขหรือลบ`
              : `พบความผิดปกติ ${verify.broken} รายการ เริ่มที่ลำดับ #${verify.firstBroken} ให้แจ้งผู้ดูแลระบบทันที`}
          </div>
        )}
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field">เรื่อง
            <select value={action} onChange={(e) => setAction(e.target.value)} style={field}>
              <option value="">ทั้งหมด</option>
              {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
            </select></label>
          <label className="field">คนทำ
            <select value={userId} onChange={(e) => setUserId(e.target.value)} style={field}>
              <option value="">ทุกคน</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="field">ตั้งแต่<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">ถึง<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn" onClick={() => quick(1)}>วันนี้</button>
          <button className="btn" onClick={() => quick(7)}>7 วัน</button>
          <button className="btn" onClick={() => quick(30)}>30 วัน</button>
          {(action || userId || from || to) && <button className="btn" onClick={() => { setAction(''); setUserId(''); setFrom(''); setTo(''); }}>ล้างตัวกรอง</button>}
        </div>
        <section className="card" style={{ padding: '8px 18px' }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>เวลา</th><th>คนทำ</th><th>เรื่อง</th><th>รายละเอียด</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpenRow(openRow === r.id ? null : r.id)} style={{ verticalAlign: 'top' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                    <td>{r.user_name ?? '—'}</td>
                    <td style={{ fontWeight: 600 }}>
                      {SENSITIVE.has(r.action) && <span aria-label="ควรตรวจ" title="ควรตรวจ" style={{ color: 'var(--warn)', marginRight: 6 }}>●</span>}{label(r.action)}</td>
                    <td>
                      <div>{summary(r.action, r.detail) || <span className="muted">{r.entity}{r.entity_id ? ` ${r.entity_id.slice(0, 8)}` : ''}</span>}</div>
                      {openRow === r.id && r.detail && <pre style={{ margin: '6px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--bg)', padding: 8, borderRadius: 8 }}>{JSON.stringify(r.detail, null, 2)}</pre>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', height: 80 }}>ยังไม่มีรายการตามเงื่อนไข</td></tr>}
              </tbody>
            </table>
          </div>
          {more && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => load(rows[rows.length - 1]!.id)}>โหลดเพิ่ม</button></div>}
        </section>
      </main>
    </>
  );
}
