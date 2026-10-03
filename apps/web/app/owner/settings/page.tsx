'use client';

import { isValidPromptPayId, isValidThaiTaxId } from '@prakai/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { PrintersSection } from './PrintersSection';
import { SecuritySection } from './SecuritySection';
import { TablesSection } from './TablesSection';

export default function Settings() {
  const { me, reload } = useMe();
  const [f, setF] = useState<any>(null);
  const [posIds, setPosIds] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!me) return;
    setF({
      name: me.tenant.name, vatRegisteredAt: me.tenant.vat_registered_at ?? '', branchCode: me.branches[0]?.branch_code ?? '00000',
      vatRegistered: me.tenant.vat_registered, legalName: me.tenant.legal_name ?? '', taxId: me.tenant.tax_id ?? '',
      address: me.tenant.address ?? '', priceIncludesVat: me.tenant.price_includes_vat,
      serviceCharge: String(me.tenant.service_charge_bp / 100), cashRounding: me.tenant.cash_rounding,
      promptpay: me.tenant.promptpay_id ?? '',
    });
    setPosIds(Object.fromEntries(me.terminals.map((t) => [t.id, t.rd_pos_id ?? ''])));
    setSerials(Object.fromEntries(me.terminals.map((t) => [t.id, t.serial_no ?? ''])));
  }, [me]);

  if (!me || !f) return <><TopBar me={me} active="owner" /><main style={{ padding: 40 }}>กำลังโหลด…</main></>;
  const taxIdBad = f.taxId !== '' && !isValidThaiTaxId(f.taxId);
  const branchBad = !/^\d{5}$/.test(f.branchCode);
  const ppBad = f.promptpay.trim() !== '' && !isValidPromptPayId(f.promptpay);

  async function save() {
    setErr(''); setMsg('');
    try {
      await api('PATCH', '/api/settings', {
        name: f.name.trim(), vatRegisteredAt: f.vatRegistered && f.vatRegisteredAt ? f.vatRegisteredAt : null,
        vatRegistered: f.vatRegistered, legalName: f.legalName || null, taxId: f.taxId || null, address: f.address || null,
        priceIncludesVat: f.priceIncludesVat, serviceChargeBp: Math.round(Number(f.serviceCharge || 0) * 100), cashRounding: f.cashRounding,
        promptpayId: f.promptpay.trim() || null,
      });
      for (const t of me!.terminals) {
        if ((t.rd_pos_id ?? '') !== posIds[t.id] || (t.serial_no ?? '') !== serials[t.id]) {
          await api('PATCH', `/api/terminals/${t.id}`, { rdPosId: posIds[t.id] || null, serialNo: serials[t.id] || null });
        }
      }
      const br = me!.branches[0];
      if (br && br.branch_code !== f.branchCode) await api('PATCH', `/api/branches/${br.id}`, { branchCode: f.branchCode });
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
            <label className="field">ชื่อร้าน (แสดงบนหน้าจอและหัวใบเสร็จ)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="row" style={{ minHeight: 48, fontSize: 17, fontWeight: 700 }}>
              <input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} style={{ width: 26, height: 26, accentColor: 'var(--accent)' }} />
              จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)
            </label>
            {f.vatRegistered && (
              <label className="field">วันที่จดทะเบียน VAT<input type="date" value={f.vatRegisteredAt} onChange={(e) => setF({ ...f, vatRegisteredAt: e.target.value })} /></label>
            )}
            <label className="field">ชื่อผู้ประกอบการ (พิมพ์บนใบกำกับภาษี)<input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></label>
            <label className="field">เลขประจำตัวผู้เสียภาษี 13 หลัก
              <input inputMode="numeric" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} aria-invalid={taxIdBad} style={taxIdBad ? { borderColor: 'var(--warn)' } : undefined} />
              {taxIdBad && <span style={{ color: 'var(--warn-ink)' }}>เลขไม่ถูกต้อง (ตรวจหลักสุดท้ายไม่ผ่าน)</span>}
            </label>
            <label className="field">ที่อยู่ร้าน<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
            <label className="field">รหัสสาขา 5 หลัก (00000 = สำนักงานใหญ่)
              <input inputMode="numeric" maxLength={5} value={f.branchCode} onChange={(e) => setF({ ...f, branchCode: e.target.value })} aria-invalid={branchBad} style={branchBad ? { borderColor: 'var(--warn)' } : undefined} />
              {branchBad && <span style={{ color: 'var(--warn-ink)' }}>ต้องเป็นตัวเลข 5 หลัก</span>}
            </label>
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
            <label className="field">พร้อมเพย์ของร้าน (เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี/บัตรประชาชน 13 หลัก)
              <input inputMode="numeric" placeholder="ว่าง = ไม่แสดง QR" value={f.promptpay} onChange={(e) => setF({ ...f, promptpay: e.target.value })}
                aria-invalid={ppBad} style={ppBad ? { borderColor: 'var(--warn)' } : undefined} />
              {ppBad ? <span style={{ color: 'var(--warn-ink)' }}>ต้องเป็นตัวเลข 10 หรือ 13 หลัก</span>
                : <span>หน้าชำระเงินจะสร้าง QR ตามยอดบิล ลูกค้าสแกนแล้วยอดขึ้นเอง</span>}
            </label>
            <div style={{ fontWeight: 700, paddingTop: 8 }}>เครื่องขายและ POS ID สรรพากร</div>
            {me.terminals.map((t) => (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field">{t.name} ({t.code}) · POS ID
                  <input placeholder="ว่าง = ยังไม่ได้รับอนุมัติ ภ.พ.06" value={posIds[t.id] ?? ''} onChange={(e) => setPosIds({ ...posIds, [t.id]: e.target.value })} />
                </label>
                <label className="field">หมายเลขเครื่อง (serial)
                  <input value={serials[t.id] ?? ''} onChange={(e) => setSerials({ ...serials, [t.id]: e.target.value })} />
                </label>
              </div>
            ))}
            <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--info-soft)', color: 'var(--info-ink)', fontSize: 14 }}>
              ระหว่างรออนุมัติ ออกใบกำกับภาษีเต็มรูปได้ ใบอย่างย่อเปิดใช้เมื่อกรอก POS ID แล้ว
              {owner && <> · <Link href="/owner/pp06" style={{ fontWeight: 700, textDecoration: 'underline' }}>พิมพ์เอกสารประกอบคำขอ ภ.พ.06</Link></>}
            </div>
          </section>
        </div>
        {err && <div className="error" role="alert">{err}</div>}
        {msg && <div style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}
        <div><button className="btn btn-primary btn-lg" onClick={save} disabled={!owner || taxIdBad || branchBad || ppBad || !f.name.trim()} style={{ minWidth: 200 }}>บันทึก</button></div>
        <TablesSection canEdit={me.role === 'owner' || me.role === 'manager'} />
        <PrintersSection me={me} />
        <SecuritySection isOwner={me.role === 'owner'} />
        <section className="card" style={{ padding: 18, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>สำรองข้อมูล</h2>
            <div className="muted" style={{ fontSize: 14 }}>ดาวน์โหลดข้อมูลทั้งหมดของร้าน (เมนู บิล เอกสารภาษี สต็อก ค่าใช้จ่าย audit log) เป็นไฟล์ JSON เก็บไว้เองได้ตลอด ระบบสำรองรายคืนบนเซิร์ฟเวอร์แยกต่างหาก</div>
          </div>
          {/* A plain link: the browser downloads with the session cookie, no JS needed. */}
          <a className="btn btn-outline" href="/api/export" download aria-disabled={!owner} style={owner ? undefined : { pointerEvents: 'none', opacity: 0.5 }}>ดาวน์โหลดข้อมูลร้าน</a>
        </section>
      </main>
    </>
  );
}
