# Deploy Checklist (ชั่วคราว — ลบได้หลัง deploy เสร็จ)

สถานะ: commit แล้ว 4 commits (`fbf87be`, `ee98146`, `9501559`, `c68ff39`) · **ยังไม่ได้ push**
หมายเหตุ: push `main` = ทริกเกอร์ workflow `Build and Deploy POS` ทันที (test → build → deploy)

## ตรวจแล้ว
- [x] ไม่มีความลับใน commit (`.env.example` มีแต่ placeholder, `*.local.md` ถูก ignore)
- [x] typecheck ผ่านทั้ง core / api / web
- [x] core test ผ่าน 24/24
- [x] API test ผ่าน 115/115 ในเครื่อง (รวมตัวเลือกเมนูและสมุดลูกค้า) · CI จะรันซ้ำก่อน build

## ก่อน push
- [ ] ตั้ง GitHub secrets: `SERVER_SSH_HOST` `SERVER_SSH_PORT` `SERVER_SSH_USERNAME` `SERVER_SSH_KEY`
      `REGISTRY_URL` `REGISTRY_USERNAME` `REGISTRY_PASSWORD` (ค่าอยู่ใน `vps-handoff-pos.local.md`)
- [ ] เช็คเครื่อง VPS: `ssh deploy@<VPS> "free -h; df -h /; docker ps"`
- [ ] บน VPS: `mkdir -p ~/pos/backups` แล้วสร้าง `~/pos/.env` (`chmod 600`) ใช้ค่า hex เท่านั้น
  ```
  POS_DB_PASSWORD=<openssl rand -hex 24>
  APP_DB_PASSWORD=<openssl rand -hex 24>
  JWT_SECRET=<openssl rand -hex 48>
  PLATFORM_ADMIN_EMAILS=<your email, comma separated; empty = nobody can open /platform>
  ```
- [ ] ชี้ DNS โดเมน POS มาที่ IP ของ VPS
- [ ] (ทางเลือก) ลอง build ในเครื่องก่อน:
  ```bash
  docker build -f apps/api/Dockerfile -t pos-backend:smoke .
  docker build -f apps/web/Dockerfile -t pos-frontend:smoke .
  ```

## Deploy
- [ ] `git push origin main`
- [ ] ดู GitHub Actions ให้ผ่านครบ 3 job
- [ ] บน VPS `docker ps`: `pos-*` ต้อง Up และ `loei-banrakrod-*` ต้องยัง Up เหมือนเดิม
- [ ] Nginx Proxy Manager → Proxy Host ใหม่: โดเมน POS → `pos-frontend` port `3000`, เปิด Websockets, SSL (Let's Encrypt), Force SSL

## หลัง deploy
- [ ] smoke test โดเมน POS (login, เปิดโต๊ะ, ชำระเงิน, ใบเสร็จ)
- [ ] **เช็ค banrukrot.com ซ้ำ**: `curl -s https://banrukrot.com/api/status`
- [ ] `docker stats --no-stream` ดู RAM รวม
- [ ] คัดลอก backup ออกนอกเครื่อง (`~/pos/backups` อยู่เครื่องเดียวกับ VPS)

## กู้ข้อมูล (ถ้าจำเป็น)
```bash
cd ~/pos
docker compose stop pos-backend pos-frontend
docker exec -i pos-db pg_restore -U postgres -d prakai --clean --if-exists < backups/prakai-YYYY-MM-DD.dump
docker compose start pos-backend pos-frontend
```
