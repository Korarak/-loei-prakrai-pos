import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkle } from '@/lib/ui';
import './landing.css';
import { OpenApp } from './OpenApp';

const TITLE = 'ประกาย POS ระบบขายหน้าร้านอาหาร รู้ต้นทุนทุกจาน ออกใบกำกับภาษีถูกต้อง';
const DESC = 'POS สำหรับร้านอาหารไทย รับออเดอร์ที่โต๊ะบนแท็บเล็ต ส่งครัวและบาร์ คิดต้นทุนต่อจานจากสูตร ตัดสต็อกอัตโนมัติ ออกใบกำกับภาษีอย่างย่อและเต็มรูป พร้อมรายงานภาษี';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  openGraph: { title: TITLE, description: DESC, type: 'website', locale: 'th_TH', siteName: 'ประกาย POS' },
};

type IconName = 'table' | 'sliders' | 'chart' | 'box' | 'receipt' | 'printer' | 'wallet' | 'shield' | 'check';
const PATHS: Record<IconName, string> = {
  table: 'M3 10h18M5 10v9M19 10v9M4 6h16l1 4H3z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M7 15v4',
  chart: 'M4 20V9M10 20V4M16 20v-8M22 20H2',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  printer: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1zM16 14h2',
  shield: 'M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6zM9 12l2 2 4-4',
  check: 'M5 12.5l4.2 4.2L19 7',
};

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'table', title: 'ผังโต๊ะ', body: 'แตะโต๊ะ แตะเมนู ย้ายโต๊ะ แยกบิล' },
  { icon: 'sliders', title: 'ตัวเลือกเมนู', body: 'ความสุก ซอส ท็อปปิ้ง บวกราคาให้เอง' },
  { icon: 'chart', title: 'ต้นทุนต่อจาน', body: 'ใส่สูตรครั้งเดียว เห็นกำไรทันที' },
  { icon: 'box', title: 'สต็อกตัดเอง', body: 'ขายแล้วหักวัตถุดิบ เตือนของใกล้หมด' },
  { icon: 'receipt', title: 'ภาษีครบ', body: 'ใบกำกับภาษี ใบลดหนี้ รายงาน ภ.พ.30' },
  { icon: 'printer', title: 'ครัวและบาร์', body: 'ใบสั่งแยกสถานี พิมพ์ได้เลย' },
  { icon: 'wallet', title: 'รับเงินทุกแบบ', body: 'เงินสด พร้อมเพย์ QR แยกบิล' },
  { icon: 'shield', title: 'พนักงานปลอดภัย', body: 'กำหนดสิทธิ์ ใช้ PIN มี 2FA' },
];

const FAQ: Array<[string, string]> = [
  ['ต้องใช้อุปกรณ์อะไร', 'แท็บเล็ต มือถือ หรือคอมที่มีเน็ต ไม่ต้องติดตั้งโปรแกรม'],
  ['ร้านที่ไม่จด VAT ใช้ได้ไหม', 'ได้ ระบบออกใบเสร็จรับเงินให้ จด VAT แล้วค่อยเปิดโหมดใบกำกับภาษี'],
  ['ขายตอนเน็ตหลุดได้ไหม', 'ยังไม่ได้ ต้องออนไลน์ แนะนำมีฮอตสปอตสำรอง'],
  ['เริ่มใช้งานอย่างไร', 'สมัครด้วยอีเมล เลือกแม่แบบร้าน แล้วเปิดขายได้เลย'],
];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ประกาย POS',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: DESC,
};

function Check() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>;
}

export default function Landing() {
  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className="lp-head">
        <div className="lp-wrap">
          <Link href="/" className="lp-brand"><Sparkle size={26} /> ประกาย <small style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}>POS</small></Link>
          <nav className="lp-nav" aria-label="เมนูหลัก">
            <a href="#features">ความสามารถ</a>
            <a href="#cost">ต้นทุนต่อจาน</a>
            <a href="#start">เริ่มใช้งาน</a>
            <a href="#faq">คำถามที่พบบ่อย</a>
          </nav>
          <div className="lp-cta"><OpenApp /></div>
        </div>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section className="lp-hero">
          <div className="lp-wrap">
            <div>
              <span className="lp-eyebrow lp-rise" style={{ background: 'rgba(233,180,76,.18)', color: 'var(--lp-gold)' }}>สำหรับร้านอาหารไทย</span>
              <h1 className="lp-rise d1">ขายง่ายที่หน้าร้าน<br />รู้<em>ต้นทุนทุกจาน</em><br />ภาษีถูกต้องทุกบิล</h1>
              <p className="lp-sub lp-rise d2">POS ร้านอาหารบนแท็บเล็ต ครบในที่เดียว</p>
              <div className="lp-actions lp-rise d3">
                <Link href="/signup" className="lp-btn lp-btn-gold">สมัครใช้งาน</Link>
                <a href="#features" className="lp-btn lp-btn-ghost">ดูว่าทำอะไรได้บ้าง</a>
              </div>
              <p className="lp-rise d3" style={{ marginTop: 18, color: '#cfe3d8', fontSize: 15 }}>สมัครด้วยอีเมล เลือกแม่แบบร้าน เปิดขายได้เลย</p>
            </div>

            {/* Decorative preview drawn in CSS; not a real screenshot */}
            <div className="lp-mock lp-rise d2" aria-hidden="true">
              <div className="lp-tablet">
                <div className="lp-screen">
                  <div className="lp-bar"><Sparkle size={16} /> ประกาย <span className="lp-tab lp-on">ผังโต๊ะ</span><span className="lp-tab">หลังบ้าน</span><span className="lp-tab">กะ</span></div>
                  <div className="lp-floor">
                    {[
                      ['1', 'ว่าง'], ['2', '3 ท่าน · 24 นาที'], ['3', 'ว่าง'], ['4', '2 ท่าน · 8 นาที'],
                      ['5', 'ว่าง'], ['6', '4 ท่าน · 41 นาที'], ['7', 'ว่าง'], ['8', 'ว่าง'],
                      ['VIP', 'ว่าง'], ['10', '2 ท่าน · 3 นาที'], ['11', 'ว่าง'], ['12', 'ว่าง'],
                    ].map(([n, s]) => (
                      <div key={n} className={`lp-tbl${s !== 'ว่าง' ? ' on' : ''}`}><b>{n}</b><small>{s}</small></div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="lp-float lp-float-bill">
                <h4>โต๊ะ 6 · ตัวอย่างบิล</h4>
                <div className="lp-bill-line"><span>สเต็กริบอาย (Medium)</span><span>599</span></div>
                <div className="lp-bill-line"><span>ข้าวขาหมู ไข่ต้ม</span><span>89</span></div>
                <div className="lp-bill-line"><span>เบียร์สิงห์ ขวดใหญ่</span><span>130</span></div>
                <div className="lp-bill-line" style={{ color: 'var(--lp-soft)' }}><span>ค่าบริการ 10%</span><span>81.80</span></div>
                <div className="lp-bill-line total"><span>รวม</span><span>฿899.80</span></div>
              </div>
              <div className="lp-float lp-float-cost">
                <h4>ต้นทุนต่อจาน (ตัวอย่าง)</h4>
                <div className="lp-bar-row"><span>ข้าวขาหมู</span><b>29%</b><i style={{ '--w': '29%' } as React.CSSProperties} /></div>
                <div className="lp-bar-row"><span>หมูกรอบทอดกระเทียม</span><b>33%</b><i style={{ '--w': '33%' } as React.CSSProperties} /></div>
                <div className="lp-bar-row warn"><span>สเต็กริบอาย 250 ก.</span><b>41%</b><i style={{ '--w': '41%' } as React.CSSProperties} /></div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- facts strip ---------- */}
        <div className="lp-strip">
          <div className="lp-wrap">
            <div className="lp-strip-in">
              <div><b>VAT 7%</b></div>
              <div><b>พร้อมเพย์ QR</b></div>
              <div><b>ทุกอุปกรณ์</b></div>
              <div><b>ข้อมูลแยกร้าน</b></div>
            </div>
          </div>
        </div>

        {/* ---------- features ---------- */}
        <section className="lp-sec" id="features">
          <div className="lp-wrap">
            <span className="lp-eyebrow">ความสามารถ</span>
            <h2 className="lp-h2">ครบทุกอย่างที่ร้านใช้ทุกวัน</h2>
            <div className="lp-grid">
              {FEATURES.map((f) => (
                <article className="lp-feat" key={f.title}>
                  <div className="lp-ico"><Icon name={f.icon} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- costing showcase ---------- */}
        <section className="lp-sec lp-dark" id="cost">
          <div className="lp-wrap lp-split">
            <div>
              <span className="lp-eyebrow">ต้นทุนต่อจาน</span>
              <h2 className="lp-h2">รู้กำไรจริงของทุกเมนู</h2>
              <ul className="lp-checks">
                <li><Icon name="check" size={20} /><div><b>เห็นผลทันทีที่พิมพ์</b></div></li>
                <li><Icon name="check" size={20} /><div><b>เตือนเมนูต้นทุนสูง</b></div></li>
                <li><Icon name="check" size={20} /><div><b>ซอสและน้ำจิ้มทำเอง ก็คิดให้</b></div></li>
              </ul>
            </div>
            <div className="lp-panel" aria-label="ตัวอย่างตารางต้นทุนเมนู">
              <h4>เมนูและต้นทุน <small>ตัวอย่างข้อมูล · ราคาก่อน VAT</small></h4>
              <table className="lp-ptable">
                <thead><tr><th>เมนู</th><th>ราคาขาย</th><th>ต้นทุน</th><th>Food cost</th></tr></thead>
                <tbody>
                  <tr><td>ข้าวขาหมู</td><td>65.42</td><td>19.05</td><td><span className="lp-badge ok">29%</span></td></tr>
                  <tr><td>หมูกรอบคลุกพริกเกลือ</td><td>130.84</td><td>43.20</td><td><span className="lp-badge ok">33%</span></td></tr>
                  <tr><td>สเต็กสันนอก 200 ก.</td><td>270.09</td><td>94.30</td><td><span className="lp-badge ok">35%</span></td></tr>
                  <tr><td>สเต็กริบอาย 250 ก.</td><td>559.81</td><td>229.50</td><td><span className="lp-badge hi">41%</span></td></tr>
                </tbody>
              </table>
              <p className="lp-note">ตัวเลขตัวอย่าง</p>
            </div>
          </div>
        </section>

        {/* ---------- how it starts ---------- */}
        <section className="lp-sec" id="start">
          <div className="lp-wrap">
            <span className="lp-eyebrow">เริ่มใช้งาน</span>
            <h2 className="lp-h2">เริ่มขายใน 3 ขั้น</h2>
            <div className="lp-steps">
              <div className="lp-step"><h3>สมัครและเลือกแม่แบบ</h3></div>
              <div className="lp-step"><h3>ปรับเมนูและราคา</h3></div>
              <div className="lp-step"><h3>เปิดกะแล้วขาย</h3></div>
            </div>
          </div>
        </section>

        {/* ---------- templates ---------- */}
        <section className="lp-sec" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <span className="lp-eyebrow">แม่แบบร้าน</span>
            <h2 className="lp-h2">เริ่มจากเมนูที่พร้อมใช้</h2>
            <div className="lp-tpl">
              <div className="lp-tcard hot">
                <span className="lp-tag">ครบที่สุด</span>
                <h3>ร้านสเต็ก ข้าวขาหมู หมูกรอบ</h3>
                
                <div className="lp-chips"><span>44 เมนู</span><span>10 หมวด</span><span>สูตรครบ</span><span>ครัว + บาร์น้ำ</span></div>
              </div>
              <div className="lp-tcard">
                <h3>อาหารตามสั่ง</h3>
                
                <div className="lp-chips"><span>ข้าวผัด</span><span>กะเพรา</span><span>ต้ม ยำ</span><span>เครื่องดื่ม</span></div>
              </div>
              <div className="lp-tcard">
                <h3>เริ่มจากว่าง</h3>
                
                <div className="lp-chips"><span>กำหนดเองทั้งหมด</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- trust ---------- */}
        <section className="lp-sec lp-dark">
          <div className="lp-wrap">
            <span className="lp-eyebrow">ความถูกต้องและความปลอดภัย</span>
            <h2 className="lp-h2">ตัวเลขที่เชื่อใจได้</h2>
            <div className="lp-trust">
              <div><h3>เอกสารภาษีแก้ไม่ได้</h3><p>ผิดแล้วออกใบลดหนี้</p></div>
              <div><h3>ตรวจสอบย้อนหลังได้</h3><p>ใครทำอะไรเมื่อไร มีบันทึก</p></div>
              <div><h3>ข้อมูลแยกต่อร้าน</h3><p>ร้านอื่นมองไม่เห็น</p></div>
            </div>
            <p className="lp-disclaimer">ระบบช่วยจัดทำเอกสารตามรูปแบบที่กฎหมายกำหนด การจดทะเบียน VAT และยื่นภาษีเป็นหน้าที่ของผู้ประกอบการ</p>
          </div>
        </section>

        {/* ---------- faq ---------- */}
        <section className="lp-sec" id="faq">
          <div className="lp-wrap">
            <span className="lp-eyebrow">คำถามที่พบบ่อย</span>
            <h2 className="lp-h2">ก่อนตัดสินใจ มักมีคำถามเหล่านี้</h2>
            <div className="lp-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}><summary>{q}</summary><p>{a}</p></details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- final cta ---------- */}
        <section style={{ paddingBottom: 'clamp(40px, 6vw, 72px)' }}>
          <div className="lp-wrap">
            <div className="lp-final">
              <h2>พร้อมรู้กำไรทุกจานหรือยัง</h2>
              <div className="lp-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link href="/signup" className="lp-btn lp-btn-gold">สร้างร้านของคุณ</Link>
                <Link href="/login" className="lp-btn lp-btn-ghost">มีบัญชีแล้ว เข้าสู่ระบบ</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Sparkle size={18} /> ประกาย POS · ตั้งชื่อตามคุณประกายดาว ผลสอน</span>
          <nav aria-label="ลิงก์ท้ายหน้า">
            <a href="#features">ความสามารถ</a>
            <a href="#faq">คำถามที่พบบ่อย</a>
            <Link href="/login">เข้าสู่ระบบ</Link>
            <Link href="/signup">สมัครใช้งาน</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
