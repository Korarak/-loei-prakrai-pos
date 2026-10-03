'use client';

import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { agentOnline, printTicket, thaiDateTime, usePrinters, type Printer } from '@/lib/print';
import type { Me } from '@/lib/useMe';

const ROLE: Record<Printer['role'], string> = { receipt: 'ใบเสร็จ', kitchen: 'ครัว', bar: 'บาร์น้ำ' };
const small: React.CSSProperties = { height: 44, borderRadius: 10, border: '1px solid #c9cfc7', padding: '0 10px', fontSize: 16, background: '#fff' };
const blank = { name: '', host: '', port: '9100', widthPx: '576', role: 'receipt' as Printer['role'], terminalId: '', kickDrawer: false };

interface Agent { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }

/** เครื่องพิมพ์ LAN (ESC/POS) และโปรแกรมพิมพ์ในร้าน (print agent) ที่ส่งงานต่อให้เครื่องพิมพ์ */
export function PrintersSection({ me }: { me: Me }) {
  const { list, reload } = usePrinters();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [add, setAdd] = useState(blank);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('คอมเคาน์เตอร์');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const canEdit = me.role === 'owner' || me.role === 'manager';
  const owner = me.role === 'owner';

  const loadAgents = () => owner ? api<Agent[]>('GET', '/api/print-agents').then(setAgents).catch(() => {}) : Promise.resolve();
  useEffect(() => { loadAgents(); }, []);

  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(''); setMsg('');
    try { await fn(); await reload(); await loadAgents(); setMsg(done); } catch (e) { setErr(errText(e)); }
  }

  async function test(p: Printer) {
    setErr(''); setMsg(`กำลังส่งหน้าทดสอบไปที่ ${p.name}…`);
    const r = await printTicket(p, 'test', [
      { t: 'text', text: me.tenant.name, align: 'center', size: 30, bold: true },
      { t: 'text', text: `ทดสอบเครื่องพิมพ์ ${p.name}`, align: 'center' },
      { t: 'hr' },
      { t: 'text', text: 'ภาษาไทย: ก่ ก้ ก๊ ก๋ กำ กิ่ กี้ กึ่ กื้ กุ่ กู้ ญี่ปุ่น น้ำแข็ง', size: 26 },
      { t: 'row', left: 'ข้าวผัดกุ้ง', right: '60.00' },
      { t: 'row', left: 'รวมทั้งสิ้น', right: '1,234.50', size: 32, bold: true },
      { t: 'hr' },
      { t: 'text', text: `${p.host}:${p.port} · กว้าง ${p.width_px === 576 ? '80' : '58'} มม. · ${thaiDateTime(new Date().toISOString())}`, align: 'center', size: 20 },
    ]).catch((e) => ({ status: 'failed' as const, error: errText(e) }));
    if (r.status === 'done') setMsg(`${p.name} พิมพ์หน้าทดสอบแล้ว`);
    else if (r.status === 'failed') { setMsg(''); setErr(`${p.name}: ${r.error}`); }
    else { setMsg(''); setErr(agentOnline(list) ? `${p.name} ยังไม่ตอบ — ตรวจ IP และสายแลนของเครื่องพิมพ์` : 'โปรแกรมพิมพ์ในร้านไม่ได้เปิดอยู่ (ดูขั้นตอนด้านล่าง)'); }
  }

  const online = agentOnline(list);
  const hostOk = /^[A-Za-z0-9.-]{1,100}$/.test(add.host.trim());
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <section className="card" style={{ padding: 18, display: 'grid', gap: 14 }} aria-labelledby="printers-h">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 id="printers-h" style={{ margin: 0, fontSize: 20 }}>เครื่องพิมพ์</h2>
        <span className="pill" style={{ background: online ? 'var(--accent-soft)' : 'var(--warn-soft)', color: online ? 'var(--accent-ink)' : 'var(--warn-ink)' }}>
          {online ? 'โปรแกรมพิมพ์ในร้านออนไลน์' : list?.agentLastSeen ? `โปรแกรมพิมพ์ออฟไลน์ (เห็นล่าสุด ${thaiDateTime(list.agentLastSeen)})` : 'ยังไม่ได้ติดตั้งโปรแกรมพิมพ์'}
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        เครื่องพิมพ์ความร้อน 58/80 มม. ที่ต่อสายแลน (ESC/POS พอร์ต 9100) · ใบเสร็จพิมพ์อัตโนมัติหลังรับเงิน ใบสั่งครัวไปที่เครื่องของครัว/บาร์
        · ถ้าไม่ตั้งเครื่องพิมพ์ ระบบใช้การพิมพ์ของเบราว์เซอร์ตามเดิม
      </p>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ชื่อ</th><th>ใช้พิมพ์</th><th>IP</th><th>กระดาษ</th><th>เครื่องขาย</th><th>ลิ้นชัก</th><th /></tr></thead>
          <tbody>
            {list?.printers.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td>{ROLE[p.role]}</td>
                <td className="muted">{p.host}:{p.port}</td>
                <td>{p.width_px === 576 ? '80 มม.' : '58 มม.'}</td>
                <td className="muted">{p.role === 'receipt' ? (me.terminals.find((t) => t.id === p.terminal_id)?.code ?? 'ทุกเครื่อง') : '—'}</td>
                <td>{p.kick_drawer ? 'เปิดลิ้นชัก' : '—'}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn" style={{ minHeight: 40 }} disabled={!p.active} onClick={() => test(p)}>ทดสอบ</button>{' '}
                  {canEdit && <button className="btn" style={{ minHeight: 40 }}
                    onClick={() => run(() => api('PATCH', `/api/printers/${p.id}`, { active: !p.active }), p.active ? `ปิดใช้ ${p.name} แล้ว` : `เปิดใช้ ${p.name} แล้ว`)}>
                    {p.active ? 'ปิดใช้' : 'เปิดใช้'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list?.printers.length === 0 && <p className="muted">ยังไม่มีเครื่องพิมพ์</p>}
      </div>

      {canEdit && (
        <form className="row" style={{ flexWrap: 'wrap', alignItems: 'end', gap: 10 }} onSubmit={(e) => {
          e.preventDefault();
          run(() => api('POST', '/api/printers', {
            name: add.name.trim(), host: add.host.trim(), port: Number(add.port), widthPx: Number(add.widthPx), role: add.role,
            terminalId: add.role === 'receipt' && add.terminalId ? add.terminalId : null, kickDrawer: add.role === 'receipt' && add.kickDrawer,
          }).then(() => setAdd(blank)), `เพิ่มเครื่องพิมพ์ ${add.name.trim()} แล้ว`);
        }}>
          <label className="field" style={{ width: 150 }}>ชื่อเครื่องพิมพ์
            <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="หน้าร้าน" required /></label>
          <label className="field" style={{ width: 150 }}>ใช้พิมพ์
            <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Printer['role'] })} style={small}>
              <option value="receipt">ใบเสร็จ</option><option value="kitchen">ใบสั่งครัว</option><option value="bar">ใบสั่งบาร์น้ำ</option>
            </select></label>
          <label className="field" style={{ width: 170 }}>IP เครื่องพิมพ์
            <input value={add.host} onChange={(e) => setAdd({ ...add, host: e.target.value })} placeholder="192.168.1.50" inputMode="decimal" required /></label>
          <label className="field" style={{ width: 90 }}>พอร์ต
            <input value={add.port} onChange={(e) => setAdd({ ...add, port: e.target.value })} inputMode="numeric" /></label>
          <label className="field" style={{ width: 110 }}>กระดาษ
            <select value={add.widthPx} onChange={(e) => setAdd({ ...add, widthPx: e.target.value })} style={small}>
              <option value="576">80 มม.</option><option value="384">58 มม.</option>
            </select></label>
          {add.role === 'receipt' && me.terminals.length > 1 && (
            <label className="field" style={{ width: 150 }}>ของเครื่องขาย
              <select value={add.terminalId} onChange={(e) => setAdd({ ...add, terminalId: e.target.value })} style={small}>
                <option value="">ทุกเครื่อง</option>
                {me.terminals.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
              </select></label>
          )}
          {add.role === 'receipt' && (
            <label className="row" style={{ gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={add.kickDrawer} onChange={(e) => setAdd({ ...add, kickDrawer: e.target.checked })} style={{ width: 22, height: 22 }} />
              ต่อลิ้นชักเก็บเงิน</label>
          )}
          <button className="btn btn-outline" style={{ minHeight: 50 }} disabled={!add.name.trim() || !hostOk}>เพิ่มเครื่องพิมพ์</button>
        </form>
      )}

      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}

      {owner && (
        <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <b>โปรแกรมพิมพ์ในร้าน (print agent)</b>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            ระบบอยู่บนอินเทอร์เน็ต จึงส่งงานถึงเครื่องพิมพ์ในร้านโดยตรงไม่ได้ ให้เปิดโปรแกรมพิมพ์บนคอมพิวเตอร์หนึ่งเครื่องในร้าน
            ที่ต่อวง LAN เดียวกับเครื่องพิมพ์และเปิดทิ้งไว้ (ต้องมี Node.js 18 ขึ้นไป) · โปรแกรมดึงงานจากระบบเอง ไม่ต้องตั้งค่าเราเตอร์
          </p>
          <form className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={(e) => {
            e.preventDefault();
            setErr('');
            api<{ token: string }>('POST', '/api/print-agents', { name: agentName.trim() })
              .then((a) => { setNewToken(a.token); loadAgents(); }).catch((x) => setErr(errText(x)));
          }}>
            <label className="field" style={{ width: 220 }}>ชื่อคอมพิวเตอร์
              <input value={agentName} onChange={(e) => setAgentName(e.target.value)} required /></label>
            <button className="btn btn-outline" style={{ minHeight: 50 }} disabled={!agentName.trim()}>สร้างรหัสสำหรับโปรแกรมพิมพ์</button>
          </form>
          {newToken && (
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--info-soft)', color: 'var(--info-ink)', fontSize: 14, display: 'grid', gap: 6 }}>
              <b>คัดลอกคำสั่งนี้ไปรันบนคอมในร้าน (รหัสแสดงครั้งเดียว)</b>
              <code style={{ wordBreak: 'break-all', background: '#fff', color: '#111', padding: 8, borderRadius: 8 }}>
                node print-agent.mjs --server {origin} --token {newToken}
              </code>
              <span>1) ติดตั้ง Node.js (nodejs.org) · 2) <a href="/print-agent.mjs" download style={{ fontWeight: 700, textDecoration: 'underline' }}>ดาวน์โหลด print-agent.mjs</a> ·
                3) เปิด Command Prompt ในโฟลเดอร์ที่ดาวน์โหลด แล้ววางคำสั่งนี้ · ทดสอบเครื่องพิมพ์ก่อนได้ด้วย <code>node print-agent.mjs --test IP-เครื่องพิมพ์</code></span>
              <button type="button" className="btn" style={{ justifySelf: 'start' }}
                onClick={() => navigator.clipboard?.writeText(`node print-agent.mjs --server ${origin} --token ${newToken}`).then(() => setMsg('คัดลอกแล้ว'))}>คัดลอกคำสั่ง</button>
            </div>
          )}
          {agents.length > 0 && (
            <table className="tbl">
              <thead><tr><th>คอมพิวเตอร์</th><th>เห็นล่าสุด</th><th /></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} style={{ opacity: a.revoked_at ? 0.5 : 1 }}>
                    <td>{a.name}</td>
                    <td className="muted">{a.revoked_at ? 'ยกเลิกแล้ว' : a.last_seen_at ? thaiDateTime(a.last_seen_at) : 'ยังไม่เคยเชื่อมต่อ'}</td>
                    <td style={{ textAlign: 'right' }}>{!a.revoked_at && <button className="btn btn-warn" style={{ minHeight: 40 }}
                      onClick={() => run(() => api('POST', `/api/print-agents/${a.id}/revoke`), `ยกเลิกรหัสของ ${a.name} แล้ว`)}>ยกเลิกรหัส</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
