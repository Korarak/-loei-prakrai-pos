'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { DaySection } from './DaySection';
import { InventorySection } from './InventorySection';
import { VatReturnSection } from './VatReturnSection';

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(0, 7);
const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthLabel = (m: string) => `${TH_MONTH[Number(m.slice(5)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
const dayLabel = (d: string) => `${Number(d.slice(8))}/${d.slice(5, 7)}/${Number(d.slice(0, 4)) + 543}`;

export default function Reports() {
  const { me } = useMe();
  const [month, setMonth] = useState(thisMonth());
  const [rep, setRep] = useState<any>(null);
  const [daily, setDaily] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    api('GET', `/api/reports/sales-tax?month=${month}`).then(setRep).catch((e) => setErr(errText(e)));
    api('GET', '/api/reports/daily').then(setDaily).catch(() => {});
  }, [month]);

  function csv() {
    const head = ['วันที่', 'เครื่อง', 'ประเภท', 'เลขที่เอกสาร', 'ผู้ซื้อ', 'มูลค่า', 'VAT', 'รวม'];
    const lines = rep.rows.map((r: any) => [dayLabel(r.day), r.terminal, r.doc_type, r.doc_no, r.buyer,
      (r.base / 100).toFixed(2), (r.vat / 100).toFixed(2), (r.total / 100).toFixed(2)]);
    const text = '﻿' + [head, ...lines].map((l) => l.map((c: string) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `รายงานภาษีขาย-${month}.csv`;
    a.click();
  }

  const methodTotal = (m: string) => daily?.methods.find((x: any) => x.method === m)?.amount ?? 0;
  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <div className="row">
          <OwnerTabs active="reports" />
          <span className="spacer" />
          <label className="row muted" style={{ gap: 8 }}>เดือนภาษี
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ height: 48, padding: '0 12px', borderRadius: 12, border: '1px solid var(--line-2)' }} />
          </label>
        </div>

        {daily && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: '12px 16px' }}><div className="muted">บิลวันนี้</div><div style={{ fontSize: 28, fontWeight: 700 }}>{daily.bills}</div></div>
            <div className="card" style={{ padding: '12px 16px' }}><div className="muted">เงินสดวันนี้</div><div style={{ fontSize: 28, fontWeight: 700 }}>฿{formatBaht(methodTotal('cash'))}</div></div>
            <div className="card" style={{ padding: '12px 16px' }}><div className="muted">พร้อมเพย์/โอน/บัตร</div><div style={{ fontSize: 28, fontWeight: 700 }}>฿{formatBaht(methodTotal('promptpay') + methodTotal('transfer') + methodTotal('card'))}</div></div>
            {rep && <div className="card" style={{ padding: '12px 16px', background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
              <div style={{ color: 'var(--accent-ink)' }}>ภาษีขาย {monthLabel(month)}</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-ink)' }}>{formatBaht(rep.totals.vat)}</div></div>}
          </div>
        )}

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>รายงานภาษีขาย · {monthLabel(month)}</h1>
            <span className="muted" style={{ fontSize: 14 }}>ใบอย่างย่อสรุปรายวันต่อเครื่อง · ใบเต็มรูปและใบลดหนี้แสดงรายใบ{rep?.voidedCount ? ` · ยกเลิก ${rep.voidedCount} ใบ (ไม่รวมในยอด)` : ''}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => window.print()}>พิมพ์ / PDF</button>
            <button className="btn btn-primary" onClick={csv} disabled={!rep?.rows.length}>ดาวน์โหลด Excel (CSV)</button>
          </div>
          {err && <div className="error">{err}</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'left' }}>
                <th style={{ height: 32 }}>วันที่</th><th>เลขที่เอกสาร</th><th>ผู้ซื้อ</th>
                <th style={{ textAlign: 'right' }}>มูลค่า</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {rep?.rows.map((r: any, i: number) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <td style={{ height: 44 }}>{dayLabel(r.day)}</td><td className="muted">{r.doc_no}</td><td className="muted">{r.buyer}</td>
                  <td style={{ textAlign: 'right' }}>{formatBaht(r.base)}</td><td style={{ textAlign: 'right' }}>{formatBaht(r.vat)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatBaht(r.total)}</td>
                </tr>
              ))}
              {rep && (
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                  <td style={{ height: 44 }} colSpan={3}>รวม</td>
                  <td style={{ textAlign: 'right' }}>{formatBaht(rep.totals.base)}</td><td style={{ textAlign: 'right' }}>{formatBaht(rep.totals.vat)}</td>
                  <td style={{ textAlign: 'right' }}>{formatBaht(rep.totals.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {rep?.rows.length === 0 && <p className="muted">ยังไม่มีใบกำกับภาษีในเดือนนี้</p>}
        </section>

        <VatReturnSection month={month} />

        <InventorySection month={month} />

        <DaySection />
      </main>
    </>
  );
}
