'use client';

import { formatBaht } from '@prakai/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';

type Mode = 'move' | 'merge' | 'split';
interface TableRow { id: string; name: string; seats: number; order_id: string | null; amount: number }
interface Line { id: string; name: string; unit_price: number; qty: number; status: string; note: string | null }

const TITLE: Record<Mode, string> = { move: 'ย้ายไปโต๊ะ', merge: 'รวมบิลของโต๊ะอื่นเข้าบิลนี้', split: 'แยกบิล: เลือกรายการที่จะจ่ายแยก' };

/** ย้ายโต๊ะ · รวมโต๊ะ · แยกบิล for one open bill. */
export function TableOps({ orderId, tableId, lines, onDone }: { orderId: string; tableId: string | null; lines: Line[]; onDone: () => void }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    setPick({});
    if (mode === 'move' || mode === 'merge') api<TableRow[]>('GET', '/api/tables').then(setTables).catch((e) => setErr(errText(e)));
  }, [mode]);

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); setMode(null); onDone(); } catch (e) { setErr(errText(e)); }
  };

  const live = lines.filter((l) => l.status !== 'void');
  const picked = Object.entries(pick).filter(([, q]) => q > 0);
  const pickedTotal = picked.reduce((s, [lid, q]) => s + (live.find((l) => l.id === lid)?.unit_price ?? 0) * q, 0);
  const choices = tables.filter((t) => t.id !== tableId && (mode === 'move' ? !t.order_id : !!t.order_id && t.order_id !== orderId));

  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        {(['move', 'merge', 'split'] as Mode[]).map((m) => (
          <button key={m} className="btn" style={{ flex: 1, minHeight: 40, fontSize: 14 }} aria-pressed={mode === m}
            onClick={() => setMode(mode === m ? null : m)}>{m === 'move' ? 'ย้ายโต๊ะ' : m === 'merge' ? 'รวมโต๊ะ' : 'แยกบิล'}</button>
        ))}
      </div>
      {mode && (
        <div role="dialog" aria-label={TITLE[mode]} className="card" style={{ padding: 12, display: 'grid', gap: 10, marginTop: 8, background: 'var(--surface)' }}>
          <b>{TITLE[mode]}</b>
          {mode !== 'split' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
              {choices.map((t) => (
                <button key={t.id} className="btn" style={{ minHeight: 64, flexDirection: 'column', gap: 2 }}
                  onClick={async () => {
                    if (mode === 'merge' && !(await confirm({ title: `รวมบิลโต๊ะ ${t.name} เข้ามา?`, body: 'รวมแล้วแยกกลับเป็นบิลเดิมไม่ได้', confirm: 'รวมบิล', icon: 'table' }))) return;
                    run(() => mode === 'move'
                      ? api('POST', `/api/orders/${orderId}/move`, { tableId: t.id })
                      : api('POST', `/api/orders/${orderId}/merge`, { fromOrderId: t.order_id }));
                  }}>
                  <b style={{ fontSize: 20 }}>{t.name}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{mode === 'move' ? `${t.seats} ที่นั่ง` : `฿${formatBaht(t.amount)}`}</span>
                </button>
              ))}
              {choices.length === 0 && <span className="muted">{mode === 'move' ? 'ไม่มีโต๊ะว่าง' : 'ไม่มีโต๊ะอื่นที่มีบิลเปิด'}</span>}
            </div>
          )}
          {mode === 'split' && <>
            {live.map((l) => {
              const q = pick[l.id] ?? 0;
              const set = (v: number) => setPick({ ...pick, [l.id]: Math.max(0, Math.min(l.qty, v)) });
              return (
                <div key={l.id} className="row" style={{ gap: 8 }}>
                  <span style={{ flex: 1 }}>{l.name}{l.note ? ` · ${l.note}` : ''} <span className="muted">(มี {l.qty})</span></span>
                  <button className="btn" style={{ minWidth: 40, minHeight: 40 }} aria-label={`แยก ${l.name} น้อยลง`} onClick={() => set(q - 1)}>−</button>
                  <b style={{ width: 24, textAlign: 'center' }}>{q}</b>
                  <button className="btn" style={{ minWidth: 40, minHeight: 40 }} aria-label={`แยก ${l.name} มากขึ้น`} onClick={() => set(q + 1)}><Icon name="plus" /> </button>
                </div>
              );
            })}
            <button className="btn btn-primary" disabled={picked.length === 0}
              onClick={async () => {
                setErr('');
                try {
                  const child = await api('POST', `/api/orders/${orderId}/split`, { lines: picked.map(([lineId, qty]) => ({ lineId, qty })) });
                  router.push(`/pos/order/${child.id}`);
                } catch (e) { setErr(errText(e)); }
              }}>
              <Icon name="plus" /> สร้างบิลแยก{picked.length ? ` ฿${formatBaht(pickedTotal)}` : ''}
            </button>
          </>}
          {err && <div className="error" role="alert">{err}</div>}
        </div>
      )}
    </>
  );
}
