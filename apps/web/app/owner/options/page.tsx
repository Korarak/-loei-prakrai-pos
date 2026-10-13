'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sheet, toSatang, UNIT } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

interface Opt { id?: string; name: string; price: string; active: boolean; ingredients: { ingredientId: string; qty: string }[] }
interface Draft { id?: string; name: string; minSelect: number; maxSelect: number; active: boolean; itemIds: string[]; options: Opt[] }

const blankOpt = (): Opt => ({ name: '', price: '', active: true, ingredients: [] });
const field: React.CSSProperties = { height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 10px', fontSize: 16, background: '#fff' };

const toDraft = (g: any): Draft => ({
  id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, active: g.active, itemIds: g.item_ids,
  options: g.options.map((o: any) => ({
    id: o.id, name: o.name, price: o.price ? String(o.price / 100) : '', active: o.active,
    ingredients: o.ingredients.map((x: any) => ({ ingredientId: x.ingredient_id, qty: String(x.qty) })),
  })),
});

export default function OptionsPage() {
  const { me } = useMe();
  const [groups, setGroups] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [ings, setIngs] = useState<any[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api('GET', '/api/modifier-groups').then(setGroups),
    api('GET', '/api/menu').then((m) => setItems(m.items)),
    api('GET', '/api/ingredients').then(setIngs),
  ]).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? '—';

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="options" />
        {err && <div className="error" role="alert">{err}</div>}
        <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 12 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: 20 }}>ตัวเลือกเมนู</h1>
            <span className="muted" style={{ fontSize: 14 }}>ระดับเผ็ด ไซส์ ท็อปปิ้ง — ติดกับเมนูที่เลือก หน้าขายจะถามตอนแตะเมนู</span>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setEdit({ name: '', minSelect: 0, maxSelect: 1, active: true, itemIds: [], options: [blankOpt(), blankOpt()] })}>+ เพิ่มกลุ่มตัวเลือก</button>
          </div>
          {groups?.length === 0 && <p className="muted">ยังไม่มีตัวเลือก เช่น กลุ่ม “ระดับเผ็ด” (ไม่เผ็ด / เผ็ดกลาง / เผ็ดมาก) หรือ “ท็อปปิ้ง” (ไข่ดาว +10 บาท)</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {groups?.map((g) => (
              <button key={g.id} className="card" onClick={() => setEdit(toDraft(g))}
                style={{ padding: '12px 16px', textAlign: 'left', display: 'grid', gap: 4, opacity: g.active ? 1 : 0.55 }}>
                <b style={{ fontSize: 18 }}>{g.name}{!g.active && ' (ปิดใช้)'}</b>
                <span className="muted" style={{ fontSize: 14 }}>
                  {g.min_select > 0 ? 'ต้องเลือก' : 'ไม่บังคับ'} · {g.max_select === 1 ? 'เลือกได้ 1' : `เลือกได้ไม่เกิน ${g.max_select}`}
                </span>
                <span style={{ fontSize: 15 }}>
                  {g.options.filter((o: any) => o.active).map((o: any) => o.name + (o.price ? ` +${formatBaht(o.price).replace(/\.00$/, '')}` : '')).join(' · ')}
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {g.item_ids.length === 0 ? 'ยังไม่ผูกกับเมนูไหน' : `เมนู: ${g.item_ids.slice(0, 3).map(itemName).join(', ')}${g.item_ids.length > 3 ? ` และอีก ${g.item_ids.length - 3}` : ''}`}
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
      {edit && <GroupSheet draft={edit} items={items} ings={ings} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function GroupSheet({ draft, items, ings, onClose, onSaved }: { draft: Draft; items: any[]; ings: any[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setOpt = (i: number, p: Partial<Opt>) => setD({ ...d, options: d.options.map((o, k) => (k === i ? { ...o, ...p } : o)) });

  const prices = d.options.map((o) => (o.price.trim() === '' ? 0 : toSatang(o.price)));
  const live = d.options.filter((o) => o.active && o.name.trim());
  const valid = d.name.trim() && live.length > 0 && prices.every((p) => Number.isFinite(p) && p >= 0) && d.minSelect <= d.maxSelect && d.minSelect <= live.length
    && d.options.every((o) => o.ingredients.every((x) => x.ingredientId && Number(x.qty) > 0));

  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = {
        name: d.name.trim(), minSelect: d.minSelect, maxSelect: d.maxSelect, active: d.active, itemIds: d.itemIds,
        options: d.options.map((o, i) => ({
          id: o.id, name: o.name.trim(), price: prices[i], active: o.active,
          ingredients: o.ingredients.map((x) => ({ ingredientId: x.ingredientId, qty: Number(x.qty) })),
        })).filter((o) => o.name),
      };
      await (d.id ? api('PUT', `/api/modifier-groups/${d.id}`, body) : api('POST', '/api/modifier-groups', body));
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Sheet title={d.id ? `แก้กลุ่ม “${draft.name}”` : 'เพิ่มกลุ่มตัวเลือก'} onClose={onClose} wide>
      <label className="field">ชื่อกลุ่ม (คำถามที่หน้าขายจะถาม)<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="เช่น ระดับเผ็ด, ไซส์, ท็อปปิ้ง" autoFocus /></label>
      <div className="grid-form">
        <label className="field">บังคับเลือกอย่างน้อย
          <select value={d.minSelect} onChange={(e) => setD({ ...d, minSelect: Number(e.target.value) })}>
            <option value={0}>ไม่บังคับ</option>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n} ตัวเลือก</option>)}
          </select>
        </label>
        <label className="field">เลือกได้ไม่เกิน
          <select value={d.maxSelect} onChange={(e) => setD({ ...d, maxSelect: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n === 1 ? '1 (เลือกอย่างเดียว)' : n}</option>)}
          </select>
        </label>
        {d.id && (
          <label className="row" style={{ minHeight: 50, alignSelf: 'end', fontSize: 16 }}>
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} /> เปิดใช้
          </label>
        )}
      </div>

      <div style={{ fontWeight: 700 }}>ตัวเลือก</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {d.options.map((o, i) => (
          <div key={o.id ?? `n${i}`} className="card" style={{ padding: '10px 12px', display: 'grid', gap: 8, opacity: o.active ? 1 : 0.55 }}>
            <div className="row">
              <input aria-label="ชื่อตัวเลือก" placeholder="ชื่อ เช่น เผ็ดมาก" value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} style={{ ...field, flex: 1 }} />
              <input aria-label="ราคาที่บวกเพิ่ม" inputMode="decimal" placeholder="+บาท" value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} style={{ ...field, width: 90, textAlign: 'right' }} />
              {o.id ? (
                <button className="btn" style={{ minHeight: 44 }} onClick={() => setOpt(i, { active: !o.active })}>{o.active ? 'ปิด' : 'เปิด'}</button>
              ) : (
                <button className="btn" style={{ minHeight: 44 }} aria-label="ลบตัวเลือก" onClick={() => setD({ ...d, options: d.options.filter((_, k) => k !== i) })}>ลบ</button>
              )}
            </div>
            {o.ingredients.map((x, k) => {
              const ing = ings.find((y) => y.id === x.ingredientId);
              return (
                <div key={k} className="row" style={{ gap: 8 }}>
                  <select aria-label="วัตถุดิบที่ใช้เพิ่ม" value={x.ingredientId} style={{ ...field, flex: 1 }}
                    onChange={(e) => setOpt(i, { ingredients: o.ingredients.map((y, j) => (j === k ? { ...y, ingredientId: e.target.value } : y)) })}>
                    <option value="">เลือกวัตถุดิบ…</option>
                    {ings.filter((y) => y.active || y.id === x.ingredientId).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                  </select>
                  <input aria-label="ปริมาณ" inputMode="decimal" value={x.qty} style={{ ...field, width: 80, textAlign: 'right' }}
                    onChange={(e) => setOpt(i, { ingredients: o.ingredients.map((y, j) => (j === k ? { ...y, qty: e.target.value } : y)) })} />
                  <span className="muted" style={{ width: 40 }}>{ing ? UNIT[ing.base_unit] : ''}</span>
                  <button className="btn" style={{ minHeight: 40 }} aria-label="เอาวัตถุดิบออก" onClick={() => setOpt(i, { ingredients: o.ingredients.filter((_, j) => j !== k) })}>×</button>
                </div>
              );
            })}
            <button className="btn" style={{ justifySelf: 'start', minHeight: 40, fontSize: 14 }}
              onClick={() => setOpt(i, { ingredients: [...o.ingredients, { ingredientId: '', qty: '' }] })}>+ ตัดสต็อกวัตถุดิบเพิ่มเมื่อเลือกอันนี้</button>
          </div>
        ))}
      </div>
      <button className="btn btn-outline" onClick={() => setD({ ...d, options: [...d.options, blankOpt()] })}>+ เพิ่มตัวเลือก</button>

      <div style={{ fontWeight: 700 }}>ใช้กับเมนู</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
        {items.filter((i) => i.active || d.itemIds.includes(i.id)).map((i) => (
          <label key={i.id} className="row" style={{ minHeight: 44, fontSize: 16 }}>
            <input type="checkbox" checked={d.itemIds.includes(i.id)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
              onChange={(e) => setD({ ...d, itemIds: e.target.checked ? [...d.itemIds, i.id] : d.itemIds.filter((x) => x !== i.id) })} /> {i.name}
          </label>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 14 }}>ตัวเลือกที่ปิดหรือเอาออก ยังแสดงในบิลเก่าตามเดิม ใช้เพิ่มในบิลใหม่ไม่ได้</div>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!valid || busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
    </Sheet>
  );
}
