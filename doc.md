# 📚 KACRUT DIGITAL — DOKUMENTASI TEKNIS DEPLOYMENT

**VPS**: `103.150.92.15` · **Lobby Domain**: `app.luxoptic.id`
**Domain terpisah**: `arc.ar-cargo.com` (ARC), `www.ar-cargo.com` (Arcweb)
**OS**: Ubuntu 22.04 LTS · **Owner**: rendhy565
**Last Updated**: 2026

---

## 📑 DAFTAR ISI

1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Port & Path Map](#2-port--path-map)
3. [Stack Komponen](#3-stack-komponen)
4. [App #1 — LuxOptic POS](#4-app-1--luxoptic-pos)
5. [App #2 — ARC](#5-app-2--arc)
6. [App #3 — HRIS Nusantara](#6-app-3--hris-nusantara)
7. [App #4 — Content Studio (OCS)](#7-app-4--content-studio-ocs)
8. [App #5 — Arcweb (Company Profile AR Cargo)](#8-app-5--arcweb-company-profile-ar-cargo)
9. [Lobby & Reverse Proxy](#9-lobby--reverse-proxy)
10. [Server Stats & Monitoring](#10-server-stats--monitoring)
11. [Backup & Restore MongoDB (v2 — rolling 30 hari + Google Drive)](#11-backup--restore-mongodb)
12. [Cheat Sheets](#12-cheat-sheets)
13. [Troubleshooting](#13-troubleshooting)
14. [Security Notes](#14-security-notes)
15. [Roadmap](#15-roadmap)

---

## 1. ARSITEKTUR SISTEM

```
                       ┌───────────────────────────────────────────┐
                       │             USER BROWSER                  │
                       └────┬──────────┬──────────┬────────────────┘
                            │          │          │
                    app.luxoptic.id  arc.ar-cargo.com  www.ar-cargo.com
                            │          │(HTTPS)   │ (HTTPS)
                            ▼          ▼          ▼
                       ┌───────────────────────────────────────────┐
                       │        LOBBY-NGINX (Docker)               │
                       │   Reverse Proxy + Static + SSL termination│
                       └──┬──────┬──────┬──────┬─────────┬─────────┘
                          │      │      │      │         │
              ┌───────────┘      │      │      │         └─────────┐
              │        ┌─────────┘      │      └────────┐          │
              ▼        ▼                ▼               ▼          ▼
     ┌────────────┐ ┌─────────┐ ┌──────────────┐ ┌──────────┐ ┌─────────┐
     │ LuxOptic   │ │  ARC    │ │    HRIS      │ │   OCS    │ │ Arcweb  │
     │ /luxoptic/ │ │  root   │ │   /hris/     │ │  /ocs/   │ │  root   │
     │ port 8000  │ │ port    │ │  proxy /api  │ │  proxy   │ │ static  │
     │            │ │  8001   │ │              │ │          │ │  only   │
     └─────┬──────┘ └────┬────┘ └──────┬───────┘ └────┬─────┘ └────┬────┘
           │             │             │              │            │
           └─────────────┼─────────────┘              │            │
                         │             │              │            │
                         │        ┌────▼──────────┐   │            │
                         │        │ MongoDB HRIS  │   │            │
                         │        │ hris-mongodb  │   │            │
                         │        └───────────────┘   │            │
                         │                            │            │
                    ┌────▼────────────────────────────▼────────────▼──┐
                    │         MongoDB Shared                          │
                    │         luxoptic-mongodb-1                      │
                    │  luxoptic_db · arc_db · ocs_production          │
                    └─────────────────────────────────────────────────┘
```

### Prinsip Desain

- **Multi-entry point**: 3 domain aktif → `app.luxoptic.id` (lobby internal), `arc.ar-cargo.com` (ARC production), `www.ar-cargo.com` (company profile). Semua terminasi di `lobby-nginx`.
- **URL routing**: lobby internal pakai subpath (`/luxoptic/`, `/hris/`, `/ocs/`). ARC & Arcweb pakai **domain sendiri** (root path).
- **Backend isolation**: setiap app punya container backend sendiri kecuali **Arcweb share backend `arc-backend-1`** (untuk fitur tracking).
- **Database**: 2 MongoDB — shared (LuxOptic, ARC, OCS) + dedicated (HRIS).
- **Static frontend**: React di-build, dilayani nginx sebagai static file.
- **Docker network**: `luxoptic_luxoptic-net` (shared) + `hris_hris-net` (HRIS only).

---

## 2. PORT & PATH MAP

| App | Domain / URL | Frontend Dir | Backend Container | Port host | Port internal | DB | MongoDB | Source |
|-----|--------------|--------------|-------------------|----------:|---------------|----|---------|--------|
| 🏠 Lobby | `app.luxoptic.id/` | `/usr/share/nginx/html/` | `lobby-nginx` | 80 / 443 | 80 | — | — | — |
| 👓 LuxOptic | `app.luxoptic.id/luxoptic/` | `/usr/share/nginx/html/luxoptic/` | `luxoptic-backend-1` | 8000 | 8000 | `luxoptic_db` | `luxoptic-mongodb-1` | `~/LuxOptic` |
| 📊 **ARC** | **`arc.ar-cargo.com/`** (HTTPS) | `/usr/share/nginx/html/arc/` | `arc-backend-1` | 8001 | 8000 | `arc_db` | (shared) | `~/ARC` |
| 👥 HRIS | `app.luxoptic.id/hris/` | `/usr/share/nginx/html/hris/` | `hris-backend` | — (proxy only) | 8001 | `hris_db` | `hris-mongodb` | `~/hris` |
| 🎬 OCS | `app.luxoptic.id/ocs/` | `/usr/share/nginx/html/ocs/` | `ocs-backend` | — (proxy only) | 8001 | `ocs_production` | (shared) | `~/ocs` |
| 🚚 **Arcweb** | **`www.ar-cargo.com/`** (HTTPS) | `/usr/share/nginx/html/arcweb/` | *(share `arc-backend-1`)* | — | — | `arc_db` | (shared) | `~/ARC/arcweb` |

### Backend API Endpoint (dari Frontend)

| App | `REACT_APP_BACKEND_URL` | Nginx Proxy Path |
|-----|-------------------------|------------------|
| LuxOptic | `http://app.luxoptic.id:8000` (direct port) | — |
| **ARC** | **`https://arc.ar-cargo.com`** (via nginx `/api/` proxy) | `/api/` → `arc-backend-1:8000/api/` |
| HRIS | `/hris-api` (relative) | `/hris-api/` → `hris-backend:8001/` |
| OCS | `/ocs-api` (relative) | `/ocs-api/` → `ocs-backend:8001/` |
| **Arcweb** | **`https://arc.ar-cargo.com`** (share ARC API untuk tracking) | (via ARC domain) |

---

## 3. STACK KOMPONEN

### 3.1 Common Stack

| Layer | Tech | Versi |
|-------|------|-------|
| OS | Ubuntu LTS | 22.04 |
| Container | Docker + Docker Compose V2 | latest |
| Reverse Proxy | nginx:alpine (containerized) | latest |
| SSL | Let's Encrypt via certbot (host) atau Cloudflare | — |
| Database | MongoDB | 6.0 / 7.0 |
| Backend Runtime | Python | 3.10–3.12 |
| Frontend | React + Tailwind | 18+ / 19+ |
| Build Tool | npm + react-scripts / craco | latest |
| Process Manager | gunicorn (HRIS) / uvicorn (lainnya) | — |
| Backup Tool | mongodump (in-container) + rclone (host) | — |
| Cloud Backup | Google Drive via rclone | 15 GB free |

### 3.2 Per-App Stack

| App | Backend Framework | Frontend Stack | Special Deps |
|-----|------------------|----------------|--------------|
| LuxOptic | FastAPI + Motor | React + craco + shadcn/ui | — |
| ARC | FastAPI + Motor | React + craco + emergentintegrations | LLM (gemini/openai) |
| HRIS | FastAPI + Motor + gunicorn | React (lean: 6 deps) | reportlab (PDF) |
| OCS | FastAPI + Motor | React + tailwind + lucide | ffmpeg, emergentintegrations |
| **Arcweb** | *(share ARC backend)* | React 19 + craco + tailwind + framer-motion + HashRouter | i18n custom, lenis, embla-carousel |

---

## 4. APP #1 — LUXOPTIC POS

### Deskripsi
Sistem POS untuk toko optik. Inventory, sales, customer management, reporting.

### Folder Structure
```
~/LuxOptic/
├── backend/
│   ├── server.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env             ← MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_USERNAME/PASSWORD
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── nginx.conf
│   ├── Dockerfile
│   └── .env             ← REACT_APP_BACKEND_URL, PUBLIC_URL=/luxoptic
└── docker-compose.yml
```

### Backend `.env`
```env
MONGO_URL=mongodb://mongodb:27017
DB_NAME=luxoptic_db
CORS_ORIGINS=*
JWT_SECRET=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### Frontend `.env`
```env
REACT_APP_BACKEND_URL=http://app.luxoptic.id:8000
PUBLIC_URL=/luxoptic
```

### Deploy dari Nol
```bash
cd ~
git clone https://@github.com/rendhy565/LuxOptic.git
cd LuxOptic
nano backend/.env
nano frontend/.env

# Build frontend
cd frontend && npm install --legacy-peer-deps && npm run build && cd ..

# Deploy frontend
sudo mkdir -p /usr/share/nginx/html/luxoptic
sudo rm -rf /usr/share/nginx/html/luxoptic/*
sudo cp -r frontend/build/* /usr/share/nginx/html/luxoptic/
sudo chown -R www-data:www-data /usr/share/nginx/html/luxoptic
sudo chmod -R 755 /usr/share/nginx/html/luxoptic

# Backend + MongoDB
docker compose up -d --build
```

### Update Workflow
```bash
cd ~/LuxOptic && git pull origin main && \
cd frontend && npm run build && cd .. && \
sudo rm -rf /usr/share/nginx/html/luxoptic/* && \
sudo cp -r frontend/build/* /usr/share/nginx/html/luxoptic/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/luxoptic && \
sudo chmod -R 755 /usr/share/nginx/html/luxoptic && \
docker exec lobby-nginx nginx -s reload && \
docker compose up -d --build backend
```

### Login Default
- Username: `admin`
- Password: sesuai `ADMIN_PASSWORD` di `.env` (default `admin123`).

---

## 5. APP #2 — ARC

### Deskripsi
Aplikasi ARC — ERP/TMS lengkap: Order Management, Accounting (PSAK), HR & Payroll, Tax, Asset, Bank Reconciliation, Analytics Dashboard. Pakai LLM untuk fitur AI (analytics, chat).

> ⚠️ **PENTING**: Sejak 2026, ARC punya **domain sendiri** `arc.ar-cargo.com` (HTTPS). Tidak lagi diakses via `app.luxoptic.id/arc/`.

### Folder Structure
```
~/ARC/
├── backend/
│   ├── server.py
│   ├── requirements.txt
│   ├── Dockerfile       ← Python 3.12 + emergentintegrations
│   └── .env
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env             ← REACT_APP_BACKEND_URL=https://arc.ar-cargo.com
├── arcweb/              ← APP #5 (company profile), lihat section 8
└── docker-compose.yml   ← share network luxoptic-net
```

### Backend `.env`
```env
MONGO_URL=mongodb://mongodb:27017
DB_NAME=arc_db
CORS_ORIGINS=https://arc.ar-cargo.com,https://www.ar-cargo.com
JWT_SECRET=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EMERGENT_LLM_KEY=
```

### Frontend `.env`
```env
REACT_APP_BACKEND_URL=https://arc.ar-cargo.com
# tidak pakai PUBLIC_URL karena serve di root domain
```

### `docker-compose.yml` (key bits)
```yaml
networks:
  luxoptic-net:
    external: true
    name: luxoptic_luxoptic-net

services:
  backend:
    build: ./backend
    container_name: arc-backend-1
    restart: always
    env_file: [./backend/.env]
    ports:
      - "8001:8000"
    networks: [luxoptic-net]
```

### Deploy dari Nol
```bash
cd ~
git clone https://@github.com/rendhy565/ARC.git
cd ARC
nano backend/.env
nano frontend/.env    # isi REACT_APP_BACKEND_URL=https://arc.ar-cargo.com

# Build frontend (TANPA PUBLIC_URL karena root domain)
cd frontend && npm install --legacy-peer-deps && npm run build && cd ..

# Deploy frontend ke direktori khusus
sudo mkdir -p /usr/share/nginx/html/arc
sudo rm -rf /usr/share/nginx/html/arc/*
sudo cp -r frontend/build/* /usr/share/nginx/html/arc/
sudo chown -R www-data:www-data /usr/share/nginx/html/arc
sudo chmod -R 755 /usr/share/nginx/html/arc

# Backend (share LuxOptic's MongoDB)
docker compose up -d --build
```

### Update Workflow
```bash
cd ~/ARC && git pull origin main && \
cd frontend && npm run build && cd .. && \
sudo rm -rf /usr/share/nginx/html/arc/* && \
sudo cp -r frontend/build/* /usr/share/nginx/html/arc/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/arc && \
sudo chmod -R 755 /usr/share/nginx/html/arc && \
docker exec lobby-nginx nginx -s reload && \
docker compose up -d --build backend
```

### DNS & SSL Setup (`arc.ar-cargo.com`)
1. **DNS A record** di provider domain: `arc` → `103.150.92.15`
2. **SSL cert**: pakai Let's Encrypt via certbot (host, mount ke lobby-nginx). Lihat section 9.4.

---

## 6. APP #3 — HRIS NUSANTARA

### Deskripsi
Human Resource Information System Indonesia — payroll, attendance, leaves, employees, PPh 21 compliance.

### Folder Structure
```
~/hris/
├── backend/
│   ├── server.py
│   ├── seed.py
│   ├── tax_tables.py
│   ├── routers/
│   ├── requirements.txt
│   ├── requirements-docker.txt   ← slim version untuk Docker
│   ├── Dockerfile
│   └── .env
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env             ← REACT_APP_BACKEND_URL=/hris-api, PUBLIC_URL=/hris
├── deploy/
│   ├── DEPLOY.md
│   ├── DEPLOY-DOCKER.md
│   └── nginx-hris.conf
└── docker-compose.yml   ← DEDICATED MongoDB, no exposed port
```

### Backend `.env`
```env
MONGO_URL=mongodb://mongodb:27017
DB_NAME=hris_db
CORS_ORIGINS=*
JWT_SECRET=
ADMIN_EMAIL=admin@hris.id
ADMIN_PASSWORD=Admin123!
```

### Frontend `.env`
```env
REACT_APP_BACKEND_URL=/hris-api
```

### `docker-compose.yml` (key bits)
```yaml
services:
  mongodb:
    image: mongo:7
    container_name: hris-mongodb
    restart: unless-stopped
    networks: [hris-net]
    volumes: [hris-mongo-data:/data/db]
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]

  hris-backend:
    build: ./backend
    container_name: hris-backend
    restart: unless-stopped
    env_file: [./backend/.env]
    depends_on:
      mongodb: { condition: service_healthy }
    networks: [hris-net]

networks:
  hris-net: { driver: bridge }
volumes:
  hris-mongo-data:
```

### Deploy dari Nol
```bash
cd ~
git clone https://@github.com/rendhy565/HRIS.git hris
cd hris
nano backend/.env
nano frontend/.env

cd frontend && npm install --legacy-peer-deps && PUBLIC_URL=/hris npm run build && cd ..

sudo mkdir -p /usr/share/nginx/html/hris
sudo rm -rf /usr/share/nginx/html/hris/*
sudo cp -r frontend/build/* /usr/share/nginx/html/hris/
sudo chown -R www-data:www-data /usr/share/nginx/html/hris
sudo chmod -R 755 /usr/share/nginx/html/hris

docker compose up -d --build

# CONNECT lobby-nginx ke HRIS network (PENTING!)
docker network connect hris_hris-net lobby-nginx
docker network inspect hris_hris-net --format '{{range .Containers}}{{.Name}} {{end}}'
# Harus muncul: lobby-nginx hris-backend hris-mongodb
```

### Update Workflow
```bash
cd ~/hris && git pull origin main && \
cd frontend && PUBLIC_URL=/hris npm run build && cd .. && \
sudo rm -rf /usr/share/nginx/html/hris/* && \
sudo cp -r frontend/build/* /usr/share/nginx/html/hris/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/hris && \
sudo chmod -R 755 /usr/share/nginx/html/hris && \
docker exec lobby-nginx nginx -s reload && \
docker compose up -d --build hris-backend
```

### Login Default
- Email: `admin@hris.id`
- Password: `Admin123!`

### Catatan Khusus
- `BrowserRouter basename={process.env.PUBLIC_URL}` di App.js — wajib untuk subpath routing
- Backend pakai gunicorn 2 workers (lebih performant dari uvicorn single)
- MongoDB dedicated (TIDAK shared dengan LuxOptic)

---

## 7. APP #4 — CONTENT STUDIO (OCS)

### Deskripsi
Optical Content Studio — generator konten otomatis (caption, video) untuk social media. Pakai Gemini API + Pexels API.

### Folder Structure
```
~/ocs/
├── backend/
│   ├── server.py        ← FastAPI + bcrypt + email/password auth + Google OAuth
│   ├── requirements.txt
│   ├── Dockerfile       ← Python 3.11 + ffmpeg + emergentintegrations
│   └── .env
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── .env.production
└── docker-compose.yml
```

### Backend `.env`
```env
MONGO_URL=mongodb://mongodb:27017
DB_NAME=ocs_production
CORS_ORIGINS=*
JWT_SECRET=

ADMIN_EMAIL=admin@kacrut.id
ADMIN_PASSWORD=Admin123!
ADMIN_NAME=Administrator

COOKIE_SECURE=false
COOKIE_SAMESITE=lax

EMERGENT_LLM_KEY=
```

### Frontend `.env.production`
```env
REACT_APP_BACKEND_URL=/ocs-api
```

### `docker-compose.yml`
```yaml
services:
  ocs-backend:
    build: ./backend
    container_name: ocs-backend
    restart: unless-stopped
    env_file: [./backend/.env]
    networks: [lobby-network]
    expose: ["8001"]

networks:
  lobby-network:
    external: true
    name: luxoptic_luxoptic-net
```

### Deploy dari Nol
```bash
cd ~
git clone https://@github.com/rendhy565/Content-Generator.git ocs
cd ocs
nano backend/.env

cat > frontend/.env.production << 'EOF'
REACT_APP_BACKEND_URL=/ocs-api
EOF

cd frontend && npm install --legacy-peer-deps && PUBLIC_URL=/ocs npm run build && cd ..

sudo mkdir -p /usr/share/nginx/html/ocs
sudo rm -rf /usr/share/nginx/html/ocs/*
sudo cp -r frontend/build/* /usr/share/nginx/html/ocs/
sudo chown -R www-data:www-data /usr/share/nginx/html/ocs
sudo chmod -R 755 /usr/share/nginx/html/ocs

docker compose up -d --build
```

### Update Workflow
```bash
cd ~/ocs && git pull origin main && \
cd frontend && PUBLIC_URL=/ocs npm run build && cd .. && \
sudo rm -rf /usr/share/nginx/html/ocs/* && \
sudo cp -r frontend/build/* /usr/share/nginx/html/ocs/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/ocs && \
sudo chmod -R 755 /usr/share/nginx/html/ocs && \
docker exec lobby-nginx nginx -s reload && \
docker compose up -d --build --force-recreate ocs-backend
```

### Login Default
- Email: `admin@kacrut.id`
- Password: `Admin123!`

### Settings API Keys (via UI, bukan .env)
- **Gemini API Key** → https://aistudio.google.com/apikey
- **Pexels API Key** → https://www.pexels.com/api/

---

## 8. APP #5 — ARCWEB (Company Profile AR Cargo)

### Deskripsi
Website company profile **AR Cargo** — logistik kargo laut/darat/udara. **Static React SPA** dengan multi-halaman + **fitur Tracking kiriman** yang memanggil backend ARC (`arc-backend-1`).

### Halaman
| Route | Fungsi |
|-------|--------|
| `/` | **Home** — hero, layanan singkat, testimonial |
| `/services` | Detail layanan (sea/land/air freight) |
| `/about` | Profil perusahaan, tim, visi-misi |
| `/gallery` | Portofolio & armada |
| `/contact` | Form kontak, alamat, WhatsApp |
| `/tracking` | **Tracking kiriman via nomor AWB** → hit ARC API |

### Folder Structure
```
~/ARC/arcweb/                     ← subfolder di dalam repo ARC
├── src/
│   ├── App.js                    ← HashRouter (bukan BrowserRouter)
│   ├── pages/{Home,Services,About,Gallery,Contact,Tracking}.jsx
│   ├── lib/i18n.js               ← bilingual ID/EN
│   └── components/
├── public/
│   ├── index.html                ← title "AR CARGO — Logistik Presisi Tinggi"
│   └── (assets: logo, hero images)
├── package.json                  ← "homepage": "."  ← WAJIB untuk hash routing
├── craco.config.js
├── tailwind.config.js
└── postcss.config.js
```

### `.env` (opsional untuk Arcweb — API URL dipakai halaman Tracking)
```env
REACT_APP_BACKEND_URL=https://arc.ar-cargo.com
```

### Karakteristik Teknis
- **Routing**: pakai **`HashRouter`** (URL berisi `#`, contoh: `www.ar-cargo.com/#/tracking`). Alasan: aman untuk static hosting tanpa fallback nginx.
- **`"homepage": "."`** di package.json → asset path relative, bebas ganti domain tanpa rebuild.
- **Tracking API**: memanggil `GET https://arc.ar-cargo.com/api/tracking?awb=XXX` (share backend ARC).
- **Tidak punya backend sendiri** — 100% static + call ARC API.
- **Framework berat**: React 19, Framer Motion, Lenis smooth scroll, Embla Carousel, React Fast Marquee, i18n custom.

### Deploy dari Nol
```bash
cd ~/ARC/arcweb
npm install --legacy-peer-deps
npm run build     # via craco

# Deploy frontend
sudo mkdir -p /usr/share/nginx/html/arcweb
sudo rm -rf /usr/share/nginx/html/arcweb/*
sudo cp -r build/* /usr/share/nginx/html/arcweb/
sudo chown -R www-data:www-data /usr/share/nginx/html/arcweb
sudo chmod -R 755 /usr/share/nginx/html/arcweb
```

### Update Workflow
```bash
cd ~/ARC && git pull origin main && \
cd arcweb && npm install --legacy-peer-deps && npm run build && cd .. && \
sudo rm -rf /usr/share/nginx/html/arcweb/* && \
sudo cp -r arcweb/build/* /usr/share/nginx/html/arcweb/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/arcweb && \
sudo chmod -R 755 /usr/share/nginx/html/arcweb && \
docker exec lobby-nginx nginx -s reload && \
echo "✅ Arcweb updated"
```

### DNS & SSL Setup (`www.ar-cargo.com`)
1. **DNS A record**: `www` → `103.150.92.15`. Tambahkan juga apex `@` → `103.150.92.15` supaya `ar-cargo.com` (tanpa www) juga bisa diakses.
2. **SSL cert**: Let's Encrypt (lihat section 9.4). Cert sebaiknya cover keduanya: `ar-cargo.com` + `www.ar-cargo.com`.
3. **CORS ARC**: pastikan `CORS_ORIGINS` di `~/ARC/backend/.env` include `https://www.ar-cargo.com` supaya fitur tracking bisa call ARC API dari domain Arcweb.

### Catatan Khusus
- **HashRouter** artinya URL selalu punya `#` (mis. `www.ar-cargo.com/#/tracking`). Ini tidak SEO-friendly. Kalau mau SEO friendly, migrasi ke `BrowserRouter` + tambah nginx `try_files $uri $uri/ /index.html;` di block Arcweb.
- Arcweb TIDAK butuh rebuild kalau ARC backend URL ganti (`REACT_APP_BACKEND_URL` di-baca runtime dari env yang di-inject saat build — jadi masih perlu rebuild kalau URL ARC berubah).
- Setiap perubahan design/copywriting di company profile → hanya perlu build ulang Arcweb, tidak mengganggu ARC backend/frontend.

---

## 9. LOBBY & REVERSE PROXY

### 9.1 Lobby HTML
**File**: `/usr/share/nginx/html/index.html`

Halaman index modern dengan dark/light mode toggle, live server stats, card untuk akses tiap app. **Update kartu kalau tambah app baru** (Arcweb sudah harus ditambahkan sebagai tile "Company Profile AR Cargo").

### 9.2 Nginx Config
**File**: `/etc/lobby-nginx/default.conf`

```nginx
# Gzip
gzip on;
gzip_vary on;
gzip_comp_level 6;
gzip_min_length 256;
gzip_types
  application/javascript application/json
  text/css text/javascript image/svg+xml font/woff2;

# =========================================================================
# Server #1 — Lobby (app.luxoptic.id) + apps di subpath
# =========================================================================
server {
  listen 80 default_server;
  server_name app.luxoptic.id _;
  root /usr/share/nginx/html;
  index index.html;

  location = /              { try_files /index.html =404; }
  location = /stats.json    { add_header Cache-Control "no-cache, no-store"; try_files /stats.json =404; }

  # LuxOptic
  location /luxoptic/ {
    alias /usr/share/nginx/html/luxoptic/;
    index index.html;
    try_files $uri $uri/ /luxoptic/index.html;
  }

  # HRIS
  location /hris/ {
    alias /usr/share/nginx/html/hris/;
    index index.html;
    try_files $uri $uri/ /hris/index.html;
  }
  location /hris-api/ {
    proxy_pass http://hris-backend:8001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
  }

  # OCS
  location /ocs/ {
    alias /usr/share/nginx/html/ocs/;
    index index.html;
    try_files $uri $uri/ /ocs/index.html;
  }
  location /ocs-api/ {
    proxy_pass http://ocs-backend:8001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Cookie $http_cookie;
    client_max_body_size 200M;
    proxy_buffering off;
    proxy_read_timeout 600s;
  }
}

# =========================================================================
# Server #2 — ARC (arc.ar-cargo.com) — HTTPS
# =========================================================================
server {
  listen 80;
  server_name arc.ar-cargo.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name arc.ar-cargo.com;

  ssl_certificate     /etc/letsencrypt/live/arc.ar-cargo.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/arc.ar-cargo.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  root /usr/share/nginx/html/arc;
  index index.html;

  client_max_body_size 100M;

  # API → arc-backend-1
  location /api/ {
    proxy_pass http://arc-backend-1:8000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 600s;
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}

# =========================================================================
# Server #3 — Arcweb (www.ar-cargo.com + ar-cargo.com) — HTTPS
# =========================================================================
server {
  listen 80;
  server_name ar-cargo.com www.ar-cargo.com;
  return 301 https://www.ar-cargo.com$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ar-cargo.com;
  ssl_certificate     /etc/letsencrypt/live/ar-cargo.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ar-cargo.com/privkey.pem;
  return 301 https://www.ar-cargo.com$request_uri;
}

server {
  listen 443 ssl http2;
  server_name www.ar-cargo.com;

  ssl_certificate     /etc/letsencrypt/live/ar-cargo.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ar-cargo.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  root /usr/share/nginx/html/arcweb;
  index index.html;

  # Static SPA (HashRouter, jadi tidak butuh SPA fallback)
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 9.3 Setup Awal Lobby-Nginx Container

```bash
docker run -d \
  --name lobby-nginx \
  --restart always \
  -p 80:80 -p 443:443 \
  -v /usr/share/nginx/html:/usr/share/nginx/html:ro \
  -v /etc/lobby-nginx/default.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  nginx:alpine

docker network connect luxoptic_luxoptic-net lobby-nginx
docker network connect hris_hris-net lobby-nginx
```

### 9.4 SSL Certificate — Let's Encrypt via certbot

Install certbot di host (bukan container):
```bash
sudo apt install -y certbot
```

Untuk minta cert, sementara **stop lobby-nginx** supaya port 80 kosong (atau pakai `--webroot`):

```bash
# Stop container sebentar
docker stop lobby-nginx

# Issue cert untuk arc.ar-cargo.com
sudo certbot certonly --standalone -d arc.ar-cargo.com --agree-tos -m your@email.com

# Issue cert untuk apex + www ar-cargo.com
sudo certbot certonly --standalone -d ar-cargo.com -d www.ar-cargo.com --agree-tos -m your@email.com

# Start ulang container
docker start lobby-nginx
```

**Auto-renew** (certbot install cron otomatis, cek dulu):
```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

Renew hook untuk reload nginx setelah cert diperbarui:
```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-lobby.sh > /dev/null << 'EOF'
#!/bin/bash
docker exec lobby-nginx nginx -s reload
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-lobby.sh
```

### 9.5 Reload Config
```bash
docker exec lobby-nginx nginx -t          # test syntax
docker exec lobby-nginx nginx -s reload   # apply changes
```

---

## 10. SERVER STATS & MONITORING

### 10.1 Stats Writer Service
**File**: `/usr/local/bin/server-stats.sh` (writes `/usr/share/nginx/html/stats.json` every 3 sec)

**Systemd Unit**: `/etc/systemd/system/server-stats.service`
```ini
[Unit]
Description=Server Stats Writer for Lobby Dashboard
After=network.target docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/server-stats.sh
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

### 10.2 Control
```bash
sudo systemctl status server-stats
sudo systemctl restart server-stats
sudo journalctl -u server-stats -f
```

### 10.3 Health Check Script (`cekkabel`)

```bash
sudo tee /usr/local/bin/cekkabel > /dev/null << 'SCRIPT'
#!/bin/bash
echo "================================================="
echo "  KACRUT DIGITAL — HEALTH CHECK"
echo "================================================="
echo -e "\n=== CONTAINERS ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo -e "\n=== ENDPOINTS (internal) ==="
for url in / /luxoptic/ /hris/ /hris-api/api/ /ocs/ /ocs-api/api/; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost$url)
  [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ] \
    && echo "✅ $url → HTTP $code" \
    || echo "❌ $url → HTTP $code"
done

echo -e "\n=== ENDPOINTS (external HTTPS) ==="
for url in https://arc.ar-cargo.com https://arc.ar-cargo.com/api/health https://www.ar-cargo.com; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" $url)
  [ "$code" = "200" ] && echo "✅ $url → HTTP $code" || echo "❌ $url → HTTP $code"
done

echo -e "\n=== BACKUP STATUS ==="
LAST_LOCAL=$(ls -t /root/mongo-backups/*.gz 2>/dev/null | head -1)
[ -n "$LAST_LOCAL" ] && echo "Last local:   $LAST_LOCAL ($(du -h "$LAST_LOCAL" | cut -f1))" || echo "❌ No local backup"
LAST_REMOTE=$(rclone lsf gdrive:ARC-Backups/ --format "tp" 2>/dev/null | sort -r | head -1)
[ -n "$LAST_REMOTE" ] && echo "Last remote:  $LAST_REMOTE" || echo "❌ No remote backup"

echo -e "\n=== RESOURCES ==="
df -h / | tail -1 | awk '{print "Disk: " $5 " of " $2}'
free -h | awk 'NR==2{printf "RAM: %s / %s (%.0f%%)\n", $3, $2, ($3/$2)*100}'
uptime | awk -F'load average:' '{print "Load:" $2}'
echo "================================================="
SCRIPT
sudo chmod +x /usr/local/bin/cekkabel
```

Usage: ketik `cekkabel` dari shell manapun.

---

## 11. BACKUP & RESTORE MONGODB

> **✅ AKTIF sejak Jan 2026** — rolling **30 hari**, jadwal **00:00 WIB** (bukan 03:00 lagi), upload otomatis ke **Google Drive** via rclone. Menggantikan script lama yang cuma keep 7 hari.

### 11.1 Arsitektur Backup

```
Setiap hari 00:00 WIB (via cron CRON_TZ=Asia/Jakarta)
  │
  ├── docker exec luxoptic-mongodb-1 mongodump --archive --gzip
  │        → /root/mongo-backups/luxoptic-shared-<host>-YYYY-MM-DD.gz
  │        → rclone copy → gdrive:ARC-Backups/
  │
  ├── docker exec hris-mongodb mongodump --archive --gzip
  │        → /root/mongo-backups/hris-<host>-YYYY-MM-DD.gz
  │        → rclone copy → gdrive:ARC-Backups/
  │
  ├── rclone delete --min-age 30d  (rolling remote)
  └── find ... -mtime +30 -delete  (rolling lokal)
```

### 11.2 Komponen

| Komponen | Lokasi | Fungsi |
|----------|--------|--------|
| Script backup | `/usr/local/bin/mongo-daily-backup.sh` | Dump + upload + rolling |
| Script restore | `/usr/local/bin/mongo-restore.sh` | Restore ke container |
| Log | `/var/log/mongo-backup.log` | Riwayat lengkap semua run |
| Lock | `/tmp/mongo-backup.lock` | Cegah 2 job tumpang tindih |
| Cron user | `root` | `sudo crontab -l` untuk lihat |
| Cron entry | `CRON_TZ=Asia/Jakarta` + `0 0 * * *` | Setiap hari 00:00 WIB |
| Storage lokal | `/root/mongo-backups/` | Rolling 30 hari |
| Storage remote | `gdrive:ARC-Backups/` | Rolling 30 hari |
| Rclone config | `/root/.config/rclone/rclone.conf` | Remote `gdrive` (Google Drive OAuth) |

### 11.3 Instalasi dari Nol (kalau setup ulang)

**a. Install dependencies:**
```bash
sudo apt update && sudo apt install -y flock
curl https://rclone.org/install.sh | sudo bash
```

**b. Setup rclone Google Drive:**
```bash
sudo -i
rclone config
# Pilih: n → name=gdrive → storage=drive → scope=1 → auto config=y
# (untuk headless/mobile-only: pakai trik 3-tab curl callback, lihat section 13.7)
rclone mkdir gdrive:ARC-Backups
rclone lsd gdrive:ARC-Backups
```

**c. Install script backup:**
```bash
sudo tee /usr/local/bin/mongo-daily-backup.sh > /dev/null << 'BACKUPSCRIPT'
#!/usr/bin/env bash
# KACRUT DIGITAL — MongoDB Auto Backup (rolling 30 hari + Google Drive)
set -Eeuo pipefail

LOCAL_DIR="/root/mongo-backups"
LOG_FILE="/var/log/mongo-backup.log"
RETENTION_DAYS=30
GDRIVE_REMOTE="gdrive"
GDRIVE_PATH="ARC-Backups"

DATE=$(date +'%Y-%m-%d')
HOST=$(hostname -s)

mkdir -p "$LOCAL_DIR"; touch "$LOG_FILE"
log()  { printf '[%s] %s\n' "$(date '+%F %T %Z')" "$*" | tee -a "$LOG_FILE"; }
trap 'log "ERROR line ${BASH_LINENO[0]} (exit=$?)"; exit 1' ERR

exec 9>/tmp/mongo-backup.lock
flock -n 9 || { log "SKIP: proses lain masih jalan"; exit 0; }

log "========== START backup $DATE =========="

backup_container() {
  local container="$1" label="$2"
  local out="$LOCAL_DIR/${label}-${HOST}-${DATE}.gz"

  if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
    log "WARN: container '$container' tidak jalan — dilewati"; return 0
  fi
  log "Dump $container → $(basename "$out")"
  docker exec "$container" mongodump --archive --gzip --quiet 2>>"$LOG_FILE" > "$out"
  [[ -s "$out" ]] || { log "FATAL: archive kosong ($container)"; rm -f "$out"; return 1; }
  log "  OK ($(du -h "$out" | cut -f1))"

  if command -v rclone >/dev/null 2>&1; then
    log "  Upload ke $GDRIVE_REMOTE:$GDRIVE_PATH/"
    rclone copy "$out" "$GDRIVE_REMOTE:$GDRIVE_PATH/" \
      --transfers=2 --checkers=4 --retries=3 --low-level-retries=10 \
      --log-file="$LOG_FILE" --log-level=INFO
  fi
}

backup_container "luxoptic-mongodb-1" "luxoptic-shared"
backup_container "hris-mongodb"       "hris"

if command -v rclone >/dev/null 2>&1; then
  log "Cleanup remote > ${RETENTION_DAYS} hari"
  rclone delete "$GDRIVE_REMOTE:$GDRIVE_PATH/" --min-age "${RETENTION_DAYS}d" \
    --include "luxoptic-shared-*.gz" --include "hris-*.gz" \
    --log-file="$LOG_FILE" --log-level=INFO || log "WARN: rclone delete remote gagal"
fi

log "Cleanup lokal > ${RETENTION_DAYS} hari"
DELETED=$(find "$LOCAL_DIR" -maxdepth 1 -type f \
  \( -name 'luxoptic-shared-*.gz' -o -name 'hris-*.gz' -o -name '*.tar.gz' \) \
  -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log "  $DELETED file lokal terhapus"

log "========== DONE =========="
BACKUPSCRIPT
sudo chmod +x /usr/local/bin/mongo-daily-backup.sh
```

**d. Install script restore:**
```bash
sudo tee /usr/local/bin/mongo-restore.sh > /dev/null << 'RESTORESCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
CONTAINER="${1:-}"; ARCHIVE="${2:-}"; DROP="${3:-}"
[[ -z "$CONTAINER" || -z "$ARCHIVE" ]] && { echo "Usage: $0 <container> <archive.gz> [--drop]"; exit 1; }
[[ ! -f "$ARCHIVE" ]] && { echo "File tidak ditemukan: $ARCHIVE"; exit 1; }
echo "!! RESTORE $ARCHIVE ke container $CONTAINER"
[[ "$DROP" == "--drop" ]] && echo "!! Mode --drop: database tujuan AKAN DITIMPA"
read -r -p "Ketik 'YES' untuk lanjut: " C
[[ "$C" == "YES" ]] || { echo "Dibatalkan."; exit 1; }
CMD="mongorestore --archive --gzip"
[[ "$DROP" == "--drop" ]] && CMD="$CMD --drop"
cat "$ARCHIVE" | docker exec -i "$CONTAINER" sh -c "$CMD"
echo "OK — restore selesai."
RESTORESCRIPT
sudo chmod +x /usr/local/bin/mongo-restore.sh
```

**e. Pasang cron:**
```bash
sudo bash -c '
(crontab -l 2>/dev/null | grep -v mongo-daily-backup.sh | grep -v "^CRON_TZ="; \
 echo "CRON_TZ=Asia/Jakarta"; \
 echo "0 0 * * * /usr/local/bin/mongo-daily-backup.sh >> /var/log/mongo-backup.log 2>&1"
) | crontab -
'
sudo crontab -l                           # verifikasi
sudo systemctl status cron --no-pager
```

**f. Test manual:**
```bash
sudo /usr/local/bin/mongo-daily-backup.sh
sudo tail -n 40 /var/log/mongo-backup.log
ls -lh /root/mongo-backups/
rclone ls gdrive:ARC-Backups/
```

### 11.4 Monitoring Harian

```bash
# Log tail (Ctrl+C untuk keluar)
sudo tail -f /var/log/mongo-backup.log

# List file di GDrive
rclone ls gdrive:ARC-Backups/

# Ukuran total di GDrive
rclone size gdrive:ARC-Backups/

# List file lokal
ls -lh /root/mongo-backups/

# Cek 5 backup terakhir yang sukses (grep DONE)
grep "DONE" /var/log/mongo-backup.log | tail -5
```

### 11.5 Restore

**Kalau file masih ada di lokal:**
```bash
sudo /usr/local/bin/mongo-restore.sh luxoptic-mongodb-1 \
  /root/mongo-backups/luxoptic-shared-Kacrut-Digital-2026-01-15.gz --drop

sudo /usr/local/bin/mongo-restore.sh hris-mongodb \
  /root/mongo-backups/hris-Kacrut-Digital-2026-01-15.gz --drop
```

**Kalau harus download dulu dari Google Drive:**
```bash
rclone copy gdrive:ARC-Backups/luxoptic-shared-Kacrut-Digital-2026-01-15.gz /root/mongo-backups/
sudo /usr/local/bin/mongo-restore.sh luxoptic-mongodb-1 \
  /root/mongo-backups/luxoptic-shared-Kacrut-Digital-2026-01-15.gz --drop
```

**Restart backend setelah restore:**
```bash
docker restart arc-backend-1 luxoptic-backend-1 ocs-backend
# Untuk HRIS:
docker restart hris-backend
```

### 11.6 Restore dari Raw WiredTiger (fallback ekstrem)

Kalau punya raw dump WiredTiger (bukan archive gzip):
```bash
docker stop <mongo-container>
MONGO_VOL=$(docker volume inspect <volume-name> -f '{{ .Mountpoint }}')
sudo rm -rf $MONGO_VOL/* $MONGO_VOL/.[!.]*
sudo rsync -av --exclude='backup_segar' /path/to/extracted-backup/ $MONGO_VOL/
sudo chown -R 999:999 $MONGO_VOL
sudo rm -f $MONGO_VOL/mongod.lock $MONGO_VOL/WiredTiger.lock
docker start <mongo-container>
```

### 11.7 Catatan Penting

- **Warning `client_id retiring 2026`**: rclone pakai OAuth client_id shared bawaan. Google akan mematikan ini selama 2026. **Wajib** ganti dengan client_id sendiri sebelum akhir tahun. Panduan: https://rclone.org/drive/#making-your-own-client-id.
- **Retensi 30 hari** ada di 2 tempat (lokal + GDrive). Hapus file lokal manual tidak akan menghapus di GDrive dan sebaliknya — sengaja dibuat begitu supaya redundant.
- **Ukuran backup**: monitoring size di GDrive tiap bulan (`rclone size gdrive:ARC-Backups/`). Kalau mendekati 15 GB (kuota free), naikkan retensi ke Google One 100 GB (Rp 26 rb/bulan) atau ubah ke Backblaze B2.
- **Google Drive quota**: kalau overquota, upload akan gagal tapi **backup lokal tetap dibuat** — tidak ada kehilangan data selama disk VPS masih ada tempat.
- **Kalau ganti server / restore ke server baru**: copy 3 hal — (1) `/usr/local/bin/mongo-daily-backup.sh`, (2) `/root/.config/rclone/rclone.conf`, (3) cron entry. Jalankan test manual sekali sebelum aktifkan cron.

---

## 12. CHEAT SHEETS

### 12.1 Update All Apps (Pull + Rebuild)

**LuxOptic:**
```bash
cd ~/LuxOptic && git pull origin main && cd frontend && npm run build && cd .. && sudo rm -rf /usr/share/nginx/html/luxoptic/* && sudo cp -r frontend/build/* /usr/share/nginx/html/luxoptic/ && sudo chown -R www-data:www-data /usr/share/nginx/html/luxoptic && sudo chmod -R 755 /usr/share/nginx/html/luxoptic && docker exec lobby-nginx nginx -s reload && docker compose up -d --build backend && echo "✅ Done"
```

**ARC:**
```bash
cd ~/ARC && git pull origin main && cd frontend && npm run build && cd .. && sudo rm -rf /usr/share/nginx/html/arc/* && sudo cp -r frontend/build/* /usr/share/nginx/html/arc/ && sudo chown -R www-data:www-data /usr/share/nginx/html/arc && sudo chmod -R 755 /usr/share/nginx/html/arc && docker exec lobby-nginx nginx -s reload && docker compose up -d --build backend && echo "✅ Done"
```

**Arcweb:**
```bash
cd ~/ARC && git pull origin main && cd arcweb && npm install --legacy-peer-deps && npm run build && cd .. && sudo rm -rf /usr/share/nginx/html/arcweb/* && sudo cp -r arcweb/build/* /usr/share/nginx/html/arcweb/ && sudo chown -R www-data:www-data /usr/share/nginx/html/arcweb && sudo chmod -R 755 /usr/share/nginx/html/arcweb && docker exec lobby-nginx nginx -s reload && echo "✅ Arcweb updated"
```

**HRIS:**
```bash
cd ~/hris && git pull origin main && cd frontend && PUBLIC_URL=/hris npm run build && cd .. && sudo rm -rf /usr/share/nginx/html/hris/* && sudo cp -r frontend/build/* /usr/share/nginx/html/hris/ && sudo chown -R www-data:www-data /usr/share/nginx/html/hris && sudo chmod -R 755 /usr/share/nginx/html/hris && docker exec lobby-nginx nginx -s reload && docker compose up -d --build hris-backend && echo "✅ Done"
```

**OCS:**
```bash
cd ~/ocs && git pull origin main && cd frontend && PUBLIC_URL=/ocs npm run build && cd .. && sudo rm -rf /usr/share/nginx/html/ocs/* && sudo cp -r frontend/build/* /usr/share/nginx/html/ocs/ && sudo chown -R www-data:www-data /usr/share/nginx/html/ocs && sudo chmod -R 755 /usr/share/nginx/html/ocs && docker exec lobby-nginx nginx -s reload && docker compose up -d --build --force-recreate ocs-backend && echo "✅ Done"
```

### 12.2 Restart Container Cepat
```bash
docker restart luxoptic-backend-1
docker restart arc-backend-1
docker restart hris-backend
docker restart ocs-backend
docker restart lobby-nginx
```

### 12.3 Log Lookup
```bash
docker logs --tail 50 <container-name>
docker logs -f <container-name>       # follow live
sudo tail -f /var/log/mongo-backup.log
```

### 12.4 MongoDB Shell
```bash
docker exec -it luxoptic-mongodb-1 mongosh    # shared (luxoptic_db, arc_db, ocs_production)
docker exec -it hris-mongodb mongosh          # HRIS dedicated

# Inside mongosh:
show dbs
use arc_db
show collections
db.awb_orders.countDocuments()
```

### 12.5 Backup Manual (di luar jadwal cron)
```bash
sudo /usr/local/bin/mongo-daily-backup.sh
sudo tail -n 20 /var/log/mongo-backup.log
```

### 12.6 Docker Compose Operations
```bash
docker compose ps
docker compose logs --tail 50
docker compose up -d --build <svc>
docker compose up -d --force-recreate <svc>
docker compose down
docker compose down -v            # DESTRUCTIVE: hapus volume
```

### 12.7 SSL Cert Cek & Renew
```bash
sudo certbot certificates                    # lihat semua cert + expiry
sudo certbot renew --dry-run                 # simulasi renew
sudo certbot renew                           # renew paksa (kalau perlu)
docker exec lobby-nginx nginx -s reload      # apply setelah renew
```

---

## 13. TROUBLESHOOTING

### 13.1 Container Not Starting
```bash
docker logs <container> --tail 50
docker exec <container> env | grep -E "MONGO|DB_"
cd ~/<app> && docker compose up -d --force-recreate <svc>
```

### 13.2 Frontend Blank Putih
- **Penyebab #1**: `BrowserRouter` tidak ada `basename` saat deploy di subpath. Fix: `<BrowserRouter basename={process.env.PUBLIC_URL}>`.
- **Penyebab #2**: `PUBLIC_URL` salah saat build. Fix: `PUBLIC_URL=/<path> npm run build`.
- **Penyebab #3 (ARC/Arcweb di root domain)**: `homepage` di `package.json` bikin path asset broken. Fix: hapus `"homepage"` atau set `"homepage": "."` (untuk arcweb).

### 13.3 Frontend 403 Forbidden
```bash
sudo chown -R www-data:www-data /usr/share/nginx/html/<app>
sudo chmod -R 755 /usr/share/nginx/html/<app>
```

### 13.4 Backend API 502 Bad Gateway
```bash
docker ps | grep backend
docker network inspect luxoptic_luxoptic-net --format '{{range .Containers}}{{.Name}} {{end}}'
docker network connect luxoptic_luxoptic-net lobby-nginx     # kalau perlu
docker network connect hris_hris-net lobby-nginx
```

### 13.5 Login Cookie Tidak Ter-set (OCS/HRIS)
- HTTPS: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`
- HTTP: `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax`
- Wajib `docker compose up -d --force-recreate <svc>` setelah edit `.env`.

### 13.6 npm install OOM
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

NODE_OPTIONS="--max-old-space-size=1536" npm install --legacy-peer-deps
```

### 13.7 rclone Config Headless (mobile-only — trik 3-tab)

Kalau VPS tidak punya browser & Anda cuma pakai iPhone/Android via Termius:

**Tab 1** (rclone menunggu code):
```bash
rclone config
# n → gdrive → drive → scope=1 → auto config=y
# Rclone print URL: http://127.0.0.1:53682/auth?state=xxxxx
```

**Tab 2** SSH baru:
```bash
curl -sI "http://127.0.0.1:53682/auth?state=xxxxx" | grep -i '^location:'
# Copy URL Google yang muncul
```

**Safari mobile:**
- Paste URL Google → login → izinkan → Google redirect ke `http://127.0.0.1:53682/?code=4/...&state=xxx`
- Safari error "cannot connect" — normal
- Copy URL utuh dari address bar

**Tab 2 lagi:**
```bash
curl "http://127.0.0.1:53682/?code=4/.....&state=xxxxx"
```

**Tab 1** akan otomatis lanjut — jawab `n` (bukan shared drive) → `y` (keep) → `q`.

### 13.8 Git Push Rejected
```bash
git log origin/main..main --oneline
git pull origin main --rebase
git push origin main

# atau kalau local garbage:
git fetch origin && git reset --hard origin/main
```

### 13.9 Port 80 Already In Use
```bash
sudo lsof -i :80
sudo systemctl stop nginx && sudo systemctl disable nginx
```

### 13.10 Docker Compose V1 vs V2
```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

### 13.11 Database Name Mismatch
```bash
docker exec luxoptic-mongodb-1 mongosh --eval 'show dbs' --quiet
# Cocokkan dengan DB_NAME di backend/.env
# Kalau tidak sama: edit .env, docker compose up -d --force-recreate <svc>
```

### 13.12 SSL Cert Expired / Renew Failed
```bash
sudo certbot certificates                    # cek expiry
sudo certbot renew                           # renew semua
docker stop lobby-nginx                      # kalau webroot/standalone butuh port 80
sudo certbot renew --force-renewal
docker start lobby-nginx
docker exec lobby-nginx nginx -s reload
```

### 13.13 Backup Tidak Jalan Otomatis
```bash
# Cek cron aktif
sudo systemctl status cron

# Cek entry ada
sudo crontab -l

# Cek log terakhir
sudo tail -n 100 /var/log/mongo-backup.log

# Test manual
sudo /usr/local/bin/mongo-daily-backup.sh

# Cek lock stuck
ls -la /tmp/mongo-backup.lock
# Kalau proses backup tidak jalan tapi lock ada:
sudo rm /tmp/mongo-backup.lock
```

---

## 14. SECURITY NOTES

### 14.1 Firewall (UFW)
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp        # LuxOptic backend (direct) — pertimbangkan tutup nanti
sudo ufw allow 8001/tcp        # ARC backend (direct) — pertimbangkan tutup nanti (sudah lewat nginx)
sudo ufw enable
```

> **REKOMENDASI**: tutup port 8000 & 8001 setelah nginx proxy stabil, supaya semua traffic lewat SSL termination di 443.

### 14.2 PAT GitHub
- JANGAN commit PAT
- `git config --global credential.helper store`
- Revoke di https://github.com/settings/tokens kalau bocor

### 14.3 Admin Credentials
- Ganti `ADMIN_PASSWORD` default semua app
- `openssl rand -hex 32` untuk `JWT_SECRET` unik per app

### 14.4 MongoDB
- Saat ini tanpa auth (aman karena container tidak expose port ke public)
- Kalau kelak expose ke public, WAJIB enable `--auth` + buat user application-level

### 14.5 Backup Google Drive
- Rclone OAuth token disimpan di `/root/.config/rclone/rclone.conf` — protect file ini (permission `0600`, root-only).
- Consider tambah **rclone crypt** remote di atas gdrive untuk enkripsi client-side (biar orang yang bobol GDrive tetap tidak bisa baca backup).
- Contoh:
  ```bash
  rclone config
  # n → gdrive-crypt → crypt → remote=gdrive:ARC-Backups-Crypt → password=<strong> → password2=<strong>
  ```
  Lalu ganti `GDRIVE_PATH` di script ke `gdrive-crypt:` (isinya otomatis di-encrypt sebelum upload).

---

## 15. ROADMAP

### Short-term (1 minggu)
- [x] ~~Setup auto-backup MongoDB harian~~ ✅ (Jan 2026 — rolling 30 hari + Google Drive)
- [x] ~~Setup HTTPS untuk ARC~~ ✅ (`arc.ar-cargo.com`)
- [x] ~~Setup domain company profile~~ ✅ (`www.ar-cargo.com` untuk Arcweb)
- [ ] Buat client_id Google Drive sendiri (rclone) sebelum shared client_id di-retire
- [ ] Tutup port 8000 & 8001 di UFW — semua via 443 nginx

### Mid-term (1 bulan)
- [ ] Rclone crypt untuk enkripsi backup client-side
- [ ] Pisahkan ARC MongoDB ke instance terpisah (data isolation)
- [ ] Monitoring lanjut (Uptime Kuma untuk 3 domain publik)
- [ ] Centralized logging (Loki / Filebeat)
- [ ] SEO: migrasi Arcweb dari HashRouter ke BrowserRouter + Open Graph tags

### Long-term (3 bulan)
- [ ] CI/CD pipeline (GitHub Actions → auto-deploy on push main)
- [ ] Staging environment untuk ARC & Arcweb
- [ ] CDN untuk static asset Arcweb (Cloudflare)
- [ ] Multi-region MongoDB replica set (kalau scale up)

---

## 📞 CONTACT / OWNERSHIP

- **Developer**: rendhy565
- **VPS Provider**: KacrutDigital (`103.150.92.15`)
- **GitHub**: https://github.com/rendhy565
- **Domain Owner**: rendhy565 (`luxoptic.id`, `ar-cargo.com`)
- **Google Drive Backup**: akun `<isi email gdrive di sini>` (folder `ARC-Backups`)
- **Repos**:
  - `LuxOptic`
  - `ARC` (termasuk subfolder `arcweb/` untuk company profile)
  - `HRIS`
  - `Content-Generator` (OCS)

---

**END OF DOCUMENTATION** — v2.1 (Jan 2026)
