'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, fmtQty, MonthPicker, Sheet, Stat, thisMonth, toSatang, today, UNIT } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { Icon } from '@/lib/icons';

const KIND: Record<string, string> = { food: 'อาหาร', beverage: 'เครื่องดื่ม', packaging: 'บรรจุภัณฑ์' };
const MOVE: Record<string, string> = { purchase: 'รับของ', sale: 'ขาย', waste: 'ของเสีย', adjust: 'ปรับจากนับสต็อก' };
/** Average cost of one purchase unit, in satang. */
const perPurchaseUnit = (i: any) => Math.round((i.avg_cost * i.purchase_factor) / 10_000);
const inPurchaseUnits = (i: any, q: number) => fmtQty(q / i.purchase_factor);

type Panel = null | 'purchase' | 'waste' | 'count' | 'new' | 'newPrep' | { edit: any };

export default function Stock() {
  const { me } = useMe();
  const [ings, setIngs] = useState<any[] | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const [purchases, setPurchases] = useState<any>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [err, setErr] = useState('');

  const load = () => api('GET', '/api/ingredients').then(setIngs).catch((e) => setErr(errText(e)));
  const loadPurchases = () => api('GET', `/api/purchases?month=${month}`).then(setPurchases).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { loadPurchases(); }, [month]);
  const done = () => { setPanel(null); load(); loadPurchases(); };

  const active = ings?.filter((i) => i.active) ?? [];
  const stocked = active.filter((i) => !i.is_prep);   // prep items hold no stock: not bought, not counted
  const value = active.reduce((s, i) => s + Math.max(i.stock_value, 0), 0);
  const low = active.filter((i) => i.low);
  const negative = active.filter((i) => i.on_hand < 0);

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <OwnerTabs active="stock" />
        {err && <div className="error" role="alert">{err}</div>}
        {ings && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Stat label="มูลค่าสต็อกคงเหลือ" value={`฿${formatBaht(value)}`} />
            <Stat label="ใกล้หมด" value={low.length} tone={low.length ? 'warn' : undefined} />
            <Stat label="ยอดติดลบ (ยังไม่บันทึกรับของ)" value={negative.length} tone={negative.length ? 'warn' : undefined} />
          </div>
        )}
        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>วัตถุดิบ</h1>
            <span className="muted" style={{ fontSize: 14 }}>ยอดคงเหลือคำนวณจากสมุดสต็อก แก้ตรงไม่ได้ ต้องรับของ บันทึกของเสีย หรือนับสต็อก</span>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setPanel('purchase')}><Icon name="box" /> รับของ</button>
            <button className="btn btn-warn" onClick={() => setPanel('waste')}><Icon name="box" /> ของเสีย</button>
            <button className="btn btn-outline" onClick={() => setPanel('count')}><Icon name="box" /> นับสต็อก</button>
            <button className="btn" onClick={() => setPanel('new')}><Icon name="plus" /> วัตถุดิบ</button>
            <button className="btn" onClick={() => setPanel('newPrep')}><Icon name="plus" /> สูตรย่อย</button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>วัตถุดิบ</th><th>ประเภท</th><th className="num">คงเหลือ</th><th className="num">ต้นทุนเฉลี่ย</th>
                <th className="num">yield</th><th className="num">มูลค่า</th><th className="num">ใช้ในเมนู</th>
              </tr></thead>
              <tbody>
                {ings?.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setPanel({ edit: i })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPanel({ edit: i })}
                    style={{ opacity: i.active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>
                      {i.name}
                      {i.low && <span className="pill" style={{ marginLeft: 8, background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>ใกล้หมด</span>}
                      {i.is_prep && <span className="pill" style={{ marginLeft: 8, background: 'var(--info-soft)', color: 'var(--info-ink)' }}>สูตรย่อย · {i.prep_lines} ส่วนผสม</span>}
                    </td>
                    <td className="muted">{KIND[i.kind]}</td>
                    {i.is_prep ? (
                      <td className="num muted">ทำ 1 ชุดได้ {fmtQty(i.batch_yield)} {UNIT[i.base_unit]}</td>
                    ) : (
                      <td className="num" style={{ color: i.on_hand < 0 ? 'var(--warn-ink)' : undefined }}>
                        {fmtQty(i.on_hand)} {UNIT[i.base_unit]}
                        <div className="muted" style={{ fontSize: 12, lineHeight: 1 }}>{inPurchaseUnits(i, i.on_hand)} {i.purchase_unit}</div>
                      </td>
                    )}
                    <td className="num">{formatBaht(perPurchaseUnit(i))} <span className="muted">/ {i.purchase_unit}</span></td>
                    <td className="num muted">{i.yield_pct}%</td>
                    <td className="num">{formatBaht(i.stock_value)}</td>
                    <td className="num muted">{i.used_in}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>การรับของและรายงานภาษีซื้อ</h2>
            <span className="spacer" />
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>วันที่</th><th>ผู้ขาย</th><th>เลขที่ใบกำกับ</th><th>รายการ</th>
                <th className="num">มูลค่า</th><th className="num">ภาษีซื้อ</th><th className="num">รวม</th><th>เคลม VAT</th>
              </tr></thead>
              <tbody>
                {purchases?.rows.map((p: any) => (
                  <tr key={p.id}>
                    <td>{dayLabel(p.purchased_on.slice(0, 10))}</td>
                    <td>{p.supplier_name}{p.supplier_tax_id && <div className="muted" style={{ fontSize: 12, lineHeight: 1.1 }}>{p.supplier_tax_id} · {p.supplier_branch}</div>}</td>
                    <td className="muted">{p.invoice_no ?? '—'}</td>
                    <td className="muted" style={{ fontSize: 14 }}>{(p.lines ?? []).map((l: any) => `${l.name} ${fmtQty(l.qty)} ${l.unit}`).join(', ')}</td>
                    <td className="num">{formatBaht(p.subtotal)}</td>
                    <td className="num">{formatBaht(p.input_vat)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatBaht(p.total)}</td>
                    <td>{p.vat_claimable ? <span className="pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>เคลมได้</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {purchases && purchases.rows.length > 0 && (
                  <tr className="total">
                    <td colSpan={4}>ภาษีซื้อที่เคลมได้ (ยื่น ภ.พ.30)</td>
                    <td className="num">{formatBaht(purchases.totals.claimableBase)}</td>
                    <td className="num">{formatBaht(purchases.totals.claimableVat)}</td>
                    <td className="num">{formatBaht(purchases.totals.total)}</td><td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {purchases?.rows.length === 0 && <p className="muted">ยังไม่มีการรับของในเดือนนี้</p>}
        </section>
      </main>

      {panel === 'purchase' && ings && <PurchaseSheet ings={stocked} vatShop={!!me?.tenant.vat_registered} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'waste' && ings && <WasteSheet ings={active} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'count' && ings && <CountSheet ings={stocked} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'new' && <IngredientSheet all={active} onClose={() => setPanel(null)} onSaved={done} />}
      {panel === 'newPrep' && <IngredientSheet all={active} prep onClose={() => setPanel(null)} onSaved={done} />}
      {panel && typeof panel === 'object' && <IngredientSheet all={active} ing={panel.edit} prep={panel.edit.is_prep} onClose={() => setPanel(null)} onSaved={done} />}
    </>
  );
}

const cell: React.CSSProperties = { height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 8px', background: '#fff' };

function PurchaseSheet({ ings, vatShop, onClose, onSaved }: { ings: any[]; vatShop: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ purchasedOn: today(), supplierName: '', supplierTaxId: '', supplierBranch: '00000', invoiceNo: '', taxInvoice: false, vatMode: 'none' });
  const [lines, setLines] = useState([{ ingredientId: '', qty: '', amount: '' }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(ings.map((i) => [i.id, i])), [ings]);
  const sum = lines.reduce((s, l) => s + (toSatang(l.amount) || 0), 0);
  const ok = f.supplierName.trim() && lines.every((l) => l.ingredientId && Number(l.qty) > 0 && Number.isFinite(toSatang(l.amount)))
    && (!f.taxInvoice || (f.supplierTaxId && f.invoiceNo));

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('POST', '/api/purchases', {
        purchasedOn: f.purchasedOn, supplierName: f.supplierName, supplierTaxId: f.supplierTaxId || null,
        supplierBranch: f.supplierTaxId ? f.supplierBranch : null, invoiceNo: f.invoiceNo || null,
        taxInvoice: f.taxInvoice, vatMode: f.vatMode,
        lines: lines.map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty), amount: toSatang(l.amount) })),
      });
      onSaved();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Sheet title="รับของเข้าสต็อก" onClose={onClose} wide>
      <div className="grid-form">
        <label className="field">วันที่<input type="date" value={f.purchasedOn} onChange={(e) => setF({ ...f, purchasedOn: e.target.value })} /></label>
        <label className="field">ผู้ขาย<input value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} placeholder="เช่น ตลาดไท, แม็คโคร" /></label>
        <label className="field">ราคาในบิล
          <select value={f.vatMode} onChange={(e) => setF({ ...f, vatMode: e.target.value })}>
            <option value="none">ไม่มี VAT</option><option value="included">รวม VAT แล้ว</option><option value="excluded">ยังไม่รวม VAT</option>
          </select>
        </label>
      </div>
      {f.vatMode !== 'none' && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <label className="row" style={{ fontSize: 16 }}>
            <input type="checkbox" checked={f.taxInvoice} onChange={(e) => setF({ ...f, taxInvoice: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} />
            ได้ใบกำกับภาษีเต็มรูป
          </label>
          {f.taxInvoice && (
            <div className="grid-form">
              <label className="field">เลขผู้เสียภาษีผู้ขาย<input inputMode="numeric" value={f.supplierTaxId} onChange={(e) => setF({ ...f, supplierTaxId: e.target.value })} /></label>
              <label className="field">สาขา<input inputMode="numeric" value={f.supplierBranch} onChange={(e) => setF({ ...f, supplierBranch: e.target.value })} /></label>
              <label className="field">เลขที่ใบกำกับ<input value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} /></label>
            </div>
          )}
          <div className="muted" style={{ fontSize: 14 }}>
            {vatShop && f.taxInvoice ? 'ภาษีซื้อนำไปเครดิตใน ภ.พ.30 ได้ ต้นทุนวัตถุดิบคิดราคาไม่รวม VAT'
              : 'เคลมภาษีซื้อไม่ได้ VAT จะรวมเป็นต้นทุนวัตถุดิบ'}
          </div>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>วัตถุดิบ</th><th className="num">จำนวน</th><th className="num">ราคาในบิล (บาท)</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const ing = byId.get(l.ingredientId);
            const set = (p: object) => setLines(lines.map((x, k) => (k === i ? { ...x, ...p } : x)));
            return (
              <tr key={i}>
                <td><select aria-label="วัตถุดิบ" value={l.ingredientId} onChange={(e) => set({ ingredientId: e.target.value })} style={{ ...cell, minWidth: 180 }}>
                  <option value="">เลือก…</option>
                  {ings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></td>
                <td className="num">
                  <input aria-label="จำนวน" inputMode="decimal" value={l.qty} onChange={(e) => set({ qty: e.target.value })} style={{ ...cell, width: 80, textAlign: 'right' }} />
                  <span className="muted" style={{ marginLeft: 6 }}>{ing?.purchase_unit ?? ''}</span>
                </td>
                <td className="num"><input aria-label="ราคา" inputMode="decimal" value={l.amount} onChange={(e) => set({ amount: e.target.value })} style={{ ...cell, width: 110, textAlign: 'right' }} /></td>
                <td className="num">{lines.length > 1 && <button className="btn" style={{ minHeight: 40 }} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Icon name="trash" /> ลบ</button>}</td>
              </tr>
            );
          })}
          <tr className="total"><td>รวมตามบิล</td><td /><td className="num">{formatBaht(sum)}</td><td /></tr>
        </tbody>
      </table>
      <button className="btn btn-outline" onClick={() => setLines([...lines, { ingredientId: '', qty: '', amount: '' }])}><Icon name="plus" /> เพิ่มรายการ</button>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!ok || busy}><Icon name="save" /> บันทึกรับของ</button>
    </Sheet>
  );
}

function WasteSheet({ ings, onClose, onSaved }: { ings: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ingredientId: '', qty: '', reason: '' });
  const [err, setErr] = useState('');
  const ing = ings.find((i) => i.id === f.ingredientId);
  async function save() {
    setErr('');
    try {
      await api('POST', '/api/stock/waste', { ingredientId: f.ingredientId, qty: Number(f.qty), reason: f.reason });
      onSaved();
    } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title="บันทึกของเสีย" onClose={onClose}>
      <label className="field">วัตถุดิบ
        <select value={f.ingredientId} onChange={(e) => setF({ ...f, ingredientId: e.target.value })}>
          <option value="">เลือก…</option>
          {ings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="field">ปริมาณที่เสีย {ing && `(${UNIT[ing.base_unit]})`}<input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
      <label className="field">เหตุผล<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="เช่น เน่า หมดอายุ ทำหก" /></label>
      {ing && Number(f.qty) > 0 && <div className="muted">มูลค่าประมาณ ฿{formatBaht(Math.round(Number(f.qty) * ing.avg_cost / 10_000))}</div>}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-warn btn-lg" onClick={save} disabled={!f.ingredientId || !(Number(f.qty) > 0) || f.reason.trim().length < 3}><Icon name="save" size={22} /> บันทึกของเสีย</button>
    </Sheet>
  );
}

function CountSheet({ ings, onClose, onSaved }: { ings: any[]; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const entered = Object.entries(counted).filter(([, v]) => v.trim() !== '');
  const diffValue = entered.reduce((s, [id, v]) => {
    const i = ings.find((x) => x.id === id)!;
    return s + Math.round((Number(v) - i.on_hand) * i.avg_cost / 10_000);
  }, 0);
  async function save() {
    setErr('');
    try {
      await api('POST', '/api/stock/counts', { lines: entered.map(([ingredientId, v]) => ({ ingredientId, countedQty: Number(v) })) });
      onSaved();
    } catch (e) { setErr(errText(e)); }
  }
  return (
    <Sheet title="นับสต็อก" onClose={onClose} wide>
      <div className="muted" style={{ fontSize: 14 }}>กรอกเฉพาะรายการที่นับ เว้นว่างไว้ = ไม่ปรับ ส่วนต่างจะลงบัญชีเป็นของหาย/เกิน</div>
      <table className="tbl">
        <thead><tr><th>วัตถุดิบ</th><th className="num">ในระบบ</th><th className="num">นับได้จริง</th><th className="num">ส่วนต่าง</th></tr></thead>
        <tbody>
          {ings.map((i) => {
            const v = counted[i.id] ?? '';
            const diff = v.trim() === '' ? null : Number(v) - i.on_hand;
            return (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num muted">{fmtQty(i.on_hand)} {UNIT[i.base_unit]}</td>
                <td className="num"><input aria-label={`นับได้ ${i.name}`} inputMode="decimal" value={v} onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value })}
                  style={{ ...cell, width: 110, textAlign: 'right' }} /></td>
                <td className="num" style={{ color: diff !== null && diff < 0 ? 'var(--warn-ink)' : undefined }}>
                  {diff === null ? '' : `${diff > 0 ? '+' : ''}${fmtQty(diff)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row" style={{ fontWeight: 700 }}>ส่วนต่างรวม <span style={{ color: diffValue < 0 ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>฿{formatBaht(diffValue)}</span></div>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={entered.length === 0 || entered.some(([, v]) => !(Number(v) >= 0))}><Icon name="save" size={22} /> บันทึกผลนับ ({entered.length} รายการ)</button>
    </Sheet>
  );
}

function IngredientSheet({ ing, all, prep = false, onClose, onSaved }: { ing?: any; all: any[]; prep?: boolean; onClose: () => void; onSaved: () => void }) {
  const [parts, setParts] = useState<Array<{ ingredientId: string; qty: string }>>([{ ingredientId: '', qty: '' }]);
  const [batch, setBatch] = useState(String(ing?.batch_yield ?? 1000));
  useEffect(() => {
    if (ing?.is_prep) {
      api('GET', `/api/ingredients/${ing.id}/prep`)
        .then((r) => setParts(r.lines.length ? r.lines.map((l: any) => ({ ingredientId: l.ingredient_id, qty: String(l.qty) })) : [{ ingredientId: '', qty: '' }]))
        .catch(() => {});
    }
  }, [ing]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  const partCost = (p: { ingredientId: string; qty: string }) => {
    const i = byId.get(p.ingredientId);
    return i && Number(p.qty) > 0 ? Math.round((Number(p.qty) * 100 / i.yield_pct) * i.avg_cost / 10_000) : 0;
  };
  const batchCost = parts.reduce((t, p) => t + partCost(p), 0);
  const partsOk = parts.every((p) => p.ingredientId && Number(p.qty) > 0) && new Set(parts.map((p) => p.ingredientId)).size === parts.length;
  const [f, setF] = useState({
    name: ing?.name ?? '', kind: ing?.kind ?? 'food', baseUnit: ing?.base_unit ?? 'g', purchaseUnit: ing?.purchase_unit ?? 'กก.',
    purchaseFactor: String(ing?.purchase_factor ?? 1000), yieldPct: String(ing?.yield_pct ?? 100),
    reorderPoint: String(ing?.reorder_point ?? 0), price: ing ? (perPurchaseUnit(ing) / 100).toFixed(2) : '', active: ing?.active ?? true,
  });
  const [moves, setMoves] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (ing) api('GET', `/api/ingredients/${ing.id}/movements`).then(setMoves).catch(() => {}); }, [ing]);

  async function save() {
    setErr('');
    if (prep) {
      try {
        // One batch is the "purchase unit" of a prep item, so its cost shows per batch like other ingredients per pack.
        const body = { name: f.name, kind: f.kind, baseUnit: f.baseUnit, purchaseUnit: 'ชุด', purchaseFactor: Number(batch),
          yieldPct: Number(f.yieldPct), active: f.active, isPrep: true, batchYield: Number(batch) };
        const saved = await api(ing ? 'PATCH' : 'POST', ing ? `/api/ingredients/${ing.id}` : '/api/ingredients', body);
        await api('PUT', `/api/ingredients/${saved.id}/prep`, { lines: parts.map((p) => ({ ingredientId: p.ingredientId, qty: Number(p.qty) })) });
        onSaved();
      } catch (e) { setErr(errText(e)); }
      return;
    }
    const body: any = {
      name: f.name, kind: f.kind, baseUnit: f.baseUnit, purchaseUnit: f.purchaseUnit, purchaseFactor: Number(f.purchaseFactor),
      yieldPct: Number(f.yieldPct), reorderPoint: Number(f.reorderPoint), active: f.active,
    };
    const price = toSatang(f.price);
    // Only send a price when it changed: it overrides the average built from deliveries.
    if (Number.isFinite(price) && (!ing || price !== perPurchaseUnit(ing))) body.purchasePrice = price;
    try {
      await api(ing ? 'PATCH' : 'POST', ing ? `/api/ingredients/${ing.id}` : '/api/ingredients', body);
      onSaved();
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <Sheet title={ing ? ing.name : prep ? 'เพิ่มสูตรย่อย (ทำเองในร้าน)' : 'เพิ่มวัตถุดิบ'} onClose={onClose} wide={!!ing || prep}>
      {prep ? <>
        <div className="grid-form">
          <label className="field">ชื่อ<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น น้ำจิ้มซีฟู้ด น้ำซุป" /></label>
          <label className="field">ประเภท
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">หน่วยที่ใช้ในสูตรเมนู
            <select value={f.baseUnit} onChange={(e) => setF({ ...f, baseUnit: e.target.value })}>
              {Object.entries(UNIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">ทำ 1 ชุดได้ ({UNIT[f.baseUnit]})<input inputMode="decimal" value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
        </div>
        <h3 style={{ margin: '4px 0 0', fontSize: 17 }}>ส่วนผสมต่อ 1 ชุด</h3>
        <table className="tbl">
          <thead><tr><th>วัตถุดิบ</th><th className="num">ปริมาณที่ใช้</th><th className="num">ต้นทุน</th><th /></tr></thead>
          <tbody>
            {parts.map((p, k) => {
              const i = byId.get(p.ingredientId);
              const set = (x: object) => setParts(parts.map((y, j) => (j === k ? { ...y, ...x } : y)));
              return (
                <tr key={k}>
                  <td><select aria-label="ส่วนผสม" value={p.ingredientId} onChange={(e) => set({ ingredientId: e.target.value })} style={{ ...cell, minWidth: 180 }}>
                    <option value="">เลือก…</option>
                    {all.filter((x) => x.id !== ing?.id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_prep ? ' (สูตรย่อย)' : ''}</option>)}
                  </select></td>
                  <td className="num">
                    <input aria-label="ปริมาณ" inputMode="decimal" value={p.qty} onChange={(e) => set({ qty: e.target.value })} style={{ ...cell, width: 90, textAlign: 'right' }} />
                    <span className="muted" style={{ marginLeft: 6 }}>{i ? UNIT[i.base_unit] : ''}</span>
                  </td>
                  <td className="num">{formatBaht(partCost(p))}</td>
                  <td className="num">{parts.length > 1 && <button className="btn" style={{ minHeight: 40 }} onClick={() => setParts(parts.filter((_, j) => j !== k))}><Icon name="trash" /> ลบ</button>}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>ต้นทุนต่อชุด</td><td />
              <td className="num">{formatBaht(batchCost)}</td><td />
            </tr>
          </tbody>
        </table>
        <div className="row">
          <button className="btn btn-outline" onClick={() => setParts([...parts, { ingredientId: '', qty: '' }])}><Icon name="plus" /> ส่วนผสม</button>
          <span className="spacer" />
          {Number(batch) > 0 && <span className="muted">≈ ฿{(batchCost / 100 / Number(batch)).toFixed(4)} ต่อ {UNIT[f.baseUnit]}</span>}
        </div>
        <div className="muted" style={{ fontSize: 14 }}>สูตรย่อยไม่มีสต็อกของตัวเอง เมื่อขายเมนูที่ใช้ ระบบตัดสต็อกส่วนผสมตามสัดส่วน · บันทึกของเสียของสูตรย่อยได้ (ตัดส่วนผสมเป็นของเสีย)</div>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!f.name.trim() || !(Number(batch) > 0) || !partsOk}><Icon name="save" size={22} /> บันทึกสูตรย่อย</button>
      </> : <>
      <div className="grid-form">
        <label className="field">ชื่อ<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">ประเภท
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">หน่วยที่ใช้ในสูตร
          <select value={f.baseUnit} onChange={(e) => setF({ ...f, baseUnit: e.target.value })}>
            {Object.entries(UNIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">หน่วยที่ซื้อ<input value={f.purchaseUnit} onChange={(e) => setF({ ...f, purchaseUnit: e.target.value })} /></label>
        <label className="field">1 {f.purchaseUnit || 'หน่วยซื้อ'} = ? {UNIT[f.baseUnit]}<input inputMode="decimal" value={f.purchaseFactor} onChange={(e) => setF({ ...f, purchaseFactor: e.target.value })} /></label>
        <label className="field">ราคาต่อ{f.purchaseUnit || 'หน่วย'} (บาท)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <label className="field">ใช้ได้จริงหลังตัดแต่ง (yield %)<input inputMode="numeric" value={f.yieldPct} onChange={(e) => setF({ ...f, yieldPct: e.target.value })} /></label>
        <label className="field">แจ้งเตือนเมื่อเหลือต่ำกว่า ({UNIT[f.baseUnit]})<input inputMode="decimal" value={f.reorderPoint} onChange={(e) => setF({ ...f, reorderPoint: e.target.value })} /></label>
      </div>
      {ing && (
        <label className="row" style={{ fontSize: 16 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 24, height: 24, accentColor: 'var(--accent)' }} /> ใช้งานอยู่
        </label>
      )}
      <div className="muted" style={{ fontSize: 14 }}>ราคาต่อหน่วยจะถูกแทนด้วยต้นทุนเฉลี่ยถ่วงน้ำหนักทุกครั้งที่บันทึกรับของ</div>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save}
        disabled={!f.name.trim() || !(Number(f.purchaseFactor) > 0) || !(Number(f.yieldPct) >= 1 && Number(f.yieldPct) <= 100)}><Icon name="save" size={22} /> บันทึก</button>
      </>}
      {ing && !prep && (
        <>
          <h3 style={{ margin: '8px 0 0', fontSize: 17 }}>ความเคลื่อนไหวล่าสุด</h3>
          <table className="tbl">
            <thead><tr><th>เมื่อ</th><th>รายการ</th><th className="num">ปริมาณ</th><th className="num">มูลค่า</th><th>โดย</th></tr></thead>
            <tbody>
              {moves?.map((m) => (
                <tr key={m.id}>
                  <td className="muted" style={{ fontSize: 14 }}>{new Date(m.at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{MOVE[m.kind]}{m.reason && m.kind !== 'adjust' && <div className="muted" style={{ fontSize: 12, lineHeight: 1.1 }}>{m.reason}</div>}</td>
                  <td className="num" style={{ color: m.qty < 0 ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>{m.qty > 0 ? '+' : ''}{fmtQty(m.qty)}</td>
                  <td className="num">{formatBaht(m.value)}</td>
                  <td className="muted">{m.by ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {moves?.length === 0 && <p className="muted" style={{ margin: 0 }}>ยังไม่มีความเคลื่อนไหว</p>}
        </>
      )}
    </Sheet>
  );
}
