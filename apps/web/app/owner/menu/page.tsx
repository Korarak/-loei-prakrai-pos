'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sheet, Stat } from '@/lib/owner';
import { BowlIcon, tintFor } from '@/lib/ui';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { ItemSheet, TARGET_PCT } from './ItemSheet';

export default function MenuCosting() {
  const { me } = useMe();
  const [items, setItems] = useState<any[] | null>(null);
  const [ings, setIngs] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [managingCats, setManagingCats] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api('GET', '/api/costing/menu').then(setItems),
    api('GET', '/api/ingredients').then(setIngs),
    api('GET', '/api/menu').then((m) => setCats(m.categories)),
    api('GET', '/api/modifier-groups').then(setGroups),
  ]).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  const withRecipe = items?.filter((i) => i.recipe_lines > 0) ?? [];
  const avgPct = withRecipe.length ? Math.round(withRecipe.reduce((s, i) => s + i.food_cost_pct, 0) / withRecipe.length * 10) / 10 : 0;
  const over = withRecipe.filter((i) => i.food_cost_pct > TARGET_PCT).length;
  // Price → pre-VAT ratio this shop uses, so a new dish previews food cost before it exists on the server.
  const vatRatio = useMemo(() => {
    const ref = items?.find((i) => i.price > 0 && !i.vat_exempt);
    return ref ? ref.price_ex_vat / ref.price : 1;
  }, [items]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (items ?? []).filter((i) => (cat === 'all' || i.category_id === cat) && (!n || i.name.toLowerCase().includes(n)));
  }, [items, q, cat]);

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
        <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>เมนูและต้นทุน</h1>
            <span className="muted" style={{ fontSize: 14 }}>แตะเมนูเพื่อแก้</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setManagingCats(true)}>จัดการหมวด</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ เพิ่มเมนู</button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <input aria-label="ค้นหาเมนู" placeholder="ค้นหาเมนู" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ height: 46, borderRadius: 12, border: '1px solid #c9cfc7', padding: '0 12px', minWidth: 200, fontSize: 16 }} />
            <button className="btn" style={{ minHeight: 44 }} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>ทั้งหมด {items?.length ?? ''}</button>
            {cats.map((c) => (
              <button key={c.id} className="btn" style={{ minHeight: 44 }} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                {c.name} {items?.filter((i) => i.category_id === c.id).length ?? ''}
              </button>
            ))}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>เมนู</th><th>หมวด</th><th className="num">ราคาขาย</th><th className="num">ต้นทุน</th><th className="num">Food cost</th><th className="num">กำไรขั้นต้น</th>
              </tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setOpen(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
                    <td style={{ fontWeight: 600 }}>
                      <span className="row" style={{ gap: 10 }}>
                        <span style={{ width: 38, height: 38, borderRadius: 8, background: tintFor(i.id), overflow: 'hidden', display: 'grid', placeItems: 'center', flex: 'none' }}>
                          {i.image_url ? <img src={i.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <BowlIcon size={22} />}
                        </span>
                        <span>{i.name}
                          {!i.active && <span className="pill" style={{ marginLeft: 8, background: 'var(--line-soft)' }}>ปิดขาย</span>}
                          {i.station === 'bar' && <span className="pill" style={{ marginLeft: 8, background: 'var(--info-soft)', color: 'var(--info-ink)' }}>บาร์</span>}
                          {i.group_ids?.length > 0 && <span className="muted" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>{i.group_ids.length} คำถาม</span>}
                        </span>
                      </span>
                    </td>
                    <td className="muted">{i.category ?? '—'}</td>
                    <td className="num">{formatBaht(i.price)}</td>
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
          {items && shown.length === 0 && <p className="muted">{items.length === 0 ? 'ยังไม่มีเมนู — กด “+ เพิ่มเมนู” ได้เลย' : 'ไม่พบเมนูตามที่ค้นหา'}</p>}
          {!items && !err && <p className="muted">กำลังโหลด…</p>}
        </section>
      </main>
      {(open || adding) && (
        <ItemSheet item={open} ings={ings} cats={cats} groups={groups} items={items ?? []} vatRatio={vatRatio}
          onClose={() => { setOpen(null); setAdding(false); }} onSaved={() => { setOpen(null); setAdding(false); load(); }}
          onIngsChanged={() => api('GET', '/api/ingredients').then(setIngs)} />
      )}
      {managingCats && <CategorySheet cats={cats} items={items ?? []} onClose={() => { setManagingCats(false); load(); }} onChanged={setCats} />}
    </>
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
