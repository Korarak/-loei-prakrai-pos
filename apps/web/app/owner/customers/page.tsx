'use client';

import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sheet } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

interface Draft { id?: string; name: string; taxId: string; branch: string; address: string; phone: string; note: string; active: boolean }
const blank: Draft = { name: '', taxId: '', branch: '00000', address: '', phone: '', note: '', active: true };

export default function CustomersPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState('');

  const load = () => api('GET', `/api/customers?all=1${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then(setRows).catch((e) => setErr(errText(e)));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="customers" />
        {err && <div className="error" role="alert">{err}</div>}
        <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 12 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: 20 }}>ลูกค้าประจำ</h1>
            <span className="muted" style={{ fontSize: 14 }}>เก็บข้อมูลผู้ซื้อไว้ออกใบกำกับภาษีเต็มรูปซ้ำ ๆ — เลือกจากหน้าชำระเงินได้เลย</span>
            <span className="spacer" />
            <input aria-label="ค้นหาลูกค้า" placeholder="ค้นหาชื่อ / เลขผู้เสียภาษี / เบอร์" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ height: 48, borderRadius: 12, border: '1px solid #c9cfc7', padding: '0 12px', minWidth: 240, fontSize: 16 }} />
            <button className="btn btn-primary" onClick={() => setEdit(blank)}>+ เพิ่มลูกค้า</button>
          </div>
          {rows?.length === 0 && <p className="muted">{q ? 'ไม่พบลูกค้าตามที่ค้นหา' : 'ยังไม่มีลูกค้า — เพิ่มที่นี่ หรือกด “บันทึกเป็นลูกค้า” ตอนออกใบกำกับภาษีเต็มรูป'}</p>}
          {rows && rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>ชื่อ</th><th>เลขผู้เสียภาษี</th><th>สาขา</th><th>เบอร์</th><th>ที่อยู่</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => setEdit({ id: c.id, name: c.name, taxId: c.tax_id, branch: c.branch, address: c.address, phone: c.phone ?? '', note: c.note ?? '', active: c.active })}
                      style={{ cursor: 'pointer', opacity: c.active ? 1 : 0.5 }}>
                      <td><b>{c.name}</b>{!c.active && <span className="muted"> (ปิดใช้)</span>}</td>
                      <td>{c.tax_id}</td><td>{c.branch === '00000' ? 'สนง.ใหญ่' : c.branch}</td><td>{c.phone ?? ''}</td>
                      <td className="muted" style={{ maxWidth: 360 }}>{c.address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      {edit && <CustomerSheet draft={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function CustomerSheet({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = { name: d.name, taxId: d.taxId, branch: d.branch, address: d.address, phone: d.phone || null, note: d.note || null, active: d.active };
      await (d.id ? api('PUT', `/api/customers/${d.id}`, body) : api('POST', '/api/customers', body));
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Sheet title={d.id ? 'แก้ข้อมูลลูกค้า' : 'เพิ่มลูกค้า'} onClose={onClose}>
      <label className="field">ชื่อบริษัท / ผู้ซื้อ<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
        <label className="field">เลขผู้เสียภาษี 13 หลัก<input inputMode="numeric" value={d.taxId} onChange={(e) => setD({ ...d, taxId: e.target.value })} /></label>
        <label className="field">สาขา<input inputMode="numeric" value={d.branch} onChange={(e) => setD({ ...d, branch: e.target.value })} /></label>
      </div>
      <label className="field">ที่อยู่ (ตามที่จะพิมพ์บนใบกำกับภาษี)<input value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} /></label>
      <label className="field">เบอร์โทร<input inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></label>
      <label className="field">หมายเหตุภายใน<input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
      {d.id && (
        <label className="row" style={{ minHeight: 50, fontSize: 16 }}>
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} /> ใช้งานอยู่ (ปิดแล้วจะไม่ขึ้นให้เลือกตอนชำระเงิน)
        </label>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={busy || !d.name.trim() || !d.taxId.trim() || d.address.trim().length < 5}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
    </Sheet>
  );
}
