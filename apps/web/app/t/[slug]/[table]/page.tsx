'use client';

import { formatBaht } from '@prakai/core';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';

interface Group { id: string; name: string; min_select: number; max_select: number; options: { id: string; name: string; price: number }[] }
interface Item { id: string; category_id: string | null; name: string; price: number; image_url: string | null; group_ids: string[] }
interface Menu {
  shop: { name: string; logoUrl: string | null };
  table: { id: string; name: string };
  categories: { id: string; name: string }[];
  items: Item[];
  groups: Group[];
}
interface CartLine { key: string; item: Item; qty: number; note: string; options: { id: string; name: string; price: number }[] }

/** Customer ordering page, opened by scanning the sticker on the table. No sign-in: the signed link is the credential. */
function Order() {
  const { slug, table } = useParams<{ slug: string; table: string }>();
  const k = useSearchParams().get('k') ?? '';
  const base = `/api/public/qr/${slug}/${table}`;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [fatal, setFatal] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);
  const [cat, setCat] = useState<string>('all');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ total: number } | null>(null);

  useEffect(() => {
    api<Menu>('GET', `${base}?k=${encodeURIComponent(k)}`).then(setMenu).catch((e) => {
      setFatal(e?.code === 'qr_disabled' ? 'ร้านนี้ปิดรับออเดอร์ผ่าน QR ชั่วคราว กรุณาเรียกพนักงาน'
        : e?.status === 404 ? 'ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาสแกน QR ที่โต๊ะอีกครั้ง หรือเรียกพนักงาน' : errText(e));
    });
  }, [base, k]);

  const groups = useMemo(() => new Map(menu?.groups.map((g) => [g.id, g])), [menu]);
  const shown = menu?.items.filter((i) => cat === 'all' || i.category_id === cat) ?? [];
  const total = cart.reduce((s, l) => s + (l.item.price + l.options.reduce((a, o) => a + o.price, 0)) * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  function add(item: Item, options: CartLine['options'], itemNote: string) {
    const key = `${item.id}|${options.map((o) => o.id).sort().join(',')}|${itemNote}`;
    setCart((c) => c.some((l) => l.key === key) ? c.map((l) => l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l) : [...c, { key, item, qty: 1, note: itemNote, options }]);
    setPicking(null);
  }
  const bump = (key: string, d: number) => setCart((c) => c.flatMap((l) => l.key !== key ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: Math.min(20, l.qty + d) }]));

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ total: number }>('POST', `${base}/orders?k=${encodeURIComponent(k)}`, {
        items: cart.map((l) => ({ menuItemId: l.item.id, qty: l.qty, note: l.note || undefined, options: l.options.map((o) => o.id) })),
        note: note.trim() || undefined,
      });
      setSent(r); setCart([]); setNote('');
    } catch (e) {
      setErr((e as { code?: string })?.code === 'too_many_pending' ? 'มีออเดอร์รอพนักงานรับอยู่หลายรายการแล้ว กรุณารอสักครู่หรือเรียกพนักงาน'
        : (e as { status?: number })?.status === 429 ? 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' : errText(e));
    } finally { setBusy(false); }
  }

  const shell: React.CSSProperties = { maxWidth: 560, margin: '0 auto', padding: '16px 16px 140px', display: 'grid', gap: 14 };
  if (fatal) return <main style={shell}><div className="error" role="alert" style={{ marginTop: 40, textAlign: 'center', padding: 24 }}>{fatal}</div></main>;
  if (!menu) return <main style={shell}><p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>กำลังโหลดเมนู…</p></main>;

  if (sent) return (
    <main style={shell}>
      <div className="card" style={{ padding: 24, textAlign: 'center', display: 'grid', gap: 10, marginTop: 40 }} role="status">
        <h1 style={{ margin: 0, fontSize: 24 }}>ส่งออเดอร์แล้ว</h1>
        <p style={{ margin: 0 }}>พนักงานกำลังตรวจรับออเดอร์ของโต๊ะ {menu.table.name}</p>
        <div style={{ fontSize: 28, fontWeight: 700 }}>฿{formatBaht(sent.total)}</div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>ยังไม่ได้ชำระเงิน ชำระกับพนักงานเมื่อรับประทานเสร็จ · หากรอนานเรียกพนักงานได้เลย</p>
        <button className="btn btn-primary btn-lg" onClick={() => setSent(null)}>สั่งเพิ่ม</button>
      </div>
    </main>
  );

  if (!confirmed) return (
    <main style={shell}>
      <div className="card" style={{ padding: 24, textAlign: 'center', display: 'grid', gap: 12, marginTop: 40 }}>
        {menu.shop.logoUrl && <img src={menu.shop.logoUrl} alt="" style={{ height: 64, objectFit: 'contain', margin: '0 auto' }} />}
        <h1 style={{ margin: 0, fontSize: 24 }}>{menu.shop.name}</h1>
        <p className="muted" style={{ margin: 0 }}>คุณนั่งอยู่ที่โต๊ะ</p>
        <div className="display" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>{menu.table.name}</div>
        <button className="btn btn-primary btn-lg" onClick={() => setConfirmed(true)}>ใช่ ถูกต้อง · ดูเมนู</button>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>ไม่ใช่โต๊ะของคุณ? กรุณาสแกน QR ที่โต๊ะตัวเอง</p>
      </div>
    </main>
  );

  return (
    <main style={shell}>
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div><strong style={{ fontSize: 20 }}>{menu.shop.name}</strong><div className="muted" style={{ fontSize: 14 }}>โต๊ะ {menu.table.name}</div></div>
      </header>
      <nav aria-label="หมวดเมนู" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {[{ id: 'all', name: 'ทั้งหมด' }, ...menu.categories].map((c) => (
          <button key={c.id} className="btn" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} style={{ whiteSpace: 'nowrap', minHeight: 44 }}>{c.name}</button>
        ))}
      </nav>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {shown.map((i) => (
          <li key={i.id} className="card row" style={{ padding: 12 }}>
            {i.image_url && <img src={i.image_url} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }} />}
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{i.name}</div><div className="muted">฿{formatBaht(i.price)}</div></div>
            <button className="btn btn-primary" style={{ minHeight: 48 }} aria-label={`เพิ่ม ${i.name}`}
              onClick={() => i.group_ids.length ? setPicking(i) : add(i, [], '')}>+ เพิ่ม</button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">ยังไม่มีเมนูในหมวดนี้</li>}
      </ul>

      {count > 0 && (
        <section aria-label="ตะกร้า" className="card" style={{ position: 'fixed', left: 8, right: 8, bottom: 8, maxWidth: 544, margin: '0 auto', padding: 12, display: 'grid', gap: 8, maxHeight: '55vh', overflowY: 'auto', boxShadow: '0 -4px 24px rgba(0,0,0,.12)' }}>
          {cart.map((l) => (
            <div key={l.key} className="row">
              <div style={{ flex: 1, fontSize: 15 }}>
                {l.item.name}{l.options.length > 0 && <span className="muted"> ({l.options.map((o) => o.name).join(', ')})</span>}
                {l.note && <div className="muted" style={{ fontSize: 13 }}>{l.note}</div>}
              </div>
              <button className="btn" style={{ minHeight: 40, minWidth: 40 }} aria-label={`ลด ${l.item.name}`} onClick={() => bump(l.key, -1)}>−</button>
              <span style={{ minWidth: 20, textAlign: 'center' }}>{l.qty}</span>
              <button className="btn" style={{ minHeight: 40, minWidth: 40 }} aria-label={`เพิ่ม ${l.item.name} อีกหนึ่ง`} onClick={() => bump(l.key, 1)}>+</button>
            </div>
          ))}
          <label className="field">ข้อความถึงร้าน (ถ้ามี)
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ขอช้อนเพิ่ม" />
          </label>
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
            {busy ? 'กำลังส่ง…' : `ส่งออเดอร์ · ${count} รายการ · ฿${formatBaht(total)}`}
          </button>
        </section>
      )}

      {picking && <Picker item={picking} groups={picking.group_ids.map((g) => groups.get(g)!).filter(Boolean)} onClose={() => setPicking(null)} onAdd={add} />}
    </main>
  );
}

function Picker({ item, groups, onClose, onAdd }: { item: Item; groups: Group[]; onClose: () => void; onAdd: (i: Item, o: CartLine['options'], note: string) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const chosen = groups.flatMap((g) => g.options.filter((o) => sel[g.id]?.includes(o.id)));
  const missing = groups.find((g) => (sel[g.id]?.length ?? 0) < g.min_select);
  const toggle = (g: Group, id: string) => setSel((s) => {
    const cur = s[g.id] ?? [];
    if (g.max_select === 1) return { ...s, [g.id]: cur[0] === id ? [] : [id] };
    return { ...s, [g.id]: cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < g.max_select ? [...cur, id] : cur };
  });
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,22,.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 30 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', width: 'min(560px, 100%)', maxHeight: '85vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: 18, display: 'grid', gap: 14 }}>
        <div className="row"><h2 style={{ margin: 0, fontSize: 21, flex: 1 }}>{item.name}</h2><button className="btn" onClick={onClose}>ปิด</button></div>
        {groups.map((g) => (
          <fieldset key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
            <legend style={{ fontWeight: 600 }}>{g.name} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{g.min_select > 0 ? '(ต้องเลือก)' : g.max_select > 1 ? `(เลือกได้ไม่เกิน ${g.max_select})` : '(ไม่บังคับ)'}</span></legend>
            {g.options.map((o) => (
              <button key={o.id} type="button" className="btn" aria-pressed={sel[g.id]?.includes(o.id) ?? false} onClick={() => toggle(g, o.id)} style={{ justifyContent: 'space-between' }}>
                <span>{o.name}</span>{o.price > 0 && <span>+฿{formatBaht(o.price)}</span>}
              </button>
            ))}
          </fieldset>
        ))}
        <label className="field">หมายเหตุ (ถ้ามี)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ไม่ใส่ผัก" /></label>
        <button className="btn btn-primary btn-lg" disabled={!!missing} onClick={() => onAdd(item, chosen, note.trim())}>
          {missing ? `เลือก “${missing.name}” ก่อน` : `ใส่ตะกร้า · ฿${formatBaht(item.price + chosen.reduce((s, o) => s + o.price, 0))}`}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><Order /></Suspense>;
}
