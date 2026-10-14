'use client';

import { formatBaht, valueOf } from '@prakai/core';
import { useMemo, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sheet, toSatang, UNIT } from '@/lib/owner';

export interface PickRow { id: string; label: string; sub?: string; right?: string; group?: string }

/** Search-as-you-type list in a side panel: far quicker than a 60-line dropdown. */
export function PickSheet({ title, rows, onPick, onClose, footer, placeholder = 'พิมพ์ค้นหา…' }: {
  title: string; rows: PickRow[]; onPick: (id: string) => void; onClose: () => void; footer?: React.ReactNode; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rows.filter((r) => `${r.label} ${r.sub ?? ''} ${r.group ?? ''}`.toLowerCase().includes(n)) : rows;
  }, [q, rows]);
  return (
    <Sheet title={title} onClose={onClose}>
      <input aria-label="ค้นหา" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) onPick(shown[0]!.id); }}
        style={{ height: 52, borderRadius: 12, border: '1px solid #c9cfc7', padding: '0 14px', fontSize: 17 }} />
      {footer}
      <div role="list" style={{ display: 'grid' }}>
        {shown.map((r, i) => (
          <div key={r.id} role="listitem">
            {r.group && r.group !== shown[i - 1]?.group && <div className="muted" style={{ fontSize: 13, fontWeight: 600, padding: '12px 4px 4px' }}>{r.group}</div>}
            <button onClick={() => onPick(r.id)} className="pick-row">
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                {r.sub && <span className="muted" style={{ display: 'block', fontSize: 13 }}>{r.sub}</span>}
              </span>
              {r.right && <span className="muted" style={{ fontSize: 14 }}>{r.right}</span>}
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="muted">ไม่พบ “{q}” — สร้างใหม่ได้ด้านบน</p>}
      </div>
    </Sheet>
  );
}

const KIND_LABEL: Record<string, string> = { food: 'อาหาร / วัตถุดิบ', beverage: 'เครื่องดื่ม', packaging: 'บรรจุภัณฑ์' };

/** Ingredient search; `onCreate` appears when the shop wants to add one that does not exist yet. */
export function IngredientPicker({ ings, onPick, onClose, onCreate }: {
  ings: any[]; onPick: (id: string) => void; onClose: () => void; onCreate: () => void;
}) {
  const rows: PickRow[] = ings.filter((i) => i.active).map((i) => ({
    id: i.id, label: i.name,
    group: i.is_prep ? 'สูตรย่อย (ทำเองในร้าน)' : KIND_LABEL[i.kind] ?? i.kind,
    sub: `ใช้เป็น${UNIT[i.base_unit]}`,
    right: i.avg_cost > 0 ? `฿${formatBaht(valueOf(i.is_prep ? 1 : i.purchase_factor, i.avg_cost))} / ${i.is_prep ? UNIT[i.base_unit] : i.purchase_unit}` : 'ยังไม่มีราคา',
  })).sort((a, b) => a.group!.localeCompare(b.group!, 'th'));
  return (
    <PickSheet title="เลือกวัตถุดิบ" rows={rows} onPick={onPick} onClose={onClose} placeholder="ค้นหา เช่น หมู, ไข่, เบียร์…"
      footer={<button className="btn btn-outline" onClick={onCreate}>+ ไม่มีในรายการ? สร้างวัตถุดิบใหม่</button>} />
  );
}

const PRESETS: Array<{ label: string; base: 'g' | 'ml' | 'pc'; unit: string; factor: string }> = [
  { label: 'ซื้อเป็น กก.', base: 'g', unit: 'กก.', factor: '1000' },
  { label: 'ซื้อเป็นลิตร', base: 'ml', unit: 'ลิตร', factor: '1000' },
  { label: 'ซื้อเป็นชิ้น/ฟอง', base: 'pc', unit: 'ชิ้น', factor: '1' },
  { label: 'ซื้อเป็นขวด', base: 'ml', unit: 'ขวด', factor: '' },
];

/** The shortest honest form: what it is, how it is bought, what it costs. */
export function NewIngredientSheet({ onClose, onCreated, initialName = '' }: { onClose: () => void; onCreated: (ing: any) => void; initialName?: string }) {
  const [f, setF] = useState({ name: initialName, kind: 'food', base: 'g' as 'g' | 'ml' | 'pc', unit: 'กก.', factor: '1000', price: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const price = toSatang(f.price);
  const factor = Number(f.factor);
  const ok = f.name.trim() && f.unit.trim() && factor > 0 && Number.isFinite(price) && price >= 0;

  async function save() {
    setBusy(true); setErr('');
    try {
      onCreated(await api('POST', '/api/ingredients', {
        name: f.name.trim(), kind: f.kind, baseUnit: f.base, purchaseUnit: f.unit.trim(), purchaseFactor: factor, purchasePrice: price,
      }));
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Sheet title="สร้างวัตถุดิบใหม่" onClose={onClose}>
      <label className="field">ชื่อวัตถุดิบ<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="เช่น สันนอกเนื้อ, เบียร์สิงห์ขวดใหญ่" /></label>
      <div>
        <div className="muted" style={{ fontSize: 14, marginBottom: 6 }}>ซื้อมาเป็นหน่วยอะไร (เลือกแบบที่ใกล้เคียงที่สุด)</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.label} className="btn" aria-pressed={f.unit === p.unit && f.base === p.base} onClick={() => setF({ ...f, base: p.base, unit: p.unit, factor: p.factor })}>{p.label}</button>
          ))}
        </div>
      </div>
      <div className="grid-form">
        <label className="field">ราคาที่ซื้อ ต่อ 1 {f.unit || 'หน่วย'} (บาท)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="เช่น 180" /></label>
        <label className="field">1 {f.unit || 'หน่วย'} มีกี่{UNIT[f.base]}<input inputMode="decimal" value={f.factor} onChange={(e) => setF({ ...f, factor: e.target.value })} /></label>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>ในสูตรจะใส่ปริมาณเป็น{UNIT[f.base]} · ชนิด:{' '}
        <select aria-label="ชนิด" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} style={{ height: 36, borderRadius: 8, border: '1px solid #c9cfc7' }}>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save} disabled={!ok || busy}>{busy ? 'กำลังบันทึก…' : 'สร้างและใช้เลย'}</button>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>ราคานี้เป็นต้นทุนเริ่มต้น พอบันทึกใบรับของ ระบบจะคิดต้นทุนเฉลี่ยให้เอง</p>
    </Sheet>
  );
}
