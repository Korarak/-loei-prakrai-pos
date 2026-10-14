'use client';

import { formatBaht } from '@prakai/core';
import { useCallback, useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';
import { terminalFor, useMe } from '@/lib/useMe';
import { TopBar } from '../TopBar';

const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };
const input: React.CSSProperties = { width: '100%', height: 52, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line-2)', fontSize: 20 };
const toSatang = (s: string) => (s.trim() === '' ? NaN : Math.round(Number(s.replace(/,/g, '')) * 100));

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

interface Summary {
  shift: { id: string; status: string; opening_float: number; opened_at: string; closed_at: string | null; counted_cash: number | null;
           close_note: string | null; terminal_code: string; terminal_name: string; opened_by_name: string; closed_by_name: string | null };
  methods: { method: string; amount: number; n: number }[];
  moves: { id: string; kind: 'in' | 'out'; amount: number; reason: string; created_at: string; by_name: string }[];
  bills: number; sales: number; cashSales: number; cashIn: number; cashOut: number; expectedCash: number; difference: number | null;
  openOrders?: number;
}

/** เปิดกะ · นำเงินเข้า–ออก · ปิดกะนับเงิน (X/Z report ของกะ) สำหรับเครื่องขายนี้ */
export default function ShiftPage() {
  const confirm = useConfirm();
  const { me } = useMe();
  const terminal = me ? terminalFor(me) : null;
  const [cur, setCur] = useState<Summary | null | undefined>(undefined);
  const [closed, setClosed] = useState<Summary | null>(null);
  const [float, setFloat] = useState('1000');
  const [move, setMove] = useState({ kind: 'in' as 'in' | 'out', amount: '', reason: '' });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (terminal) api<Summary | null>('GET', `/api/shifts/current?terminalId=${terminal.id}`).then(setCur).catch((e) => setErr(errText(e)));
  }, [terminal?.id]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); load(); } catch (e) { setErr(errText(e)); }
  };

  const report = closed ?? cur;
  return (
    <>
      <TopBar me={me} active="shift" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)', alignItems: 'start' }} className="shift-grid">
        <section className="card" style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: 24 }}>{closed ? 'สรุปปิดกะ (Z)' : 'กะปัจจุบัน (X)'}</h1>
            <span className="muted">{terminal ? `เครื่อง ${terminal.name} (${terminal.code})` : ''}</span>
            <span className="spacer" />
            {report && <button className="btn no-print" onClick={() => window.print()}><Icon name="print" /> พิมพ์</button>}
          </div>
          {cur === undefined && !closed && <p className="muted">กำลังโหลด…</p>}
          {cur === null && !closed && <p className="muted">เครื่องนี้ยังไม่ได้เปิดกะ ต้องเปิดกะก่อนจึงรับชำระเงินได้</p>}
          {report && <ShiftReport r={report} />}
        </section>

        <aside className="no-print" style={{ display: 'grid', gap: 16 }}>
          {err && <div className="error" role="alert">{err}</div>}
          {closed && (
            <button className="btn btn-primary btn-lg" onClick={() => { setClosed(null); setCounted(''); setNote(''); }}><Icon name="clock" /> เปิดกะใหม่</button>
          )}
          {!closed && cur === null && (
            <form className="card" style={{ padding: 16, display: 'grid', gap: 10 }}
              onSubmit={(e) => { e.preventDefault(); run(() => api('POST', '/api/shifts', { terminalId: terminal!.id, openingFloat: toSatang(float) || 0 })); }}>
              <b style={{ fontSize: 18 }}>เปิดกะ</b>
              <label><span className="muted">เงินทอนตั้งต้นในลิ้นชัก (บาท)</span>
                <input style={input} inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} required /></label>
              <button className="btn btn-primary btn-lg"><Icon name="clock" size={22} /> เปิดกะ</button>
            </form>
          )}
          {!closed && cur && <>
            <form className="card" style={{ padding: 16, display: 'grid', gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api('POST', `/api/shifts/${cur.shift.id}/cash`, { kind: move.kind, amount: toSatang(move.amount), reason: move.reason }))
                  .then(() => setMove({ ...move, amount: '', reason: '' }));
              }}>
              <b style={{ fontSize: 18 }}>นำเงินเข้า–ออก</b>
              <div className="row" style={{ gap: 8 }}>
                {(['in', 'out'] as const).map((k) => (
                  <button type="button" key={k} className="btn" style={{ flex: 1 }} aria-pressed={move.kind === k}
                    onClick={() => setMove({ ...move, kind: k })}>{k === 'in' ? 'นำเข้า' : 'นำออก'}</button>
                ))}
              </div>
              <label><span className="muted">จำนวน (บาท)</span>
                <input style={input} inputMode="decimal" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} required /></label>
              <label><span className="muted">เหตุผล</span>
                <input style={{ ...input, fontSize: 16 }} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })}
                  placeholder={move.kind === 'in' ? 'เช่น แลกเหรียญเพิ่ม' : 'เช่น จ่ายค่าน้ำแข็ง'} required minLength={2} /></label>
              <button className="btn btn-outline"><Icon name="save" /> บันทึก</button>
            </form>

            <form className="card" style={{ padding: 16, display: 'grid', gap: 10 }}
              onSubmit={async (e) => {
                e.preventDefault();
                setErr('');
                if (!(await confirm({ title: 'ปิดกะ?', body: `นับเงินสดได้ ${counted} บาท ปิดแล้วรับเงินต่อไม่ได้จนกว่าจะเปิดกะใหม่`, confirm: 'ปิดกะ', icon: 'clock' }))) return;
                api<Summary>('POST', `/api/shifts/${cur.shift.id}/close`, { countedCash: toSatang(counted), note: note || undefined })
                  .then((z) => { setClosed(z); setCur(null); }).catch((x) => setErr(errText(x)));
              }}>
              <b style={{ fontSize: 18 }}>ปิดกะ</b>
              <label><span className="muted">นับเงินสดในลิ้นชักได้ (บาท)</span>
                <input style={input} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} required /></label>
              {counted !== '' && !Number.isNaN(toSatang(counted)) && (
                <div className="muted">ต่างจากยอดระบบ {signed(toSatang(counted) - cur.expectedCash)} บาท</div>
              )}
              <label><span className="muted">หมายเหตุ (ถ้าเงินขาด/เกิน)</span>
                <input style={{ ...input, fontSize: 16 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button className="btn btn-primary btn-lg"><Icon name="clock" size={22} /> ปิดกะและพิมพ์สรุป</button>
            </form>
          </>}
        </aside>
      </main>
    </>
  );
}

const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + formatBaht(Math.abs(v));

function ShiftReport({ r }: { r: Summary }) {
  const s = r.shift;
  const row = (a: React.ReactNode, b: React.ReactNode, strong = false) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontWeight: strong ? 700 : 400 }}>
      <span>{a}</span><span>{b}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 16 }}>
      <div className="muted" style={{ fontSize: 14 }}>
        เปิด {fmtTime(s.opened_at)} โดย {s.opened_by_name}{s.closed_at ? ` · ปิด ${fmtTime(s.closed_at)} โดย ${s.closed_by_name}` : ''}
      </div>
      {row('จำนวนบิล', r.bills)}
      {r.methods.map((m) => row(`${METHOD[m.method] ?? m.method} (${m.n})`, formatBaht(m.amount)))}
      {row('ยอดขายรวม', formatBaht(r.sales), true)}
      <div style={{ height: 8 }} />
      {row('เงินทอนตั้งต้น', formatBaht(s.opening_float))}
      {row('+ ขายเงินสด', formatBaht(r.cashSales))}
      {row('+ นำเงินเข้า', formatBaht(r.cashIn))}
      {row('− นำเงินออก / คืนเงิน', formatBaht(r.cashOut))}
      {row('เงินสดที่ควรมีในลิ้นชัก', formatBaht(r.expectedCash), true)}
      {s.counted_cash !== null && <>
        {row('นับได้จริง', formatBaht(s.counted_cash), true)}
        <div className="row" style={{ justifyContent: 'space-between', padding: '8px 0', fontSize: 20, fontWeight: 700,
          color: r.difference === 0 ? 'var(--accent-ink)' : 'var(--warn-ink)' }}>
          <span>{r.difference === 0 ? 'เงินตรง' : r.difference! > 0 ? 'เงินเกิน' : 'เงินขาด'}</span><span>{signed(r.difference!)}</span>
        </div>
        {s.close_note && <div className="muted">หมายเหตุ: {s.close_note}</div>}
      </>}
      {!!r.openOrders && <div className="error">ยังมีบิลเปิดค้าง {r.openOrders} บิล</div>}
      {r.moves.length > 0 && <>
        <b style={{ paddingTop: 10 }}>รายการนำเงินเข้า–ออก</b>
        {r.moves.map((m) => row(`${fmtTime(m.created_at)} · ${m.reason} · ${m.by_name}`, `${m.kind === 'in' ? '+' : '−'}${formatBaht(m.amount)}`))}
      </>}
    </div>
  );
}
