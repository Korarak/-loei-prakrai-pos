'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; name: string; email: string };
  tenant: {
    id: string; name: string; status: string; legal_name: string | null; tax_id: string | null; address: string | null;
    vat_registered: boolean; vat_registered_at: string | null; price_includes_vat: boolean; service_charge_bp: number; cash_rounding: string;
    promptpay_id: string | null;
  };
  role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
  branches: { id: string; name: string; branch_code: string }[];
  terminals: { id: string; name: string; code: string; rd_pos_id: string | null; serial_no: string | null }[];
  /** Set when this browser is a till the owner registered for PIN sign-in. */
  device: { id: string; name: string; terminal_id: string | null } | null;
  /** The operator of the whole service: may review sign-ups at /platform. */
  platformAdmin?: boolean;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = () => api<Me>('GET', '/api/me').then(setMe).catch(() => {});
  useEffect(() => { reload(); }, []);
  return { me, reload };
}

/** The terminal this device prints on: the one the owner bound it to, else remembered per browser. */
export function terminalFor(me: Me): Me['terminals'][number] {
  const bound = me.device?.terminal_id && me.terminals.find((t) => t.id === me.device!.terminal_id);
  if (bound) return bound;
  let saved: string | null = null;
  try { saved = localStorage.getItem('prakai.terminal'); } catch {}
  return me.terminals.find((t) => t.id === saved) ?? me.terminals[0]!;
}
