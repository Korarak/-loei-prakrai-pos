# Deploy ขึ้น VPS (เครื่องเดียวกับ banrukrot.com)

กฎและรหัสผ่านอยู่ใน `vps-handoff-pos.local.md` (ไม่อยู่ใน git) อ่านก่อนทุกครั้ง สรุปกฎที่ไฟล์ในโฟลเดอร์นี้ทำตามแล้ว:

- ทุก service ชื่อขึ้นต้น `pos-` · compose project ชื่อ `pos` · ไม่มี `ports:` เลย
- memory limit รวม 1.1 GB (db 512M · backend 256M · frontend 256M · backup 128M) · log rotation 10m × 3
- มีแค่ `pos-frontend` ที่เข้า network `loei-banrakrod_default` ของ Nginx Proxy Manager
  API อยู่ใน network ภายในเท่านั้น หน้าเว็บ proxy `/api/*` ไปหา `pos-backend:4000` เอง
- API รัน migration ทุกครั้งที่ container เริ่ม แล้วจึงเปิดรับ request
- `pos-backup` ทำ `pg_dump` วันละครั้ง เก็บ 14 วันใน `/home/deploy/pos/backups` (ยังอยู่เครื่องเดียวกัน ต้องคัดลอกออกนอกเครื่องเอง)

## ครั้งแรก

1. เช็คเครื่อง: `ssh deploy@<VPS> "free -h; df -h /; docker ps"`
2. ชี้ DNS ของโดเมน POS มาที่ IP ของ VPS
3. บน VPS: `mkdir -p ~/pos/backups && cd ~/pos` แล้วสร้าง `.env` (`chmod 600 .env`) ด้วยค่าใหม่ทั้งหมด

   ```
   POS_DB_PASSWORD=<openssl rand -hex 24>
   APP_DB_PASSWORD=<openssl rand -hex 24>
   JWT_SECRET=<openssl rand -hex 48>
   ```

   ใช้ค่า hex เท่านั้น (อยู่ใน URL ของฐานข้อมูล อักขระพิเศษจะทำให้ต่อไม่ติด)
4. ตั้ง GitHub secrets ของ repo นี้: `SERVER_SSH_HOST` `SERVER_SSH_PORT` `SERVER_SSH_USERNAME` `SERVER_SSH_KEY`
   `REGISTRY_URL` `REGISTRY_USERNAME` `REGISTRY_PASSWORD` (ค่าอยู่ในไฟล์ handoff ข้อ 6)
5. push `main` → workflow `Build and Deploy POS` จะ test → build → push image → ssh ไป `docker compose pull && up -d`
6. `docker ps` บน VPS: `pos-*` ต้อง Up และ `loei-banrakrod-*` ต้องยัง Up เหมือนเดิม
7. Nginx Proxy Manager → Proxy Host ใหม่: โดเมน POS → `pos-frontend` port `3000`, เปิด Websockets, ขอ SSL (Let's Encrypt), Force SSL
8. smoke test โดเมน POS แล้ว **เช็ค banrukrot.com ซ้ำ**: `curl -s https://banrukrot.com/api/status`
9. `docker stats --no-stream` ดูว่ารวมแล้ว RAM ไม่ใกล้เต็ม

## ทดสอบบนเครื่องตัวเองก่อน push

```bash
docker build -f apps/api/Dockerfile -t pos-backend:smoke .
docker build -f apps/web/Dockerfile -t pos-frontend:smoke .
docker network create loei-banrakrod_default        # แทน network ของ NPM (เฉพาะเครื่องตัวเอง)
# ใน scratch folder: คัดลอก docker-compose.yml + .env ทดสอบ + override ที่ชี้ image :smoke และเปิด 127.0.0.1:3100:3000
docker compose -p pos-smoke -f docker-compose.yml -f override.yml up -d --wait
docker compose -p pos-smoke -f docker-compose.yml -f override.yml down -v && docker network rm loei-banrakrod_default
```

## กู้ข้อมูลจาก backup

```bash
cd ~/pos
docker compose stop pos-backend pos-frontend
docker exec -i pos-db pg_restore -U postgres -d prakai --clean --if-exists < backups/prakai-YYYY-MM-DD.dump
docker compose start pos-backend pos-frontend
```
