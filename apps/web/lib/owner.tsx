'use client';

import { useRef } from 'react';
import { useConfirm } from './dialog';
import { Icon } from './icons';

/** Bangkok calendar month, e.g. 2026-09 — tax and cost periods follow Thai time. */
export const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthLabel = (m: string) => `${TH_MONTH[Number(m.slice(5)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
export const dayLabel = (d: string) => `${Number(d.slice(8, 10))}/${d.slice(5, 7)}/${Number(d.slice(0, 4)) + 543}`;

export const EXPENSE_LABEL: Record<string, string> = {
  labor: 'ค่าแรง', rent: 'ค่าเช่า', utilities: 'ค่าน้ำ ไฟ แก๊ส', packaging: 'บรรจุภัณฑ์',
  fees: 'ค่าธรรมเนียม / GP', marketing: 'การตลาด', other: 'อื่น ๆ',
};

export const UNIT: Record<string, string> = { g: 'กรัม', ml: 'มล.', pc: 'ชิ้น' };

/** "12.50" → 1250 satang; blank or junk → NaN so forms can refuse it. */
export const toSatang = (s: string) => (s.trim() === '' ? NaN : Math.round(Number(s.replace(/,/g, '')) * 100));

/** Quantities read like a person would write them: 2,300 · 266.67 · 0.5 */
export const fmtQty = (q: number) => q.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function MonthPicker({ value, onChange, label = 'เดือน' }: { value: string; onChange: (m: string) => void; label?: string }) {
  return (
    <label className="row muted" style={{ gap: 8 }}>{label}
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{ height: 48, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line-2)' }} />
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'var(--accent-ink)' : tone === 'warn' ? 'var(--warn-ink)' : 'var(--ink)';
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

/**
 * Right-hand panel for forms, so the list stays visible behind it.
 * Typing or toggling anything inside marks it unsaved; closing it then asks first (pass `noConfirm` for search-only panels).
 */
export function Sheet({ title, onClose, children, wide, noConfirm }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; noConfirm?: boolean }) {
  const dirty = useRef(false);
  const confirm = useConfirm();
  async function close() {
    if (dirty.current && !noConfirm && !(await confirm({ title: 'ปิดโดยไม่บันทึก?', body: 'ข้อมูลที่แก้ไว้จะหายไป', confirm: 'ปิดโดยไม่บันทึก', cancel: 'กลับไปแก้ต่อ', tone: 'danger', icon: 'close' }))) return;
    onClose();
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,22,.35)', zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="sheet"
        onInputCapture={() => { dirty.current = true; }}
        onClickCapture={(e) => { if ((e.target as HTMLElement).closest('[aria-pressed]')) dirty.current = true; }}
        style={{ width: wide ? 'min(760px, 100%)' : 'min(520px, 100%)', background: 'var(--surface)', height: '100%', overflowY: 'auto', padding: 20, display: 'grid', gap: 14, alignContent: 'start' }}>
        <div className="row">
          <h2 style={{ margin: 0, fontSize: 21 }}>{title}</h2>
          <span className="spacer" />
          <button className="btn" onClick={close} aria-label="ปิด"><Icon name="close" /> ปิด</button>
        </div>
        {children}
      </div>
    </div>
  );
}
