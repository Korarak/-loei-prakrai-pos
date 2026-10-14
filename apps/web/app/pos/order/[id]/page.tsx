'use client';

import { formatBaht } from '@prakai/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { BackIcon, BowlIcon, tintFor } from '@/lib/ui';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../TopBar';
import { OptionPicker, type OptionGroup } from './OptionPicker';
import { TableOps } from './TableOps';

interface Item { id: string; category_id: string | null; name: string; price: number; active: boolean; image_url: string | null; group_ids: string[] }
interface Line { id: string; menu_item_id: string; name: string; unit_price: number; qty: number; note: string | null; options: { id: string; name: string; price: number }[]; status: 'new' | 'sent' | 'void'; void_reason: string | null }
interface OrderView {
  order: { id: string; bill_no: number; status: string; table_id: string | null; table_name: string | null; guests: number; channel: string; discount_type: string; discount_value: number };
  parent: { id: string; bill_no: number; table_name: string | null } | null;
  splits: { id: string; bill_no: number; status: string; amount: number }[];
  merged_into: string | null;
  lines: Line[];
  bill: { gross: number; discount: number; vatableBase: number; exemptBase: number; serviceCharge: number; vat: number; total: number };
  document: { id: string } | null;
}

const stepBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 10, border: '1px solid var(--line-2)', background: '#fff', fontSize: 22, lineHeight: 1 };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useMe();
  const canPay = !me || ['owner', 'manager', 'cashier'].includes(me.role);
  const [menu, setMenu] = useState<{ categories: { id: string; name: string }[]; items: Item[]; groups: OptionGroup[] } | null>(null);
  const [picking, setPicking] = useState<Item | null>(null);
  const [cat, setCat] = useState<string>('all');
  const [view, setView] = useState<OrderView | null>(null);
  const [err, setErr] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [batch, setBatch] = useState<string | null>(null);

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
        <h1>บิล #{view.order.bill_no} {view.merged_into ? 'ถูกรวมเข้ากับบิลอื่นแล้ว' : 'ปิดแล้ว'}</h1>
        {view.merged_into && <Link className="btn btn-primary btn-lg" href={`/pos/order/${view.merged_into}`}><Icon name="back" /> ไปที่บิลที่รวมแล้ว</Link>}
        {view.document && <Link className="btn btn-primary btn-lg" href={`/receipt/${view.document.id}`}><Icon name="receipt" /> ดูใบเสร็จ</Link>}
        {view.parent && <Link className="btn btn-lg" href={`/pos/order/${view.parent.id}`}>กลับไปบิลหลักของโต๊ะ {view.parent.table_name}</Link>}
        <Link className="btn" href="/pos"><Icon name="back" /> กลับผังโต๊ะ</Link>
      </main>
    );
  }

  const items = (menu?.items ?? []).filter((i) => i.active && (cat === 'all' || i.category_id === cat));
  const live = view?.lines.filter((l) => l.status !== 'void') ?? [];
  const hasNew = live.some((l) => l.status === 'new');
  const hasSent = live.some((l) => l.status === 'sent');
  const b = view?.bill;
  const vatIncluded = me?.tenant.vat_registered && me.tenant.price_includes_vat;
  const title = !view ? '' : view.order.table_name ? `โต๊ะ ${view.order.table_name}`
    : view.parent ? `บิลแยกจากโต๊ะ ${view.parent.table_name ?? `#${view.parent.bill_no}`}` : 'กลับบ้าน';
  const openSplits = view?.splits.filter((x) => x.status === 'open') ?? [];

  return (
    <div className="order-shell">
      <TopBar me={me}>
        <Link href="/pos" className="btn"><BackIcon /> {title}{view?.order.table_name ? ` · ${view.order.guests} ท่าน` : ''}</Link>
      </TopBar>
      <div className="order-body">
        <main className="order-menu">
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 12 }}>
            {items.map((i) => {
              const q = qtyByItem.get(i.id) ?? 0;
              return (
                <button key={i.id} aria-label={`เพิ่ม ${i.name}`} onClick={() => i.group_ids.length ? setPicking(i) : run(() => api('POST', `/api/orders/${id}/lines`, { menuItemId: i.id }))}
                  style={{ display: 'flex', flexDirection: 'column', padding: 0, textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ position: 'relative', width: '100%', height: 104, background: tintFor(i.id), display: 'grid', placeItems: 'center' }}>
                    {i.image_url ? <img src={i.image_url} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <BowlIcon />}
                    {q > 0 && <span style={{ position: 'absolute', top: 8, right: 8, minWidth: 34, height: 34, padding: '0 8px', borderRadius: 17, background: 'var(--accent)', color: '#fff', fontSize: 17, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{q}</span>}
                  </div>
                  <div style={{ padding: '10px 14px 12px', width: '100%' }}>
                    <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.name}</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>฿{formatBaht(i.price).replace(/\.00$/, '')}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="order-aside">
          <div className="row" style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>รายการสั่ง</div>
              <div className="muted" style={{ fontSize: 14 }}>บิล #{view?.order.bill_no} · {live.reduce((s, l) => s + l.qty, 0)} รายการ</div>
            </div>
          </div>
          {view && live.length > 0 && (
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line-soft)' }}>
              <TableOps orderId={id} tableId={view.order.table_id} lines={view.lines} onDone={load} />
            </div>
          )}
          {openSplits.length > 0 && (
            <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--line-soft)', display: 'grid', gap: 6 }}>
              {openSplits.map((x) => (
                <Link key={x.id} href={`/pos/order/${x.id}`} className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontWeight: 600 }}>
                  <span>บิลแยก #{x.bill_no} ยังไม่ชำระ</span><span>฿{formatBaht(x.amount)} ›</span>
                </Link>
              ))}
            </div>
          )}

          <div className="order-lines" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 20px' }}>
            {live.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '48px 0' }}>แตะเมนูทางซ้ายเพื่อเพิ่มรายการ</p>}
            {live.map((l) => (
              <div key={l.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div className="row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{l.name}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {l.options.length > 0 && <div style={{ color: 'var(--ink)' }}>{l.options.map((o) => o.name).join(' · ')}</div>}
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
                    <button className="btn btn-warn" style={{ minHeight: 44 }} onClick={() => { setVoiding(l.id); setReason(''); }}><Icon name="ban" /> ยกเลิก ×{l.qty}</button>
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
                    <button className="btn btn-danger" style={{ alignSelf: 'end' }}><Icon name="ban" /> ยืนยันยกเลิกรายการ</button>
                    <button type="button" className="btn" style={{ alignSelf: 'end' }} onClick={() => setVoiding(null)}><Icon name="close" /> ไม่ยกเลิก</button>
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
          {(batch || hasSent) && (
            <div className="row" style={{ padding: '10px 20px 0', gap: 8 }}>
              {batch && <Link className="btn btn-outline" style={{ flex: 1 }} href={`/kitchen/${id}?at=${encodeURIComponent(batch)}`}><Icon name="print" /> พิมพ์ใบสั่งครัวรอบนี้</Link>}
              <Link className="btn" style={{ flex: batch ? undefined : 1 }} href={`/kitchen/${id}`}><Icon name="print" /> พิมพ์ซ้ำทั้งโต๊ะ</Link>
            </div>
          )}
          <div className="row order-actions" style={{ gap: 10 }}>
            <button className="btn btn-outline btn-lg" style={{ width: 132 }} disabled={!hasNew}
              onClick={() => run(async () => setBatch((await api('POST', `/api/orders/${id}/send`)).sentAt))}><Icon name="send" size={22} /> ส่งครัว</button>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={live.length === 0 || !canPay}
              title={canPay ? undefined : 'พนักงานเสิร์ฟรับชำระเงินไม่ได้ ให้แคชเชียร์รับ'}
              onClick={() => router.push(`/pos/order/${id}/pay`)}><Icon name="wallet" size={24} /> ชำระเงิน</button>
          </div>
        </aside>
      </div>
      {picking && menu && (
        <OptionPicker item={picking} groups={picking.group_ids.map((g) => menu.groups.find((x) => x.id === g)).filter((g): g is OptionGroup => !!g)}
          onCancel={() => setPicking(null)}
          onAdd={(a) => { const item = picking; setPicking(null); run(() => api('POST', `/api/orders/${id}/lines`, { menuItemId: item.id, qty: a.qty, options: a.options, note: a.note || undefined })); }} />
      )}
    </div>
  );
}
