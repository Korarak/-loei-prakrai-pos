'use client';

import { formatBaht, formatBranch } from '@prakai/core';
import { useEffect, useState } from 'react';
import { api } from './api';
import { renderTicket, toBase64, type TicketLine } from './ticket';

export interface Printer {
  id: string; name: string; host: string; port: number; width_px: 384 | 576; role: 'receipt' | 'kitchen' | 'bar';
  terminal_id: string | null; kick_drawer: boolean; active: boolean;
}
export interface PrinterList { printers: Printer[]; agentLastSeen: string | null; agents: number }

export function usePrinters() {
  const [list, setList] = useState<PrinterList | null>(null);
  const reload = () => api<PrinterList>('GET', '/api/printers').then(setList).catch(() => setList({ printers: [], agentLastSeen: null, agents: 0 }));
  useEffect(() => { reload(); }, []);
  return { list, reload };
}

/** The till's own receipt printer, else one shared by all tills. */
export const receiptPrinterFor = (ps: Printer[], terminalId: string | null | undefined) =>
  ps.find((p) => p.active && p.role === 'receipt' && p.terminal_id === terminalId) ?? ps.find((p) => p.active && p.role === 'receipt' && !p.terminal_id);

export const stationPrinter = (ps: Printer[], station: string) => ps.find((p) => p.active && p.role === (station === 'bar' ? 'bar' : 'kitchen'))
  ?? ps.find((p) => p.active && p.role === 'kitchen');

/** An agent that polled in the last half minute is taking jobs right now. */
export const agentOnline = (l: PrinterList | null) => !!l?.agentLastSeen && Date.now() - new Date(l.agentLastSeen).getTime() < 30_000;

export type PrintResult = { status: 'done' } | { status: 'failed'; error: string } | { status: 'waiting' };

/** Queue a ticket and wait until the shop's print agent reports back (or give up waiting after `waitMs`). */
export async function printTicket(printer: Printer, kind: 'receipt' | 'kitchen' | 'test', lines: TicketLine[],
  opts: { kickDrawer?: boolean; waitMs?: number } = {}): Promise<PrintResult> {
  const bmp = await renderTicket(lines, printer.width_px);
  const job = await api<{ id: string }>('POST', '/api/print-jobs', {
    printerId: printer.id, kind, width: bmp.width, height: bmp.height, bitmap: toBase64(bmp.bits), kickDrawer: !!opts.kickDrawer,
  });
  const until = Date.now() + (opts.waitMs ?? 12_000);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 700));
    const j = await api<{ status: string; error: string | null }>('GET', `/api/print-jobs/${job.id}`);
    if (j.status === 'done') return { status: 'done' };
    if (j.status === 'failed') return { status: 'failed', error: j.error ?? 'พิมพ์ไม่สำเร็จ' };
  }
  return { status: 'waiting' };
}

// ---------- ticket content ----------

const TITLE: Record<string, [string, string]> = {
  ABB: ['ใบกำกับภาษีอย่างย่อ', 'TAX INVOICE (ABB)'],
  FULL: ['ใบกำกับภาษี / ใบเสร็จรับเงิน', 'TAX INVOICE / RECEIPT'],
  RECEIPT: ['ใบเสร็จรับเงิน', 'RECEIPT'],
  CN: ['ใบลดหนี้', 'CREDIT NOTE'],
};
const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน' };

export function thaiDateTime(iso: string) {
  const p = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

/** The same content as the on-screen receipt (/receipt/[id]), as printer lines. */
export function receiptLines(d: any, change = 0, copy = false): TicketLine[] {
  const [th, en] = TITLE[d.doc_type]!;
  const isTax = d.doc_type !== 'RECEIPT';
  const L: TicketLine[] = [
    { t: 'text', text: d.seller.shopName, align: 'center', size: 30, bold: true },
  ];
  if (d.seller.name !== d.seller.shopName) L.push({ t: 'text', text: d.seller.name, align: 'center' });
  if (d.seller.address) L.push({ t: 'text', text: d.seller.address, align: 'center' });
  if (isTax) {
    L.push({ t: 'text', text: `เลขประจำตัวผู้เสียภาษี ${d.seller.taxId}`, align: 'center' });
    L.push({ t: 'text', text: `${formatBranch(d.seller.branchCode)}${d.seller.rdPosId ? ` · POS ID ${d.seller.rdPosId}` : ''}`, align: 'center' });
  }
  L.push({ t: 'hr' }, { t: 'text', text: th, align: 'center', size: 28, bold: true }, { t: 'text', text: en, align: 'center', bold: true });
  if (copy) L.push({ t: 'text', text: '(สำเนา)', align: 'center' });
  if (d.status === 'void') L.push({ t: 'text', text: `*** ยกเลิกแล้ว: ${d.void_reason} ***`, align: 'center', bold: true });
  L.push({ t: 'row', left: 'เลขที่', right: d.doc_no }, { t: 'row', left: 'วันที่', right: thaiDateTime(d.issued_at) });
  if (d.doc_type === 'CN' && d.credits) {
    L.push({ t: 'hr' },
      { t: 'row', left: 'อ้างถึงเอกสาร', right: d.credits.doc_no },
      { t: 'row', left: 'ลงวันที่', right: thaiDateTime(d.credits.issued_at) },
      { t: 'row', left: 'มูลค่าตามเอกสารเดิม', right: formatBaht(d.credits.total) },
      { t: 'row', left: 'มูลค่าที่ถูกต้อง', right: formatBaht(d.credits.corrected_total) },
      { t: 'row', left: 'ผลต่าง', right: formatBaht(d.total) },
      { t: 'text', text: `เหตุผล: ${d.reason}` });
  }
  if (d.buyer_name) {
    L.push({ t: 'hr' }, { t: 'text', text: `ผู้ซื้อ ${d.buyer_name}`, bold: true },
      { t: 'text', text: `เลขประจำตัวผู้เสียภาษี ${d.buyer_tax_id} · ${formatBranch(d.buyer_branch)}` },
      { t: 'text', text: d.buyer_address });
  }
  L.push({ t: 'hr' });
  for (const l of d.lines) L.push({ t: 'item', qty: String(l.qty), name: l.name, sub: `@ ${formatBaht(l.unitPrice)}`, amount: formatBaht(l.gross) });
  L.push({ t: 'hr' });
  if (d.discount > 0) L.push({ t: 'row', left: 'ส่วนลด', right: `-${formatBaht(d.discount)}` });
  if (d.service_charge > 0) L.push({ t: 'row', left: 'ค่าบริการ', right: formatBaht(d.service_charge) });
  L.push({ t: 'row', left: d.doc_type === 'CN' ? 'ลดหนี้รวมทั้งสิ้น' : 'รวมทั้งสิ้น', right: formatBaht(d.total), size: 32, bold: true });
  if (d.doc_type === 'ABB') L.push({ t: 'text', text: 'ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT INCLUDED)', align: 'right', bold: true });
  if (isTax) {
    L.push({ t: 'row', left: 'มูลค่าสินค้า/บริการ', right: formatBaht(d.vatable_base + d.service_charge) });
    if (d.exempt_base > 0) L.push({ t: 'row', left: 'สินค้ายกเว้น VAT', right: formatBaht(d.exempt_base) });
    L.push({ t: 'row', left: `ภาษีมูลค่าเพิ่ม${d.doc_type === 'CN' ? 'ของผลต่าง' : ''} ${d.vat_rate_bp / 100}%`, right: formatBaht(d.vat) });
  }
  if (d.rounding !== 0) L.push({ t: 'row', left: 'ปัดเศษ', right: formatBaht(d.rounding) });
  if (d.payments?.length) {
    L.push({ t: 'hr' });
    for (const p of d.payments) L.push({ t: 'row', left: METHOD[p.method] ?? p.method, right: formatBaht(p.tendered ?? p.amount) });
    if (change > 0) L.push({ t: 'row', left: 'เงินทอน', right: formatBaht(change), bold: true });
  }
  L.push({ t: 'hr' });
  if (d.doc_type === 'ABB') L.push({ t: 'text', text: 'ต้องการใบกำกับภาษีเต็มรูป กรุณาแจ้งแคชเชียร์', align: 'center' });
  if (d.doc_type !== 'CN') L.push({ t: 'gap', px: 6 }, { t: 'text', text: 'ขอบคุณที่อุดหนุน', align: 'center', bold: true });
  return L;
}

/** One kitchen/bar ticket: big table name and quantities so the cook reads it from a step away. */
export function kitchenLines(a: { where: string; station: string; billNo: string | number; guests: number; time: string; reprint: boolean;
  lines: Array<{ qty: number; name: string; note: string | null }> }): TicketLine[] {
  const L: TicketLine[] = [
    { t: 'row', left: a.where, right: a.station, size: 40, bold: true },
    { t: 'text', text: `บิล #${a.billNo} · ${a.guests} ท่าน · ${a.time}${a.reprint ? ' · พิมพ์ซ้ำ' : ''}`, size: 24 },
    { t: 'hr', thick: true },
  ];
  for (const l of a.lines) {
    L.push({ t: 'item', qty: String(l.qty), name: l.name, sub: l.note ? `** ${l.note}` : undefined, size: 32, bold: true }, { t: 'hr' });
  }
  return L;
}
