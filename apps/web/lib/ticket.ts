'use client';

/**
 * Tickets for thermal printers, drawn on a canvas with the page's own Thai font and sent as a 1-bit
 * bitmap (ESC/POS raster). Printing Thai as text on code page 874 misplaces floating vowels and tone
 * marks, so we never send text to the printer.
 */
export type TicketLine =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; size?: number; bold?: boolean }
  | { t: 'row'; left: string; right: string; size?: number; bold?: boolean }
  | { t: 'item'; qty: string; name: string; sub?: string; amount?: string; size?: number; bold?: boolean }
  | { t: 'hr'; thick?: boolean }
  | { t: 'gap'; px: number };

export interface Bitmap { width: number; height: number; bits: Uint8Array }

const BASE = 24;          // font px at 576 dots (80 mm); scaled down for 58 mm paper
const PAD = 6;
const LEADING = 1.4;

/** Split into words where Thai allows a break (no spaces in Thai), so lines wrap like a person would. */
function words(s: string): string[] {
  const Seg = (Intl as any).Segmenter;
  if (!Seg) return [...s];
  return [...new Seg('th', { granularity: 'word' }).segment(s)].map((x: any) => x.segment);
}

function wrap(ctx: CanvasRenderingContext2D, s: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of words(s)) {
    if (cur && ctx.measureText(cur + w).width > max) { out.push(cur.trimEnd()); cur = w.trimStart(); }
    else cur += w;
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

/** Lay out and draw; with `ctx` only measuring (height), with a sized canvas actually painting. */
function layout(ctx: CanvasRenderingContext2D, lines: TicketLine[], width: number, family: string, paint: boolean): number {
  const k = width / 576;
  const inner = width - PAD * 2;
  let y = PAD;
  const font = (size: number, bold?: boolean) => { ctx.font = `${bold ? 700 : 400} ${Math.round(size * k)}px ${family}`; return Math.round(size * k * LEADING); };
  const draw = (s: string, x: number, lh: number, align: CanvasTextAlign = 'left') => {
    if (!paint) return;
    ctx.textAlign = align;
    ctx.fillText(s, x, y + lh * 0.78);
  };
  for (const l of lines) {
    if (l.t === 'gap') { y += Math.round(l.px * k); continue; }
    if (l.t === 'hr') {
      const h = l.thick ? 3 : 2;
      if (paint) {
        if (l.thick) ctx.fillRect(PAD, y + 4, inner, h);
        else for (let x = PAD; x < width - PAD; x += 10) ctx.fillRect(x, y + 4, 6, h);
      }
      y += 12;
      continue;
    }
    const lh = font(l.size ?? BASE, l.bold);
    if (l.t === 'text') {
      const x = l.align === 'center' ? width / 2 : l.align === 'right' ? width - PAD : PAD;
      for (const s of wrap(ctx, l.text, inner)) { draw(s, x, lh, l.align ?? 'left'); y += lh; }
    } else if (l.t === 'row') {
      const rw = ctx.measureText(l.right).width;
      const rows = wrap(ctx, l.left, inner - rw - 12 * k);
      rows.forEach((s, i) => { draw(s, PAD, lh); if (i === 0) draw(l.right, width - PAD, lh, 'right'); y += lh; });
    } else {
      const qw = Math.round(44 * k);
      const aw = l.amount ? ctx.measureText(l.amount).width + 12 * k : 0;
      draw(l.qty, PAD, lh);
      if (l.amount) draw(l.amount, width - PAD, lh, 'right');
      for (const s of wrap(ctx, l.name, inner - qw - aw)) { draw(s, PAD + qw, lh); y += lh; }
      if (l.sub) {
        const sh = font((l.size ?? BASE) * 0.85);
        for (const s of wrap(ctx, l.sub, inner - qw)) { draw(s, PAD + qw, sh); y += sh; }
      }
    }
  }
  return y + PAD;
}

/** Render ticket lines to a 1-bit bitmap `width` dots wide (576 = 80 mm, 384 = 58 mm). */
export async function renderTicket(lines: TicketLine[], width: number): Promise<Bitmap> {
  await document.fonts?.ready;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 10;
  const height = layout(canvas.getContext('2d')!, lines, width, family, false);
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  layout(ctx, lines, width, family, true);

  const px = ctx.getImageData(0, 0, width, height).data;
  const row = Math.ceil(width / 8);
  const bits = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Slightly generous threshold keeps thin Thai strokes and tone marks from breaking up.
      if (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114 < 150) {
        const j = y * row + (x >> 3);
        bits[j] = bits[j]! | (0x80 >> (x & 7));
      }
    }
  }
  return { width, height, bits };
}

export function toBase64(bits: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bits.length; i += 0x8000) s += String.fromCharCode(...bits.subarray(i, i + 0x8000));
  return btoa(s);
}
