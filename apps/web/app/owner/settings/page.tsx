'use client';

import { isValidThaiTaxId } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

export default function Settings() {
  const { me, reload } = useMe();
  const [f, setF] = useState<any>(null);
  const [posIds, setPosIds] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!me) return;
    setF({
      vatRegistered: me.tenant.vat_registered, legalName: me.tenant.legal_name ?? '', taxId: me.tenant.tax_id ?? '',
      address: me.tenant.address ?? '', priceIncludesVat: me.tenant.price_includes_vat,
      serviceCharge: String(me.tenant.service_charge_bp / 100), cashRounding: me.tenant.cash_rounding,
    });
    setPosIds(Object.fromEntries(me.terminals.map((t) => [t.id, t.rd_pos_id ?? ''])));
  }, [me]);

  if (!me || !f) return <><TopBar me={me} active="owner" /><main style={{ padding: 40 }}>กำลังโหลด…</main></>;
  const taxIdBad = f.taxId !== '' && !isValidThaiTaxId(f.taxId);

  async function save() {
    setErr(''); setMsg('');
    try {
      await api('PATCH', '/api/settings', {
        vatRegistered: f.vatRegistered, legalName: f.legalName || null, taxId: f.taxId || null, address: f.address || null,
        priceIncludesVat: f.priceIncludesVat, serviceChargeBp: Math.round(Number(f.serviceCharge || 0) * 100), cashRounding: f.cashRounding,
      });
      for (const t of me!.terminals) {
        if ((t.rd_pos_id ?? '') !== posIds[t.id]) await api('PATCH', `/api/terminals/${t.id}`, { rdPosId: posIds[t.id] || null });
      }
      await reload();
      setMsg('บันทึกแล้ว');
    } catch (e) { setErr(errText(e)); }
  }

  const owner = me.role === 'owner';
  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16, maxWidth: 1100 }}>
        <OwnerTabs active="settings" />
        {!owner && <div className="error">เฉพาะเจ้าของร้านแก้ค่าภาษีได้</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          <section className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
            <label className="row" style={{ minHeight: 48, fontSize: 17, fontWeight: 700 }}>
              <input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} style={{ width: 26, height: 26, accentColor: 'var(--accent)' }} />
              จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)
            </label>
            <label className="field">ชื่อผู้ประกอบการ (พิมพ์บนใบกำกับภาษี)<input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></label>
            <label className="field">เลขประจำตัวผู้เสียภาษี 13 หลัก
              <input inputMode="numeric" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} aria-invalid={taxIdBad} style={taxIdBad ? { borderColor: 'var(--warn)' } : undefined} />
              {taxIdBad && <span style={{ color: 'var(--warn-ink)' }}>เลขไม่ถูกต้อง (ตรวจหลักสุดท้ายไม่ผ่าน)</span>}
            </label>
            <label className="field">ที่อยู่ร้าน<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          </section>
          <section className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
            <label className="field">ราคาเมนู
              <select value={f.priceIncludesVat ? 'incl' : 'excl'} onChange={(e) => setF({ ...f, priceIncludesVat: e.target.value === 'incl' })}>
                <option value="incl">ราคาเมนูรวม VAT แล้ว</option>
                <option value="excl">บวก VAT ตอนคิดเงิน</option>
              </select>
            </label>
            <label className="field">Service charge (%)<input inputMode="decimal" value={f.serviceCharge} onChange={(e) => setF({ ...f, serviceCharge: e.target.value })} /></label>
            <label className="field">ปัดเศษเงินสด
              <select value={f.cashRounding} onChange={(e) => setF({ ...f, cashRounding: e.target.value })}>
                <option value="none">ไม่ปัด</option><option value="down-25">ปัดลงเป็น 25 สตางค์</option><option value="down-baht">ปัดลงเป็นบาท</option>
              </select>
            </label>
            <div style={{ fontWeight: 700, paddingTop: 8 }}>เครื่องขายและ POS ID สรรพากร</div>
            {me.terminals.map((t) => (
              <label key={t.id} className="field">{t.name} ({t.code})
                <input placeholder="ว่าง = ยังไม่ได้รับอนุมัติ ภ.พ.06" value={posIds[t.id] ?? ''} onChange={(e) => setPosIds({ ...posIds, [t.id]: e.target.value })} />
              </label>
            ))}
            <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--info-soft)', color: 'var(--info-ink)', fontSize: 14 }}>
              ระหว่างรออนุมัติ ออกใบกำกับภาษีเต็มรูปได้ ใบอย่างย่อเปิดใช้เมื่อกรอก POS ID แล้ว
            </div>
          </section>
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <div style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}
        <div><button className="btn btn-primary btn-lg" onClick={save} disabled={!owner || taxIdBad} style={{ minWidth: 200 }}>บันทึก</button></div>
      </main>
    </>
  );
}
