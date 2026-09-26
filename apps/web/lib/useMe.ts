'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; name: string; email: string };
  tenant: {
    id: string; name: string; status: string; legal_name: string | null; tax_id: string | null; address: string | null;
    vat_registered: boolean; price_includes_vat: boolean; service_charge_bp: number; cash_rounding: string;
  };
  role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
  branches: { id: string; name: string; branch_code: string }[];
  terminals: { id: string; name: string; code: string; rd_pos_id: string | null; serial_no: string | null }[];
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = () => api<Me>('GET', '/api/me').then(setMe).catch(() => {});
  useEffect(() => { reload(); }, []);
  return { me, reload };
}

/** The terminal this device prints on; remembered per device. */
export function terminalFor(me: Me): Me['terminals'][number] {
  let saved: string | null = null;
  try { saved = localStorage.getItem('prakai.terminal'); } catch {}
  return me.terminals.find((t) => t.id === saved) ?? me.terminals[0]!;
}
