'use client';

import { formatBaht } from '@prakai/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { TopBar } from './TopBar';

interface TableRow { id: string; name: string; seats: number; order_id: string | null; guests: number | null; opened_at: string | null; amount: number }

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default function Tables() {
  const router = useRouter();
  const { me } = useMe();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => api<TableRow[]>('GET', '/api/tables').then(setTables).catch((e) => setErr(errText(e)));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  async function open(t: TableRow | null) {
    if (t?.order_id) return router.push(`/pos/order/${t.order_id}`);
    try {
      const o = await api('POST', '/api/orders', t ? { tableId: t.id, guests: t.seats } : { channel: 'takeaway' });
      router.push(`/pos/order/${o.id}`);
    } catch (e) { setErr(errText(e)); }
  }

  const busy = tables?.filter((t) => t.order_id).length ?? 0;
  return (
    <>
      <TopBar me={me} active="tables" />
      <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row">
          <h1 style={{ margin: 0, fontSize: 26 }}>ผังโต๊ะ</h1>
          <span className="muted">ว่าง {(tables?.length ?? 0) - busy} · มีลูกค้า {busy}</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-lg" onClick={() => open(null)}>+ ออเดอร์กลับบ้าน</button>
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {tables?.map((t) => {
            const on = !!t.order_id;
            return (
              <button key={t.id} onClick={() => open(t)} aria-label={`โต๊ะ ${t.name} ${on ? 'มีลูกค้า' : 'ว่าง'}`}
                style={{
                  minHeight: 150, textAlign: 'left', display: 'flex', flexDirection: 'column', padding: '14px 16px', borderRadius: 16,
                  background: on ? 'var(--accent-soft)' : '#fff', border: `2px solid ${on ? 'var(--accent)' : '#C9CFC7'}`,
                }}>
                <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <span className="display" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1 }}>{t.name}</span>
                  <span className="pill" style={{ background: '#fff', color: on ? 'var(--accent-ink)' : 'var(--muted)' }}>{on ? 'มีลูกค้า' : 'ว่าง'}</span>
                </div>
                <span className="spacer" />
                <span style={{ fontSize: 15, color: 'var(--muted-2)' }}>
                  {on ? `${t.guests} ท่าน · ${minutesSince(t.opened_at!)} นาที` : `${t.seats} ที่นั่ง`}
                </span>
                {on && <span style={{ fontSize: 22, fontWeight: 700 }}>฿{formatBaht(t.amount)}</span>}
              </button>
            );
          })}
        </div>
        {tables?.length === 0 && <p className="muted">ยังไม่มีโต๊ะ ใช้ปุ่มออเดอร์กลับบ้านได้เลย</p>}
      </main>
    </>
  );
}
