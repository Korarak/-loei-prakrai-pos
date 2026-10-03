'use client';

import { formatBaht } from '@prakai/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, today } from '@/lib/owner';

const DOC: Record<string, string> = { ABB: 'ใบย่อ', FULL: 'เต็มรูป', RECEIPT: 'ใบเสร็จ', CN: 'ใบลดหนี้' };
const hhmm = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const signed = (v: number) => (v > 0 ? '+' : '') + formatBaht(v);

/** กะและเอกสารของวันที่เลือก: ดูเงินขาด/เกินรายกะ และเปิดเอกสารเพื่อยกเลิกหรือออกใบลดหนี้ */
export function DaySection() {
  const [date, setDate] = useState(today());
  const [q, setQ] = useState('');
  const [shifts, setShifts] = useState<any[] | null>(null);
  const [docs, setDocs] = useState<any[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    api('GET', `/api/shifts?date=${date}`).then(setShifts).catch((e) => setErr(errText(e)));
  }, [date]);
  useEffect(() => {
    const t = setTimeout(() => {
      const url = q.trim() ? `/api/documents?q=${encodeURIComponent(q.trim())}` : `/api/documents?date=${date}`;
      api('GET', url).then(setDocs).catch((e) => setErr(errText(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [date, q]);

  return (
    <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>กะและเอกสาร · {dayLabel(date)}</h2>
        <span className="spacer" />
        <label className="row muted" style={{ gap: 8 }}>วันที่
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ height: 48, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line-2)' }} />
        </label>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>เครื่อง</th><th>เปิด–ปิด</th><th>ผู้ปิด</th><th className="num">บิล</th><th className="num">ยอดขาย</th>
            <th className="num">เงินสดควรมี</th><th className="num">นับได้</th><th className="num">ขาด/เกิน</th></tr></thead>
          <tbody>
            {shifts?.map((s) => (
              <tr key={s.shift.id}>
                <td>{s.shift.terminal_name}</td>
                <td>{hhmm(s.shift.opened_at)} – {s.shift.closed_at ? hhmm(s.shift.closed_at) : <b>เปิดอยู่</b>}</td>
                <td className="muted">{s.shift.closed_by_name ?? '—'}</td>
                <td className="num">{s.bills}</td>
                <td className="num">{formatBaht(s.sales)}</td>
                <td className="num">{formatBaht(s.expectedCash)}</td>
                <td className="num">{s.shift.counted_cash === null ? '—' : formatBaht(s.shift.counted_cash)}</td>
                <td className="num" style={{ fontWeight: 700, color: s.difference ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
                  {s.difference === null ? '—' : signed(s.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shifts?.length === 0 && <p className="muted">ไม่มีกะในวันนี้</p>}
      </div>

      <div className="row">
        <h3 style={{ margin: 0, fontSize: 17 }}>เอกสาร</h3>
        <span className="muted" style={{ fontSize: 14 }}>แตะเพื่อเปิด พิมพ์ซ้ำ ยกเลิก หรือออกใบลดหนี้</span>
        <span className="spacer" />
        <input placeholder="ค้นเลขที่เอกสาร" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ height: 44, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line-2)', width: 220 }} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>เวลา</th><th>ประเภท</th><th>เลขที่</th><th>ผู้ซื้อ</th><th className="num">VAT</th><th className="num">รวม</th><th>สถานะ</th></tr></thead>
          <tbody>
            {docs?.map((d) => (
              <tr key={d.id}>
                <td>{q ? dayLabel(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(d.issued_at))) + ' ' : ''}{hhmm(d.issued_at)}</td>
                <td>{DOC[d.doc_type]}</td>
                <td><Link href={`/receipt/${d.id}`} style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{d.doc_no}</Link></td>
                <td className="muted">{d.buyer_name ?? ''}</td>
                <td className="num">{formatBaht(d.doc_type === 'CN' ? -d.vat : d.vat)}</td>
                <td className="num">{formatBaht(d.doc_type === 'CN' ? -d.total : d.total)}</td>
                <td>{d.status === 'void' ? <span className="pill" style={{ color: 'var(--warn-ink)' }}>ยกเลิก</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs?.length === 0 && <p className="muted">ไม่พบเอกสาร</p>}
      </div>
    </section>
  );
}
