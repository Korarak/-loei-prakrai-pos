'use client';

import { formatBaht } from '@prakai/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { BackIcon, BowlIcon, tintFor } from '@/lib/ui';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../TopBar';

interface Item { id: string; category_id: string | null; name: string; price: number; active: boolean }
interface Line { id: string; menu_item_id: string; name: string; unit_price: number; qty: number; note: string | null; status: 'new' | 'sent' | 'void'; void_reason: string | null }
interface OrderView {
  order: { id: string; bill_no: number; status: string; table_name: string | null; guests: number; channel: string; discount_type: string; discount_value: number };
  lines: Line[];
  bill: { gross: number; discount: number; vatableBase: number; exemptBase: number; serviceCharge: number; vat: number; total: number };
  document: { id: string } | null;
}

const stepBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 10, border: '1px solid var(--line-2)', background: '#fff', fontSize: 22, lineHeight: 1 };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useMe();
  const [menu, setMenu] = useState<{ categories: { id: string; name: string }[]; items: Item[] } | null>(null);
  const [cat, setCat] = useState<string>('all');
  const [view, setView] = useState<OrderView | null>(null);
  const [err, setErr] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => api<OrderView>('GET', `/api/orders/${id}`).then(setView).catch((e) => setErr(errText(e))), [id]);
  useEffect(() => { load(); api('GET', '/api/menu').then(setMenu); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); await load(); } catch (e) { setErr(errText(e)); }
  };

  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>();
    view?.lines.filter((l) => l.status !== 'void').forEach((l) => m.set(l.menu_item_id, (m.get(l.menu_item_id) ?? 0) + l.qty));
    return m;
  }, [view]);

  if (view && view.order.status !== 'open') {
    return (
      <main style={{ padding: 40, display: 'grid', gap: 16, justifyItems: 'start' }}>
        <h1>บิล #{view.order.bill_no} ปิดแล้ว</h1>
        {view.document && <Link className="btn btn-primary btn-lg" href={`/receipt/${view.document.id}`}>ดูใบเสร็จ</Link>}
        <Link className="btn" href="/pos">กลับผังโต๊ะ</Link>
      </main>
    );
  }

  const items = (menu?.items ?? []).filter((i) => i.active && (cat === 'all' || i.category_id === cat));
  const live = view?.lines.filter((l) => l.status !== 'void') ?? [];
  const hasNew = live.some((l) => l.status === 'new');
  const b = view?.bill;
  const vatIncluded = me?.tenant.vat_registered && me.tenant.price_includes_vat;
  const title = view ? (view.order.table_name ? `โต๊ะ ${view.order.table_name}` : 'กลับบ้าน') : '';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me}>
        <Link href="/pos" className="btn"><BackIcon /> {title}{view?.order.table_name ? ` · ${view.order.guests} ท่าน` : ''}</Link>
      </TopBar>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
          <nav aria-label="หมวดเมนู" style={{ display: 'flex', gap: 10, overflowX: 'auto', flexShrink: 0 }}>
            {[{ id: 'all', name: 'ทั้งหมด' }, ...(menu?.categories ?? [])].map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
                style={{ height: 52, flexShrink: 0, padding: '0 20px', borderRadius: 26, fontSize: 16, fontWeight: cat === c.id ? 600 : 500,
                  border: `1px solid ${cat === c.id ? 'var(--accent)' : 'var(--line-2)'}`, background: cat === c.id ? 'var(--accent)' : '#fff',
                  color: cat === c.id ? '#fff' : 'var(--ink)' }}>
                {c.name}
              </button>
            ))}
          </nav>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            {items.map((i) => {
              const q = qtyByItem.get(i.id) ?? 0;
              return (
                <button key={i.id} aria-label={`เพิ่ม ${i.name}`} onClick={() => run(() => api('POST', `/api/orders/${id}/lines`, { menuItemId: i.id }))}
                  style={{ display: 'flex', flexDirection: 'column', padding: 0, textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ position: 'relative', width: '100%', height: 104, background: tintFor(i.id), display: 'grid', placeItems: 'center' }}>
                    <BowlIcon />
                    {q > 0 && <span style={{ position: 'absolute', top: 8, right: 8, minWidth: 34, height: 34, padding: '0 8px', borderRadius: 17, background: 'var(--accent)', color: '#fff', fontSize: 17, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{q}</span>}
                  </div>
                  <div style={{ padding: '10px 14px 12px', width: '100%' }}>
                    <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>฿{formatBaht(i.price).replace(/\.00$/, '')}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </main>

        <aside style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid var(--line)' }}>
          <div className="row" style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>รายการสั่ง</div>
              <div className="muted" style={{ fontSize: 14 }}>บิล #{view?.order.bill_no} · {live.reduce((s, l) => s + l.qty, 0)} รายการ</div>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 20px' }}>
            {live.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '48px 0' }}>แตะเมนูทางซ้ายเพื่อเพิ่มรายการ</p>}
            {live.map((l) => (
              <div key={l.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div className="row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{l.name}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      ฿{formatBaht(l.unit_price)}{l.note ? ` · ${l.note}` : ''}{l.status === 'sent' ? ' · ส่งครัวแล้ว' : ''}
                    </div>
                  </div>
                  {l.status === 'new' ? (
                    <div className="row" style={{ gap: 6 }}>
                      <button style={stepBtn} aria-label={`ลดจำนวน ${l.name}`}
                        onClick={() => run(() => l.qty > 1
                          ? api('PATCH', `/api/orders/${id}/lines/${l.id}`, { qty: l.qty - 1 })
                          : api('POST', `/api/orders/${id}/lines/${l.id}/void`, {}))}>−</button>
                      <span style={{ width: 28, textAlign: 'center', fontSize: 19, fontWeight: 700 }}>{l.qty}</span>
                      <button style={stepBtn} aria-label={`เพิ่มจำนวน ${l.name}`}
                        onClick={() => run(() => api('PATCH', `/api/orders/${id}/lines/${l.id}`, { qty: l.qty + 1 }))}>+</button>
                    </div>
                  ) : (
                    <button className="btn btn-warn" style={{ minHeight: 44 }} onClick={() => { setVoiding(l.id); setReason(''); }}>ยกเลิก ×{l.qty}</button>
                  )}
                  <div style={{ width: 80, textAlign: 'right', fontSize: 18, fontWeight: 700 }}>{formatBaht(l.unit_price * l.qty)}</div>
                </div>
                {voiding === l.id && (
                  <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); run(() => api('POST', `/api/orders/${id}/lines/${l.id}/void`, { reason })).then(() => setVoiding(null)); }}>
                    <label style={{ flex: 1 }}>
                      <span className="muted" style={{ fontSize: 13 }}>เหตุผล (ต้องเป็นผู้จัดการ)</span>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} autoFocus
                        style={{ width: '100%', height: 44, padding: '0 10px', borderRadius: 10, border: '1px solid var(--line-2)' }} />
                    </label>
                    <button className="btn btn-warn" style={{ alignSelf: 'end' }}>ยืนยัน</button>
                    <button type="button" className="btn" style={{ alignSelf: 'end' }} onClick={() => setVoiding(null)}>ปิด</button>
                  </form>
                )}
              </div>
            ))}
          </div>

          {b && (
            <div style={{ padding: '14px 20px 6px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 16 }}>
              <div className="row muted" style={{ justifyContent: 'space-between' }}><span>รวมค่าอาหาร</span><span>{formatBaht(b.gross)}</span></div>
              {b.discount > 0 && <div className="row muted" style={{ justifyContent: 'space-between' }}><span>ส่วนลด</span><span>−{formatBaht(b.discount)}</span></div>}
              {b.serviceCharge > 0 && <div className="row muted" style={{ justifyContent: 'space-between' }}><span>ค่าบริการ</span><span>{formatBaht(b.serviceCharge)}</span></div>}
              {me?.tenant.vat_registered && <>
                <div className="row muted" style={{ justifyContent: 'space-between' }}><span>มูลค่าก่อน VAT</span><span>{formatBaht(b.vatableBase + b.exemptBase + b.serviceCharge)}</span></div>
                <div className="row muted" style={{ justifyContent: 'space-between' }}><span>VAT 7% {vatIncluded ? '(รวมในราคาแล้ว)' : ''}</span><span>{formatBaht(b.vat)}</span></div>
              </>}
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>ยอดชำระ</span>
                <span style={{ fontSize: 38, fontWeight: 700 }}>฿{formatBaht(b.total)}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {[['ไม่มีส่วนลด', 'none', 0], ['ลด 5%', 'percent', 500], ['ลด 10%', 'percent', 1000]].map(([label, type, value]) => (
                  <button key={label as string} className="btn" style={{ flex: 1, minHeight: 44, fontSize: 14 }}
                    aria-pressed={view!.order.discount_type === type && view!.order.discount_value === value}
                    onClick={() => run(() => api('PUT', `/api/orders/${id}/discount`, { type, value }))}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {err && <div className="error" role="alert" style={{ margin: '8px 20px 0' }}>{err}</div>}
          <div className="row" style={{ padding: '12px 20px 20px', gap: 10 }}>
            <button className="btn btn-outline btn-lg" style={{ width: 132 }} disabled={!hasNew}
              onClick={() => run(() => api('POST', `/api/orders/${id}/send`))}>ส่งครัว</button>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={live.length === 0}
              onClick={() => router.push(`/pos/order/${id}/pay`)}>ชำระเงิน</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
