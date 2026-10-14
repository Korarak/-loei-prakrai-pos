'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Header buttons: "sign in" for visitors, "open my shop" when this browser already has a session. */
export function OpenApp() {
  const [shop, setShop] = useState<string | null>(null);
  useEffect(() => {
    // Plain fetch, not api(): a visitor's 401 must not bounce them to the PIN screen.
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setShop(m?.tenant?.name ?? null))
      .catch(() => {});
  }, []);
  if (shop) return <Link href="/pos" className="lp-btn lp-btn-primary">เปิดร้าน {shop}</Link>;
  return (
    <>
      <Link href="/login" className="lp-btn lp-btn-line">เข้าสู่ระบบ</Link>
      <Link href="/signup" className="lp-btn lp-btn-primary">ทดลองใช้ฟรี</Link>
    </>
  );
}
