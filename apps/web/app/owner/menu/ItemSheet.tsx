'use client';

import { formatBaht, pct, valueOf } from '@prakai/core';
import { useEffect, useMemo, useState } from 'react';
import { api, errText, uploadMenuImage } from '@/lib/api';
import { Sheet, toSatang, UNIT } from '@/lib/owner';
import { BowlIcon, tintFor } from '@/lib/ui';
import { IngredientPicker, NewIngredientSheet, PickSheet } from './Pickers';

export const TARGET_PCT = 35;

interface Line { ingredientId: string; qty: string }

const lineCost = (ing: any, qty: number) => (ing && qty > 0 ? valueOf(Math.round((qty * 100 / ing.yield_pct) * 10_000) / 10_000, ing.avg_cost) : 0);

const step: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 14, background: 'var(--accent)', color: '#fff', display: 'inline-grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flex: 'none',
};
const H = ({ n, children, hint }: { n: number; children: React.ReactNode; hint?: string }) => (
  <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
    <div className="row" style={{ gap: 10 }}><span style={step}>{n}</span><b style={{ fontSize: 18 }}>{children}</b></div>
    {hint && <div className="muted" style={{ fontSize: 14, paddingLeft: 38 }}>{hint}</div>}
  </div>
);

/**
 * One panel for adding and editing a dish: the basics, the questions it asks, and its recipe.
 * Nothing is saved until the single button at the bottom, and the cost updates as you type.
 */
export function ItemSheet({ item, ings, cats, groups, items, vatRatio, onClose, onSaved, onIngsChanged }: {
  item: any | null; ings: any[]; cats: any[]; groups: any[]; items: any[]; vatRatio: number;
  onClose: () => void; onSaved: () => void; onIngsChanged: () => void;
}) {
  const [name, setName] = useState<string>(item?.name ?? '');
  const [categoryId, setCategoryId] = useState<string>(item?.category_id ?? cats[0]?.id ?? '');
  const [station, setStation] = useState<'kitchen' | 'bar'>(item?.station ?? 'kitchen');
  const [price, setPrice] = useState(item ? (item.price / 100).toFixed(2) : '');
  const [active, setActive] = useState<boolean>(item?.active ?? true);
  const [groupIds, setGroupIds] = useState<string[]>(item?.group_ids ?? []);
  const [lines, setLines] = useState<Line[] | null>(item ? null : []);
  const [image, setImage] = useState<string | null>(item?.image_url ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | { kind: 'ing'; at: number | null } | { kind: 'new'; at: number | null } | { kind: 'copy' }>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(ings.map((i) => [i.id, i])), [ings]);
  const id: string | null = item?.id ?? savedId;

  useEffect(() => {
    if (!item) return;
    api('GET', `/api/menu/items/${item.id}/recipe`)
      .then((r) => setLines(r.lines.map((l: any) => ({ ingredientId: l.ingredient_id, qty: String(l.qty) }))))
      .catch((e) => setErr(errText(e)));
  }, [item]);

  const rows = lines ?? [];
  const cost = rows.reduce((s, l) => s + lineCost(byId.get(l.ingredientId), Number(l.qty)), 0);
  const newPrice = toSatang(price);
  const exVat = Number.isFinite(newPrice) ? Math.round(newPrice * vatRatio) : NaN;
  const set = (i: number, patch: Partial<Line>) => setLines(rows.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const recipeOk = lines !== null && rows.every((l) => l.ingredientId && Number(l.qty) > 0);
  const valid = name.trim() && Number.isFinite(newPrice) && newPrice >= 0 && recipeOk;
  const toggleGroup = (g: string) => setGroupIds(groupIds.includes(g) ? groupIds.filter((x) => x !== g) : [...groupIds, g]);
  const preview = file ? URL.createObjectURL(file) : image;

  function pickIngredient(ingId: string) {
    const at = picker && picker.kind !== 'copy' ? picker.at : null;
    if (at !== null) set(at, { ingredientId: ingId });
    else { setLines([...rows, { ingredientId: ingId, qty: '' }]); setFresh(rows.length); }
    setPicker(null);
  }

  async function copyFrom(srcId: string) {
    setPicker(null);
    try {
      const r = await api('GET', `/api/menu/items/${srcId}/recipe`);
      setLines(r.lines.map((l: any) => ({ ingredientId: l.ingredient_id, qty: String(l.qty) })));
      setFresh(null);
    } catch (e) { setErr(errText(e)); }
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      const body = { name: name.trim(), categoryId: categoryId || null, price: newPrice, station, active };
      let itemId = id;
      if (!itemId) { itemId = (await api('POST', '/api/menu/items', body)).id as string; setSavedId(itemId); }
      else await api('PATCH', `/api/menu/items/${itemId}`, body);
      if (item || rows.length) await api('PUT', `/api/menu/items/${itemId}/recipe`, { lines: rows.map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty) })) });
      if (item || groupIds.length) await api('PUT', `/api/menu/items/${itemId}/modifier-groups`, { groupIds });
      if (file) await uploadMenuImage(itemId, file);
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  async function removePhoto() {
    setFile(null);
    if (!id || !image) return;
    try { await api('DELETE', `/api/menu/items/${id}/image`); setImage(null); } catch (e) { setErr(errText(e)); }
  }

  return (
    <>
      <Sheet title={item ? `แก้เมนู · ${item.name}` : 'เพิ่มเมนูใหม่'} onClose={onClose} wide>
        <H n={1}>ข้อมูลเมนู</H>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <div style={{ width: 96, height: 96, borderRadius: 12, background: tintFor(id ?? 'new'), overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
              {preview ? <img src={preview} alt={name || 'รูปเมนู'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <BowlIcon />}
            </div>
            <label className="btn btn-outline" style={{ cursor: 'pointer', minHeight: 40, padding: '0 12px', fontSize: 14 }}>
              {preview ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
              <input type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            {preview && <button className="btn" style={{ minHeight: 36, padding: '0 10px', fontSize: 13 }} onClick={removePhoto}>ลบรูป</button>}
          </div>
          <div style={{ flex: 1, display: 'grid', gap: 12 }}>
            <label className="field">ชื่อเมนู<input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!item} placeholder="เช่น สเต็กสันนอก 200 ก." /></label>
            <label className="field">ราคาขาย (บาท){' '}
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="เช่น 249" />
            </label>
          </div>
        </div>

        <div>
          <div className="muted" style={{ fontSize: 14, marginBottom: 6 }}>หมวด</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {cats.map((c) => <button key={c.id} className="btn" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</button>)}
            <button className="btn" aria-pressed={categoryId === ''} onClick={() => setCategoryId('')}>ไม่มีหมวด</button>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="muted" style={{ fontSize: 14 }}>ส่งใบสั่งไปที่</span>
          <button className="btn" aria-pressed={station === 'kitchen'} onClick={() => setStation('kitchen')}>ครัว</button>
          <button className="btn" aria-pressed={station === 'bar'} onClick={() => setStation('bar')}>บาร์น้ำ</button>
          <span className="spacer" />
          <label className="row" style={{ fontSize: 16 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} /> เปิดขาย
          </label>
        </div>

        <H n={2}>ตัวเลือกตอนสั่ง</H>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {groups.filter((g) => g.active || groupIds.includes(g.id)).map((g) => (
            <button key={g.id} className="btn" aria-pressed={groupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}>
              {groupIds.includes(g.id) ? '✓ ' : ''}{g.name}{g.min_select > 0 ? ' *' : ''}
            </button>
          ))}
          {groups.length === 0 && <span className="muted">ยังไม่มีกลุ่มตัวเลือก — สร้างได้ที่แท็บ “ตัวเลือกเมนู”</span>}
        </div>

        <H n={3} hint="ปริมาณต่อ 1 จาน (ข้ามได้)">สูตร / ต้นทุน</H>
        {lines === null ? <p className="muted">กำลังโหลด…</p> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map((l, i) => {
              const ing = byId.get(l.ingredientId);
              return (
                <div key={i} className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn" style={{ flex: '1 1 200px', justifyContent: 'flex-start', minHeight: 46 }} onClick={() => setPicker({ kind: 'ing', at: i })}>
                    {ing ? ing.name : 'เลือกวัตถุดิบ…'}
                  </button>
                  <span className="row" style={{ gap: 6 }}>
                    <input aria-label={`ปริมาณ ${ing?.name ?? ''}`} inputMode="decimal" value={l.qty} autoFocus={fresh === i} placeholder="0"
                      onChange={(e) => set(i, { qty: e.target.value })}
                      style={{ width: 90, height: 46, borderRadius: 10, border: '1px solid #c9cfc7', textAlign: 'right', padding: '0 8px', fontSize: 17 }} />
                    <span className="muted" style={{ width: 40 }}>{ing ? UNIT[ing.base_unit] : ''}</span>
                  </span>
                  <span style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{ing ? formatBaht(lineCost(ing, Number(l.qty))) : ''}</span>
                  <button className="btn" style={{ minHeight: 40, padding: '0 12px' }} aria-label="ลบบรรทัด" onClick={() => setLines(rows.filter((_, k) => k !== i))}>✕</button>
                  {ing && ing.yield_pct < 100 && <span className="muted" style={{ fontSize: 12, flexBasis: '100%' }}>yield {ing.yield_pct}%</span>}
                </div>
              );
            })}
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => setPicker({ kind: 'ing', at: null })}>+ เพิ่มวัตถุดิบ</button>
              <button className="btn" onClick={() => setPicker({ kind: 'copy' })}>คัดลอกสูตรจากเมนูอื่น</button>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', background: 'var(--line-soft)' }} aria-live="polite">
          <span>ต้นทุน/จาน <b>{formatBaht(cost)}</b></span>
          {Number.isFinite(exVat) && exVat > 0 && rows.length > 0 && (
            <>
              <span>Food cost <b style={{ color: pct(cost, exVat) > TARGET_PCT ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>{pct(cost, exVat)}%</b></span>
              <span>กำไรขั้นต้น <b>{formatBaht(exVat - cost)}</b></span>
            </>
          )}
          {rows.length === 0 && <span className="muted">ยังไม่มีสูตร</span>}
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!valid || busy}>
          {busy ? 'กำลังบันทึก…' : item || savedId ? 'บันทึก' : 'เพิ่มเมนู'}
        </button>
        {!valid && !busy && <div className="muted" style={{ fontSize: 14 }}>{!name.trim() ? 'ใส่ชื่อเมนู' : !Number.isFinite(newPrice) ? 'ใส่ราคาขาย' : 'วัตถุดิบทุกบรรทัดต้องมีปริมาณ'}</div>}
      </Sheet>

      {picker?.kind === 'ing' && (
        <IngredientPicker ings={ings} onPick={pickIngredient} onClose={() => setPicker(null)} onCreate={() => setPicker({ kind: 'new', at: picker.at })} />
      )}
      {picker?.kind === 'new' && (
        <NewIngredientSheet onClose={() => setPicker(null)} onCreated={(ing) => { onIngsChanged(); byId.set(ing.id, ing); pickIngredient(ing.id); }} />
      )}
      {picker?.kind === 'copy' && (
        <PickSheet title="คัดลอกสูตรจาก…" placeholder="ค้นหาชื่อเมนู" onClose={() => setPicker(null)} onPick={copyFrom}
          rows={items.filter((i) => i.recipe_lines > 0 && i.id !== id).map((i) => ({ id: i.id, label: i.name, group: i.category ?? 'ไม่มีหมวด', right: `ต้นทุน ${formatBaht(i.cost)}` }))} />
      )}
    </>
  );
}
