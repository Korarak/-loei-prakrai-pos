'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface Buyer { name: string; taxId: string; branch: string; address: string }

/** Find a saved customer by name, tax ID or phone and fill the buyer form with one tap. */
export function CustomerPicker({ onPick }: { onPick: (b: Buyer) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api('GET', `/api/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => setRows(r.slice(0, 6))).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  if (rows !== null && rows.length === 0 && !q) return null; // no customers saved yet: keep the form uncluttered
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <input aria-label="ค้นหาลูกค้าประจำ" placeholder="ค้นหาลูกค้าประจำ (ชื่อ / เลขผู้เสียภาษี / เบอร์)" value={q} onChange={(e) => setQ(e.target.value)}
        style={{ height: 44, borderRadius: 10, border: '1px solid var(--line-2)', padding: '0 12px', fontSize: 16 }} />
      {rows?.map((c) => (
        <button key={c.id} type="button" className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left', minHeight: 48, padding: '6px 12px' }}
          onClick={() => { onPick({ name: c.name, taxId: c.tax_id, branch: c.branch, address: c.address }); setQ(''); }}>
          <span><b>{c.name}</b> <span className="muted" style={{ fontSize: 14 }}>{c.tax_id}{c.branch !== '00000' ? ` · สาขา ${c.branch}` : ''}</span></span>
        </button>
      ))}
      {rows && rows.length === 0 && q && <div className="muted" style={{ fontSize: 14 }}>ไม่พบลูกค้า — กรอกข้างล่างแล้วติ๊กบันทึกไว้ได้</div>}
    </div>
  );
}
