import Link from 'next/link';

export type OwnerTab = 'profit' | 'menu' | 'stock' | 'expenses' | 'reports' | 'staff' | 'settings';

const TABS: Array<[OwnerTab, string, string]> = [
  ['profit', '/owner/profit', 'กำไร–ต้นทุน'],
  ['menu', '/owner/menu', 'เมนูและสูตร'],
  ['stock', '/owner/stock', 'สต็อกวัตถุดิบ'],
  ['expenses', '/owner/expenses', 'ค่าใช้จ่าย'],
  ['reports', '/owner/reports', 'รายงานภาษี'],
  ['staff', '/owner/staff', 'พนักงานและเครื่อง'],
  ['settings', '/owner/settings', 'ตั้งค่าร้านและภาษี'],
];

export function OwnerTabs({ active }: { active: OwnerTab }) {
  const tab = (on: boolean): React.CSSProperties => ({
    height: 48, display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 24, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`, background: on ? 'var(--accent)' : '#fff', color: on ? '#fff' : 'var(--ink)',
  });
  return (
    <nav className="row no-print" aria-label="หลังบ้าน" style={{ flexWrap: 'wrap', gap: 8 }}>
      {TABS.map(([key, href, label]) => (
        <Link key={key} href={href} style={tab(active === key)} aria-current={active === key ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
