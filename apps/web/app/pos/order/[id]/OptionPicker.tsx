'use client';

import { formatBaht } from '@prakai/core';
import { useState } from 'react';
import { Icon } from '@/lib/icons';

export interface OptionGroup {
  id: string; name: string; min_select: number; max_select: number;
  options: { id: string; name: string; price: number }[];
}

/** Asks the option questions of a dish (ระดับเผ็ด, ท็อปปิ้ง …) before it goes on the bill. */
export function OptionPicker({ item, groups, onCancel, onAdd }: {
  item: { name: string; price: number };
  groups: OptionGroup[];
  onCancel: () => void;
  onAdd: (a: { options: string[]; qty: number; note: string }) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const toggle = (g: OptionGroup, id: string) => setPicked((p) => {
    const cur = p[g.id] ?? [];
    if (cur.includes(id)) return { ...p, [g.id]: cur.filter((x) => x !== id) };
    // a single-choice group swaps the answer; a multi-choice group stops at its maximum
    if (g.max_select === 1) return { ...p, [g.id]: [id] };
    return cur.length >= g.max_select ? p : { ...p, [g.id]: [...cur, id] };
  });

  const chosen = groups.flatMap((g) => g.options.filter((o) => (picked[g.id] ?? []).includes(o.id)));
  const missing = groups.filter((g) => (picked[g.id] ?? []).length < g.min_select);
  const unit = item.price + chosen.reduce((s, o) => s + o.price, 0);

  return (
    <div role="dialog" aria-modal="true" aria-label={`เลือกตัวเลือก ${item.name}`} onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,22,.45)', zIndex: 30, display: 'grid', placeItems: 'center', padding: 12 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
        e.preventDefault();
        if (missing.length === 0) onAdd({ options: groups.flatMap((g) => picked[g.id] ?? []), qty, note: note.trim() });
      }}
        style={{ width: 'min(520px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{item.name}</div>
          <div className="muted">฿{formatBaht(item.price).replace(/\.00$/, '')}</div>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px 12px', display: 'grid', gap: 16 }}>
          {groups.map((g) => {
            const n = (picked[g.id] ?? []).length;
            return (
              <fieldset key={g.id} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                <legend style={{ fontSize: 17, fontWeight: 700, padding: '8px 0 4px' }}>
                  {g.name}{' '}
                  <span className={g.min_select > n ? 'error' : 'muted'} style={{ fontSize: 14, fontWeight: 500 }}>
                    {g.min_select > 0 ? 'ต้องเลือก' : 'ไม่บังคับ'}{g.max_select > 1 ? ` · สูงสุด ${g.max_select}` : ''}
                  </span>
                </legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {g.options.map((o) => {
                    const on = (picked[g.id] ?? []).includes(o.id);
                    return (
                      <button type="button" key={o.id} aria-pressed={on} onClick={() => toggle(g, o.id)}
                        style={{ minHeight: 52, padding: '8px 12px', borderRadius: 12, textAlign: 'left', fontSize: 16, fontWeight: on ? 700 : 500,
                          border: `2px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, background: on ? 'var(--accent-soft)' : '#fff', color: 'var(--ink)' }}>
                        <div>{o.name}</div>
                        {o.price > 0 && <div className="muted" style={{ fontSize: 14 }}>+{formatBaht(o.price).replace(/\.00$/, '')}</div>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          <label className="field">หมายเหตุ (ถ้ามี)
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ไม่ใส่ผัก" />
          </label>
        </div>
        <div className="row" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', gap: 10 }}>
          <button type="button" className="btn" style={{ width: 48, height: 52, fontSize: 24 }} aria-label="ลดจำนวน" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
          <b style={{ minWidth: 28, textAlign: 'center', fontSize: 20 }}>{qty}</b>
          <button type="button" className="btn" style={{ width: 48, height: 52, fontSize: 24 }} aria-label="เพิ่มจำนวน" onClick={() => setQty(Math.min(99, qty + 1))}><Icon name="plus" /> </button>
          <span className="spacer" />
          <button type="button" className="btn" style={{ height: 52 }} onClick={onCancel}><Icon name="close" /> ยกเลิก</button>
          <button className="btn btn-primary" style={{ height: 52 }} disabled={missing.length > 0}>
            {missing.length > 0 ? `เลือก${missing[0]!.name}` : `เพิ่ม · ฿${formatBaht(unit * qty).replace(/\.00$/, '')}`}
          </button>
        </div>
      </form>
    </div>
  );
}
