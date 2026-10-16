'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';
import { Stat } from '@/lib/owner';
import { BowlIcon, tintFor } from '@/lib/ui';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { ItemSheet, TARGET_PCT } from './ItemSheet';

const NO_CAT = '__none__';
const inputStyle: React.CSSProperties = { height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 12px', fontSize: 16 };

/** Move `id` so it sits just before `beforeId` (or at the end), returning the new id order. */
function placeBefore(ids: string[], id: string, beforeId: string | null): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId ? rest.indexOf(beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}
function swap(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export default function MenuPage() {
  const { me } = useMe();
  const confirm = useConfirm();
  const [items, setItems] = useState<any[] | null>(null);
  const [ings, setIngs] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'layout' | 'cost'>('layout');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<{ kind: 'cat' | 'item'; id: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api('GET', '/api/costing/menu').then(setItems),
    api('GET', '/api/ingredients').then(setIngs),
    api('GET', '/api/menu').then((m) => setCats(m.categories)),
    api('GET', '/api/modifier-groups').then(setGroups),
  ]).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  /** Categories as the till shows them, plus a last bucket for dishes that have none. */
  const sections = useMemo(() => {
    const list = cats.map((c) => ({ id: c.id as string, name: c.name as string, items: (items ?? []).filter((i) => i.category_id === c.id) }));
    const loose = (items ?? []).filter((i) => !i.category_id);
    if (loose.length) list.push({ id: NO_CAT, name: 'ไม่มีหมวด', items: loose });
    return list;
  }, [cats, items]);
  const current = sections.find((s) => s.id === sel) ?? sections[0];
  const searching = q.trim().length > 0;
  const needle = q.trim().toLowerCase();
  const matches = (i: any) => !needle || i.name.toLowerCase().includes(needle);

  const withRecipe = items?.filter((i) => i.recipe_lines > 0) ?? [];
  const avgPct = withRecipe.length ? Math.round(withRecipe.reduce((s, i) => s + i.food_cost_pct, 0) / withRecipe.length * 10) / 10 : 0;
  const overTarget = withRecipe.filter((i) => i.food_cost_pct > TARGET_PCT).length;
  const vatRatio = useMemo(() => {
    const ref = items?.find((i) => i.price > 0 && !i.vat_exempt);
    return ref ? ref.price_ex_vat / ref.price : 1;
  }, [items]);

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); } catch (e) { setErr(errText(e)); await load(); }
  }

  // ---- ordering: optimistic locally, then saved; any failure reloads the server's order ----
  function reorderCats(ids: string[]) {
    const real = ids.filter((x) => x !== NO_CAT);
    setCats(real.map((id) => cats.find((c) => c.id === id)!).filter(Boolean));
    return run(() => api('PUT', '/api/menu/categories/order', { ids: real }));
  }
  function reorderItems(catId: string, ids: string[]) {
    setItems((items ?? []).map((i) => ({ ...i })).sort((a, b) => {
      if (a.category_id !== catId || b.category_id !== catId) return 0;
      return ids.indexOf(a.id) - ids.indexOf(b.id);
    }));
    return run(() => api('PUT', '/api/menu/items/order', { categoryId: catId === NO_CAT ? null : catId, ids }));
  }
  function moveItemToCat(itemId: string, catId: string) {
    if (catId === NO_CAT) return;
    return run(async () => { await api('PATCH', `/api/menu/items/${itemId}`, { categoryId: catId }); await load(); });
  }

  const dropOnItem = (target: string) => {
    if (drag?.kind === 'item' && current && drag.id !== target) reorderItems(current.id, placeBefore(current.items.map((i) => i.id), drag.id, target));
    setDrag(null); setOver(null);
  };
  const dropOnCat = (target: string) => {
    if (drag?.kind === 'cat' && drag.id !== target) reorderCats(placeBefore(sections.map((s) => s.id), drag.id, target));
    else if (drag?.kind === 'item' && current && target !== current.id) {
      moveItemToCat(drag.id, target);
      setSel(target);
    }
    setDrag(null); setOver(null);
  };

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="menu" />
        {err && <div className="error" role="alert">{err}</div>}

        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>เมนู</h1>
          <div className="row" role="group" aria-label="มุมมอง" style={{ gap: 6 }}>
            <button className="btn" aria-pressed={mode === 'layout'} onClick={() => setMode('layout')}><Icon name="table" /> จัดลำดับเมนู</button>
            <button className="btn" aria-pressed={mode === 'cost'} onClick={() => setMode('cost')}><Icon name="receipt" /> ต้นทุน</button>
          </div>
          <span className="spacer" />
          <input aria-label="ค้นหาเมนู" placeholder="ค้นหาเมนู" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, minWidth: 180 }} />
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> เพิ่มเมนู</button>
        </div>

        {!items && !err && <p className="muted">กำลังโหลด…</p>}

        {items && mode === 'layout' && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              ลำดับที่เห็นที่นี่คือลำดับบนหน้าขายทุกประการ — ลากแถวไปวาง หรือกดลูกศรขึ้น/ลง. ลากเมนูไปวางบนหมวดทางซ้ายเพื่อย้ายหมวด
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
              <CategoryColumn sections={sections} current={current} drag={drag} over={over} items={items}
                onSelect={setSel} onDrag={setDrag} onOver={setOver} onDrop={dropOnCat}
                onMove={(id, d) => reorderCats(swap(sections.map((s) => s.id), id, d))}
                onAdd={async (name) => { await run(async () => { const k = await api('POST', '/api/menu/categories', { name }); await load(); setSel(k.id); }); }} />
              {current ? (
                <section className="card" style={{ flex: '3 1 420px', padding: '14px 16px', display: 'grid', gap: 10, minWidth: 0 }}>
                  <CategoryHeader key={current.id} section={current}
                    onRename={(name) => run(async () => { await api('PATCH', `/api/menu/categories/${current.id}`, { name }); await load(); })}
                    onDelete={async () => {
                      if (await confirm({ title: `ลบหมวด “${current.name}”?`, confirm: 'ลบหมวด', tone: 'danger' })) {
                        await run(async () => { await api('DELETE', `/api/menu/categories/${current.id}`); setSel(null); await load(); });
                      }
                    }} />
                  {current.items.length === 0 && <p className="muted">หมวดนี้ยังไม่มีเมนู — กด “เพิ่มเมนู” หรือลากเมนูจากหมวดอื่นมาวาง</p>}
                  <div style={{ display: 'grid' }}
                    onDragOver={(e) => { if (drag?.kind === 'item') e.preventDefault(); }}
                    onDrop={() => { if (drag?.kind === 'item' && current.id !== NO_CAT && !current.items.some((i) => i.id === drag.id)) { moveItemToCat(drag.id, current.id); setDrag(null); } }}>
                    {current.items.map((i, n) => matches(i) && (
                      <div key={i.id} draggable={!searching} onDragStart={() => setDrag({ kind: 'item', id: i.id })} onDragEnd={() => { setDrag(null); setOver(null); }}
                        onDragOver={(e) => { if (drag?.kind === 'item') { e.preventDefault(); setOver(i.id); } }} onDrop={(e) => { e.stopPropagation(); dropOnItem(i.id); }}
                        className="row" style={{
                          gap: 10, padding: '6px 4px', borderTop: '1px solid var(--line-soft)', minHeight: 58,
                          opacity: drag?.id === i.id ? 0.4 : 1, background: over === i.id && drag?.kind === 'item' ? 'var(--accent-soft)' : undefined,
                        }}>
                        <span className="muted" style={{ cursor: searching ? 'default' : 'grab', display: 'grid', placeItems: 'center', width: 24 }} title={searching ? 'ล้างช่องค้นหาก่อนจึงจะลากได้' : 'ลากเพื่อจัดลำดับ'}><Icon name="grip" /></span>
                        <span className="muted num" style={{ width: 26, textAlign: 'right', fontSize: 14 }}>{n + 1}</span>
                        <button className="row" onClick={() => setOpen(i)} style={{ gap: 10, flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0, font: 'inherit' }}>
                          <span style={{ width: 42, height: 42, borderRadius: 8, background: tintFor(i.id), overflow: 'hidden', display: 'grid', placeItems: 'center', flex: 'none' }}>
                            {i.image_url ? <img src={i.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <BowlIcon size={22} />}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{i.name}</span>
                            {!i.active && <span className="pill" style={{ marginLeft: 8, background: 'var(--line-soft)' }}>ปิดขาย</span>}
                            {i.station === 'bar' && <span className="pill" style={{ marginLeft: 8, background: 'var(--info-soft)', color: 'var(--info-ink)' }}>บาร์</span>}
                          </span>
                        </button>
                        <b style={{ whiteSpace: 'nowrap' }}>{formatBaht(i.price)}</b>
                        <button className="btn" style={{ minHeight: 40, padding: '0 10px' }} disabled={searching || n === 0} aria-label={`เลื่อน ${i.name} ขึ้น`}
                          onClick={() => reorderItems(current.id, swap(current.items.map((x) => x.id), i.id, -1))}><Icon name="up" /></button>
                        <button className="btn" style={{ minHeight: 40, padding: '0 10px' }} disabled={searching || n === current.items.length - 1} aria-label={`เลื่อน ${i.name} ลง`}
                          onClick={() => reorderItems(current.id, swap(current.items.map((x) => x.id), i.id, 1))}><Icon name="down" /></button>
                        <button className="btn" style={{ minHeight: 40, padding: '0 10px' }} aria-label={`แก้ ${i.name}`} onClick={() => setOpen(i)}><Icon name="edit" /></button>
                      </div>
                    ))}
                  </div>
                  {searching && <p className="muted" style={{ margin: 0, fontSize: 13 }}>กำลังค้นหาอยู่ — ล้างช่องค้นหาเพื่อจัดลำดับ</p>}
                </section>
              ) : <p className="muted">ยังไม่มีหมวด — เพิ่มหมวดแรกทางซ้ายได้เลย</p>}
            </div>
          </>
        )}

        {items && mode === 'cost' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Stat label="เมนูที่มีสูตรแล้ว" value={`${withRecipe.length} / ${items.length}`} />
              <Stat label="Food cost เฉลี่ย (ตามสูตร)" value={`${avgPct}%`} tone={avgPct > TARGET_PCT ? 'warn' : 'good'} />
              <Stat label={`เมนูที่ต้นทุนเกิน ${TARGET_PCT}%`} value={overTarget} tone={overTarget ? 'warn' : undefined} />
            </div>
            <section className="card" style={{ padding: '12px 18px' }}>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th>เมนู</th><th className="num">ราคาขาย</th><th className="num">ต้นทุน</th><th className="num">Food cost</th><th className="num">กำไรขั้นต้น</th>
                  </tr></thead>
                  <tbody>
                    {sections.map((s) => {
                      const rows = s.items.filter(matches);
                      if (!rows.length) return null;
                      return [
                        <tr key={`h-${s.id}`}><td colSpan={5} style={{ background: 'var(--line-soft)', fontWeight: 700, height: 36 }}>{s.name} <span className="muted" style={{ fontWeight: 400 }}>{s.items.length} เมนู</span></td></tr>,
                        ...rows.map((i) => (
                          <tr key={i.id} className="click" onClick={() => setOpen(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
                            <td style={{ fontWeight: 600 }}>{i.name}{!i.active && <span className="pill" style={{ marginLeft: 8, background: 'var(--line-soft)' }}>ปิดขาย</span>}</td>
                            <td className="num">{formatBaht(i.price)}</td>
                            <td className="num">{i.recipe_lines ? formatBaht(i.cost) : <span className="muted">ยังไม่มีสูตร</span>}</td>
                            <td className="num" style={{ fontWeight: 700, color: !i.recipe_lines ? 'var(--muted)' : i.food_cost_pct > TARGET_PCT ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
                              {i.recipe_lines ? `${i.food_cost_pct}%` : '—'}
                            </td>
                            <td className="num">{i.recipe_lines ? formatBaht(i.margin) : '—'}</td>
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              {items.length === 0 && <p className="muted">ยังไม่มีเมนู — กด “เพิ่มเมนู” ได้เลย</p>}
            </section>
          </>
        )}
      </main>
      {(open || adding) && (
        <ItemSheet item={open} ings={ings} cats={cats} groups={groups} items={items ?? []} vatRatio={vatRatio}
          defaultCategoryId={adding && current && current.id !== NO_CAT ? current.id : undefined}
          onClose={() => { setOpen(null); setAdding(false); }} onSaved={() => { setOpen(null); setAdding(false); load(); }}
          onIngsChanged={() => api('GET', '/api/ingredients').then(setIngs)} />
      )}
    </>
  );
}

function CategoryColumn({ sections, current, drag, over, items, onSelect, onDrag, onOver, onDrop, onMove, onAdd }: {
  sections: Array<{ id: string; name: string; items: any[] }>; current?: { id: string }; items: any[];
  drag: { kind: 'cat' | 'item'; id: string } | null; over: string | null;
  onSelect: (id: string) => void; onDrag: (d: { kind: 'cat' | 'item'; id: string } | null) => void; onOver: (id: string | null) => void;
  onDrop: (id: string) => void; onMove: (id: string, d: -1 | 1) => void; onAdd: (name: string) => Promise<void>;
}) {
  const [add, setAdd] = useState('');
  return (
    <section className="card" style={{ flex: '1 1 240px', maxWidth: 320, padding: '12px 10px', display: 'grid', gap: 4 }}>
      <div className="muted" style={{ fontSize: 13, fontWeight: 600, padding: '0 6px' }}>หมวด · {items.length} เมนู</div>
      {sections.map((s, n) => {
        const on = current?.id === s.id;
        const target = over === s.id && drag && !(drag.kind === 'cat' && drag.id === s.id);
        return (
          <div key={s.id} draggable={s.id !== NO_CAT} onDragStart={() => onDrag({ kind: 'cat', id: s.id })} onDragEnd={() => { onDrag(null); onOver(null); }}
            onDragOver={(e) => { e.preventDefault(); onOver(s.id); }} onDrop={(e) => { e.preventDefault(); onDrop(s.id); }}
            className="row" style={{
              gap: 4, borderRadius: 10, padding: '2px 4px', border: target ? '2px dashed var(--accent)' : '2px solid transparent',
              background: on ? 'var(--accent-soft)' : undefined, opacity: drag?.id === s.id ? 0.4 : 1,
            }}>
            <span className="muted" style={{ cursor: s.id === NO_CAT ? 'default' : 'grab', display: 'grid', placeItems: 'center', width: 20 }}>{s.id !== NO_CAT && <Icon name="grip" />}</span>
            <button onClick={() => onSelect(s.id)} aria-pressed={on}
              style={{ flex: 1, minHeight: 46, textAlign: 'left', background: 'none', border: 0, font: 'inherit', cursor: 'pointer', fontWeight: on ? 700 : 500, color: on ? 'var(--accent-ink)' : 'var(--ink)' }}>
              {s.name} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{s.items.length}</span>
            </button>
            {s.id !== NO_CAT && (
              <>
                <button className="btn" style={{ minHeight: 36, padding: '0 8px' }} disabled={n === 0} aria-label={`เลื่อนหมวด ${s.name} ขึ้น`} onClick={() => onMove(s.id, -1)}><Icon name="up" size={16} /></button>
                <button className="btn" style={{ minHeight: 36, padding: '0 8px' }} disabled={n >= sections.filter((x) => x.id !== NO_CAT).length - 1} aria-label={`เลื่อนหมวด ${s.name} ลง`} onClick={() => onMove(s.id, 1)}><Icon name="down" size={16} /></button>
              </>
            )}
          </div>
        );
      })}
      <form className="row" style={{ marginTop: 6 }} onSubmit={async (e) => { e.preventDefault(); if (add.trim()) { await onAdd(add.trim()); setAdd(''); } }}>
        <input aria-label="ชื่อหมวดใหม่" placeholder="หมวดใหม่" value={add} onChange={(e) => setAdd(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0, height: 42 }} />
        <button className="btn" type="submit" disabled={!add.trim()} aria-label="เพิ่มหมวด"><Icon name="plus" /></button>
      </form>
    </section>
  );
}

function CategoryHeader({ section, onRename, onDelete }: { section: { id: string; name: string; items: any[] }; onRename: (name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(section.name);
  if (editing) {
    return (
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onRename(name.trim()); setEditing(false); } }}>
        <input aria-label="ชื่อหมวด" autoFocus value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <button className="btn btn-primary" type="submit"><Icon name="check" /> บันทึก</button>
        <button className="btn" type="button" onClick={() => { setName(section.name); setEditing(false); }}>ยกเลิก</button>
      </form>
    );
  }
  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{section.name}</h2>
      <span className="muted" style={{ fontSize: 14 }}>{section.items.length} เมนู</span>
      <span className="spacer" />
      {section.id !== NO_CAT && (
        <>
          <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> เปลี่ยนชื่อหมวด</button>
          <button className="btn btn-warn" disabled={section.items.length > 0} title={section.items.length ? 'ย้ายเมนูออกก่อน' : undefined} onClick={onDelete}><Icon name="trash" /> ลบหมวด</button>
        </>
      )}
    </div>
  );
}
