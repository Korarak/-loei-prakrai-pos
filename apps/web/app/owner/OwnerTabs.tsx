import Link from 'next/link';

export function OwnerTabs({ active }: { active: 'reports' | 'settings' }) {
  const tab = (on: boolean): React.CSSProperties => ({
    height: 48, display: 'flex', alignItems: 'center', padding: '0 20px', borderRadius: 24, fontSize: 16, fontWeight: 600,
    border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : 'var(--ink)',
  });
  return (
    <nav className="row no-print" aria-label="หลังบ้าน">
      <Link href="/owner/reports" style={tab(active === 'reports')} aria-current={active === 'reports' ? 'page' : undefined}>รายงานภาษี</Link>
      <Link href="/owner/settings" style={tab(active === 'settings')} aria-current={active === 'settings' ? 'page' : undefined}>ตั้งค่าร้านและภาษี</Link>
    </nav>
  );
}
