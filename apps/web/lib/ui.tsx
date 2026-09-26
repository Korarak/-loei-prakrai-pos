import Link from 'next/link';

export function Sparkle({ size = 30, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill={color} />
    </svg>
  );
}

export function Brand({ suffix = 'POS' }: { suffix?: string }) {
  return (
    <Link href="/pos" className="brand" style={{ color: 'var(--ink)' }}>
      <Sparkle /> ประกาย <small>{suffix}</small>
    </Link>
  );
}

export function BowlIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#7A6A55" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18a9 9 0 0 1-18 0z" />
      <path d="M8 8c0-1.5 1-1.5 1-3M12 8c0-1.5 1-1.5 1-3M16 8c0-1.5 1-1.5 1-3" />
    </svg>
  );
}

const TINTS = ['#F4E7D3', '#E9EEDC', '#F6E0D6', '#EAF0D8', '#F3E4D6', '#E3EEDF', '#F5E6CF', '#F8EDCB', '#F4E1D2', '#EEF1E8', '#F1F0EA', '#E6EEF2'];
/** Stable placeholder tint per menu item until the shop uploads a photo. */
export function tintFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function BackIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
  );
}
