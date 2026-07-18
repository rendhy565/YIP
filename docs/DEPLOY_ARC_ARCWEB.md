# 🚀 Deploy Guide — ARC + ARCWEB dalam 1 Server

Panduan deploy ARC (TMS admin) + ARCWEB (public site) dalam 1 VPS/Docker one-liner.

**Arsitektur akhir:**
```
                      ┌─── /api/*      → backend:8001 (FastAPI + MongoDB)
Reverse Proxy ────────┼─── /arc/*      → frontend:3000 (ARC React app)
(nginx/caddy)         └─── /arcweb/*   → arcweb:3001    (ARCWEB React app)
```

Kedua React app terpisah, **1 backend** melayani keduanya (public endpoint di `/api/public/tracking/*` tidak butuh auth).

---

## 1. Struktur Repo

Setelah merge ARCWEB, struktur folder di `/app`:
```
/app
├── backend/               # ARC FastAPI (satu-satunya backend)
│   ├── server.py          # sudah include /api/public/tracking/*
│   └── requirements.txt
├── frontend/              # ARC React (TMS admin)
│   ├── package.json       # homepage: /arc
│   └── .env               # PUBLIC_URL=/arc, PORT=3000
├── arcweb/                # ARCWEB React (public site) — BARU
│   ├── package.json       # homepage: /arcweb
│   └── .env               # PUBLIC_URL=/arcweb, PORT=3001
└── docker-compose.yml     # 3 service: backend, frontend, arcweb
```

## 2. `.env` files

**`/app/backend/.env`** (existing, jangan ubah):
```env
MONGO_URL=mongodb://mongo:27017
DB_NAME=arc_tms
JWT_SECRET=xxx
```

**`/app/frontend/.env`** (ARC — existing):
```env
REACT_APP_BACKEND_URL=https://arc.arcargo.com
PUBLIC_URL=/arc
```

**`/app/arcweb/.env`** (ARCWEB — baru):
```env
REACT_APP_BACKEND_URL=https://arc.arcargo.com
PUBLIC_URL=/arcweb
PORT=3001
```
> ⚠️ **Sama-sama arahkan** ke backend ARC. ARCWEB tidak punya backend sendiri.

## 3. Docker Compose (contoh untuk VPS)

```yaml
# /app/docker-compose.yml
version: "3.9"
services:
  mongo:
    image: mongo:7
    volumes: [ ./data/mongo:/data/db ]
    restart: unless-stopped

  backend:
    build: ./backend
    env_file: ./backend/.env
    depends_on: [ mongo ]
    restart: unless-stopped

  frontend:  # ARC (TMS admin)
    build: ./frontend
    env_file: ./frontend/.env
    restart: unless-stopped
    # tidak expose port ke host, dilayani lewat reverse proxy

  arcweb:    # ARCWEB (public site)
    build: ./arcweb
    env_file: ./arcweb/.env
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports: [ "80:80", "443:443" ]
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on: [ backend, frontend, arcweb ]
    restart: unless-stopped
```

## 4. `nginx.conf` — routing kunci

```nginx
server {
    listen 443 ssl http2;
    server_name arc.arcargo.com;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # ── Backend API (shared by ARC + ARCWEB) ──
    location /api/ {
        proxy_pass http://backend:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300;
    }

    # ── ARCWEB public site ──
    location /arcweb/ {
        proxy_pass http://arcweb:3001;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # ── ARC TMS admin (default) ──
    location /arc/ {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Redirect root → /arcweb (public site landing)
    location = / { return 302 /arcweb/; }
}
```

**URLs setelah deploy:**
- `https://arc.arcargo.com/`         → redirect ke `/arcweb/`
- `https://arc.arcargo.com/arcweb/`  → ARCWEB (customer public site)
- `https://arc.arcargo.com/arc/login`→ ARC TMS admin login
- `https://arc.arcargo.com/api/…`    → Backend API

## 5. Production build (opsional, lebih cepat & ringan)

Kalau mau build static (bukan dev server), tambahkan `Dockerfile` di masing-masing:

**`/app/arcweb/Dockerfile`:**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL PUBLIC_URL=/arcweb
RUN yarn build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html/arcweb
EXPOSE 3001
CMD ["nginx", "-g", "daemon off;"]
```
Sama untuk `/app/frontend/Dockerfile` (ganti `arcweb` → `arc`).

## 6. One-liner deploy (di server VPS)

```bash
# Clone repo (yang sudah include ARC+ARCWEB merged)
git clone https://github.com/your-user/ARC.git && cd ARC
# Set domain di nginx.conf & .env, lalu:
docker compose up -d --build
```

## 7. Verifikasi setelah deploy

```bash
# ARC login page
curl -I https://arc.arcargo.com/arc/login          # → 200

# ARCWEB landing
curl -I https://arc.arcargo.com/arcweb/            # → 200

# Backend API (public tracking, no auth)
curl https://arc.arcargo.com/api/public/tracking/ARC-DEMO-1234  # → JSON 200 or 404

# ARC login API
curl -X POST https://arc.arcargo.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'   # → JSON token 200
```

## 8. Cara integrasi ARCWEB → ARC

ARCWEB `Tracking.jsx` sudah panggil `${REACT_APP_BACKEND_URL}/api/public/tracking/{code}`. Karena `REACT_APP_BACKEND_URL=https://arc.arcargo.com`, request otomatis ke:
```
GET https://arc.arcargo.com/api/public/tracking/ARC-BUDI-2024
```
No auth. Backend cek `tracking_code` di collection `customers`, return AWB list. Detail spec: lihat `/app/docs/ARCWEB_INTEGRATION_SPEC.md`.

## 9. Rollback / Update

- Update ARC only: `docker compose up -d --build backend frontend`
- Update ARCWEB only: `docker compose up -d --build arcweb`
- Ganti tracking code customer: via halaman **Master Customer** di ARC TMS (kolom Tracking Code editable).

## 10. Feature yang butuh kerjaan berikutnya

Kalau nanti ARCWEB perlu form Contact / Quote yang masuk ke DB ARC:
- Copy endpoint dari `/tmp/ARCWEB/backend/server.py` (`/api/contact`, `/api/quotes`) → merge ke `/app/backend/server.py` sebagai public endpoints
- Tambah rate limit
- Simpan ke collection `contacts`, `quotes` di DB yang sama

---

## FAQ

**Q: Kenapa 2 React service, tidak 1 saja?**  
A: ARC pakai `PUBLIC_URL=/arc` dan build asset di `/arc/static/*`. ARCWEB pakai `PUBLIC_URL=/arcweb`. Kalau digabung jadi 1 React app, konflik path + tema. Pisah lebih clean.

**Q: Bisa ARCWEB pakai server lain (Vercel)?**  
A: Bisa. Sett `REACT_APP_BACKEND_URL=https://arc.arcargo.com` di Vercel env, deploy ARCWEB terpisah. Backend ARC pakai CORS `*` sudah OK. Tapi domain public jadi berbeda (mis. `arcargo.com` vs `arc.arcargo.com`).

**Q: Kalau customer belum punya tracking code?**  
A: Backend auto-generate saat startup (backfill) dan saat customer baru dibuat kalau field kosong. Admin bisa edit lewat halaman Master Customer di ARC TMS.
