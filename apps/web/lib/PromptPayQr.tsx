'use client';

import { formatBaht, promptPayPayload } from '@prakai/core';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Thai QR Payment for the exact bill amount: the customer's banking app fills in the amount by itself. */
export function PromptPayQr({ id, amount, size = 260 }: { id: string; amount: number; size?: number }) {
  const [svg, setSvg] = useState('');
  const [payload, setPayload] = useState('');
  useEffect(() => {
    try {
      const p = promptPayPayload(id, amount);
      setPayload(p);
      QRCode.toString(p, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }).then(setSvg).catch(() => setSvg(''));
    } catch {
      setPayload('');
      setSvg('');
    }
  }, [id, amount]);

  const shown = id.length === 10 ? `${id.slice(0, 3)}-xxx-${id.slice(6)}` : `x-xxxx-xxxxx-${id.slice(10, 12)}-${id.slice(12)}`;
  if (!payload) return <div className="error">เลขพร้อมเพย์ในตั้งค่าร้านไม่ถูกต้อง</div>;
  return (
    <figure style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 6 }} data-payload={payload}>
      <div style={{ background: '#0E3D6B', color: '#fff', width: size, textAlign: 'center', padding: '6px 0', borderRadius: '10px 10px 0 0', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
        THAI QR PAYMENT · พร้อมเพย์
      </div>
      <div role="img" aria-label={`QR พร้อมเพย์ ยอด ${formatBaht(amount)} บาท`} style={{ width: size, height: size, background: '#fff' }}
        dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>฿{formatBaht(amount)}</div>
        <div className="muted" style={{ fontSize: 14 }}>พร้อมเพย์ {shown} · ตรวจยอดเงินเข้าแล้วกดยืนยัน</div>
      </figcaption>
    </figure>
  );
}
