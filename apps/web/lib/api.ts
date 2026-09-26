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
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  manager_required: 'ต้องให้ผู้จัดการอนุมัติ',
  table_busy: 'โต๊ะนี้มีบิลเปิดอยู่แล้ว',
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
  use_credit_note: 'เอกสารของวันก่อนต้องแก้ด้วยใบลดหนี้',
};

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
      window.location.href = '/login';
    }
    throw new ApiError(res.status, code, MESSAGES[code] ?? data?.message ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  }
  return data as T;
}

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
