#!/usr/bin/env node
// prakai-pos print agent — runs on a PC in the shop that can reach the LAN printers.
// It polls the POS server for print jobs over HTTPS (nothing needs to be opened on the router)
// and sends each ticket to its printer as ESC/POS raster on port 9100. Needs Node 18+, no packages.
//
//   node print-agent.mjs --server https://pos.example.com --token pa_xxxxx
//   node print-agent.mjs --test 192.168.1.50    # print a test page straight to a printer
//
// The server and token may also come from PRAKAI_SERVER and PRAKAI_AGENT_TOKEN.
import net from 'node:net';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

const POLL_MS = 2000;
const BAND = 128;                  // rows per GS v 0 block; small bands suit printers with little buffer
const SOCKET_TIMEOUT_MS = 8000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** 1-bit bitmap → ESC/POS: init, optional drawer kick, raster bands, feed, partial cut. */
export function escpos({ width, height, bitmap, kickDrawer }) {
  const row = Math.ceil(width / 8);
  const parts = [Buffer.from([0x1b, 0x40])];
  if (kickDrawer) parts.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  for (let y = 0; y < height; y += BAND) {
    const h = Math.min(BAND, height - y);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, row & 0xff, row >> 8, h & 0xff, h >> 8]));
    parts.push(bitmap.subarray(y * row, (y + h) * row));
  }
  parts.push(Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}

export function send(host, port, data) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    s.setTimeout(SOCKET_TIMEOUT_MS);
    s.on('timeout', () => { s.destroy(); reject(new Error(`เครื่องพิมพ์ ${host}:${port} ไม่ตอบ`)); });
    s.on('error', (e) => reject(new Error(`ต่อเครื่องพิมพ์ ${host}:${port} ไม่ได้ (${e.code ?? e.message})`)));
    s.on('connect', () => s.end(data, () => { setTimeout(() => s.destroy(), 300); resolve(); }));
  });
}

/** Test page without the server: a solid bar and a checker strip (raster), then plain ASCII text. */
async function testPage(target) {
  const [host, port = '9100'] = target.split(':');
  const width = 576, height = 96, row = width / 8;
  const bitmap = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < row; x++) bitmap[y * row + x] = y < 48 ? 0xff : ((Math.floor(y / 8) + x) % 2 ? 0xff : 0x00);
  }
  const text = Buffer.from(`\nprakai-pos print agent OK\n${host}:${port}  ${new Date().toISOString()}\nfrom ${hostname()}\n`, 'ascii');
  const job = escpos({ width, height, bitmap, kickDrawer: false });
  await send(host, Number(port), Buffer.concat([job.subarray(0, job.length - 7), text, job.subarray(job.length - 7)]));
  console.log(`sent test page to ${host}:${port}`);
}

async function run(server, token) {
  const base = server.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let quietSince = 0;
  console.log(`prakai print agent → ${base}`);
  for (;;) {
    let jobs = [];
    try {
      const r = await fetch(`${base}/api/agent/jobs`, { headers });
      if (r.status === 401) { console.error('token ใช้ไม่ได้ (ถูกยกเลิกหรือพิมพ์ผิด) — สร้าง token ใหม่ในหน้าตั้งค่าร้าน'); process.exit(1); }
      if (!r.ok) throw new Error(`server ${r.status}`);
      ({ jobs } = await r.json());
      if (quietSince) { console.log('เชื่อมต่อ server ได้อีกครั้ง'); quietSince = 0; }
    } catch (e) {
      if (!quietSince) { console.error(`ติดต่อ server ไม่ได้: ${e.message} — จะลองใหม่เรื่อย ๆ`); quietSince = Date.now(); }
      await new Promise((r) => setTimeout(r, POLL_MS * 3));
      continue;
    }
    for (const j of jobs) {
      let result;
      try {
        await send(j.host, j.port, escpos({ ...j, bitmap: Buffer.from(j.bitmap, 'base64') }));
        result = { ok: true };
        console.log(`${new Date().toLocaleTimeString()} พิมพ์แล้ว → ${j.host}`);
      } catch (e) {
        result = { ok: false, error: e.message };
        console.error(`${new Date().toLocaleTimeString()} ${e.message}`);
      }
      await fetch(`${base}/api/agent/jobs/${j.id}`, { method: 'POST', headers, body: JSON.stringify(result) }).catch(() => {});
    }
    if (jobs.length === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const test = arg('test');
  if (test) await testPage(test);
  else {
    const server = arg('server') ?? process.env.PRAKAI_SERVER;
    const token = arg('token') ?? process.env.PRAKAI_AGENT_TOKEN;
    if (!server || !token) {
      console.error('ใช้: node print-agent.mjs --server https://<โดเมนร้าน> --token pa_...   (หรือ --test <IP เครื่องพิมพ์>)');
      process.exit(2);
    }
    await run(server, token);
  }
}
