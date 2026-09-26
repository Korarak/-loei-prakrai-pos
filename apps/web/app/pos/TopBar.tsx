'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Brand } from '@/lib/ui';
import type { Me } from '@/lib/useMe';

export function TopBar({ me, active, children }: { me: Me | null; active?: 'tables' | 'owner'; children?: React.ReactNode }) {
  const router = useRouter();
  const tab = (on: boolean): React.CSSProperties => ({
    height: 48, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 12, fontSize: 17,
    background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent-ink)' : 'var(--ink)', fontWeight: on ? 600 : 500,
  });
  const canOwn = me && (me.role === 'owner' || me.role === 'manager');
  return (
    <header className="topbar no-print">
      <Brand />
      {active && <Link href="/pos" style={tab(active === 'tables')}>โต๊ะ</Link>}
      {active && canOwn && <Link href="/owner/reports" style={tab(active === 'owner')}>หลังบ้าน</Link>}
      <span className="spacer" />
      {children}
      {me && <span className="muted" style={{ fontSize: 15 }}>{me.tenant.name} · <b style={{ color: 'var(--ink)' }}>{me.user.name}</b></span>}
      <button className="btn" onClick={async () => { await api('POST', '/api/auth/logout'); router.push('/login'); }}>ออก</button>
    </header>
  );
}
