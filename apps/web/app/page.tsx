import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkle } from '@/lib/ui';
import './landing.css';
import { OpenApp } from './OpenApp';

const TITLE = 'ประกาย POS ระบบขายหน้าร้านอาหาร รู้ต้นทุนทุกจาน ออกใบกำกับภาษีถูกต้อง';
const DESC = 'POS สำหรับร้านอาหารไทย รับออเดอร์ที่โต๊ะบนแท็บเล็ต ส่งครัวและบาร์ คิดต้นทุนต่อจานจากสูตร ตัดสต็อกอัตโนมัติ ออกใบกำกับภาษีอย่างย่อและเต็มรูป พร้อมรายงานภาษี ทดลองใช้ฟรี 30 วัน';

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
  { icon: 'table', title: 'ผังโต๊ะและรับออเดอร์', body: 'แตะโต๊ะ แตะเมนู ส่งครัว ย้ายโต๊ะ รวมบิล แยกบิล ชำระแยกได้ และเพิ่มลดโต๊ะเองได้ทันทีจากหน้าผังโต๊ะ' },
  { icon: 'sliders', title: 'ตัวเลือกเมนูที่ถามให้ครบ', body: 'ความสุกสเต็ก ซอส ของเคียง ระดับเผ็ด ท็อปปิ้ง บังคับเลือกได้ บวกราคาให้ และตัดสต็อกวัตถุดิบเพิ่มให้เอง' },
  { icon: 'chart', title: 'ต้นทุนต่อจานจากสูตรจริง', body: 'ใส่สูตรครั้งเดียว เห็น food cost และกำไรขั้นต้นทันที รวมสูตรย่อยอย่างน้ำจิ้ม ซอส น้ำซุป พร้อมรายงานกำไรขาดทุนรายเดือน' },
  { icon: 'box', title: 'สต็อกที่ตัดเองตามสูตร', body: 'ขายแล้วหักวัตถุดิบอัตโนมัติ เตือนของใกล้หมด บันทึกใบรับของ ของเสีย และนับสต็อกเทียบกับที่ระบบคำนวณ' },
  { icon: 'receipt', title: 'เอกสารภาษีครบ', body: 'VAT 7% ใบกำกับภาษีอย่างย่อและเต็มรูป ใบลดหนี้ รายงานภาษีขาย ภาษีซื้อ และสรุปยอดสำหรับกรอก ภ.พ.30' },
  { icon: 'printer', title: 'ใบสั่งครัวและบาร์', body: 'แยกใบสั่งตามสถานี ครัวกับบาร์น้ำ พิมพ์ลงเครื่องพิมพ์ความร้อนในร้าน หรือพิมพ์ผ่านเบราว์เซอร์ก็ได้' },
  { icon: 'wallet', title: 'รับเงินได้ทุกแบบ', body: 'เงินสด พร้อมเพย์ QR ตามยอดบิล จ่ายผสม ส่วนลด ค่าบริการ เปิดปิดกะ และนับเงินในลิ้นชักเทียบยอดระบบ' },
  { icon: 'shield', title: 'พนักงานและความปลอดภัย', body: 'กำหนดสิทธิ์เจ้าของ ผู้จัดการ แคชเชียร์ เสิร์ฟ ครัว ใช้ PIN ที่เครื่องหน้าร้าน ยืนยันตัวตนสองขั้น และมีบันทึกการแก้ไขตรวจสอบย้อนหลัง' },
];

const FAQ: Array<[string, string]> = [
  ['ต้องใช้อุปกรณ์อะไรบ้าง', 'ใช้เบราว์เซอร์บนแท็บเล็ต มือถือ หรือคอมพิวเตอร์ที่มีอินเทอร์เน็ต ไม่ต้องติดตั้งโปรแกรม และเพิ่มเป็นไอคอนบนหน้าจอเหมือนแอปได้ ถ้าจะพิมพ์ใบสั่งครัวหรือใบเสร็จ ใช้เครื่องพิมพ์ความร้อนแบบ LAN ที่รองรับ ESC/POS ได้'],
  ['ร้านที่ไม่ได้จด VAT ใช้ได้ไหม', 'ได้ ตั้งค่าร้านเป็นไม่จด VAT ระบบจะออกใบเสร็จรับเงินให้ และเมื่อร้านจดทะเบียน VAT ค่อยเปิดโหมดใบกำกับภาษีได้ในหน้าตั้งค่า'],
  ['ใช้เป็นระบบเครื่องบันทึกเงินสดตามสรรพากรได้ไหม', 'ระบบออกเอกสารตามรูปแบบที่ประกาศกำหนดและมีหน้าเตรียมเอกสารประกอบคำขอ ภ.พ.06 ให้ แต่การขึ้นทะเบียนเครื่องและขอ POS ID กับสรรพากรเป็นหน้าที่ของผู้ประกอบการ ควรปรึกษาสรรพากรหรือนักบัญชีของร้านประกอบด้วย'],
  ['ถ้าอินเทอร์เน็ตหลุดตอนขายจะเป็นอย่างไร', 'ตอนนี้ระบบต้องออนไลน์ระหว่างใช้งาน ยังไม่รองรับการขายแบบออฟไลน์ แนะนำให้มีเน็ตสำรอง เช่น ฮอตสปอตมือถือ'],
  ['ข้อมูลร้านของเราปลอดภัยและแยกจากร้านอื่นไหม', 'ข้อมูลแต่ละร้านถูกแยกในระดับฐานข้อมูล ร้านอื่นมองไม่เห็นกัน เอกสารภาษีที่ออกแล้วแก้หรือลบไม่ได้ ต้องแก้ด้วยใบลดหนี้ และการแก้ไขสำคัญถูกบันทึกไว้ตรวจสอบย้อนหลังได้'],
  ['ย้ายเมนูและราคามาจากระบบเดิมได้ไหม', 'เริ่มจากแม่แบบเมนูที่ใกล้เคียงกับร้านคุณ แล้วแก้ชื่อ ราคา และสูตรได้เองทั้งหมด หน้าเพิ่มเมนูมีช่องค้นหาวัตถุดิบ และคัดลอกสูตรจากเมนูอื่นได้ เพื่อให้ตั้งต้นได้เร็ว'],
  ['ทดลองใช้ฟรีต้องทำอย่างไร', 'สมัครด้วยอีเมล ไม่ต้องใส่บัตรเครดิต ใช้ได้ฟรี 30 วัน เลือกแม่แบบร้านแล้วเปิดขายได้เลย'],
];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ประกาย POS',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: DESC,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'THB', description: 'ทดลองใช้ฟรี 30 วัน' },
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
              <p className="lp-sub lp-rise d2">รับออเดอร์ที่โต๊ะบนแท็บเล็ต ส่งเข้าครัวและบาร์ ตัดสต็อกตามสูตรอัตโนมัติ แล้วปิดวันพร้อมรายงานภาษี ครบในระบบเดียว</p>
              <div className="lp-actions lp-rise d3">
                <Link href="/signup" className="lp-btn lp-btn-gold">ทดลองใช้ฟรี 30 วัน</Link>
                <a href="#features" className="lp-btn lp-btn-ghost">ดูว่าทำอะไรได้บ้าง</a>
              </div>
              <ul className="lp-points lp-rise d3">
                <li><Icon name="check" size={20} /> สมัครด้วยอีเมล ไม่ต้องใส่บัตรเครดิต</li>
                <li><Icon name="check" size={20} /> เลือกแม่แบบร้านสเต็ก อาหารตามสั่ง หรือเริ่มจากว่าง พร้อมเมนู สูตร และต้นทุน</li>
              </ul>
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
              <div><b>VAT 7%</b><span>ใบกำกับภาษีอย่างย่อและเต็มรูป</span></div>
              <div><b>พร้อมเพย์ QR</b><span>สร้างตามยอดบิลทุกใบ</span></div>
              <div><b>ทุกอุปกรณ์</b><span>แท็บเล็ต มือถือ คอมพิวเตอร์</span></div>
              <div><b>ข้อมูลแยกร้าน</b><span>แต่ละร้านมองไม่เห็นกัน</span></div>
            </div>
          </div>
        </div>

        {/* ---------- features ---------- */}
        <section className="lp-sec" id="features">
          <div className="lp-wrap">
            <span className="lp-eyebrow">ความสามารถ</span>
            <h2 className="lp-h2">ทุกอย่างที่ร้านอาหารใช้ทุกวัน อยู่ในที่เดียว</h2>
            <p className="lp-lead">ออกแบบให้ใช้ได้ด้วยนิ้วบนแท็บเล็ต ปุ่มใหญ่ ภาษาไทยทั้งหมด พนักงานใหม่เรียนรู้ได้ในไม่กี่นาที</p>
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
              <h2 className="lp-h2">ขายดี แต่กำไรจริงเท่าไร ดูได้ทุกเมนู</h2>
              <p className="lp-lead">ระบบคิดต้นทุนจากสูตรและราคาซื้อวัตถุดิบล่าสุด รวมส่วนที่เสียจากการตัดแต่ง แล้วเทียบกับราคาขายก่อน VAT ให้เห็นเมนูที่ควรปรับราคาหรือปรับสูตร</p>
              <ul className="lp-checks">
                <li><Icon name="check" size={20} /><div><b>เห็นผลทันทีที่พิมพ์</b><span>แก้ปริมาณหรือราคา แล้วดู food cost เปลี่ยนในหน้าเดียวกัน</span></div></li>
                <li><Icon name="check" size={20} /><div><b>เตือนเมนูต้นทุนสูง</b><span>ไฮไลต์เมนูที่ food cost เกินเกณฑ์ที่ร้านถือเป็นเป้า</span></div></li>
                <li><Icon name="check" size={20} /><div><b>ซอสและน้ำจิ้มทำเอง ก็คิดให้</b><span>สูตรย่อยแตกเป็นวัตถุดิบ ตัดสต็อกและคิดต้นทุนถูกต้อง</span></div></li>
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
              <p className="lp-note">ตัวเลขนี้เป็นตัวอย่างเพื่ออธิบายหน้าจอ ราคาและต้นทุนจริงขึ้นกับสูตรและราคาซื้อของแต่ละร้าน</p>
            </div>
          </div>
        </section>

        {/* ---------- how it starts ---------- */}
        <section className="lp-sec" id="start">
          <div className="lp-wrap">
            <span className="lp-eyebrow">เริ่มใช้งาน</span>
            <h2 className="lp-h2">จากสมัครถึงขายจานแรก ใช้เวลาไม่นาน</h2>
            <div className="lp-steps">
              <div className="lp-step"><h3>สมัครและเลือกแม่แบบร้าน</h3><p>กรอกอีเมล ชื่อร้าน จำนวนโต๊ะ แล้วเลือกเมนูตั้งต้นที่ใกล้เคียงกับร้านคุณ</p></div>
              <div className="lp-step"><h3>ปรับเมนู ราคา และสูตร</h3><p>แก้ชื่อ ราคา รูป ตัวเลือก และสูตรได้เองทั้งหมด มีช่องค้นหาวัตถุดิบ และเพิ่มลดโต๊ะได้เองตลอดเวลา</p></div>
              <div className="lp-step"><h3>เปิดกะแล้วเริ่มขาย</h3><p>เพิ่มพนักงานพร้อม PIN เปิดกะด้วยเงินทอนตั้งต้น แล้วรับออเดอร์ได้เลย ปิดวันดูยอดและภาษีได้ทันที</p></div>
            </div>
          </div>
        </section>

        {/* ---------- templates ---------- */}
        <section className="lp-sec" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <span className="lp-eyebrow">แม่แบบร้าน</span>
            <h2 className="lp-h2">เริ่มจากเมนูที่พร้อมใช้ ไม่ต้องพิมพ์ใหม่ทั้งหมด</h2>
            <div className="lp-tpl">
              <div className="lp-tcard hot">
                <span className="lp-tag">ครบที่สุด</span>
                <h3>ร้านสเต็ก ข้าวขาหมู หมูกรอบ</h3>
                <p>มีเมนูอาหาร เครื่องดื่ม เบียร์ ไวน์ และค็อกเทล พร้อมสูตร ต้นทุน และคำถามตอนสั่ง เช่น ความสุกสเต็ก ซอส ของเคียง</p>
                <div className="lp-chips"><span>44 เมนู</span><span>10 หมวด</span><span>สูตรครบ</span><span>ครัว + บาร์น้ำ</span></div>
              </div>
              <div className="lp-tcard">
                <h3>อาหารตามสั่ง</h3>
                <p>เมนูจานเดียวยอดนิยมสำหรับร้านทั่วไป เหมาะกับร้านที่อยากเริ่มขายก่อนแล้วค่อยใส่สูตรทีหลัง</p>
                <div className="lp-chips"><span>ข้าวผัด</span><span>กะเพรา</span><span>ต้ม ยำ</span><span>เครื่องดื่ม</span></div>
              </div>
              <div className="lp-tcard">
                <h3>เริ่มจากว่าง</h3>
                <p>สร้างหมวดและเมนูเองตั้งแต่ต้น เหมาะกับร้านคาเฟ่ บาร์ หรือร้านที่เมนูต่างจากแม่แบบมาก</p>
                <div className="lp-chips"><span>กำหนดเองทั้งหมด</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- trust ---------- */}
        <section className="lp-sec lp-dark">
          <div className="lp-wrap">
            <span className="lp-eyebrow">ความถูกต้องและความปลอดภัย</span>
            <h2 className="lp-h2">ตัวเลขที่เจ้าของร้านและนักบัญชีเชื่อใจได้</h2>
            <div className="lp-trust">
              <div><h3>เอกสารภาษีแก้ไม่ได้</h3><p>ใบกำกับภาษีที่ออกแล้วแก้หรือลบไม่ได้ หากผิดพลาดให้ยกเลิกหรือออกใบลดหนี้ ตัวเลขในรายงานจึงตรงกับเอกสารจริง</p></div>
              <div><h3>ตรวจสอบย้อนหลังได้</h3><p>การแก้ราคา ยกเลิกรายการ และตั้งค่าสำคัญถูกบันทึกเป็นประวัติที่เชื่อมต่อกัน ใครทำอะไรเมื่อไรดูได้ในหน้าบันทึกการแก้ไข</p></div>
              <div><h3>ข้อมูลแยกต่อร้าน</h3><p>แต่ละร้านมีข้อมูลของตัวเองแยกจากกันที่ระดับฐานข้อมูล ล็อกอินด้วยรหัสผ่านและเปิดยืนยันตัวตนสองขั้นได้</p></div>
            </div>
            <p className="lp-disclaimer">ประกาย POS ช่วยจัดทำเอกสารและรายงานตามรูปแบบที่กฎหมายกำหนด การจดทะเบียน VAT การขอ POS ID และการยื่นแบบภาษีเป็นหน้าที่ของผู้ประกอบการ ควรปรึกษาสรรพากรหรือนักบัญชีของร้านประกอบการตัดสินใจ</p>
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
              <h2>พร้อมให้ร้านของคุณรู้กำไรทุกจานหรือยัง</h2>
              <p>สมัครวันนี้ ทดลองใช้ฟรี 30 วัน เลือกแม่แบบร้านแล้วเปิดขายได้ในไม่กี่นาที</p>
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
