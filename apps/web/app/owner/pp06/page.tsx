'use client';

import { formatBaht } from '@prakai/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { dayLabel, today } from '@/lib/owner';
import { useMe } from '@/lib/useMe';
import { TopBar } from '../../pos/TopBar';
import { OwnerTabs } from '../OwnerTabs';
import { Icon } from '@/lib/icons';

interface Pp06 {
  terminals: { id: string; name: string; code: string; rd_pos_id: string | null; serial_no: string | null; grand_total: number; branch_name: string; branch_code: string }[];
  samples: { id: string; terminal_id: string; doc_type: string; doc_no: string; issued_at: string }[];
}

const DOC: Record<string, string> = { ABB: 'ใบกำกับภาษีอย่างย่อ', FULL: 'ใบกำกับภาษีเต็มรูป', RECEIPT: 'ใบเสร็จรับเงิน', CN: 'ใบลดหนี้' };
const bkkDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso));

/** What the system does to meet ประกาศอธิบดีฯ VAT ฉบับที่ 46 — the part of the request the RD asks software to explain. */
const FEATURES = [
  'ออกเลขที่เอกสารเรียงต่อเนื่องแยกตามเครื่องและประเภทเอกสาร (ขึ้นต้นด้วยรหัสเครื่อง เช่น P1) ไม่ซ้ำ ไม่ข้าม',
  'ใบกำกับภาษีอย่างย่อพิมพ์ชื่อผู้ประกอบการ เลขประจำตัวผู้เสียภาษี สาขา POS ID เลขที่ วันเวลา รายการ ราคารวม และข้อความ "ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT INCLUDED)"',
  'ยอดขายสะสม (grand total) ของแต่ละเครื่องไม่มีการตั้งค่าใหม่ แสดงในรายงานสรุปยอดขายประจำวัน',
  'การยกเลิกเอกสารทำได้โดยผู้มีสิทธิ์เท่านั้น เก็บเอกสารเดิมพร้อมเหตุผล และเอกสารที่ออกแล้วแก้ไขหรือลบไม่ได้',
  'สรุปยอดขายประจำวัน (Z) แยกเครื่อง: จำนวนเอกสาร เลขที่แรก–สุดท้าย ยอดขาย ภาษีขาย เอกสารยกเลิก',
  'บันทึกการใช้งาน (audit log) แบบต่อเนื่องด้วยค่าแฮช ตรวจพบการแก้ไขย้อนหลังได้',
  'เก็บข้อมูลเอกสารและรายงานไม่น้อยกว่า 5 ปี (ม.87/3) ส่งออกข้อมูลทั้งหมดได้ตลอดเวลา',
];

const field: React.CSSProperties = { border: 'none', borderBottom: '1px dotted var(--muted)', font: 'inherit', padding: '2px 4px', width: '100%', background: 'transparent' };

export default function Pp06Page() {
  const { me } = useMe();
  const [d, setD] = useState<Pp06 | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [daily, setDaily] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Pp06>('GET', '/api/reports/pp06').then(setD).catch((e) => setErr(errText(e)));
    api<any[]>('GET', '/api/devices').then((x) => setDevices(x.filter((v) => !v.revoked_at))).catch(() => {});
    api('GET', '/api/reports/daily').then(setDaily).catch(() => {});
  }, []);

  const t = me?.tenant;
  const branch = me?.branches[0];
  return (
    <>
      <div className="no-print"><TopBar me={me} active="owner" /></div>
      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
        <div className="row no-print" style={{ flexWrap: 'wrap' }}>
          <OwnerTabs active="settings" />
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" /> พิมพ์ / PDF</button>
        </div>
        <div className="no-print" style={{ maxWidth: 900, padding: '10px 14px', borderRadius: 10, background: 'var(--info-soft)', color: 'var(--info-ink)', fontSize: 14, lineHeight: 1.6 }}>
          ใช้แนบกับแบบคำขออนุมัติใช้เครื่องบันทึกการเก็บเงิน (ภ.พ.06) ที่สำนักงานสรรพากรพื้นที่ · กรอกยี่ห้อ/รุ่นเครื่องและเครื่องพิมพ์
          วาดตำแหน่งเครื่องในร้าน แล้วพิมพ์ พร้อมแนบตัวอย่างใบกำกับภาษีและรายงานประจำวัน (ลิงก์ด้านล่าง) · รายการเอกสารที่ต้องใช้อาจต่างกันแต่ละพื้นที่ ควรสอบถามสรรพากรพื้นที่ก่อนยื่น
        </div>
        {err && <div className="error">{err}</div>}

        <article className="card" style={{ maxWidth: 900, padding: '20px 24px', display: 'grid', gap: 18, lineHeight: 1.6 }}>
          <header style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>เอกสารประกอบคำขออนุมัติใช้เครื่องบันทึกการเก็บเงิน (ภ.พ.06)</h1>
            <div className="muted">จัดทำวันที่ {dayLabel(today())}</div>
          </header>

          <section>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>1. ผู้ประกอบการ</h2>
            <table className="tbl"><tbody>
              <tr><td style={{ width: 220 }} className="muted">ชื่อผู้ประกอบการ</td><td>{t?.legal_name || t?.name}</td></tr>
              <tr><td className="muted">เลขประจำตัวผู้เสียภาษีอากร</td><td>{t?.tax_id ?? '—'}</td></tr>
              <tr><td className="muted">สถานประกอบการ</td><td>{branch ? `${branch.name} (${branch.branch_code === '00000' ? 'สำนักงานใหญ่' : `สาขา ${branch.branch_code}`})` : ''}</td></tr>
              <tr><td className="muted">ที่อยู่</td><td>{t?.address ?? '—'}</td></tr>
              <tr><td className="muted">จดทะเบียนภาษีมูลค่าเพิ่ม</td><td>{t?.vat_registered ? (t.vat_registered_at ? `ตั้งแต่ ${dayLabel(t.vat_registered_at)}` : 'จดแล้ว') : 'ยังไม่จด'}</td></tr>
            </tbody></table>
          </section>

          <section>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>2. รายละเอียดเครื่องบันทึกการเก็บเงิน</h2>
            <p style={{ margin: '0 0 8px' }}>
              ระบบ prakai-pos เป็นโปรแกรมขายหน้าร้านทำงานผ่านเว็บเบราว์เซอร์บนแท็บเล็ตหรือคอมพิวเตอร์หน้าร้าน
              ข้อมูลขายและเอกสารภาษีบันทึกที่เครื่องแม่ข่าย (server) ฐานข้อมูล PostgreSQL ทุกรายการในเวลาที่ออกเอกสาร
              แต่ละเครื่องขายมีรหัสเครื่องและชุดเลขที่เอกสารของตนเอง
            </p>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>รหัส</th><th>ชื่อเครื่อง</th><th>หมายเลขเครื่อง (serial)</th><th>POS ID</th><th>ยี่ห้อ / รุ่นเครื่อง</th><th>เครื่องพิมพ์</th></tr></thead>
              <tbody>
                {d?.terminals.map((x) => (
                  <tr key={x.id}>
                    <td style={{ fontWeight: 700 }}>{x.code}</td><td>{x.name}</td>
                    <td>{x.serial_no ?? <span className="muted">ยังไม่กรอก</span>}</td>
                    <td>{x.rd_pos_id ?? <span className="muted">รออนุมัติ</span>}</td>
                    <td><input aria-label={`ยี่ห้อรุ่น ${x.code}`} style={field} /></td>
                    <td><input aria-label={`เครื่องพิมพ์ ${x.code}`} style={field} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {devices.length > 0 && (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 14 }}>
                อุปกรณ์ที่ลงทะเบียนใช้งาน: {devices.map((v) => `${v.name}${v.terminal_id ? ` (${d?.terminals.find((x) => x.id === v.terminal_id)?.code ?? ''})` : ''}`).join(' · ')}
              </p>
            )}
            {d?.terminals.some((x) => !x.serial_no) && (
              <p className="no-print" style={{ color: 'var(--warn-ink)', margin: '8px 0 0' }}>
                กรอกหมายเลขเครื่องได้ที่ <Link href="/owner/settings" style={{ textDecoration: 'underline' }}>ตั้งค่าร้านและภาษี</Link>
              </p>
            )}
          </section>

          <section style={{ breakInside: 'avoid' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>3. แผนผังระบบการเชื่อมต่อ</h2>
            <ConnectionDiagram tills={d?.terminals.map((x) => x.code) ?? ['P1']} />
          </section>

          <section style={{ breakInside: 'avoid' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>4. แผนผังแสดงตำแหน่งที่ตั้งเครื่อง</h2>
            <div style={{ height: 280, border: '1px dashed var(--line-2)', borderRadius: 10, display: 'grid', placeItems: 'center' }} className="muted">
              วาดผังร้าน: ประตู เคาน์เตอร์คิดเงิน และตำแหน่งเครื่องแต่ละเครื่อง (รหัส {d?.terminals.map((x) => x.code).join(', ') ?? 'P1'})
            </div>
          </section>

          <section style={{ breakInside: 'avoid' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>5. คุณสมบัติของระบบตามประกาศอธิบดีกรมสรรพากร (ฉบับที่ 46)</h2>
            <ol style={{ margin: 0, paddingLeft: 22 }}>{FEATURES.map((f) => <li key={f}>{f}</li>)}</ol>
          </section>

          <section style={{ breakInside: 'avoid' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>6. ตัวอย่างเอกสาร</h2>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>เครื่อง</th><th>เอกสาร</th><th>เลขที่</th><th>วันที่</th></tr></thead>
              <tbody>
                {d?.samples.map((s) => (
                  <tr key={s.id}>
                    <td>{d.terminals.find((x) => x.id === s.terminal_id)?.code}</td><td>{DOC[s.doc_type] ?? s.doc_type}</td>
                    <td><Link href={`/receipt/${s.id}`} target="_blank" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{s.doc_no}</Link></td>
                    <td>{dayLabel(bkkDay(s.issued_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {d?.samples.length === 0 && <p className="muted">ยังไม่มีเอกสาร — ขายทดลองหนึ่งบิลเพื่อใช้เป็นตัวอย่าง (ใบเต็มรูปออกได้ก่อนได้รับ POS ID)</p>}
            <p className="muted no-print" style={{ margin: '6px 0 0', fontSize: 14 }}>เปิดเลขที่เอกสารแล้วพิมพ์จากหน้าใบเสร็จ แนบไปพร้อมเอกสารนี้</p>

            {daily && (
              <>
                <h3 style={{ fontSize: 16, margin: '14px 0 6px' }}>ตัวอย่างรายงานสรุปยอดขายประจำวัน · {dayLabel(daily.date)}</h3>
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>เครื่อง</th><th>เอกสาร</th><th>เลขที่</th><th className="num">ออก</th><th className="num">ยกเลิก</th><th className="num">ภาษีขาย</th><th className="num">ยอดขาย</th><th className="num">ยอดสะสม</th></tr></thead>
                  <tbody>
                    {daily.docs.map((x: any, i: number) => (
                      <tr key={i}>
                        <td>{x.terminal}</td><td>{DOC[x.doc_type] ?? x.doc_type}</td><td className="muted">{x.first_no} – {x.last_no}</td>
                        <td className="num">{x.issued}</td><td className="num">{x.voided}</td>
                        <td className="num">{formatBaht(x.vat)}</td><td className="num">{formatBaht(x.total)}</td><td className="num">{formatBaht(x.grand_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {daily.docs.length === 0 && <p className="muted">วันนี้ยังไม่มีเอกสาร</p>}
              </>
            )}
          </section>

          <footer style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, paddingTop: 32, textAlign: 'center' }}>
            <div>ลงชื่อ ........................................ ผู้ประกอบการ<br />( ........................................ )</div>
            <div>วันที่ ........................................</div>
          </footer>
        </article>
      </main>
    </>
  );
}

/** Tills → shop router → internet (HTTPS) → server with the database; each till prints on its own receipt printer. */
function ConnectionDiagram({ tills }: { tills: string[] }) {
  const n = Math.max(tills.length, 1);
  const rowH = 70;
  const h = Math.max(n * rowH + 20, 170);
  const mid = h / 2;
  const box = (x: number, y: number, w: number, label: string, sub?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={50} rx={8} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.2} />
      <text x={x + w / 2} y={y + (sub ? 22 : 30)} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--ink)">{label}</text>
      {sub && <text x={x + w / 2} y={y + 40} textAnchor="middle" fontSize={12} fill="var(--muted)">{sub}</text>}
    </g>
  );
  return (
    <svg viewBox={`0 0 820 ${h}`} width="100%" role="img" aria-label="แผนผังการเชื่อมต่อระบบ" style={{ maxWidth: 820 }}>
      {tills.map((code, i) => {
        const y = 10 + i * rowH + (h - 20 - n * rowH) / 2;
        return (
          <g key={code}>
            {box(0, y, 150, 'เครื่องพิมพ์ใบเสร็จ', code)}
            <line x1={150} y1={y + 25} x2={190} y2={y + 25} stroke="var(--ink)" />
            {box(190, y, 170, `เครื่องขาย ${code}`, 'แท็บเล็ต / คอมพิวเตอร์')}
            <line x1={360} y1={y + 25} x2={400} y2={mid} stroke="var(--ink)" />
          </g>
        );
      })}
      {box(400, mid - 25, 120, 'เราเตอร์ร้าน', 'Wi-Fi / LAN')}
      <line x1={520} y1={mid} x2={600} y2={mid} stroke="var(--ink)" strokeDasharray="5 4" />
      <text x={560} y={mid - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">อินเทอร์เน็ต</text>
      <text x={560} y={mid + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">HTTPS</text>
      {box(600, mid - 25, 210, 'เครื่องแม่ข่าย prakai-pos', 'ฐานข้อมูลเอกสารภาษี')}
    </svg>
  );
}
