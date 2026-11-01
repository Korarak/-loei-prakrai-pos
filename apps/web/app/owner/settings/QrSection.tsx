'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';

interface Links { enabled: boolean; tables: { id: string; name: string; path: string }[] }

/** Table stickers: one signed QR per table. Customers scan it to order; staff accept each order on the POS. */
export function QrSection({ canEdit, isOwner }: { canEdit: boolean; isOwner: boolean }) {
  const confirm = useConfirm();
  const [links, setLinks] = useState<Links | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api<Links>('GET', '/api/qr/links').then(async (l) => {
    setLinks(l);
    const out: Record<string, string> = {};
    for (const t of l.tables) out[t.id] = await QRCode.toString(`${location.origin}${t.path}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    setSvgs(out);
  }).catch((e) => setErr(errText(e)));
  useEffect(() => { if (canEdit) load(); }, [canEdit]);

  if (!canEdit) return null;

  async function toggle(enabled: boolean) {
    setErr(''); setMsg('');
    try { await api('PUT', '/api/qr/enabled', { enabled }); setMsg(enabled ? 'เปิดรับออเดอร์ผ่าน QR แล้ว' : 'ปิดรับออเดอร์ผ่าน QR แล้ว สติกเกอร์เดิมยังเก็บไว้ได้'); await load(); } catch (e) { setErr(errText(e)); }
  }
  async function rotate() {
    if (!(await confirm({ title: 'สร้าง QR ชุดใหม่?', body: 'QR ที่พิมพ์ไว้ทุกใบจะใช้ไม่ได้ทันที ต้องพิมพ์และเปลี่ยนสติกเกอร์ใหม่ทุกโต๊ะ ใช้เมื่อสงสัยว่ามีคนนำ QR ไปใช้ผิดวิธี', confirm: 'สร้างชุดใหม่', tone: 'danger' }))) return;
    setErr(''); setMsg('');
    try { await api('POST', '/api/qr/rotate'); setMsg('สร้าง QR ชุดใหม่แล้ว พิมพ์ใหม่ทุกโต๊ะ'); await load(); } catch (e) { setErr(errText(e)); }
  }

  return (
    <section className="card" style={{ padding: 18, display: 'grid', gap: 14 }} aria-labelledby="qr-h">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <h2 id="qr-h" style={{ margin: 0, fontSize: 20 }}>QR สั่งอาหารที่โต๊ะ</h2>
        <span className="spacer" />
        {links && <button className="btn" aria-pressed={links.enabled} onClick={() => toggle(!links.enabled)}>{links.enabled ? 'เปิดรับออเดอร์อยู่' : 'ปิดอยู่'}</button>}
        <button className="btn btn-primary" onClick={() => window.print()} disabled={!links?.tables.length}><Icon name="print" /> พิมพ์ QR ทุกโต๊ะ</button>
        {isOwner && <button className="btn btn-warn" onClick={rotate}><Icon name="key" /> สร้าง QR ชุดใหม่</button>}
      </div>
      <p className="muted no-print" style={{ margin: 0, fontSize: 14 }}>
        ลูกค้าสแกน QR ที่โต๊ะ เลือกเมนูแล้วส่งออเดอร์ พนักงานจะเห็นรายการรอรับที่หน้าผังโต๊ะ ต้องกดรับก่อนจึงเข้าบิลของโต๊ะนั้น (ยังไม่ส่งครัวจนกว่าพนักงานกดส่ง)
      </p>
      {err && <div className="error" role="alert">{err}</div>}
      {msg && <div className="no-print" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{msg}</div>}
      <div className="qr-sheet" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {links?.tables.map((t) => (
          <figure key={t.id} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 10, textAlign: 'center', breakInside: 'avoid', background: '#fff' }}>
            <div role="img" aria-label={`QR โต๊ะ ${t.name}`} style={{ width: 160, height: 160, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: svgs[t.id] ?? '' }} />
            <figcaption><strong style={{ fontSize: 22 }}>โต๊ะ {t.name}</strong><div style={{ fontSize: 13 }}>สแกนเพื่อสั่งอาหาร</div></figcaption>
          </figure>
        ))}
      </div>
      {links?.tables.length === 0 && <p className="muted">ยังไม่มีโต๊ะ เพิ่มโต๊ะในส่วน “โต๊ะในร้าน” ก่อน</p>}
      <style>{`@media print { body * { visibility: hidden; } .qr-sheet, .qr-sheet * { visibility: visible; } .qr-sheet { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </section>
  );
}
