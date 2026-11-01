import Link from 'next/link';
import { Icon, type IconName } from '@/lib/icons';

export type OwnerTab = 'profit' | 'menu' | 'options' | 'customers' | 'stock' | 'expenses' | 'reports' | 'staff' | 'audit' | 'settings';
export type Tone = 'setup' | 'menu' | 'sell' | 'money' | 'system';

/** Back-office pages in the order a shop sets up and runs: set up → build the menu → customers → money → audit. */
export const OWNER_GROUPS: Array<{ tone: Tone; label: string; tabs: Array<[OwnerTab, string, string, IconName]> }> = [
  { tone: 'setup', label: 'ตั้งต้นร้าน', tabs: [
    ['settings', '/owner/settings', 'ตั้งค่าร้านและภาษี', 'settings'],
    ['staff', '/owner/staff', 'พนักงานและเครื่อง', 'users'],
  ] },
  { tone: 'menu', label: 'ทำเมนู', tabs: [
    ['stock', '/owner/stock', 'วัตถุดิบ', 'box'],
    ['options', '/owner/options', 'ตัวเลือกเมนู', 'sliders'],
    ['menu', '/owner/menu', 'เมนูและสูตร', 'book'],
  ] },
  { tone: 'sell', label: 'ลูกค้า', tabs: [
    ['customers', '/owner/customers', 'ลูกค้าประจำ', 'user'],
  ] },
  { tone: 'money', label: 'เงินและภาษี', tabs: [
    ['expenses', '/owner/expenses', 'ค่าใช้จ่าย', 'coins'],
    ['profit', '/owner/profit', 'กำไร–ต้นทุน', 'chart'],
    ['reports', '/owner/reports', 'รายงานภาษี', 'percent'],
  ] },
  { tone: 'system', label: 'ตรวจสอบ', tabs: [
    ['audit', '/owner/audit', 'ประวัติการใช้งาน', 'history'],
  ] },
];

export function OwnerTabs({ active }: { active: OwnerTab }) {
  return (
    <nav className="onav no-print" aria-label="หลังบ้าน">
      {OWNER_GROUPS.map((g, gi) => (
        <div key={g.tone} className={`onav-group tone-${g.tone}`}>
          <div className="onav-cap"><span className="onav-step" aria-hidden="true">{gi + 1}</span>{g.label}</div>
          <div className="onav-items">
            {g.tabs.map(([key, href, label, icon]) => (
              <Link key={key} href={href} className="onav-tab" aria-current={active === key ? 'page' : undefined}>
                <Icon name={icon} size={18} />{label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
