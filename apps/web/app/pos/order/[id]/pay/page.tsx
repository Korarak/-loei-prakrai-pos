'use client';

import { formatBaht, roundCash, type CashRounding } from '@prakai/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { BackIcon } from '@/lib/ui';
import { PromptPayQr } from '@/lib/PromptPayQr';
import { terminalFor, useMe } from '@/lib/useMe';

type Method = 'cash' | 'promptpay' | 'card' | 'transfer';
type DocType = 'ABB' | 'FULL' | 'RECEIPT';

const METHODS: [Method, string][] = [['cash', 'เงินสด'], ['promptpay', 'พร้อมเพย์'], ['card', 'บัตร'], ['transfer', 'โอน']];

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useMe();
  const [view, setView] = useState<any>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState('');
  const [doc, setDoc] = useState<DocType | null>(null);
  const [buyer, setBuyer] = useState({ name: '', taxId: '', branch: '00000', address: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('GET', `/api/orders/${id}`).then(setView).catch((e) => setErr(errText(e))); }, [id]);

  const terminal = me ? terminalFor(me) : null;
  const vat = !!me?.tenant.vat_registered;
  const abbOk = vat && !!terminal?.rd_pos_id;
  const docChoice: DocType = doc ?? (!vat ? 'RECEIPT' : abbOk ? 'ABB' : 'FULL');

  if (!view || !me) return <main style={{ padding: 40 }}>{err || 'กำลังโหลด…'}</main>;

  const total: number = view.bill.total;
  const payable = method === 'cash' ? roundCash(total, me.tenant.cash_rounding as CashRounding).payable : total;
  const got = received === '' ? 0 : Number(received) * 100;
  const diff = got - payable;
  const cashShort = method === 'cash' && diff < 0;
  const quick = Array.from(new Set([payable, Math.ceil(payable / 10000) * 10000, 50000, 100000])).filter((v) => v >= payable).slice(0, 4);

  const press = (k: string) => setReceived((cur) => {
    if (k === 'ลบ') return cur.slice(0, -1);
    if (cur.length >= 6) return cur;
    return cur === '0' ? k : cur + k;
  });

  async function confirm() {
    setBusy(true);
    setErr('');
    try {
      const r = await api('POST', `/api/orders/${id}/pay`, {
        terminalId: terminal!.id,
        docType: docChoice,
        payments: [method === 'cash' ? { method, tendered: got > 0 ? got : undefined } : { method }],
        buyer: docChoice === 'FULL' ? buyer : undefined,
      });
      router.push(`/receipt/${r.document.id}?change=${r.change}&fresh=1`);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  const docOptions: [DocType, string, string, boolean][] = vat
    ? [['ABB', 'ใบกำกับภาษีอย่างย่อ', abbOk ? `พิมพ์อัตโนมัติ · POS ID ${terminal?.rd_pos_id}` : 'ยังไม่มี POS ID จากสรรพากร', abbOk],
       ['FULL', 'ใบกำกับภาษีเต็มรูป', 'กรอกข้อมูลผู้ซื้อ', true]]
    : [['RECEIPT', 'ใบเสร็จรับเงิน', 'ร้านยังไม่จด VAT', true]];

  const choiceStyle = (on: boolean, enabled = true): React.CSSProperties => ({
    minHeight: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, textAlign: 'left',
    border: on ? '2px solid var(--accent)' : '1px solid var(--line-2)', background: on ? 'var(--accent-soft)' : '#fff', opacity: enabled ? 1 : 0.5,
  });

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <Link href={`/pos/order/${id}`} className="btn"><BackIcon /> กลับไปแก้รายการ</Link>
        <span style={{ fontSize: 20, fontWeight: 700 }}>ชำระเงิน · {view.order.table_name ? `โต๊ะ ${view.order.table_name}` : view.parent ? `บิลแยกจากโต๊ะ ${view.parent.table_name}` : 'กลับบ้าน'}</span>
        <span className="spacer" />
        <span className="muted">บิล #{view.order.bill_no} · {terminal?.name}</span>
      </header>

      <div className="pay-body">
        <section aria-label="สรุปบิล" className="card pay-summary">
          <div style={{ fontSize: 18, fontWeight: 700, paddingBottom: 8 }}>สรุปบิล</div>
          {view.lines.filter((l: any) => l.status !== 'void').map((l: any) => (
            <div key={l.id} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--line-soft)', gap: 10 }}>
              <span className="muted" style={{ width: 30 }}>{l.qty}×</span>
              <span style={{ flex: 1 }}>{l.name}</span>
              <b>{formatBaht(l.unit_price * l.qty)}</b>
            </div>
          ))}
          <span className="spacer" />
          <div style={{ display: 'grid', gap: 6, color: 'var(--muted)', paddingTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>รวมค่าอาหาร</span><span>{formatBaht(view.bill.gross)}</span></div>
            {view.bill.discount > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span>ส่วนลด</span><span>−{formatBaht(view.bill.discount)}</span></div>}
            {view.bill.serviceCharge > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span>ค่าบริการ</span><span>{formatBaht(view.bill.serviceCharge)}</span></div>}
            {vat && <div className="row" style={{ justifyContent: 'space-between' }}><span>มูลค่าก่อน VAT</span><span>{formatBaht(view.bill.vatableBase + view.bill.exemptBase + view.bill.serviceCharge)}</span></div>}
            {vat && <div className="row" style={{ justifyContent: 'space-between' }}><span>VAT 7%</span><span>{formatBaht(view.bill.vat)}</span></div>}
            {payable !== total && <div className="row" style={{ justifyContent: 'space-between' }}><span>ปัดเศษเงินสด</span><span>{formatBaht(payable - total)}</span></div>}
          </div>
        </section>

        <section aria-label="รับชำระ" className="pay-main">
          <div className="card row" style={{ padding: '14px 22px', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="muted" style={{ fontSize: 18, fontWeight: 600 }}>ยอดชำระ</span>
            <span style={{ fontSize: 56, fontWeight: 700 }}>฿{formatBaht(payable)}</span>
          </div>
          <div role="tablist" aria-label="ช่องทางชำระ" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {METHODS.map(([m, label]) => (
              <button key={m} role="tab" aria-selected={method === m} onClick={() => setMethod(m)}
                style={{ height: 56, borderRadius: 14, fontSize: 17, fontWeight: method === m ? 700 : 500,
                  border: method === m ? '2px solid var(--accent)' : '1px solid var(--line-2)',
                  background: method === m ? 'var(--accent-soft)' : '#fff', color: method === m ? 'var(--accent-ink)' : 'var(--ink)' }}>{label}</button>
            ))}
          </div>
          {method === 'cash' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="card" style={{ padding: '10px 18px' }}>
                  <div className="muted">รับเงินมา</div>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>฿{formatBaht(got)}</div>
                </div>
                <div style={{ padding: '10px 18px', borderRadius: 14, background: cashShort && got > 0 ? 'var(--warn-soft)' : 'var(--accent-soft)',
                  border: `1px solid ${cashShort && got > 0 ? 'var(--warn)' : 'var(--accent)'}`, color: cashShort && got > 0 ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
                  <div>{got === 0 ? 'รับพอดี' : cashShort ? 'ยังขาด' : 'เงินทอน'}</div>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>฿{formatBaht(got === 0 ? 0 : Math.abs(diff))}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {quick.map((v, i) => (
                  <button key={v} className="btn" style={{ height: 52, fontSize: 18 }} onClick={() => setReceived(String(v / 100))}>
                    {i === 0 ? 'พอดี' : formatBaht(v).replace(/\.00$/, '')}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'ลบ'].map((k) => (
                  <button key={k} onClick={() => press(k)} aria-label={k === 'ลบ' ? 'ลบตัวเลขสุดท้าย' : `เลข ${k}`}
                    style={{ height: 60, borderRadius: 12, border: '1px solid var(--line)', background: '#fff', fontSize: 26, fontWeight: 600 }}>{k}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="card" style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, fontSize: 17, color: 'var(--muted)', textAlign: 'center' }}>
              {method === 'promptpay'
                ? me.tenant.promptpay_id
                  ? <PromptPayQr id={me.tenant.promptpay_id} amount={payable} />
                  : 'ให้ลูกค้าสแกน QR พร้อมเพย์ของร้าน ตรวจยอดเงินเข้าแล้วกดยืนยัน (ใส่เลขพร้อมเพย์ในตั้งค่าร้าน เพื่อสร้าง QR ตามยอดบิลอัตโนมัติ)'
                : 'ทำรายการที่เครื่องรูดบัตร หรือตรวจสลิปโอน แล้วกดยืนยัน'}
            </div>
          )}
        </section>

        <section aria-label="เอกสาร" className="pay-doc">
          <div style={{ fontSize: 18, fontWeight: 700 }}>เอกสารที่ออก</div>
          {docOptions.map(([d, label, sub, enabled]) => (
            <button key={d} disabled={!enabled} aria-pressed={docChoice === d} onClick={() => setDoc(d)} style={choiceStyle(docChoice === d, enabled)}>
              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 11, border: docChoice === d ? '7px solid var(--accent)' : '2px solid #9AA39C' }} />
              <span><b style={{ display: 'block' }}>{label}</b><span className="muted" style={{ fontSize: 13 }}>{sub}</span></span>
            </button>
          ))}
          {docChoice === 'FULL' && (
            <div className="card" style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
              <label className="field">ชื่อผู้ซื้อ / บริษัท<input value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                <label className="field">เลขผู้เสียภาษี 13 หลัก<input inputMode="numeric" value={buyer.taxId} onChange={(e) => setBuyer({ ...buyer, taxId: e.target.value })} /></label>
                <label className="field">สาขา<input inputMode="numeric" value={buyer.branch} onChange={(e) => setBuyer({ ...buyer, branch: e.target.value })} /></label>
              </div>
              <label className="field">ที่อยู่<input value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} /></label>
            </div>
          )}
          <span className="spacer" />
          {err && <div className="error" role="alert">{err}</div>}
          <button className="btn btn-primary" style={{ height: 72, fontSize: 21, borderRadius: 16 }} disabled={busy || (cashShort && got > 0)} onClick={confirm}>
            {busy ? 'กำลังบันทึก…' : 'ยืนยันรับชำระ'}
          </button>
        </section>
      </div>
    </div>
  );
}
