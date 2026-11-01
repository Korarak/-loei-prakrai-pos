'use client';

import { formatBaht } from '@prakai/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Icon } from '@/lib/icons';

interface Req {
  id: string; table_name: string; note: string | null; created_at: string; total: number;
  lines: { name: string; qty: number; unit_price: number; note: string | null; options: { name: string }[] }[];
}

/** Orders customers sent from the table QR, waiting for staff. Accepting puts them on that table's bill. */
export function QrInbox({ onChanged }: { onChanged: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Req[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api<Req[]>('GET', '/api/qr/requests').then(setRows).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, []);

  async function decide(r: Req, kind: 'accept' | 'reject') {
    setBusy(r.id); setErr('');
    try {
      const res = await api<{ orderId?: string }>('POST', `/api/qr/requests/${r.id}/${kind}`);
      await load(); onChanged();
      if (kind === 'accept' && res.orderId) router.push(`/pos/order/${res.orderId}`);
    } catch (e) { setErr(errText(e)); await load(); } finally { setBusy(''); }
  }

  if (rows.length === 0 && !err) return null;
  return (
    <section aria-label="ออเดอร์จากลูกค้าผ่าน QR" className="card" style={{ padding: 14, display: 'grid', gap: 10, borderColor: 'var(--accent)', borderWidth: 2 }} role="status">
      <h2 style={{ margin: 0, fontSize: 19 }}>ลูกค้าสั่งผ่าน QR · รอรับ {rows.length}</h2>
      {err && <div className="error" role="alert">{err}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
          <div className="row"><strong style={{ fontSize: 20 }}>โต๊ะ {r.table_name}</strong><span className="muted" style={{ fontSize: 13 }}>{new Date(r.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span><span className="spacer" /><strong>฿{formatBaht(r.total)}</strong></div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.lines.map((l, i) => (
              <li key={i}>{l.qty} × {l.name}{l.options.length > 0 && ` (${l.options.map((o) => o.name).join(', ')})`}{l.note && <span className="muted"> — {l.note}</span>}</li>
            ))}
          </ul>
          {r.note && <div className="muted">ข้อความจากลูกค้า: {r.note}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy === r.id} onClick={() => decide(r, 'accept')}><Icon name="check" /> รับเข้าบิล</button>
            <button className="btn btn-warn" disabled={busy === r.id} onClick={() => decide(r, 'reject')}><Icon name="close" /> ปฏิเสธ</button>
          </div>
        </div>
      ))}
    </section>
  );
}
