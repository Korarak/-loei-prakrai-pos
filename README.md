# prakai-pos

ระบบขายหน้าร้านสำหรับร้านอาหาร คิดต้นทุนต่อจาน และออกเอกสารภาษีตามกฎหมายไทย (VAT 7%, ใบกำกับภาษีอย่างย่อ/เต็มรูป)
ตั้งชื่อตามคุณประกายดาว ผลสอน

| โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `packages/core` | คำนวณบิล VAT service charge ปัดเศษ ต้นทุนสูตร ต้นทุนเฉลี่ย เลขผู้เสียภาษี (pure TS + tests) |
| `apps/api` | Fastify + PostgreSQL (RLS แยกข้อมูลแต่ละร้าน, เอกสารภาษีแก้/ลบไม่ได้, audit log แบบ hash chain) |
| `apps/web` | Next.js หน้าขาย ผังโต๊ะ ชำระเงิน ใบเสร็จ หลังบ้าน |

## เริ่มพัฒนา

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL ที่ 127.0.0.1:5433
cp apps/api/.env.example apps/api/.env           # แล้วเปลี่ยน JWT_SECRET
npm install
npm run migrate -w @prakai/api
npm run dev -w @prakai/api                       # API :4000
npm run dev -w @prakai/web                       # เว็บ :3000 (proxy /api → :4000)
```

## ทดสอบ

```bash
npm test          # core unit tests + API integration tests (ต้องเปิด Postgres ก่อน)
npm run typecheck
```

ไฟล์ `vps-handoff-pos.local.md` มีรหัสผ่านจริง อยู่ใน `.gitignore` ห้าม commit
