# 🌐 Deploy ARC & ARCWEB ke Custom Domains (arc.ar-cargo.com, www.ar-cargo.com)

Dokumentasi migrasi + operasi harian setelah setup selesai. Deployment ini menggunakan `lobby-nginx` (Docker container) sebagai reverse proxy untuk 4+ aplikasi (LuxOptic, HRIS, ARC, OCS) — tanpa merusak salah satu.

---

## 📋 Arsitektur Akhir

```
Internet
  │
  ├── https://arc.ar-cargo.com        → ARC TMS (React SPA + /api proxy)
  ├── https://www.ar-cargo.com        → ARCWEB Public Tracking
  ├── https://ar-cargo.com            → ARCWEB (sama)
  └── https://app.luxoptic.id/{app}   → Existing 4 apps
       │
       └── lobby-nginx (Docker :80/:443)
             │
             ├── /usr/share/nginx/html/arc/          ← ARC build
             ├── /usr/share/nginx/html/arc/arcweb/   ← ARCWEB build
             ├── /usr/share/nginx/html/luxoptic/, hris/, ocs/
             └── proxy_pass → arc-backend-1:8000, luxoptic-backend-1, hris-backend
```

**Cert Path**: `/etc/letsencrypt/live/ar-cargo.com/` covers 3 domains (SAN cert).

---

## 🔑 File Kritis (JANGAN Overwrite!)

| File | Deskripsi | Aturan |
|------|-----------|--------|
| `/etc/lobby-nginx/default.conf` | Config nginx untuk 4+ apps | **APPEND ONLY**, backup dulu |
| `/etc/letsencrypt/` | SSL certs & renewal config | Auto-managed oleh certbot |
| `/etc/letsencrypt/renewal-hooks/deploy/reload-lobby-nginx.sh` | Reload hook | Sudah setup |

---

## 🔄 Redeploy ARC (Common)

```bash
cd ~/ARC/frontend
git pull

# Env harus point ke domain baru
grep REACT_APP_BACKEND_URL .env
# Expected: REACT_APP_BACKEND_URL=https://arc.ar-cargo.com

npm install
npm run build

# Deploy (backup old dulu)
sudo mv /usr/share/nginx/html/arc /usr/share/nginx/html/arc.backup-$(date +%Y%m%d-%H%M%S)
sudo cp -r build /usr/share/nginx/html/arc
sudo chmod -R 755 /usr/share/nginx/html/arc

# Reload nginx tidak wajib (static file baru langsung ke-serve)
```

## 🔄 Redeploy ARCWEB

```bash
cd ~/ARC/arcweb
git pull

grep REACT_APP_BACKEND_URL .env
# Expected: REACT_APP_BACKEND_URL=https://www.ar-cargo.com

npm install
npm run build

sudo mv /usr/share/nginx/html/arc/arcweb /usr/share/nginx/html/arc/arcweb.old-$(date +%Y%m%d-%H%M%S)
sudo cp -r build /usr/share/nginx/html/arc/arcweb
sudo chmod -R 755 /usr/share/nginx/html/arc/arcweb
```

## 🔄 Redeploy Backend

```bash
cd ~/ARC/backend
docker restart arc-backend-1
docker logs arc-backend-1 --tail 30
```

---

## 🔐 SSL Certificate Auto-Renewal

Sudah aktif via `certbot.timer`. Manual test:

```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer
```

Setelah renewal otomatis, hook `reload-lobby-nginx.sh` akan trigger `nginx -s reload`.

**Manual renewal (kalau butuh):**
```bash
sudo certbot renew
```

---

## 🩺 Troubleshooting

### Site down / 502 Bad Gateway
```bash
# Cek container status
docker ps | grep -E "lobby|arc-backend|luxoptic|hris"

# Cek nginx logs
docker logs lobby-nginx --tail 50

# Cek backend logs
docker logs arc-backend-1 --tail 50

# Restart nginx (safe)
docker exec lobby-nginx nginx -s reload
```

### Cert expired / SSL error
```bash
# Cek cert expiry
echo | openssl s_client -servername arc.ar-cargo.com -connect arc.ar-cargo.com:443 2>/dev/null | openssl x509 -noout -dates

# Force renewal
sudo certbot renew --force-renewal
docker exec lobby-nginx nginx -s reload
```

### Nginx config broken setelah edit
```bash
# Validate
docker exec lobby-nginx nginx -t

# Kalau ERROR, restore backup terbaru
ls -t /etc/lobby-nginx/*.backup* | head -1
# Copy backup kembali ke default.conf, lalu reload
```

### Frontend tidak update setelah deploy
```bash
# Clear browser cache atau hard-refresh (Ctrl+Shift+R)
# Cek file hash di build:
ls /usr/share/nginx/html/arc/static/js/ | grep main
```

### Existing apps (LuxOptic/HRIS/OCS) broken setelah deploy
Ini seharusnya TIDAK terjadi karena config di-APPEND. Kalau terjadi:
```bash
# Restore default.conf dari backup
sudo cp /etc/lobby-nginx/default.conf.backup-YYYYMMDD-HHMMSS /etc/lobby-nginx/default.conf
docker exec lobby-nginx nginx -s reload
```

---

## 📊 Health Check Script

Simpan sebagai `~/check-arc-health.sh`:

```bash
#!/bin/bash
echo "=== HTTPS Domain ==="
for host in arc.ar-cargo.com www.ar-cargo.com ar-cargo.com; do
    C=$(curl -sI -o /dev/null -w "%{http_code}" https://$host/)
    echo "$host → $C"
done

echo ""
echo "=== Existing Apps ==="
for URL in luxoptic arc hris ocs; do
    C=$(curl -sL -o /dev/null -w "%{http_code}" http://app.luxoptic.id/$URL/)
    echo "app.luxoptic.id/$URL/ → $C"
done

echo ""
echo "=== SSL Expiry ==="
echo | openssl s_client -servername arc.ar-cargo.com -connect arc.ar-cargo.com:443 2>/dev/null | openssl x509 -noout -dates

echo ""
echo "=== Containers ==="
docker ps --format "{{.Names}} → {{.Status}}" | grep -E "lobby|arc-backend|luxoptic|hris"
```

Jalankan tiap kali suspicious: `bash ~/check-arc-health.sh`

---

## 🎯 Rollback Plan

Kalau ada masalah besar, rollback dalam < 2 menit:

```bash
# 1. Restore nginx config
sudo cp /etc/lobby-nginx/default.conf.backup-<LATEST> /etc/lobby-nginx/default.conf
docker exec lobby-nginx nginx -s reload

# 2. Restore frontend (kalau perlu)
sudo rm -rf /usr/share/nginx/html/arc
sudo mv /usr/share/nginx/html/arc.backup-<LATEST> /usr/share/nginx/html/arc

# 3. Verify
curl -sI https://arc.ar-cargo.com/
```
