'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Label on the confirming button. */
  confirm?: string;
  cancel?: string;
  /** danger = red (deleting, voiding); primary = green (everything else). */
  tone?: 'danger' | 'primary';
  icon?: IconName;
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Ask>(async () => true);

/** `const confirm = useConfirm(); if (await confirm({ title: 'ลบโต๊ะ 5?', tone: 'danger' })) …` */
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<{ o: ConfirmOptions; done: (v: boolean) => void } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const open = useCallback<Ask>((o) => new Promise((done) => setAsk({ o, done })), []);
  const close = (v: boolean) => { ask?.done(v); setAsk(null); };

  useEffect(() => {
    if (!ask) return;
    confirmRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { ask.done(false); setAsk(null); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ask]);

  const o = ask?.o;
  const danger = o?.tone === 'danger';
  return (
    <Ctx.Provider value={open}>
      {children}
      {o && (
        <div role="alertdialog" aria-modal="true" aria-label={o.title} className="dlg-back" onClick={() => close(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <div className="dlg-ico" data-tone={danger ? 'danger' : 'primary'}><Icon name={o.icon ?? (danger ? 'trash' : 'check')} size={26} /></div>
            <h2 className="dlg-title">{o.title}</h2>
            {o.body && <p className="dlg-body">{o.body}</p>}
            <div className="dlg-actions">
              <button className="btn" onClick={() => close(false)}>{o.cancel ?? 'ยกเลิก'}</button>
              <button ref={confirmRef} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{o.confirm ?? 'ยืนยัน'}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
