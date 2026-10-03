'use client';

import { formatBaht, pct, valueOf } from '@prakai/core';
import { useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { fmtQty, Sheet, Stat, toSatang, UNIT } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

/** Food cost above this reads as a warning (design doc §4.4 suggests 28–35%). */
const TARGET_PCT = 35;

interface Line { ingredientId: string; qty: string }

const lineCost = (ing: any, qty: number) => (ing && qty > 0 ? valueOf(Math.round((qty * 100 / ing.yield_pct) * 10_000) / 10_000, ing.avg_cost) : 0);

export default function MenuCosting() {
  const { me } = useMe();
  const [items, setItems] = useState<any[] | null>(null);
  const [ings, setIngs] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [managingCats, setManagingCats] = useState(false);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api('GET', '/api/costing/menu').then(setItems),
    api('GET', '/api/ingredients').then(setIngs),
    api('GET', '/api/menu').then((m) => setCats(m.categories)),
  ]).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  const withRecipe = items?.filter((i) => i.recipe_lines > 0) ?? [];
  const avgPct = withRecipe.length ? Math.round(withRecipe.reduce((s, i) => s + i.food_cost_pct, 0) / withRecipe.length * 10) / 10 : 0;
  const over = withRecipe.filter((i) => i.food_cost_pct > TARGET_PCT).length;

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="menu" />
        {err && <div className="error" role="alert">{err}</div>}
        {items && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Stat label="เมนูที่มีสูตรแล้ว" value={`${withRecipe.length} / ${items.length}`} />
            <Stat label="Food cost เฉลี่ย (ตามสูตร)" value={`${avgPct}%`} tone={avgPct > TARGET_PCT ? 'warn' : 'good'} />
            <Stat label={`เมนูที่ต้นทุนเกิน ${TARGET_PCT}%`} value={over} tone={over ? 'warn' : undefined} />
          </div>
        )}
        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>ต้นทุนต่อจาน</h1>
            <span className="muted" style={{ fontSize: 14 }}>คิดจากสูตร × ต้นทุนเฉลี่ยวัตถุดิบล่าสุด · ราคาก่อน VAT · แตะเมนูเพื่อแก้สูตร</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setManagingCats(true)}>จัดการหมวด</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ เพิ่มเมนู</button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>เมนู</th><th>หมวด</th><th className="num">ราคาขาย</th><th className="num">ก่อน VAT</th>
                <th className="num">ต้นทุน</th><th className="num">Food cost</th><th className="num">กำไรขั้นต้น</th>
              </tr></thead>
              <tbody>
                {items?.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setOpen(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
                    <td style={{ fontWeight: 600 }}>{i.name}{!i.active && <span className="pill" style={{ marginLeft: 8, background: 'var(--line-soft)' }}>ปิดขาย</span>}</td>
                    <td className="muted">{i.category ?? '—'}</td>
                    <td className="num">{formatBaht(i.price)}</td>
                    <td className="num muted">{formatBaht(i.price_ex_vat)}</td>
                    <td className="num">{i.recipe_lines ? formatBaht(i.cost) : <span className="muted">ยังไม่มีสูตร</span>}</td>
                    <td className="num" style={{ fontWeight: 700, color: !i.recipe_lines ? 'var(--muted)' : i.food_cost_pct > TARGET_PCT ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
                      {i.recipe_lines ? `${i.food_cost_pct}%` : '—'}
                    </td>
                    <td className="num">{i.recipe_lines ? formatBaht(i.margin) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!items && !err && <p className="muted">กำลังโหลด…</p>}
        </section>
      </main>
      {open && <RecipeSheet item={open} ings={ings} cats={cats} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
      {managingCats && <CategorySheet cats={cats} items={items ?? []} onClose={() => { setManagingCats(false); load(); }} onChanged={setCats} />}
      {adding && <NewItemSheet cats={cats} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
  );
}

function RecipeSheet({ item, ings, cats, onClose, onSaved }: { item: any; ings: any[]; cats: any[]; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [price, setPrice] = useState((item.price / 100).toFixed(2));
  const [active, setActive] = useState<boolean>(item.active);
  const [categoryId, setCategoryId] = useState<string>(item.category_id ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(ings.map((i) => [i.id, i])), [ings]);

  useEffect(() => {
    api('GET', `/api/menu/items/${item.id}/recipe`)
      .then((r) => setLines(r.lines.map((l: any) => ({ ingredientId: l.ingredient_id, qty: String(l.qty) }))))
      .catch((e) => setErr(errText(e)));
  }, [item.id]);

  const cost = (lines ?? []).reduce((s, l) => s + lineCost(byId.get(l.ingredientId), Number(l.qty)), 0);
  // Keep the pre-VAT ratio the server used so a price edit previews the right food cost.
  const newPrice = toSatang(price);
  const exVat = item.price > 0 ? Math.round(newPrice * item.price_ex_vat / item.price) : newPrice;
  const set = (i: number, patch: Partial<Line>) => setLines(lines!.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const valid = lines !== null && lines.every((l) => l.ingredientId && Number(l.qty) > 0) && Number.isFinite(newPrice) && newPrice >= 0;

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('PUT', `/api/menu/items/${item.id}/recipe`, { lines: lines!.map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty) })) });
      if (newPrice !== item.price || active !== item.active || categoryId !== (item.category_id ?? '')) {
        await api('PATCH', `/api/menu/items/${item.id}`, { price: newPrice, active, categoryId: categoryId || null });
      }
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Sheet title={`สูตร · ${item.name}`} onClose={onClose} wide>
      <div className="grid-form">
        <label className="field">ราคาขาย (บาท)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field">หมวด
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">ไม่มีหมวด</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="row" style={{ minHeight: 50, alignSelf: 'end', fontSize: 16 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} /> เปิดขาย
        </label>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>ใส่ปริมาณที่ใช้จริงต่อ 1 จาน (หลังตัดแต่ง) ระบบจะคิดส่วนที่เสียจาก yield ของวัตถุดิบให้เอง</div>
      {lines === null ? <p className="muted">กำลังโหลด…</p> : (
        <table className="tbl">
          <thead><tr><th>วัตถุดิบ</th><th className="num">ปริมาณ/จาน</th><th className="num">ต้นทุน</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const ing = byId.get(l.ingredientId);
              return (
                <tr key={i}>
                  <td>
                    <select aria-label="วัตถุดิบ" value={l.ingredientId} onChange={(e) => set(i, { ingredientId: e.target.value })}
                      style={{ height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 8px', minWidth: 180, background: '#fff' }}>
                      <option value="">เลือก…</option>
                      {ings.filter((x) => x.active || x.id === l.ingredientId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    {ing && ing.yield_pct < 100 && <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>yield {ing.yield_pct}%</span>}
                  </td>
                  <td className="num">
                    <input aria-label="ปริมาณ" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })}
                      style={{ width: 90, height: 44, borderRadius: 10, border: '1px solid #c9cfc7', textAlign: 'right', padding: '0 8px' }} />
                    <span className="muted" style={{ marginLeft: 6, display: 'inline-block', width: 36, textAlign: 'left' }}>{ing ? UNIT[ing.base_unit] : ''}</span>
                  </td>
                  <td className="num">{formatBaht(lineCost(ing, Number(l.qty)))}</td>
                  <td className="num"><button className="btn" style={{ minHeight: 40 }} onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="ลบบรรทัด">ลบ</button></td>
                </tr>
              );
            })}
            <tr className="total">
              <td>ต้นทุนต่อจาน</td><td />
              <td className="num">{formatBaht(cost)}</td><td />
            </tr>
          </tbody>
        </table>
      )}
      <button className="btn btn-outline" onClick={() => setLines([...(lines ?? []), { ingredientId: '', qty: '' }])}>+ เพิ่มวัตถุดิบ</button>
      {Number.isFinite(exVat) && exVat > 0 && (
        <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <span>ราคาก่อน VAT <b>{formatBaht(exVat)}</b></span>
          <span>Food cost <b style={{ color: pct(cost, exVat) > TARGET_PCT ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>{pct(cost, exVat)}%</b></span>
          <span>กำไรขั้นต้น <b>{formatBaht(exVat - cost)}</b></span>
        </div>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!valid || busy}>บันทึกสูตร</button>
    </Sheet>
  );
}

function NewItemSheet({ cats, onClose, onSaved }: { cats: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', categoryId: cats[0]?.id ?? '', price: '', station: 'kitchen' });
  const [err, setErr] = useState('');
  const price = toSatang(f.price);
  async function save() {
    setErr('');
    try {
      await api('POST', '/api/menu/items', { name: f.name, categoryId: f.categoryId || null, price, station: f.station });
      onSaved();
    } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title="เพิ่มเมนู" onClose={onClose}>
      <label className="field">ชื่อเมนู<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label className="field">หมวด
        <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">ไม่มีหมวด</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="field">ราคาขาย (บาท)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
      <label className="field">ส่งไปที่
        <select value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })}>
          <option value="kitchen">ครัว</option><option value="bar">บาร์น้ำ</option>
        </select>
      </label>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!f.name.trim() || !Number.isFinite(price) || price < 0}>เพิ่มเมนู</button>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>เพิ่มแล้วแตะเมนูในตารางเพื่อใส่สูตร</p>
    </Sheet>
  );
}

function CategorySheet({ cats, items, onClose, onChanged }: { cats: any[]; items: any[]; onClose: () => void; onChanged: (c: any[]) => void }) {
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(cats.map((c) => [c.id, c.name])));
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  const refresh = async () => {
    const m = await api('GET', '/api/menu');
    onChanged(m.categories);
    setNames(Object.fromEntries(m.categories.map((c: any) => [c.id, c.name])));
  };
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await refresh(); } catch (e) { setErr(errText(e)); } };
  const count = (id: string) => items.filter((i) => i.category_id === id).length;

  return (
    <Sheet title="หมวดเมนู" onClose={onClose}>
      <div className="muted" style={{ fontSize: 14 }}>ลำดับหมวดที่นี่คือลำดับที่แสดงบนหน้าขาย</div>
      <table className="tbl">
        <tbody>
          {cats.map((c, i) => (
            <tr key={c.id}>
              <td><input aria-label={`ชื่อหมวด ${c.name}`} value={names[c.id] ?? ''} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
                style={{ height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 10px', width: '100%', fontSize: 16 }} /></td>
              <td className="muted num" style={{ fontSize: 13 }}>{count(c.id)} เมนู</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                {names[c.id]?.trim() && names[c.id]!.trim() !== c.name && (
                  <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => run(() => api('PATCH', `/api/menu/categories/${c.id}`, { name: names[c.id]!.trim() }))}>บันทึก</button>
                )}
                <button className="btn" style={{ minHeight: 40, padding: '0 12px' }} disabled={i === 0} aria-label={`เลื่อน ${c.name} ขึ้น`}
                  onClick={() => run(() => api('POST', `/api/menu/categories/${c.id}/move`, { dir: 'up' }))}>↑</button>
                <button className="btn" style={{ minHeight: 40, padding: '0 12px' }} disabled={i === cats.length - 1} aria-label={`เลื่อน ${c.name} ลง`}
                  onClick={() => run(() => api('POST', `/api/menu/categories/${c.id}/move`, { dir: 'down' }))}>↓</button>
                <button className="btn btn-warn" style={{ minHeight: 40 }} disabled={count(c.id) > 0} title={count(c.id) ? 'ย้ายเมนูออกก่อน' : undefined}
                  onClick={() => run(() => api('DELETE', `/api/menu/categories/${c.id}`))}>ลบ</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input aria-label="ชื่อหมวดใหม่" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="ชื่อหมวดใหม่"
          style={{ height: 48, borderRadius: 12, border: '1px solid #c9cfc7', padding: '0 12px', flex: 1, fontSize: 16 }} />
        <button className="btn btn-primary" disabled={!add.trim()} onClick={() => run(async () => { await api('POST', '/api/menu/categories', { name: add.trim() }); setAdd(''); })}>+ เพิ่มหมวด</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
    </Sheet>
  );
}
