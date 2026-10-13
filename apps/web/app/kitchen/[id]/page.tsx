'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, errText } from '@/lib/api';
import { kitchenLines, printTicket, stationPrinter, usePrinters, type PrintResult } from '@/lib/print';

const STATION: Record<string, string> = { kitchen: 'ครัว', bar: 'บาร์น้ำ' };

interface Line { id: string; name: string; qty: number; note: string | null; options: { name: string }[]; status: string; station: string | null; sent_at: string | null }

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * ใบสั่งครัว 72 มม. หนึ่งใบต่อสถานี พิมพ์ผ่านเครื่องพิมพ์ของเบราว์เซอร์
 * `?at=` = one send batch; without it, every line already sent (reprint the whole table).
 */
function Ticket() {
  const { id } = useParams<{ id: string }>();
  const at = useSearchParams().get('at');
  const [view, setView] = useState<any>(null);
  const [err, setErr] = useState('');
  const { list } = usePrinters();
  const [sent, setSent] = useState<Record<string, PrintResult | { status: 'sending' }>>({});
  const started = useRef(false);
  useEffect(() => { api('GET', `/api/orders/${id}`).then(setView).catch((e) => setErr(errText(e))); }, [id]);

  const lines: Line[] = view ? view.lines.filter((l: Line) => l.status === 'sent' && (!at || l.sent_at === at)) : [];
  const stations = [...new Set(lines.map((l) => l.station ?? 'kitchen'))];
  const where = !view ? '' : view.order.table_name ? `โต๊ะ ${view.order.table_name}` : view.order.channel === 'delivery' ? 'เดลิเวอรี' : 'กลับบ้าน';
  const time = hhmm(at ?? lines[0]?.sent_at ?? new Date().toISOString());

  async function sendStation(st: string) {
    const printer = list && stationPrinter(list.printers, st);
    if (!printer) return;
    setSent((s) => ({ ...s, [st]: { status: 'sending' } }));
    const ticket = kitchenLines({ where, station: STATION[st] ?? st, billNo: view.order.bill_no, guests: view.order.guests, time, reprint: !at,
      lines: lines.filter((l) => (l.station ?? 'kitchen') === st) });
    const r = await printTicket(printer, 'kitchen', ticket).catch((e) => ({ status: 'failed' as const, error: errText(e) }));
    setSent((s) => ({ ...s, [st]: r }));
  }

  // Stations with a LAN printer get their ticket there; if none is set up, fall back to the browser's print dialog.
  useEffect(() => {
    if (!view || !list || started.current || lines.length === 0) return;
    started.current = true;
    const withPrinter = stations.filter((st) => stationPrinter(list.printers, st));
    if (withPrinter.length === 0) setTimeout(() => window.print(), 300);
    else withPrinter.forEach((st) => sendStation(st));
  });
  if (!view) return <main style={{ padding: 40 }}>{err || 'กำลังโหลด…'}</main>;

  return (
    <main style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ display: 'grid', gap: 16 }}>
        {stations.map((st) => (
          <article key={st} className="ticket" style={{ width: '72mm', background: '#fff', padding: '12px 10px 20px', color: '#111', fontSize: 15 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b style={{ fontSize: 26 }}>{where}</b>
              <span>{STATION[st] ?? st}</span>
            </div>
            <div style={{ borderBottom: '2px solid #111', paddingBottom: 4 }}>
              บิล #{view.order.bill_no} · {view.order.guests} ท่าน · {hhmm(at ?? lines[0]?.sent_at ?? new Date().toISOString())}
              {!at && ' · พิมพ์ซ้ำ'}
            </div>
            {lines.filter((l) => (l.station ?? 'kitchen') === st).map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px dashed #999' }}>
                <b style={{ fontSize: 24, minWidth: 30 }}>{l.qty}</b>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{l.name}</div>
                  {l.options.length > 0 && <div style={{ fontSize: 17, fontWeight: 600 }}>+ {l.options.map((o) => o.name).join(', ')}</div>}
                  {l.note && <div style={{ fontSize: 17 }}>** {l.note}</div>}
                </div>
              </div>
            ))}
          </article>
        ))}
        {lines.length === 0 && <p className="muted">ไม่มีรายการที่ส่งครัว</p>}
      </div>
      <div className="no-print" style={{ display: 'grid', gap: 12, width: 260 }}>
        {stations.map((st) => {
          const p = list && stationPrinter(list.printers, st);
          const r = sent[st];
          if (!p) return null;
          return (
            <div key={st} className="card" style={{ padding: 12, display: 'grid', gap: 6 }}>
              <b>{STATION[st] ?? st} → {p.name}</b>
              {r?.status === 'sending' && <span className="muted">กำลังส่ง…</span>}
              {r?.status === 'done' && <span style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>พิมพ์แล้ว</span>}
              {r?.status === 'waiting' && <span className="error">ส่งงานแล้ว เครื่องพิมพ์ยังไม่ตอบ</span>}
              {r?.status === 'failed' && <span className="error">{r.error}</span>}
              <button className="btn" disabled={r?.status === 'sending'} onClick={() => sendStation(st)}>ส่งไปพิมพ์อีกครั้ง</button>
            </div>
          );
        })}
        <button className={`btn btn-lg${list && stations.some((st) => stationPrinter(list.printers, st)) ? '' : ' btn-primary'}`} onClick={() => window.print()}>พิมพ์ผ่านเบราว์เซอร์</button>
        <Link className="btn btn-lg" href={`/pos/order/${id}`}>กลับไปที่บิล</Link>
        <Link className="btn" href="/pos">ผังโต๊ะ</Link>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Ticket /></Suspense>;
}
