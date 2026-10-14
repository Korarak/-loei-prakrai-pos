'use client';

import { formatBaht } from '@prakai/core';
import { useCallback, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';
import { Sheet, Stat } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../pos/TopBar';

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'ใช้งานจริง', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  pending: { label: 'รอตรวจสอบ', bg: 'var(--warn-soft)', fg: 'var(--warn-ink)' },
  suspended: { label: 'ระงับ', bg: '#fde8e8', fg: '#9b1c1c' },
  closed: { label: 'ปิดร้าน', bg: 'var(--line-soft)', fg: 'var(--muted)' },
};
const ROLE: Record<string, string> = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', waiter: 'เสิร์ฟ', kitchen: 'ครัว' };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
const day = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T12:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' }) : '—';
/** "3 วันที่แล้ว" — how stale a shop is matters more than the exact time. */
function ago(iso: string | null) {
  if (!iso) return 'ไม่เคย';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  if (m < 1440) return `${Math.round(m / 60)} ชม.ที่แล้ว`;
  return `${Math.round(m / 1440)} วันที่แล้ว`;
}
const Pill = ({ s }: { s: string }) => {
  const x = STATUS[s] ?? { label: s, bg: 'var(--line-soft)', fg: 'var(--muted)' };
  return <span className="pill" style={{ background: x.bg, color: x.fg, whiteSpace: 'nowrap' }}>{x.label}</span>;
};

interface Row {
  id: string; name: string; status: string; created_at: string; tax_id: string | null; vat_registered: boolean;
  admin_note: string | null; members: number; owner_name: string | null; owner_email: string | null; owner_phone: string | null; last_login_at: string | null;
}

export default function Platform() {
  const { me } = useMe();
  const [overview, setOverview] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const PAGE = 50;

  const load = useCallback(async (offset = 0) => {
    setErr('');
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (q.trim()) p.set('q', q.trim());
      if (status) p.set('status', status);
      const r = await api<{ rows: Row[]; total: number }>('GET', `/api/platform/tenants?${p}`);
      setRows((cur) => (offset === 0 ? r.rows : [...cur, ...r.rows]));
      setTotal(r.total);
    } catch (e) { setErr(errText(e)); }
  }, [q, status]);

  const loadOverview = () => api('GET', '/api/platform/overview').then(setOverview).catch(() => {});
  useEffect(() => { loadOverview(); }, []);
  useEffect(() => { const t = setTimeout(() => load(0), 250); return () => clearTimeout(t); }, [load]);

  const count = (s: string) => overview?.byStatus?.find((x: any) => x.status === s)?.n ?? 0;

  return (
    <>
      <TopBar me={me} active="platform" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        {me && !me.platformAdmin && <div className="error">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>}
        <div className="row"><h1 style={{ margin: 0, fontSize: 26 }}>ร้านที่สมัครเข้าใช้งาน</h1><span className="muted">{total} ร้านตามตัวกรอง</span></div>
        {overview && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Stat label="สมัครใหม่ 7 วัน" value={overview.signups_7d} tone="good" />
            <Stat label="สมัครใหม่ 30 วัน" value={overview.signups_30d} />
            <Stat label="ใช้งานจริง" value={count('active')} />
            <Stat label="รอตรวจ / ระงับ" value={`${count('pending')} / ${count('suspended')}`} tone={count('pending') ? 'warn' : undefined} />
            <Stat label="บัญชีที่ถูกล็อกอยู่" value={overview.lockedUsers} tone={overview.lockedUsers ? 'warn' : undefined} />
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input aria-label="ค้นหา" placeholder="ค้นหาชื่อร้าน เจ้าของ อีเมล เบอร์ เลขผู้เสียภาษี" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ flex: '1 1 320px', height: 48, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line-2)' }} />
          <select aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)} style={{ height: 48, borderRadius: 12, border: '1px solid var(--line-2)', padding: '0 10px', background: '#fff' }}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        <section className="card" style={{ padding: '8px 18px' }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>ร้าน</th><th>เจ้าของ</th><th>สถานะ</th><th>สมัครเมื่อ</th><th>ทดลองถึง</th><th>เข้าล่าสุด</th><th className="num">คน</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                    <td style={{ fontWeight: 600 }}>{r.name}{r.admin_note && <span title={r.admin_note} style={{ marginLeft: 6 }}>📝</span>}
                      {r.tax_id && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{r.vat_registered ? 'VAT · ' : ''}{r.tax_id}</div>}</td>
                    <td>{r.owner_name}<div className="muted" style={{ fontSize: 12 }}>{r.owner_email}{r.owner_phone ? ` · ${r.owner_phone}` : ''}</div></td>
                    <td><Pill s={r.status} /></td>
                    <td>{when(r.created_at)}</td>
                    <td>{ago(r.last_login_at)}</td>
                    <td className="num">{r.members}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', height: 80 }}>ไม่พบร้านตามเงื่อนไข</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length < total && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => load(rows.length)}>โหลดเพิ่ม ({total - rows.length})</button></div>}
        </section>
      </main>
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={() => { load(0); loadOverview(); }} />}
    </>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const confirm = useConfirm();
  const [d, setD] = useState<any>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => api('GET', `/api/platform/tenants/${id}`).then((x) => {
    setD(x); setNote(x.tenant.admin_note ?? '');
  }).catch((e) => setErr(errText(e))), [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: object, text: string) {
    setErr(''); setMsg('');
    try { await api('PATCH', `/api/platform/tenants/${id}`, body); setMsg(text); await load(); onChanged(); } catch (e) { setErr(errText(e)); }
  }
  async function unlock(userId: string) {
    setErr(''); setMsg('');
    try { await api('POST', `/api/platform/tenants/${id}/members/${userId}/unlock`); setMsg('ปลดล็อกแล้ว'); await load(); onChanged(); } catch (e) { setErr(errText(e)); }
  }
  const t = d?.tenant;
  const u = d?.usage;
  const Btn = ({ to, label, tone }: { to: string; label: string; tone?: 'warn' }) => (
    <button className={`btn ${tone === 'warn' ? 'btn-warn' : ''}`} disabled={t?.status === to}
      onClick={async () => { if (to !== 'suspended' && to !== 'closed') return patch({ status: to }, `เปลี่ยนเป็น “${STATUS[to]!.label}” แล้ว`);
        if (await confirm({ title: `${label} ร้าน ${t.name}?`, body: 'พนักงานทุกคนจะเข้าใช้งานไม่ได้ทันที', confirm: label, tone: 'danger', icon: 'ban' })) patch({ status: to }, `เปลี่ยนเป็น “${STATUS[to]!.label}” แล้ว`); }}>{tone === 'warn' && <Icon name="ban" />}{label}</button>
  );

  return (
    <Sheet title={t?.name ?? 'รายละเอียดร้าน'} onClose={onClose} wide noConfirm>
      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div role="status" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}
      {t && <>
        <div className="row" style={{ flexWrap: 'wrap' }}><Pill s={t.status} />
          <span className="muted">สมัคร {when(t.created_at)}{t.status_changed_at ? ` · เปลี่ยนสถานะ ${when(t.status_changed_at)}` : ''}</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Stat label="บิลที่จ่ายแล้ว" value={u.paid_orders} />
          <Stat label="ยอดเอกสารภาษี" value={`฿${formatBaht(u.issued_total)}`} />
          <Stat label="ขายล่าสุด" value={<span style={{ fontSize: 16 }}>{ago(u.last_sale_at)}</span>} />
          <Stat label="ใช้งานล่าสุด" value={<span style={{ fontSize: 16 }}>{ago(u.last_activity_at)}</span>} />
        </div>
        <div className="muted" style={{ fontSize: 14 }}>เมนู {u.menu_items} · โต๊ะ {u.tables} · เครื่องที่ลงทะเบียน {u.devices}
          {t.legal_name && <> · {t.legal_name}</>}{t.tax_id && <> · เลขผู้เสียภาษี {t.tax_id}</>}{t.vat_registered && ' · จด VAT'}</div>
        {t.address && <div className="muted" style={{ fontSize: 14 }}>{t.address}</div>}

        <h3 style={{ margin: '8px 0 0' }}>สถานะ</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Btn to="active" label="ใช้งาน" /><Btn to="pending" label="รอตรวจสอบ" />
          <Btn to="suspended" label="ระงับ" tone="warn" /><Btn to="closed" label="ปิดร้าน" tone="warn" />
        </div>

        <h3 style={{ margin: '8px 0 0' }}>หมายเหตุภายใน <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(ร้านไม่เห็น)</span></h3>
        <label className="field"><textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โทรยืนยันแล้ว / รอเอกสาร ภ.พ.20" /></label>
        <div><button className="btn btn-primary" disabled={note === (t.admin_note ?? '')} onClick={() => patch({ adminNote: note.trim() || null }, 'บันทึกหมายเหตุแล้ว')}><Icon name="save" /> บันทึกหมายเหตุ</button></div>

        <h3 style={{ margin: '8px 0 0' }}>บัญชีในร้าน ({d.members.length})</h3>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>ชื่อ</th><th>บทบาท</th><th>ความปลอดภัย</th><th>เข้าล่าสุด</th><th /></tr></thead>
          <tbody>{d.members.map((m: any) => (
            <tr key={m.user_id} style={{ opacity: m.active ? 1 : 0.5 }}>
              <td style={{ fontWeight: 600 }}>{m.name}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{m.email ?? 'เข้าด้วย PIN'}{m.phone ? ` · ${m.phone}` : ''}</div></td>
              <td>{ROLE[m.role]}{!m.active && ' (ปิด)'}</td>
              <td style={{ fontSize: 13 }}>{m.has_totp ? '2 ขั้นตอน' : m.email ? <span className="muted">รหัสผ่านอย่างเดียว</span> : m.has_pin ? 'PIN' : '—'}
                {m.locked && <span className="pill" style={{ marginLeft: 6, background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>ล็อก</span>}</td>
              <td>{ago(m.last_login_at)}</td>
              <td className="num">{m.locked && <button className="btn" style={{ minHeight: 40 }} onClick={() => unlock(m.user_id)}><Icon name="key" /> ปลดล็อก</button>}</td>
            </tr>))}</tbody>
        </table></div>
      </>}
    </Sheet>
  );
}
