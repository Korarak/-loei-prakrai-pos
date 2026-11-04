'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/lib/icons';
import { isSimple, useMe } from '@/lib/useMe';

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

/** What a simple-mode shop keeps in its back office: the menu, the sales report, staff and settings. */
const SIMPLE_TABS: OwnerTab[] = ['menu', 'reports', 'staff', 'settings'];

export function OwnerTabs({ active }: { active: OwnerTab }) {
  const { me } = useMe();
  const groups = OWNER_GROUPS
    .map((g) => (isSimple(me) ? { ...g, tabs: g.tabs.filter(([k]) => SIMPLE_TABS.includes(k)).map(([k, h, l, i]) => [k, h, k === 'reports' ? 'รายงานยอดขาย' : l, i] as typeof g.tabs[number]) } : g))
    .filter((g) => g.tabs.length > 0);
  return (
    <nav className="onav no-print" aria-label="หลังบ้าน">
      {groups.map((g, gi) => (
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
