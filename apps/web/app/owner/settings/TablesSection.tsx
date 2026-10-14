'use client';

import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';

interface Row { id: string; name: string; seats: number; order_id: string | null }

const small: React.CSSProperties = { height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 10px', fontSize: 16, background: '#fff' };

/** Floor plan: how many tables, their names and seats. Saved per action, separate from the tax settings. */
export function TablesSection({ canEdit, bare, onChanged }: { canEdit: boolean; bare?: boolean; onChanged?: () => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { name: string; seats: string }>>({});
  const [count, setCount] = useState('');
  const [add, setAdd] = useState({ name: '', seats: '4' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api<Row[]>('GET', '/api/tables').then((r) => {
    setRows(r);
    setCount(String(r.length));
    setEdit(Object.fromEntries(r.map((t) => [t.id, { name: t.name, seats: String(t.seats) }])));
  });
  useEffect(() => { load().catch((e) => setErr(errText(e))); }, []);

  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(''); setMsg('');
    try { await fn(); await load(); setMsg(done); onChanged?.(); } catch (e) { setErr(errText(e)); }
  }

  const n = Number(count);
  const countOk = Number.isInteger(n) && n >= 0 && n <= 200;
  const dirty = (t: Row) => edit[t.id] && (edit[t.id]!.name.trim() !== t.name || Number(edit[t.id]!.seats) !== t.seats);
  const busy = rows?.filter((t) => t.order_id).length ?? 0;

  return (
    <section className={bare ? undefined : 'card'} style={{ padding: bare ? 0 : 18, display: 'grid', gap: 14 }} aria-labelledby="tables-h">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 id="tables-h" style={{ margin: 0, fontSize: 20 }}>โต๊ะในร้าน</h2>
        <span className="muted" style={{ fontSize: 14 }}>{rows ? `${rows.length} โต๊ะ · มีลูกค้า ${busy}` : 'กำลังโหลด…'}</span>
      </div>
      {!canEdit && <div className="error">เฉพาะเจ้าของร้านหรือผู้จัดการแก้ผังโต๊ะได้</div>}

      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 180 }}>จำนวนโต๊ะทั้งหมด
          <input type="number" min={0} max={200} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} disabled={!canEdit} />
        </label>
        <button className="btn btn-outline" style={{ minHeight: 50 }} disabled={!canEdit || !countOk || !rows || n === rows.length}
          onClick={async () => { if (rows && n < rows.length && !(await confirm({ title: `ลดเหลือ ${n} โต๊ะ?`, body: `โต๊ะท้ายสุดที่ว่างจะถูกลบ ${rows.length - n} โต๊ะ`, confirm: 'ลดจำนวนโต๊ะ', tone: 'danger' }))) return; run(() => api('PUT', '/api/tables/count', { count: n }), `ตั้งเป็น ${n} โต๊ะแล้ว`); }}><Icon name="table" /> ปรับจำนวน</button>
        <span className="muted" style={{ fontSize: 14, flexBasis: 320, flexGrow: 1 }}>
          เพิ่ม = ต่อท้ายเป็นเลขถัดไป · ลด = เอาโต๊ะท้ายสุดที่ว่างออก (โต๊ะที่มีบิลเปิดอยู่จะไม่ถูกลบ ประวัติบิลเก่ายังอยู่ครบ)
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ชื่อโต๊ะ</th><th>ที่นั่ง</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {rows?.map((t) => (
              <tr key={t.id}>
                <td><input aria-label={`ชื่อโต๊ะ ${t.name}`} value={edit[t.id]?.name ?? ''} maxLength={20} disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, [t.id]: { ...edit[t.id]!, name: e.target.value } })} style={{ ...small, width: 160 }} /></td>
                <td><input aria-label={`ที่นั่ง ${t.name}`} type="number" min={1} max={50} value={edit[t.id]?.seats ?? ''} disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, [t.id]: { ...edit[t.id]!, seats: e.target.value } })} style={{ ...small, width: 90 }} /></td>
                <td>{t.order_id ? <span className="pill" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>มีบิลเปิด</span> : <span className="muted">ว่าง</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {dirty(t) && (
                    <button className="btn btn-primary" style={{ minHeight: 40, marginRight: 8 }}
                      disabled={!edit[t.id]!.name.trim() || !(Number(edit[t.id]!.seats) >= 1 && Number(edit[t.id]!.seats) <= 50)}
                      onClick={() => run(() => api('PATCH', `/api/tables/${t.id}`, { name: edit[t.id]!.name.trim(), seats: Number(edit[t.id]!.seats) }), `บันทึกโต๊ะ ${edit[t.id]!.name.trim()} แล้ว`)}><Icon name="check" /> บันทึก</button>
                  )}
                  <button className="btn btn-warn" style={{ minHeight: 40 }} disabled={!canEdit || !!t.order_id} title={t.order_id ? 'ปิดบิลก่อนจึงลบได้' : undefined}
                    onClick={async () => { if (await confirm({ title: `ลบโต๊ะ ${t.name}?`, body: 'ประวัติบิลเก่ายังอยู่ครบ', confirm: 'ลบโต๊ะ', tone: 'danger' })) run(() => api('DELETE', `/api/tables/${t.id}`), `ลบโต๊ะ ${t.name} แล้ว`); }}><Icon name="trash" /> ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 200 }}>เพิ่มโต๊ะชื่อ<input value={add.name} maxLength={20} placeholder="เช่น VIP, ระเบียง 1" disabled={!canEdit} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
        <label className="field" style={{ width: 110 }}>ที่นั่ง<input type="number" min={1} max={50} value={add.seats} disabled={!canEdit} onChange={(e) => setAdd({ ...add, seats: e.target.value })} /></label>
        <button className="btn btn-primary" style={{ minHeight: 50 }} disabled={!canEdit || !add.name.trim() || !(Number(add.seats) >= 1 && Number(add.seats) <= 50)}
          onClick={() => run(async () => { await api('POST', '/api/tables', { name: add.name.trim(), seats: Number(add.seats) }); setAdd({ name: '', seats: '4' }); }, `เพิ่มโต๊ะ ${add.name.trim()} แล้ว`)}><Icon name="plus" /> เพิ่มโต๊ะ</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div role="status" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}
    </section>
  );
}
