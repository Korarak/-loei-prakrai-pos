'use client';

import { applyRate, formatBaht } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, EXPENSE_LABEL, monthLabel, MonthPicker, Sheet, thisMonth, toSatang, today } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

/** Common withholding rates (ภ.ง.ด.3/53): rent 5%, services 3%, advertising 2%, transport 1%. */
const WHT = [[0, 'ไม่หัก'], [100, '1% ค่าขนส่ง'], [200, '2% ค่าโฆษณา'], [300, '3% ค่าบริการ'], [500, '5% ค่าเช่า']] as const;

export default function Expenses() {
  const { me } = useMe();
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api('GET', `/api/expenses?month=${month}`).then(setRows).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, [month]);

  const byCat = Object.keys(EXPENSE_LABEL).map((k) => [k, (rows ?? []).filter((r) => r.category === k).reduce((s, r) => s + r.amount, 0)] as const)
    .filter(([, v]) => v > 0);
  const total = (rows ?? []).reduce((s, r) => s + r.amount, 0);
  const owner = me?.role === 'owner';

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <OwnerTabs active="expenses" />
          <span className="spacer" />
          <MonthPicker value={month} onChange={setMonth} label="เดือนของค่าใช้จ่าย" />
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        {byCat.length > 0 && (
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {byCat.map(([k, v]) => <span key={k}>{EXPENSE_LABEL[k]} <b>฿{formatBaht(v)}</b></span>)}
            <span style={{ marginLeft: 'auto' }}>รวม <b>฿{formatBaht(total)}</b></span>
          </div>
        )}
        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>ค่าใช้จ่าย · {monthLabel(month)}</h1>
            <span className="muted" style={{ fontSize: 14 }}>ต้นทุนวัตถุดิบมาจากการรับของและขาย ไม่ต้องบันทึกซ้ำที่นี่</span>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!owner} title={owner ? undefined : 'เฉพาะเจ้าของร้าน'}>+ บันทึกค่าใช้จ่าย</button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>วันที่จ่าย</th><th>หมวด</th><th>รายการ</th><th>ผู้รับเงิน</th>
                <th className="num">ต้นทุน</th><th className="num">ภาษีซื้อ</th><th className="num">หัก ณ ที่จ่าย</th>
              </tr></thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id}>
                    <td>{dayLabel(r.paid_on)}</td>
                    <td className="muted">{EXPENSE_LABEL[r.category]}</td>
                    <td>{r.description}</td>
                    <td className="muted">{r.payee_name ?? ''}{r.payee_tax_id && <div style={{ fontSize: 12, lineHeight: 1.1 }}>{r.payee_tax_id}</div>}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatBaht(r.amount)}</td>
                    <td className="num">{r.input_vat ? formatBaht(r.input_vat) : '—'}</td>
                    <td className="num">{r.wht_amount ? `${formatBaht(r.wht_amount)} (${r.wht_rate_bp / 100}%)` : '—'}</td>
                  </tr>
                ))}
                {rows && rows.length > 0 && (
                  <tr className="total">
                    <td colSpan={4}>รวม</td>
                    <td className="num">{formatBaht(total)}</td>
                    <td className="num">{formatBaht(rows.reduce((s, r) => s + r.input_vat, 0))}</td>
                    <td className="num">{formatBaht(rows.reduce((s, r) => s + r.wht_amount, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows?.length === 0 && <p className="muted">ยังไม่มีค่าใช้จ่ายในเดือนนี้</p>}
        </section>
      </main>
      {adding && <ExpenseSheet month={month} vatShop={!!me?.tenant.vat_registered} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
  );
}

function ExpenseSheet({ month, vatShop, onClose, onSaved }: { month: string; vatShop: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ month, paidOn: today(), category: 'rent', description: '', total: '', inputVat: '', whtRateBp: 500, payeeName: '', payeeTaxId: '' });
  const [err, setErr] = useState('');
  const total = toSatang(f.total);
  const vat = f.inputVat.trim() === '' ? 0 : toSatang(f.inputVat);
  const wht = Number.isFinite(total) && Number.isFinite(vat) ? applyRate(total - vat, f.whtRateBp) : 0;

  async function save() {
    setErr('');
    try {
      await api('POST', '/api/expenses', {
        month: f.month, paidOn: f.paidOn, category: f.category, description: f.description, total, inputVat: vat, whtRateBp: f.whtRateBp,
        payeeName: f.payeeName || undefined, payeeTaxId: f.payeeTaxId || undefined,
      });
      onSaved();
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <Sheet title="บันทึกค่าใช้จ่าย" onClose={onClose}>
      <div className="grid-form">
        <label className="field">เป็นค่าใช้จ่ายของเดือน<input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></label>
        <label className="field">วันที่จ่าย<input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></label>
      </div>
      <label className="field">หมวด
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, whtRateBp: e.target.value === 'rent' ? 500 : f.category === 'rent' ? 0 : f.whtRateBp })}>
          {Object.entries(EXPENSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field">รายการ<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="เช่น ค่าเช่าร้านเดือนกันยายน" /></label>
      <div className="grid-form">
        <label className="field">ยอดจ่ายรวม VAT (บาท)<input inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
        <label className="field">VAT ในใบกำกับ (บาท)<input inputMode="decimal" value={f.inputVat} onChange={(e) => setF({ ...f, inputVat: e.target.value })} placeholder="0.00" /></label>
      </div>
      {!vatShop && vat > 0 && <div className="muted" style={{ fontSize: 14 }}>ร้านยังไม่จด VAT ภาษีซื้อจะรวมเป็นต้นทุน</div>}
      <label className="field">หักภาษี ณ ที่จ่าย
        <select value={f.whtRateBp} onChange={(e) => setF({ ...f, whtRateBp: Number(e.target.value) })}>
          {WHT.map(([bp, label]) => <option key={bp} value={bp}>{label}</option>)}
        </select>
      </label>
      {f.whtRateBp > 0 && (
        <>
          <div className="grid-form">
            <label className="field">ผู้รับเงิน<input value={f.payeeName} onChange={(e) => setF({ ...f, payeeName: e.target.value })} /></label>
            <label className="field">เลขผู้เสียภาษีผู้รับเงิน<input inputMode="numeric" value={f.payeeTaxId} onChange={(e) => setF({ ...f, payeeTaxId: e.target.value })} /></label>
          </div>
          <div className="card" style={{ padding: '10px 14px' }}>หัก ณ ที่จ่าย <b>฿{formatBaht(wht)}</b> · จ่ายจริง <b>฿{formatBaht(total - wht)}</b></div>
        </>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn btn-primary btn-lg" onClick={save}
        disabled={!f.description.trim() || !Number.isFinite(total) || total < 0 || !Number.isFinite(vat) || vat > total}>บันทึก</button>
    </Sheet>
  );
}
