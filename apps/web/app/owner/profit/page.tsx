'use client';

import { formatBaht } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EXPENSE_LABEL, fmtQty, monthLabel, MonthPicker, Stat, thisMonth, UNIT } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';

const CLASS: Record<string, { label: string; hint: string; bg: string; ink: string }> = {
  star: { label: 'ดาวเด่น', hint: 'ขายดี กำไรดี — รักษาคุณภาพ', bg: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  plowhorse: { label: 'ม้างาน', hint: 'ขายดี กำไรน้อย — ปรับราคาหรือสูตร', bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  puzzle: { label: 'ปริศนา', hint: 'กำไรดี ขายน้อย — ช่วยโปรโมต', bg: '#f6f0dc', ink: '#6b5310' },
  dog: { label: 'หมา', hint: 'ขายน้อย กำไรน้อย — พิจารณาตัด', bg: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
};

function Line({ label, value, strong, minus, indent }: { label: string; value: number; strong?: boolean; minus?: boolean; indent?: boolean }) {
  return (
    <tr className={strong ? 'total' : undefined}>
      <td style={{ paddingLeft: indent ? 28 : 8 }}>{label}</td>
      <td className="num" style={{ color: strong && value < 0 ? 'var(--warn-ink)' : undefined }}>{minus && value ? `(${formatBaht(value)})` : formatBaht(value)}</td>
    </tr>
  );
}

export default function Profit() {
  const { me } = useMe();
  const [month, setMonth] = useState(thisMonth());
  const [pnl, setPnl] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [variance, setVariance] = useState<any>(null);

  useEffect(() => {
    setPnl(null);
    // P&L is owner-only; managers still get the menu and stock views.
    api('GET', `/api/reports/pnl?month=${month}`).then(setPnl).catch(() => setPnl(false));
    api('GET', `/api/reports/menu-profit?month=${month}`).then(setMenu).catch(() => {});
    api('GET', `/api/reports/stock-variance?month=${month}`).then(setVariance).catch(() => {});
  }, [month]);

  return (
    <>
      <TopBar me={me} active="owner" />
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <OwnerTabs active="profit" />
          <span className="spacer" />
          <MonthPicker value={month} onChange={setMonth} />
        </div>

        {pnl && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Stat label="ยอดขายสุทธิ (ก่อน VAT)" value={`฿${formatBaht(pnl.netSales)}`} />
            <Stat label="Food cost" value={`${pnl.foodCostPct}%`} tone={pnl.foodCostPct > 35 ? 'warn' : 'good'} />
            <Stat label="Prime cost (วัตถุดิบ + แรงงาน)" value={`${pnl.primeCostPct}%`} tone={pnl.primeCostPct > 65 ? 'warn' : 'good'} />
            <Stat label="กำไรสุทธิ" value={`฿${formatBaht(pnl.netProfit)}`} tone={pnl.netProfit < 0 ? 'warn' : 'good'} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
          {pnl !== false && (
            <section className="card" style={{ padding: '12px 18px' }}>
              <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>กำไรขาดทุน · {monthLabel(month)}</h1>
              {!pnl ? <p className="muted">กำลังโหลด…</p> : (
                <table className="tbl">
                  <tbody>
                    <Line label={`ยอดขายสุทธิ (${pnl.docs} เอกสาร)`} value={pnl.netSales} />
                    <Line label="ต้นทุนอาหาร" value={pnl.cogs.food} minus indent />
                    <Line label="ต้นทุนเครื่องดื่ม" value={pnl.cogs.beverage} minus indent />
                    <Line label="บรรจุภัณฑ์" value={pnl.cogs.packaging} minus indent />
                    <Line label="ของเสีย" value={pnl.cogs.waste} minus indent />
                    <Line label={pnl.cogs.countVariance >= 0 ? 'ของขาดจากการนับสต็อก' : 'ของเกินจากการนับสต็อก'} value={pnl.cogs.countVariance} minus indent />
                    <Line label="กำไรขั้นต้น" value={pnl.grossProfit} strong />
                    {Object.entries(pnl.expenses as Record<string, number>).filter(([, v]) => v).map(([k, v]) => (
                      <Line key={k} label={EXPENSE_LABEL[k]!} value={v} minus indent />
                    ))}
                    {pnl.expensesTotal === 0 && <tr><td colSpan={2} className="muted" style={{ paddingLeft: 28 }}>ยังไม่มีค่าใช้จ่ายดำเนินงาน</td></tr>}
                    <Line label="กำไรสุทธิ" value={pnl.netProfit} strong />
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>ภาษีขาย ฿{pnl ? formatBaht(pnl.outputVat) : '—'} ไม่นับเป็นรายได้ · ต้นทุนมาจากสมุดสต็อกตามวันที่เกิดจริง</p>
            </section>
          )}

          <section className="card" style={{ padding: '12px 18px' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Menu engineering</h2>
            {menu?.items.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {(['puzzle', 'star', 'dog', 'plowhorse'] as const).map((k) => {
                  const c = CLASS[k]!;
                  const names = menu.items.filter((i: any) => i.class === k).map((i: any) => i.name);
                  return (
                    <div key={k} style={{ background: c.bg, borderRadius: 12, padding: '10px 12px', minHeight: 110 }}>
                      <div style={{ fontWeight: 700, color: c.ink }}>{c.label} · {names.length}</div>
                      <div style={{ fontSize: 12, color: c.ink, opacity: 0.85 }}>{c.hint}</div>
                      <div style={{ fontSize: 14, marginTop: 6 }}>{names.join(', ') || '—'}</div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="muted">ยังไม่มียอดขายในเดือนนี้</p>}
            <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>แนวตั้ง = กำไรต่อจานเทียบค่าเฉลี่ย · แนวนอน = ความนิยม (ซ้าย ขายน้อย / ขวา ขายดี)</p>
          </section>
        </div>

        <section className="card" style={{ padding: '12px 18px' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>กำไรต่อเมนู</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>เมนู</th><th className="num">ขายได้</th><th className="num">ยอดขายก่อน VAT</th><th className="num">ต้นทุน</th>
                <th className="num">Food cost</th><th className="num">กำไรขั้นต้น</th><th>กลุ่ม</th>
              </tr></thead>
              <tbody>
                {menu?.items.map((i: any) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.name}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{formatBaht(i.revenue)}</td>
                    <td className="num">{formatBaht(i.cost)}</td>
                    <td className="num" style={{ color: i.food_cost_pct > 35 ? 'var(--warn-ink)' : 'var(--accent-ink)', fontWeight: 700 }}>{i.cost ? `${i.food_cost_pct}%` : '—'}</td>
                    <td className="num">{formatBaht(i.margin)}</td>
                    <td>{i.class && <span className="pill" style={{ background: CLASS[i.class]!.bg, color: CLASS[i.class]!.ink }}>{CLASS[i.class]!.label}</span>}</td>
                  </tr>
                ))}
                {menu?.items.length > 0 && (
                  <tr className="total">
                    <td>รวม</td><td className="num">{menu.totals.qty}</td><td className="num">{formatBaht(menu.totals.revenue)}</td>
                    <td className="num">{formatBaht(menu.totals.cost)}</td><td className="num">{menu.totals.food_cost_pct}%</td>
                    <td className="num">{formatBaht(menu.totals.margin)}</td><td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>ต้นทุนเป็นค่าที่บันทึกไว้ตอนชำระเงิน ราคาวัตถุดิบที่เปลี่ยนทีหลังไม่ทำให้ตัวเลขย้อนหลังเปลี่ยน</p>
        </section>

        <section className="card" style={{ padding: '12px 18px' }}>
          <div className="row" style={{ paddingBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>ต้นทุนตามสูตร vs นับจริง</h2>
            {variance && <span className="pill" style={{ background: Math.abs(variance.totals.variancePct) > 5 ? 'var(--warn-soft)' : 'var(--accent-soft)', color: Math.abs(variance.totals.variancePct) > 5 ? 'var(--warn-ink)' : 'var(--accent-ink)' }}>
              ส่วนต่าง {variance.totals.variancePct}% {Math.abs(variance.totals.variancePct) > 5 ? '(เกินเกณฑ์ 5%)' : '(ผ่านเกณฑ์ 5%)'}
            </span>}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>วัตถุดิบ</th><th className="num">ใช้ตามสูตร</th><th className="num">มูลค่าตามสูตร</th>
                <th className="num">ของเสีย</th><th className="num">ขาดจากนับ</th><th className="num">มูลค่าที่ขาด</th>
              </tr></thead>
              <tbody>
                {variance?.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="num">{fmtQty(r.used_qty)} {UNIT[r.base_unit]}</td>
                    <td className="num">{formatBaht(r.used_value)}</td>
                    <td className="num">{r.waste_value ? formatBaht(r.waste_value) : '—'}</td>
                    <td className="num" style={{ color: r.missing_qty > 0 ? 'var(--warn-ink)' : undefined }}>{r.missing_qty ? `${fmtQty(r.missing_qty)} ${UNIT[r.base_unit]}` : '—'}</td>
                    <td className="num" style={{ fontWeight: 600, color: r.missing_value > 0 ? 'var(--warn-ink)' : undefined }}>{r.missing_value ? formatBaht(r.missing_value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {variance?.rows.length === 0 && <p className="muted">ยังไม่มีการเคลื่อนไหวของสต็อกในเดือนนี้</p>}
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>ของขาด = ระบบคาดว่ามีมากกว่าที่นับได้ อาจมาจากตักเกินสูตร ของหาย หรือลืมบันทึกของเสีย</p>
        </section>
      </main>
    </>
  );
}
