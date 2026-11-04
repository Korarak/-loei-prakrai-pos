'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; name: string; email: string };
  tenant: {
    id: string; name: string; status: string; legal_name: string | null; tax_id: string | null; address: string | null;
    vat_registered: boolean; vat_registered_at: string | null; price_includes_vat: boolean; service_charge_bp: number; cash_rounding: string;
    promptpay_id: string | null; logo_url: string | null; logo_on_receipt: boolean;
    /** 'simple' = menu + sales only; the back office hides stock, costing, options and the like. */
    ui_mode: 'simple' | 'full';
  };
  role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
  branches: { id: string; name: string; branch_code: string }[];
  terminals: { id: string; name: string; code: string; rd_pos_id: string | null; serial_no: string | null }[];
  /** Set when this browser is a till the owner registered for PIN sign-in. */
  device: { id: string; name: string; terminal_id: string | null } | null;
  /** The operator of the whole service: may review sign-ups at /platform. */
  platformAdmin?: boolean;
}

/** Shared by every page so moving around the app never flashes the full menu before the mode is known. */
let cached: Me | null = null;

export function useMe() {
  const [me, setMe] = useState<Me | null>(cached);
  const reload = () => api<Me>('GET', '/api/me').then((m) => { cached = m; setMe(m); }).catch(() => {});
  useEffect(() => { reload(); }, []);
  return { me, reload };
}

/** Simple mode: hide what a small shop does not need. Unknown (still loading) counts as full. */
export const isSimple = (me: Me | null | undefined) => me?.tenant.ui_mode === 'simple';

/**
 * Back-office pages a simple shop does not have: send it to the sales report instead.
 * The pages and data stay intact, so switching back to full mode brings everything back.
 */
export function useFullOnly(me: Me | null) {
  const router = useRouter();
  const simple = isSimple(me);
  useEffect(() => { if (simple) router.replace('/owner/reports'); }, [simple, router]);
  return simple;
}

/** The terminal this device prints on: the one the owner bound it to, else remembered per browser. */
export function terminalFor(me: Me): Me['terminals'][number] {
  const bound = me.device?.terminal_id && me.terminals.find((t) => t.id === me.device!.terminal_id);
  if (bound) return bound;
  let saved: string | null = null;
  try { saved = localStorage.getItem('prakai.terminal'); } catch {}
  return me.terminals.find((t) => t.id === saved) ?? me.terminals[0]!;
}
