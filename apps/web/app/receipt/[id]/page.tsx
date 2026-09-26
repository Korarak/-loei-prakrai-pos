'use client';

import { formatBaht, formatBranch } from '@prakai/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { Sparkle } from '@/lib/ui';

const TITLE: Record<string, [string, string]> = {
  ABB: ['ใบกำกับภาษีอย่างย่อ', 'TAX INVOICE (ABB)'],
  FULL: ['ใบกำกับภาษี / ใบเสร็จรับเงิน', 'TAX INVOICE / RECEIPT'],
  RECEIPT: ['ใบเสร็จรับเงิน', 'RECEIPT'],
  CN: ['ใบลดหนี้', 'CREDIT NOTE'],
};
const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

function Receipt() {
  const { id } = useParams<{ id: string }>();
  const change = Number(useSearchParams().get('change') ?? 0);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('GET', `/api/documents/${id}`).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  if (!d) return <main style={{ padding: 40 }}>{err || 'กำลังโหลด…'}</main>;

  const [th, en] = TITLE[d.doc_type]!;
  const isTax = d.doc_type !== 'RECEIPT';
  const row = (a: React.ReactNode, b: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, ...style }}><span>{a}</span><span>{b}</span></div>
  );
  const hr = <div style={{ borderTop: '1px dashed #777', margin: '4px 0' }} />;

  return (
    <main style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <article style={{ width: '72mm', background: '#fff', padding: '16px 12px 24px', fontSize: 13, lineHeight: '19px', color: '#111', position: 'relative' }}>
        {d.status === 'void' && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <span style={{ transform: 'rotate(-30deg)', fontSize: 44, fontWeight: 700, color: 'rgba(180,83,9,.35)', border: '4px solid rgba(180,83,9,.35)', padding: '0 12px' }}>ยกเลิก</span>
          </div>
        )}
        <div style={{ textAlign: 'center', display: 'grid', gap: 2, justifyItems: 'center' }}>
          <Sparkle size={26} color="#111" />
          <b style={{ fontSize: 17 }}>{d.seller.shopName}</b>
          {d.seller.name !== d.seller.shopName && <div>{d.seller.name}</div>}
          {d.seller.address && <div>{d.seller.address}</div>}
          {isTax && <div>เลขประจำตัวผู้เสียภาษี {d.seller.taxId}</div>}
          {isTax && <div>{formatBranch(d.seller.branchCode)}{d.seller.rdPosId ? ` · POS ID ${d.seller.rdPosId}` : ''}</div>}
        </div>
        {hr}
        <div style={{ textAlign: 'center' }}><b style={{ fontSize: 16 }}>{th}</b><div style={{ fontWeight: 600 }}>{en}</div></div>
        {row('เลขที่', d.doc_no)}
        {row('วันที่', fmtDate(d.issued_at))}
        {d.buyer_name && <>
          {hr}
          <div><b>ผู้ซื้อ</b> {d.buyer_name}</div>
          <div>เลขประจำตัวผู้เสียภาษี {d.buyer_tax_id} · {formatBranch(d.buyer_branch)}</div>
          <div>{d.buyer_address}</div>
        </>}
        {hr}
        {d.lines.map((l: any, i: number) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 22 }}>{l.qty}</span>
            <span style={{ flex: 1 }}>{l.name}<br /><span style={{ color: '#555' }}>@ {formatBaht(l.unitPrice)}</span></span>
            <span>{formatBaht(l.gross)}</span>
          </div>
        ))}
        {hr}
        {d.discount > 0 && row('ส่วนลด', `-${formatBaht(d.discount)}`)}
        {d.service_charge > 0 && row('ค่าบริการ', formatBaht(d.service_charge))}
        {row(<b>รวมทั้งสิ้น</b>, <b>{formatBaht(d.total)}</b>, { fontSize: 18, lineHeight: '26px' })}
        {d.doc_type === 'ABB' && <div style={{ textAlign: 'right', fontWeight: 600 }}>ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT INCLUDED)</div>}
        {isTax && row('มูลค่าสินค้า/บริการ', formatBaht(d.vatable_base + d.service_charge), { color: '#333' })}
        {isTax && d.exempt_base > 0 && row('สินค้ายกเว้น VAT', formatBaht(d.exempt_base), { color: '#333' })}
        {isTax && row(`ภาษีมูลค่าเพิ่ม ${d.vat_rate_bp / 100}%`, formatBaht(d.vat), { color: '#333' })}
        {d.rounding !== 0 && row('ปัดเศษ', formatBaht(d.rounding))}
        {hr}
        {d.payments.map((p: any, i: number) => <div key={i}>{row(METHOD[p.method], formatBaht(p.tendered ?? p.amount))}</div>)}
        {change > 0 && row(<b>เงินทอน</b>, <b>{formatBaht(change)}</b>)}
        {hr}
        <div style={{ textAlign: 'center', color: '#333' }}>
          {d.doc_type === 'ABB' && <div>ต้องการใบกำกับภาษีเต็มรูป กรุณาแจ้งแคชเชียร์</div>}
          <div style={{ paddingTop: 8, fontWeight: 600, color: '#111' }}>ขอบคุณที่อุดหนุน</div>
        </div>
      </article>

      <div className="no-print" style={{ display: 'grid', gap: 12, width: 280 }}>
        <button className="btn btn-primary btn-lg" onClick={() => window.print()}>พิมพ์</button>
        <Link className="btn btn-lg" href="/pos">กลับผังโต๊ะ</Link>
        {change > 0 && <div className="card" style={{ padding: 16, textAlign: 'center' }}><div className="muted">เงินทอน</div><div style={{ fontSize: 40, fontWeight: 700, color: 'var(--accent-ink)' }}>฿{formatBaht(change)}</div></div>}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Receipt /></Suspense>;
}
