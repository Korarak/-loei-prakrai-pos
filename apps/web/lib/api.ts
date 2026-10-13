'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Thai wording for API error codes the cashier can act on. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  email_taken: 'อีเมลนี้สมัครแล้ว ลองเข้าสู่ระบบ',
  unauthenticated: 'กรุณาเข้าสู่ระบบ',
  shop_suspended: 'ร้านนี้ถูกระงับการใช้งานชั่วคราว ติดต่อผู้ดูแลระบบ',
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  manager_required: 'ต้องให้ผู้จัดการอนุมัติ',
  table_busy: 'โต๊ะนี้มีบิลเปิดอยู่',
  tables_busy: 'โต๊ะที่จะลดมีบิลเปิดอยู่ ปิดบิลก่อนหรือลดจำนวนให้น้อยลง',
  table_name_taken: 'มีโต๊ะชื่อนี้แล้ว',
  order_closed: 'บิลนี้ปิดไปแล้ว',
  empty_order: 'ยังไม่มีรายการในบิล',
  pos_not_approved: 'เครื่องนี้ยังไม่มี POS ID จากสรรพากร ออกใบกำกับภาษีอย่างย่อไม่ได้ ใช้ใบเต็มรูปแทน',
  not_vat_registered: 'ร้านยังไม่จด VAT ออกได้เฉพาะใบเสร็จรับเงิน',
  tax_invoice_required: 'ร้านจด VAT ต้องออกใบกำกับภาษี',
  seller_tax_info_missing: 'ยังไม่ได้กรอกชื่อผู้ประกอบการและเลขผู้เสียภาษีในตั้งค่าร้าน',
  buyer_required: 'กรอกข้อมูลผู้ซื้อสำหรับใบกำกับภาษีเต็มรูป',
  amount_mismatch: 'ยอดชำระไม่ตรงกับยอดบิล',
  line_not_editable: 'รายการที่ส่งครัวแล้วแก้จำนวนไม่ได้ ต้องยกเลิกพร้อมเหตุผล',
  invalid_input: 'ข้อมูลไม่ถูกต้อง',
  invalid_pin: 'PIN ไม่ถูกต้อง',
  pin_locked: 'ใส่ PIN ผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว',
  device_not_registered: 'เครื่องนี้ยังไม่ได้ลงทะเบียน ให้เจ้าของร้านลงทะเบียนก่อน',
  owner_locked: 'ปิดหรือเปลี่ยนบทบาทเจ้าของร้านไม่ได้',
  category_in_use: 'หมวดนี้ยังมีเมนูอยู่ ย้ายเมนูออกก่อนจึงลบได้',
  terminal_not_found: 'ไม่พบเครื่องขายนี้',
  use_credit_note: 'เอกสารของวันก่อนต้องแก้ด้วยใบลดหนี้',
  shift_required: 'เครื่องนี้ยังไม่ได้เปิดกะ เปิดกะที่เมนู “กะ / ลิ้นชัก” ก่อนรับเงิน',
  shift_open: 'เครื่องนี้เปิดกะอยู่แล้ว',
  shift_closed: 'กะนี้ปิดไปแล้ว',
  already_void: 'เอกสารนี้ถูกยกเลิกไปแล้ว',
  already_credited: 'เอกสารนี้ออกใบลดหนี้ไปแล้ว',
  not_creditable: 'ออกใบลดหนี้ได้เฉพาะใบกำกับภาษี',
  not_voidable: 'ใบลดหนี้ยกเลิกไม่ได้',
  qty_over: 'จำนวนเกินกว่าที่มีอยู่',
  split_all: 'ต้องเหลืออย่างน้อยหนึ่งรายการในบิลเดิม ถ้าจะย้ายทั้งบิลให้ใช้ย้ายโต๊ะ',
  same_order: 'เลือกบิลของโต๊ะอื่น',
  table_not_found: 'ไม่พบโต๊ะนี้',
  prep_cycle: 'สูตรย่อยใส่ตัวเอง (หรือสูตรที่ใช้ตัวมันอยู่) เป็นส่วนผสมไม่ได้',
  prep_not_purchasable: 'สูตรย่อยทำเองในร้าน รับของเข้าไม่ได้ ให้รับส่วนผสมแทน',
  has_stock: 'วัตถุดิบนี้ยังมีสต็อกคงเหลือ เปลี่ยนเป็นสูตรย่อยไม่ได้',
  batch_yield_required: 'ใส่ปริมาณที่ทำได้ต่อชุด',
  duplicate_ingredient: 'มีส่วนผสมซ้ำกัน',
  login_locked: 'ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อก 15 นาที',
  invalid_code: 'รหัสไม่ถูกต้อง ลองรหัสใหม่จากแอป',
  challenge_expired: 'หมดเวลายืนยันตัวตน เข้าสู่ระบบใหม่อีกครั้ง',
  totp_already_enabled: 'เปิดใช้แอปยืนยันตัวตนอยู่แล้ว',
  totp_not_enabled: 'ยังไม่ได้เปิดใช้แอปยืนยันตัวตน',
  no_password: 'พนักงานที่เข้าด้วย PIN ไม่ต้องใช้แอปยืนยันตัวตน',
  invalid_image: 'ไฟล์ต้องเป็นรูป JPEG, PNG หรือ WebP',
  option_required: 'ยังไม่ได้เลือกตัวเลือกที่บังคับ',
  option_too_many: 'เลือกตัวเลือกเกินจำนวนที่กำหนด',
  bad_option: 'ตัวเลือกนี้ใช้กับเมนูนี้ไม่ได้ (อาจถูกปิดไปแล้ว) ลองเลือกใหม่',
  customer_exists: 'มีลูกค้าเลขผู้เสียภาษีและสาขานี้อยู่แล้ว',
  printer_not_found: 'ไม่พบเครื่องพิมพ์นี้ หรือถูกปิดใช้',
};

/** Codes whose server message carries a number the person needs (tries left, minutes to wait). */
function detail(code: string, message?: string): string | null {
  const n = message?.match(/\d+/)?.[0];
  if (!n) return null;
  if (code === 'invalid_pin') return `PIN ไม่ถูกต้อง เหลืออีก ${n} ครั้ง`;
  if (code === 'pin_locked') return `ใส่ PIN ผิด 5 ครั้ง ลองใหม่ได้ใน ${n} นาที`;
  return null;
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.error ?? 'error';
    if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth/')) {
      // Registered tills go back to the PIN screen; it falls through to /login on other devices.
      window.location.href = '/pin';
    }
    throw new ApiError(res.status, code, detail(code, data?.message) ?? MESSAGES[code] ?? data?.message ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  }
  return data as T;
}

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');

/** Shrink a photo in the browser (longest side 800px, JPEG) so uploads stay small and fast on shop Wi-Fi. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('encode'))), 'image/jpeg', 0.85));
}

export async function uploadMenuImage(itemId: string, file: File): Promise<{ id: string; image_url: string }> {
  const blob = await shrink(file).catch(() => { throw new ApiError(415, 'invalid_image', MESSAGES.invalid_image!); });
  const res = await fetch(`/api/menu/items/${itemId}/image`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', MESSAGES[data?.error] ?? data?.message ?? 'อัปโหลดรูปไม่สำเร็จ');
  return data;
}
