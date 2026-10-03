'use client';

import { formatBaht } from '@prakai/core';
import { Fragment, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, fmtQty, monthLabel, UNIT } from '@/lib/owner';

interface CardLine { day: string; doc: string | null; text: string; inQty: number; outQty: number; value: number; balance: number; balanceValue: number }
interface Row {
  id: string; name: string; kind: string; unit: string;
  openQty: number; openValue: number; received: number; receivedValue: number; sold: number; soldValue: number;
  waste: number; wasteValue: number; adjust: number; adjustValue: number; closeQty: number; closeValue: number;
  lines: CardLine[];
}
interface Inventory { month: string; rows: Row[]; totals: Record<'openValue' | 'receivedValue' | 'soldValue' | 'wasteValue' | 'adjustValue' | 'closeValue', number> }

const signedQty = (q: number) => (q > 0 ? '+' : '') + fmtQty(q);

/** รายงานสินค้าและวัตถุดิบ ตาม ม.87(3): สรุปรับ–จ่าย–คงเหลือต่อวัตถุดิบ แตะแถวเพื่อดูบัญชีคุมรายตัว */
export function InventorySection({ month }: { month: string }) {
  const [r, setR] = useState<Inventory | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    setOpen(null);
    api<Inventory>('GET', `/api/reports/inventory?month=${month}`).then(setR).catch((e) => setErr(errText(e)));
  }, [month]);

  // One file with every card, in the columns of the statutory report: date, document, description, in, out, balance.
  function csv() {
    if (!r) return;
    const out: string[][] = [['วัตถุดิบ', 'หน่วย', 'วันที่', 'เลขที่เอกสาร', 'รายการ', 'รับ', 'จ่าย', 'คงเหลือ', 'มูลค่าคงเหลือ']];
    for (const row of r.rows) {
      const u = UNIT[row.unit] ?? row.unit;
      out.push([row.name, u, `1/${month.slice(5)}/${Number(month.slice(0, 4)) + 543}`, '', 'ยอดยกมา', '', '', String(row.openQty), (row.openValue / 100).toFixed(2)]);
      for (const l of row.lines) {
        out.push([row.name, u, dayLabel(l.day), l.doc ?? '', l.text, l.inQty ? String(l.inQty) : '', l.outQty ? String(l.outQty) : '',
          String(l.balance), (l.balanceValue / 100).toFixed(2)]);
      }
    }
    const text = '﻿' + out.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `รายงานสินค้าและวัตถุดิบ-${month}.csv`;
    a.click();
  }

  return (
    <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>รายงานสินค้าและวัตถุดิบ · {monthLabel(month)}</h2>
        <span className="muted" style={{ fontSize: 14 }}>ยอดยกมา รับ จ่าย คงเหลือ ต่อวัตถุดิบ · แตะแถวเพื่อดูรายการรายวัน</span>
        <span className="spacer" />
        <button className="btn btn-primary no-print" onClick={csv} disabled={!r?.rows.length}>ดาวน์โหลดทุกรายการ (CSV)</button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>วัตถุดิบ</th><th className="num">ยกมา</th><th className="num">รับ</th><th className="num">ขาย</th>
              <th className="num">ของเสีย</th><th className="num">ปรับจากนับ</th><th className="num">คงเหลือ</th><th className="num">มูลค่าคงเหลือ</th></tr>
          </thead>
          <tbody>
            {r?.rows.map((row) => (
              <Fragment key={row.id}>
                <tr className="click" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                  <td style={{ fontWeight: 600 }}>{row.name} <span className="muted" style={{ fontWeight: 400 }}>({UNIT[row.unit] ?? row.unit})</span></td>
                  <td className="num">{fmtQty(row.openQty)}</td>
                  <td className="num">{row.received ? fmtQty(row.received) : '—'}</td>
                  <td className="num">{row.sold ? fmtQty(row.sold) : '—'}</td>
                  <td className="num">{row.waste ? fmtQty(row.waste) : '—'}</td>
                  <td className="num" style={{ color: row.adjust < 0 ? 'var(--warn-ink)' : undefined }}>{row.adjust ? signedQty(row.adjust) : '—'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmtQty(row.closeQty)}</td>
                  <td className="num">{formatBaht(row.closeValue)}</td>
                </tr>
                {open === row.id && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--line-soft)', padding: '8px 12px', height: 'auto' }}>
                      <table className="tbl" aria-label={`บัญชีคุม ${row.name}`} style={{ background: 'var(--surface)', borderRadius: 10 }}>
                        <thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>รายการ</th><th className="num">รับ</th><th className="num">จ่าย</th><th className="num">คงเหลือ</th><th className="num">มูลค่า</th></tr></thead>
                        <tbody>
                          <tr><td>1/{month.slice(5)}/{Number(month.slice(0, 4)) + 543}</td><td /><td className="muted">ยอดยกมา</td><td /><td />
                            <td className="num">{fmtQty(row.openQty)}</td><td className="num">{formatBaht(row.openValue)}</td></tr>
                          {row.lines.map((l, i) => (
                            <tr key={i}>
                              <td>{dayLabel(l.day)}</td><td className="muted">{l.doc ?? '—'}</td><td>{l.text}</td>
                              <td className="num">{l.inQty ? fmtQty(l.inQty) : ''}</td><td className="num">{l.outQty ? fmtQty(l.outQty) : ''}</td>
                              <td className="num" style={{ fontWeight: 600 }}>{fmtQty(l.balance)}</td><td className="num">{formatBaht(l.balanceValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {r && r.rows.length > 0 && (
              <tr className="total">
                <td>มูลค่ารวม (บาท)</td><td className="num">{formatBaht(r.totals.openValue)}</td><td className="num">{formatBaht(r.totals.receivedValue)}</td>
                <td className="num">{formatBaht(r.totals.soldValue)}</td><td className="num">{formatBaht(r.totals.wasteValue)}</td>
                <td className="num">{formatBaht(r.totals.adjustValue)}</td><td /><td className="num">{formatBaht(r.totals.closeValue)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {r?.rows.length === 0 && <p className="muted">ยังไม่มีการรับหรือจ่ายวัตถุดิบในเดือนนี้</p>}
      </div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
        ปริมาณเป็นหน่วยฐาน (กรัม มล. ชิ้น) · ขายตัดตามสูตรรวมเป็นวันละหนึ่งบรรทัด · มูลค่าตามต้นทุนเฉลี่ยถ่วงน้ำหนัก ·
        ผู้ประกอบการจด VAT ต้องจัดทำรายงานนี้และลงรายการภายใน 3 วันทำการ (ม.87)
      </div>
    </section>
  );
}
