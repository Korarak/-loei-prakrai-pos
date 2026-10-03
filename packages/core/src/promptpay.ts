import type { Satang } from './money.ts';

/** PromptPay account: a 10-digit mobile number or a 13-digit tax / national ID. */
export const isValidPromptPayId = (id: string) => /^(\d{10}|\d{13})$/.test(id.replace(/[\s-]/g, ''));

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as EMVCo requires for tag 63. */
export function crc16(s: string): string {
  let crc = 0xffff;
  // The payload is ASCII, so each char code is one byte (and core must run in the browser: no Buffer).
  for (let k = 0; k < s.length; k++) {
    crc ^= s.charCodeAt(k) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Thai QR Payment (PromptPay) payload. With an amount it is a one-time QR (point of initiation 12)
 * that fills the amount in the customer's banking app; without one, a static QR (11).
 */
export function promptPayPayload(id: string, amount?: Satang): string {
  const clean = id.replace(/[\s-]/g, '');
  if (!isValidPromptPayId(clean)) throw new RangeError('PromptPay ID must be a 10-digit phone or 13-digit ID');
  // A mobile number is sent as 0066 + the number without its leading 0.
  const account = clean.length === 10 ? tlv('01', `0066${clean.slice(1)}`) : tlv('02', clean);
  const body = [
    tlv('00', '01'),
    tlv('01', amount === undefined ? '11' : '12'),
    tlv('29', tlv('00', 'A000000677010111') + account),
    tlv('53', '764'),
    amount === undefined ? '' : tlv('54', (amount / 100).toFixed(2)),
    tlv('58', 'TH'),
  ].join('') + '6304';
  return body + crc16(body);
}
