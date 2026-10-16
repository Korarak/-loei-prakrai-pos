'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useConfirm } from '@/lib/dialog';
import { Icon } from '@/lib/icons';
import { Brand } from '@/lib/ui';
import type { Me } from '@/lib/useMe';

const ROLE: Record<string, string> = { owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', waiter: 'เสิร์ฟ', kitchen: 'ครัว' };

export function TopBar({ me, active, children }: { me: Me | null; active?: 'tables' | 'shift' | 'owner' | 'platform'; children?: React.ReactNode }) {
  const router = useRouter();
  const confirm = useConfirm();
  async function leave(to: '/login' | '/pin') {
    const swap = to === '/pin';
    if (!(await confirm({ title: swap ? 'สลับผู้ใช้?' : 'ออกจากระบบ?', body: swap ? 'เครื่องนี้จะกลับไปหน้าใส่ PIN' : 'บิลที่ค้างอยู่ยังอยู่ครบ กลับมาเข้าใหม่ได้', confirm: swap ? 'สลับผู้ใช้' : 'ออกจากระบบ', icon: swap ? 'switch' : 'logout' }))) return;
    await api('POST', '/api/auth/logout');
    router.push(to);
  }
  const tab = (on: boolean): React.CSSProperties => ({
    height: 48, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 12, fontSize: 17,
    background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent-ink)' : 'var(--ink)', fontWeight: on ? 600 : 500,
  });
  const canOwn = me && (me.role === 'owner' || me.role === 'manager');
  const canCash = canOwn || me?.role === 'cashier';
  return (
    <header className="topbar no-print">
      <Brand />
      {active && <Link href="/pos" style={tab(active === 'tables')}>โต๊ะ</Link>}
      {active && canCash && <Link href="/pos/shift" style={tab(active === 'shift')}>กะ / ลิ้นชัก</Link>}
      {active && canOwn && <Link href="/owner/profit" style={tab(active === 'owner')}>หลังบ้าน</Link>}
      {active && me?.platformAdmin && <Link href="/platform" style={tab(active === 'platform')}>ผู้ดูแลระบบ</Link>}
      <span className="spacer" />
      {children}
      {me?.tenant.logo_url && <img src={me.tenant.logo_url} alt="" style={{ height: 34, maxWidth: 90, objectFit: 'contain' }} />}
      {me && <span className="muted topbar-user" style={{ fontSize: 15 }}>{me.tenant.name} · <b style={{ color: 'var(--ink)' }}>{me.user.name}</b> ({ROLE[me.role]})</span>}
      {me?.device ? (
        // A shared till: hand over to the next person instead of signing the shop out.
        <button className="btn btn-outline" onClick={() => leave('/pin')}><Icon name="switch" /> สลับผู้ใช้</button>
      ) : (
        <button className="btn" onClick={() => leave('/login')}><Icon name="logout" /> ออก</button>
      )}
    </header>
  );
}
