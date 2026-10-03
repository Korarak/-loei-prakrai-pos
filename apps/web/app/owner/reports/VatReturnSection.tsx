'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, monthLabel } from '@/lib/owner';

interface VatReturn {
  month: string;
  purchases: { day: string; doc_no: string | null; name: string; tax_id: string | null; branch: string | null; base: number; vat: number; source: 'purchase' | 'expense' }[];
  summary: { salesVatable: number; salesExempt: number; outputVat: number; creditNotes: number; purchaseBase: number; inputVat: number; payable: number; credit: number };
}

/** รายงานภาษีซื้อ และสรุปยอดสำหรับกรอก ภ.พ.30 ของเดือนภาษีที่เลือก */
export function VatReturnSection({ month }: { month: string }) {
  const [r, setR] = useState<VatReturn | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    api<VatReturn>('GET', `/api/reports/vat-return?month=${month}`).then(setR).catch((e) => setErr(errText(e)));
  }, [month]);

  function csv() {
    if (!r) return;
    const head = ['วันที่', 'เลขที่ใบกำกับ', 'ผู้ขาย', 'เลขผู้เสียภาษี', 'สาขา', 'มูลค่า', 'ภาษีซื้อ'];
    const lines = r.purchases.map((p) => [dayLabel(p.day), p.doc_no ?? '', p.name, p.tax_id ?? '', p.branch ?? '', (p.base / 100).toFixed(2), (p.vat / 100).toFixed(2)]);
    const text = '﻿' + [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `รายงานภาษีซื้อ-${month}.csv`;
    a.click();
  }

  const s = r?.summary;
  const line = (no: string, label: string, v: number, strong = false) => (
    <tr className={strong ? 'total' : undefined}><td className="muted" style={{ width: 40 }}>{no}</td><td>{label}</td><td className="num">{formatBaht(v)}</td></tr>
  );
  return (
    <section className="card" style={{ padding: '12px 18px', display: 'grid', gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>สรุป ภ.พ.30 และรายงานภาษีซื้อ · {monthLabel(month)}</h2>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={csv} disabled={!r?.purchases.length}>ดาวน์โหลดภาษีซื้อ (CSV)</button>
      </div>
      {err && <div className="error">{err}</div>}
      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          <table className="tbl" aria-label="สรุป ภ.พ.30">
            <tbody>
              {line('1', 'ยอดขายที่ต้องเสียภาษี (หลังหักใบลดหนี้)', s.salesVatable)}
              {line('3', 'ยอดขายที่ได้รับยกเว้น', s.salesExempt)}
              {line('5', 'ภาษีขาย', s.outputVat, true)}
              {line('6', 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหัก', s.purchaseBase)}
              {line('7', 'ภาษีซื้อ', s.inputVat, true)}
              {s.payable > 0 ? line('8', 'ภาษีที่ต้องชำระ', s.payable, true) : line('9', 'ภาษีชำระเกิน (ยกไป/ขอคืน)', s.credit, true)}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            ภาษีขายนับตามวันที่ออกเอกสาร{s.creditNotes ? ` หักใบลดหนี้ ${s.creditNotes} ใบแล้ว` : ''} ·
            ภาษีซื้อนับเฉพาะที่มีใบกำกับภาษีเต็มรูป (รับของ + ค่าใช้จ่าย) · ตัวเลขนี้ใช้กรอกแบบ ภ.พ.30 ยื่นภายในวันที่ 15 ของเดือนถัดไป (ยื่นออนไลน์ได้ถึงวันที่ 23)
          </div>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>วันที่</th><th>เลขที่ใบกำกับ</th><th>ผู้ขาย</th><th>เลขผู้เสียภาษี · สาขา</th><th className="num">มูลค่า</th><th className="num">ภาษีซื้อ</th></tr></thead>
          <tbody>
            {r?.purchases.map((p, i) => (
              <tr key={i}>
                <td>{dayLabel(p.day)}</td>
                <td className="muted">{p.doc_no ?? (p.source === 'expense' ? 'ค่าใช้จ่าย' : '—')}</td>
                <td>{p.name}</td>
                <td className="muted">{p.tax_id ?? '—'}{p.branch ? ` · ${p.branch}` : ''}</td>
                <td className="num">{formatBaht(p.base)}</td>
                <td className="num">{formatBaht(p.vat)}</td>
              </tr>
            ))}
            {s && r!.purchases.length > 0 && (
              <tr className="total"><td colSpan={4}>รวม</td><td className="num">{formatBaht(s.purchaseBase)}</td><td className="num">{formatBaht(s.inputVat)}</td></tr>
            )}
          </tbody>
        </table>
        {r?.purchases.length === 0 && <p className="muted">ยังไม่มีภาษีซื้อที่เคลมได้ในเดือนนี้</p>}
      </div>
    </section>
  );
}
