'use client';

import { formatBaht, formatBranch } from '@prakai/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, errText } from '@/lib/api';
import { loadLogo } from '@/lib/ticket';
import { agentOnline, printTicket, receiptLines, receiptPrinterFor, usePrinters, type PrintResult } from '@/lib/print';
import { terminalFor, useMe } from '@/lib/useMe';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';

const TITLE: Record<string, [string, string]> = {
  ABB: ['ใบกำกับภาษีอย่างย่อ', 'TAX INVOICE (ABB)'],
  FULL: ['ใบกำกับภาษี / ใบเสร็จรับเงิน', 'TAX INVOICE / RECEIPT'],
  RECEIPT: ['ใบเสร็จรับเงิน', 'RECEIPT'],
  CN: ['ใบลดหนี้', 'CREDIT NOTE'],
};
const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };
const bangkokDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(d));

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
  const params = useSearchParams();
  const change = Number(params.get('change') ?? 0);
  const fresh = params.get('fresh') === '1';
  const { me } = useMe();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('GET', `/api/documents/${id}`).then(setD).catch((e) => setErr(errText(e))), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <main style={{ padding: 40 }}>{err || 'กำลังโหลด…'}</main>;
  const isManager = me?.role === 'owner' || me?.role === 'manager';

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
          {me?.tenant.logo_url && me.tenant.logo_on_receipt && <img src={me.tenant.logo_url} alt={d.seller.shopName} style={{ maxWidth: '60%', maxHeight: 70, objectFit: 'contain' }} />}
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
        {d.doc_type === 'CN' && d.credits && <>
          {hr}
          {row('อ้างถึงเอกสาร', d.credits.doc_no)}
          {row('ลงวันที่', fmtDate(d.credits.issued_at))}
          {row('มูลค่าตามเอกสารเดิม', formatBaht(d.credits.total))}
          {row('มูลค่าที่ถูกต้อง', formatBaht(d.credits.corrected_total))}
          {row('ผลต่าง', formatBaht(d.total))}
          <div>เหตุผล: {d.reason}</div>
        </>}
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
        {row(<b>{d.doc_type === 'CN' ? 'ลดหนี้รวมทั้งสิ้น' : 'รวมทั้งสิ้น'}</b>, <b>{formatBaht(d.total)}</b>, { fontSize: 18, lineHeight: '26px' })}
        {d.doc_type === 'ABB' && <div style={{ textAlign: 'right', fontWeight: 600 }}>ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT INCLUDED)</div>}
        {isTax && row('มูลค่าสินค้า/บริการ', formatBaht(d.vatable_base + d.service_charge), { color: '#333' })}
        {isTax && d.exempt_base > 0 && row('สินค้ายกเว้น VAT', formatBaht(d.exempt_base), { color: '#333' })}
        {isTax && row(`ภาษีมูลค่าเพิ่ม${d.doc_type === 'CN' ? 'ของผลต่าง' : ''} ${d.vat_rate_bp / 100}%`, formatBaht(d.vat), { color: '#333' })}
        {d.rounding !== 0 && row('ปัดเศษ', formatBaht(d.rounding))}
        {hr}
        {d.payments.length > 0 && <>
          {d.payments.map((p: any, i: number) => <div key={i}>{row(METHOD[p.method], formatBaht(p.tendered ?? p.amount))}</div>)}
          {change > 0 && row(<b>เงินทอน</b>, <b>{formatBaht(change)}</b>)}
          {hr}
        </>}
        <div style={{ textAlign: 'center', color: '#333' }}>
          {d.doc_type === 'ABB' && <div>ต้องการใบกำกับภาษีเต็มรูป กรุณาแจ้งแคชเชียร์</div>}
          {d.doc_type !== 'CN' && <div style={{ paddingTop: 8, fontWeight: 600, color: '#111' }}>ขอบคุณที่อุดหนุน</div>}
        </div>
      </article>

      <div className="no-print" style={{ display: 'grid', gap: 12, width: 280 }}>
        <PrintButtons doc={d} change={change} fresh={fresh} terminalId={me ? terminalFor(me).id : null} />
        <Link className="btn btn-lg" href="/pos"><Icon name="back" /> กลับผังโต๊ะ</Link>
        {d.credit_notes?.length > 0 && (
          <div className="error" style={{ display: 'grid', gap: 4 }}>
            <b>ใบลดหนี้ของเอกสารนี้</b>
            {d.credit_notes.map((cn: any) => (
              <Link key={cn.id} href={`/receipt/${cn.id}`}>{cn.doc_no} · −{formatBaht(cn.total)}</Link>
            ))}
          </div>
        )}
        {d.status === 'void' && <div className="error">ยกเลิกแล้ว: {d.void_reason}</div>}
        {d.credits && <Link className="btn" href={`/receipt/${d.credits.id}`}>ดูเอกสารเดิม {d.credits.doc_no}</Link>}
        {isManager && d.status === 'issued' && d.doc_type !== 'CN' && (d.remaining ?? []).some((q: number) => q > 0) && <Correct doc={d} onDone={(to) => to ? (window.location.href = `/receipt/${to}`) : load()} />}
        {change > 0 && <div className="card" style={{ padding: 16, textAlign: 'center' }}><div className="muted">เงินทอน</div><div style={{ fontSize: 40, fontWeight: 700, color: 'var(--accent-ink)' }}>฿{formatBaht(change)}</div></div>}
      </div>
    </main>
  );
}

/**
 * พิมพ์ไปเครื่องพิมพ์ใบเสร็จของเครื่องขายนี้ (ผ่าน print agent) — หลังรับเงินพิมพ์อัตโนมัติและเปิดลิ้นชักถ้าจ่ายเงินสด.
 * ถ้าร้านยังไม่ได้ตั้งเครื่องพิมพ์ ใช้การพิมพ์ของเบราว์เซอร์ตามเดิม
 */
function PrintButtons({ doc, change, fresh, terminalId }: { doc: any; change: number; fresh: boolean; terminalId: string | null }) {
  const { me } = useMe();
  const { list } = usePrinters();
  const [state, setState] = useState<PrintResult | { status: 'sending' } | null>(null);
  const auto = useRef(false);
  const printed = useRef(false);
  const printer = list && terminalId !== null ? receiptPrinterFor(list.printers, terminalId) : undefined;
  const send = useCallback(async () => {
    if (!printer) return;
    // Only the first print right after payment is the original; any later print is marked สำเนา.
    const copy = !fresh || printed.current;
    setState({ status: 'sending' });
    try {
      const cash = doc.payments?.some((p: any) => p.method === 'cash');
      const logo = me?.tenant.logo_url && me.tenant.logo_on_receipt ? await loadLogo(me.tenant.logo_url) : null;
      const r = await printTicket(printer, 'receipt', receiptLines(doc, change, copy, logo), { kickDrawer: !copy && cash });
      if (r.status !== 'failed') printed.current = true;
      setState(r);
    } catch (e) { setState({ status: 'failed', error: errText(e) }); }
  }, [printer, doc, change, fresh, me]);
  useEffect(() => {
    if (fresh && printer && !auto.current) { auto.current = true; send(); }
  }, [fresh, printer, send]);

  if (!list) return <button className="btn btn-primary btn-lg" disabled><Icon name="print" /> พิมพ์</button>;
  if (!printer) return <button className="btn btn-primary btn-lg" onClick={() => window.print()}><Icon name="print" /> พิมพ์</button>;
  return (
    <>
      <button className="btn btn-primary btn-lg" disabled={state?.status === 'sending'} onClick={() => send()}>
        {state?.status === 'sending' ? 'กำลังพิมพ์…' : `พิมพ์ไปที่ ${printer.name}`}
      </button>
      {state?.status === 'done' && <div style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>พิมพ์แล้ว</div>}
      {state?.status === 'failed' && <div className="error">พิมพ์ไม่สำเร็จ: {state.error}</div>}
      {state?.status === 'waiting' && (
        <div className="error">{agentOnline(list) ? 'ส่งงานแล้ว เครื่องพิมพ์ยังไม่ตอบ' : 'โปรแกรมพิมพ์ในร้านไม่ได้เปิดอยู่'} — งานจะพิมพ์เมื่อเครื่องพร้อม (ภายใน 10 นาที)</div>
      )}
      <button className="btn" onClick={() => window.print()}><Icon name="print" /> พิมพ์ผ่านเบราว์เซอร์</button>
    </>
  );
}

/** ยกเลิก (วันเดียวกัน หรือใบเสร็จธรรมดา) หรือออกใบลดหนี้ (ใบกำกับภาษีของวันก่อน) — ผู้จัดการเท่านั้น */
function Correct({ doc, onDone }: { doc: any; onDone: (newDocId?: string) => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<'cash' | 'transfer' | 'none'>('cash');
  const [err, setErr] = useState('');
  const creditNote = doc.doc_type !== 'RECEIPT' && bangkokDay(doc.issued_at) !== bangkokDay(new Date());
  // A document already partly credited can no longer be voided, only credited further.
  const credited = doc.credit_notes?.length > 0;
  const [whole, setWhole] = useState(true);
  const [pick, setPick] = useState<number[]>(() => doc.remaining.map(() => 0));
  const picked = pick.map((qty: number, index: number) => ({ index, qty })).filter((x: { qty: number }) => x.qty > 0);
  const pickedGross = picked.reduce((t: number, x: { index: number; qty: number }) => t + doc.lines[x.index].unitPrice * x.qty, 0);
  if (credited && !creditNote) return null;
  if (!open) {
    return <button className="btn btn-warn" onClick={() => setOpen(true)}><Icon name="ban" /> {creditNote ? 'ออกใบลดหนี้' : 'ยกเลิกเอกสาร'}</button>;
  }
  return (
    <form className="card" style={{ padding: 14, display: 'grid', gap: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      setErr('');
      if (!(await confirm({ title: creditNote ? 'ออกใบลดหนี้?' : 'ยกเลิกเอกสารนี้?', body: creditNote ? 'ออกแล้วแก้ไขไม่ได้' : 'เอกสารที่ยกเลิกแล้วกู้คืนไม่ได้', confirm: creditNote ? 'ออกใบลดหนี้' : 'ยกเลิกเอกสาร', tone: 'danger', icon: 'ban' }))) return;
      try {
        if (creditNote) onDone((await api('POST', `/api/documents/${doc.id}/credit-note`, { reason, refund, lines: whole ? undefined : picked })).id);
        else { await api('POST', `/api/documents/${doc.id}/void`, { reason }); onDone(); }
      } catch (x) { setErr(errText(x)); }
    }}>
      <b>{creditNote ? 'ออกใบลดหนี้' : 'ยกเลิกเอกสารนี้'}</b>
      {creditNote && (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn" style={{ flex: 1 }} aria-pressed={whole} onClick={() => setWhole(true)}>{credited ? 'ที่เหลือทั้งหมด' : 'ทั้งบิล'}</button>
          <button type="button" className="btn" style={{ flex: 1 }} aria-pressed={!whole} onClick={() => setWhole(false)}>เลือกรายการ</button>
        </div>
      )}
      {creditNote && !whole && (
        <div style={{ display: 'grid', gap: 6 }}>
          {doc.lines.map((l: any, i: number) => doc.remaining[i] > 0 && (
            <div key={i} className="row" style={{ gap: 6 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{l.name} <span className="muted">(เหลือ {doc.remaining[i]})</span></span>
              <button type="button" className="btn" style={{ minWidth: 36, minHeight: 36 }} aria-label={`ลดหนี้ ${l.name} น้อยลง`}
                onClick={() => setPick(pick.map((q: number, k: number) => (k === i ? Math.max(0, q - 1) : q)))}>−</button>
              <b style={{ width: 20, textAlign: 'center' }}>{pick[i]}</b>
              <button type="button" className="btn" style={{ minWidth: 36, minHeight: 36 }} aria-label={`ลดหนี้ ${l.name} มากขึ้น`}
                onClick={() => setPick(pick.map((q: number, k: number) => (k === i ? Math.min(doc.remaining[i], q + 1) : q)))}><Icon name="plus" /> </button>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 14 }}>ราคาตามเมนู ฿{formatBaht(pickedGross)} (ระบบเฉลี่ยส่วนลด/ค่าบริการตามสัดส่วน)</div>
        </div>
      )}
      <span className="muted" style={{ fontSize: 14 }}>
        {creditNote ? 'เอกสารของวันก่อนแก้ไม่ได้ ระบบจะออกใบลดหนี้อ้างถึงเลขที่นี้ และหักออกจากภาษีขายเดือนนี้' : 'เลขที่เอกสารยังถูกเก็บไว้พร้อมเหตุผล'}
      </span>
      <label className="field"><span className="muted">เหตุผล</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} autoFocus /></label>
      {creditNote && (
        <label className="field"><span className="muted">คืนเงินลูกค้าด้วย</span>
          <select value={refund} onChange={(e) => setRefund(e.target.value as typeof refund)}
            style={{ height: 50, borderRadius: 12, border: '1px solid #c9cfc7', padding: '0 10px', fontSize: 16 }}>
            <option value="cash">เงินสดจากลิ้นชัก (บันทึกเป็นเงินออกของกะ)</option>
            <option value="transfer">โอนคืน</option>
            <option value="none">ไม่คืนเงิน</option>
          </select>
        </label>
      )}
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-danger" style={{ flex: 1 }} disabled={creditNote && !whole && picked.length === 0}><Icon name="ban" /> {creditNote ? 'ออกใบลดหนี้' : 'ยกเลิกเอกสาร'}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}><Icon name="close" /> ปิด</button>
      </div>
    </form>
  );
}

export default function Page() {
  return <Suspense><Receipt /></Suspense>;
}
