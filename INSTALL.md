# 🚀 ARC Business Suite — Panduan Instalasi VPS

Panduan ini akan menginstall ARC Business Suite di VPS Anda menggunakan Docker, dari nol sampai siap pakai.

## 📋 Persyaratan VPS

| Komponen | Minimum | Direkomendasikan |
|---|---|---|
| OS | Ubuntu 22.04 / Debian 12 / CentOS Stream 9 | Ubuntu 24.04 LTS |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| Network | Port 80 & 443 open | + Port 22 (SSH) |

**Cloud provider yang cocok:** DigitalOcean, Vultr, Linode, Biznet Gio, Idcloudhost, Niagahoster VPS, AWS Lightsail.

Estimasi biaya: **Rp 100.000 – Rp 250.000 / bulan** untuk VPS sesuai spec ini.

---

## ⚡ Quick Install (15 menit)

### 1. Connect SSH ke VPS

```bash
ssh root@IP_VPS_ANDA
# atau dengan user non-root yang punya sudo
ssh ubuntu@IP_VPS_ANDA
```

### 2. Install Docker + Docker Compose

```bash
# Update & install dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ca-certificates

# Install Docker (official script)
curl -fsSL https://get.docker.com | sudo sh

# Aktifkan auto-start
sudo systemctl enable docker
sudo systemctl start docker

# Test
sudo docker --version
sudo docker compose version
```

> Untuk user non-root yang mau pakai docker tanpa sudo:  
> `sudo usermod -aG docker $USER && newgrp docker`

### 3. Upload Source Code ke VPS

**Opsi A — Via Git (recommended):**
```bash
cd /opt
sudo git clone https://github.com/USERNAME/ARC.git arc
cd arc
sudo chown -R $USER:$USER /opt/arc
```

**Opsi B — Via SCP (kalau code masih di lokal):**
```bash
# Dari komputer lokal Anda:
scp -r /path/to/arc root@IP_VPS:/opt/arc
```

### 4. Setup Environment

```bash
cd /opt/arc
cp .env.example .env

# Generate JWT secret yang random
echo "JWT_SECRET=$(openssl rand -hex 32)" >> /tmp/jwt.txt

# Edit .env — WAJIB ganti semua "CHANGE_ME"
nano .env
```

**Yang harus diubah di `.env`:**

```env
# Domain & port
HTTP_PORT=80
REACT_APP_BACKEND_URL=     # KOSONGKAN (pakai satu domain)

# MongoDB — pakai password yang kuat (min 16 char)
MONGO_ROOT_USER=arc_admin
MONGO_ROOT_PASSWORD=K8x!nP9q@vR3wM2zL5tY    # ← ganti

# JWT secret (copy hasil `openssl rand -hex 32`)
JWT_SECRET=a3f2c9e8b1d4...32-char-hex-string

# User awal yang akan dibuat otomatis
SEED_ADMIN_PASSWORD=AdminKuat2026!@#         # ← ganti
SEED_OPERATION_PASSWORD=OpsKuat2026!@#       # ← ganti
SEED_FINANCE_PASSWORD=FinKuat2026!@#         # ← ganti

# CORS — set ke domain Anda di production
CORS_ORIGINS=https://arc.namadomain.com
```

### 5. Build & Run!

```bash
# Build image (sekitar 3-5 menit, dilakukan sekali saja)
sudo docker compose build

# Start semua service
sudo docker compose up -d

# Cek status
sudo docker compose ps
```

Output normal:
```
NAME           STATUS              PORTS
arc-mongo      Up (healthy)        27017/tcp
arc-backend    Up (healthy)        8001/tcp
arc-frontend   Up (healthy)        0.0.0.0:80->80/tcp
```

### 6. Akses Aplikasi

Buka browser ke **`http://IP_VPS_ANDA`**

Login dengan username/password yang Anda set di `.env` (admin / SEED_ADMIN_PASSWORD).

🎉 **Selesai!**

---

## 🔒 Setup HTTPS (Sangat Disarankan)

### Option A — Caddy (Otomatis, paling mudah)

```bash
# Install Caddy di host (BUKAN di container)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Lalu edit `/etc/caddy/Caddyfile`:
```
arc.namadomain.com {
    reverse_proxy localhost:80
}
```

```bash
# Reload Caddy — otomatis ambil SSL cert dari Let's Encrypt
sudo systemctl reload caddy
```

**Ubah `.env`:**
```env
HTTP_PORT=8080   # supaya tidak bentrok dengan Caddy (yg di 80/443)
CORS_ORIGINS=https://arc.namadomain.com
```

Restart: `sudo docker compose up -d`

### Option B — Nginx + Certbot (Manual)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/arc`:
```nginx
server {
    listen 80;
    server_name arc.namadomain.com;
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/arc /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d arc.namadomain.com
```

---

## 🛠️ Operasi Sehari-hari

### Lihat logs

```bash
# Semua service
sudo docker compose logs -f

# Backend saja
sudo docker compose logs -f backend

# Frontend saja
sudo docker compose logs -f frontend

# MongoDB saja
sudo docker compose logs -f mongo
```

### Restart 1 service

```bash
sudo docker compose restart backend
sudo docker compose restart frontend
```

### Stop semua

```bash
sudo docker compose down
```

### Start semua

```bash
sudo docker compose up -d
```

### Update versi baru (setelah pull source baru)

```bash
cd /opt/arc
git pull
sudo docker compose build
sudo docker compose up -d
```

### Backup MongoDB

```bash
# Manual backup
sudo docker exec arc-mongo \
    mongodump --uri="mongodb://arc_admin:PASSWORD@localhost:27017/arc_db?authSource=admin" \
    --out=/data/db/backup-$(date +%Y%m%d)

# Copy ke host
sudo docker cp arc-mongo:/data/db/backup-$(date +%Y%m%d) /opt/arc-backup/

# Otomatis tiap hari (cron)
sudo crontab -e
# Tambah baris:
0 2 * * * cd /opt/arc && /usr/local/bin/arc-backup.sh
```

Script `/usr/local/bin/arc-backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M)
BACKUP_DIR=/opt/arc-backups
mkdir -p $BACKUP_DIR
docker exec arc-mongo mongodump --uri="mongodb://arc_admin:$MONGO_PASS@localhost:27017/arc_db?authSource=admin" --archive --gzip > $BACKUP_DIR/arc-$DATE.gz
# Keep last 7 days only
find $BACKUP_DIR -name "arc-*.gz" -mtime +7 -delete
```

### Restore MongoDB

```bash
# Dari file backup
sudo docker exec -i arc-mongo \
    mongorestore --uri="mongodb://arc_admin:PASSWORD@localhost:27017/arc_db?authSource=admin" \
    --gzip --archive < /path/to/backup.gz
```

---

## 🔥 Troubleshooting

### Container tidak start / crash

```bash
sudo docker compose logs --tail 100 backend
sudo docker compose ps
```

### Backend tidak konek ke MongoDB

Cek password & connection string di `.env` cocok. MongoDB perlu sehat dulu:
```bash
sudo docker exec arc-mongo mongosh --eval "db.adminCommand('ping')"
```

### Frontend bisa di-akses tapi API 502

Berarti backend down atau bermasalah. Cek:
```bash
sudo docker compose logs backend | tail -50
sudo docker exec arc-backend curl http://localhost:8001/api/health
```

### Port 80 bentrok

Ada Nginx/Apache lain yang sudah pakai port 80. Solusi:
1. Stop yang bentrok: `sudo systemctl stop nginx apache2`
2. Atau ubah `HTTP_PORT=8080` di `.env` lalu pasang reverse proxy

### Reset semua (PERINGATAN: hapus data!)

```bash
sudo docker compose down -v   # `-v` = hapus volume / data MongoDB
sudo docker compose up -d
```

---

## 📊 Resource Monitoring

```bash
# CPU & memory per container
sudo docker stats

# Disk usage
sudo docker system df

# Cleanup image lama
sudo docker system prune -af
```

---

## 🔐 Security Checklist

- [x] **Ganti semua password default** di `.env`
- [x] **JWT_SECRET** unique, generated via `openssl rand -hex 32`
- [x] **CORS_ORIGINS** spesifik ke domain Anda (jangan `*` di production)
- [x] **MongoDB tidak expose** ke public (port 27017 tidak di-publish)
- [x] **HTTPS aktif** via Caddy/Let's Encrypt
- [x] **SSH key auth** + disable password login
- [x] **UFW firewall** allow only port 22, 80, 443
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```
- [x] **Backup otomatis** ke S3/remote server (cron + rclone)
- [x] **Update OS rutin**: `sudo apt update && sudo apt upgrade -y`

---

## 📞 Support

Kalau ada masalah saat install:
1. Cek section Troubleshooting di atas
2. Cek log: `sudo docker compose logs --tail 200`
3. Restart bersih: `sudo docker compose down && sudo docker compose up -d`

---

## 🚀 Quick Reference

| Action | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Logs | `docker compose logs -f` |
| Rebuild | `docker compose build` |
| Update | `git pull && docker compose build && docker compose up -d` |
| Backup | `docker exec arc-mongo mongodump --gzip --archive > backup.gz` |
| Restore | `docker exec -i arc-mongo mongorestore --gzip --archive < backup.gz` |

**Selamat menggunakan ARC Business Suite! 🎉**
