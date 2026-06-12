# 🚀 Deploy ARC ke VPS (Sub-path `/arc/`)

Catatan khusus untuk arsitektur Mas Rendhy:
- **Frontend** ARC di-serve oleh **Nginx luar VPS** dari `/usr/share/nginx/html/arc/`
- **Backend** ARC jalan via **PM2** di `127.0.0.1:8002` (process name: `arc-backend`)
- Public URL: `https://luxoptic.id/arc/`
- Public API: `https://luxoptic.id/arc-api/` → proxy ke `127.0.0.1:8002`

---

## 1. Build Frontend (PENTING — pakai env var `PUBLIC_URL`)

Karena frontend di-serve dari sub-path `/arc/`, asset CRA harus tahu prefix-nya.
**Jangan pakai `yarn build` biasa!** Gunakan salah satu cara di bawah:

### Cara A (script yang sudah disiapkan)
```bash
cd ~/ARC/frontend
yarn install
yarn build:arc        # ← sudah otomatis set PUBLIC_URL=/arc
```

### Cara B (manual, sama hasilnya)
```bash
cd ~/ARC/frontend
PUBLIC_URL=/arc yarn build
```

Hasilnya: folder `build/` dengan `index.html` yang memuat asset dari `/arc/static/...`.

Copy ke folder Nginx:
```bash
sudo rm -rf /usr/share/nginx/html/arc/*
sudo cp -r build/* /usr/share/nginx/html/arc/
```

---

## 2. Restart Backend (PM2)
```bash
cd ~/ARC/backend
source venv/bin/activate
pip install -r requirements.txt   # kalau ada dep baru
pm2 restart arc-backend
pm2 logs arc-backend --lines 20 --nostream
```

---

## 3. Konfigurasi Nginx — Fix Refresh & Sub-path

Edit file Nginx config Anda (biasanya `/etc/nginx/sites-available/default` atau `/etc/nginx/conf.d/luxoptic.conf`). Pastikan block `/arc/` punya **`try_files`** seperti ini:

```nginx
# === ARC Frontend (React SPA di sub-path /arc/) ===
location /arc/ {
    alias /usr/share/nginx/html/arc/;
    index index.html;
    # ⬇️ KUNCINYA: kalau file/folder tidak ada, kasih index.html
    #    biar React Router yang handle routing. Tanpa baris ini,
    #    refresh di /arc/orders bakal balik ke landing Nginx.
    try_files $uri $uri/ /arc/index.html;
}

# === ARC Backend (PM2 native, port 8002) ===
location /arc-api/ {
    # Tanda "/" di ujung WAJIB → memotong prefix "/arc-api/"
    proxy_pass http://127.0.0.1:8002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Tes konfig & reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. Verifikasi (Cheat Sheet)

```bash
# Backend ARC hidup?
curl -s -I http://127.0.0.1:8002/ | head -n 1

# Frontend ARC ke-build dengan PUBLIC_URL benar?
grep "/arc/static/" /usr/share/nginx/html/arc/index.html | head -1

# PM2 status
pm2 status arc-backend
pm2 logs arc-backend --lines 10 --nostream

# Nginx error log
sudo tail -n 20 /var/log/nginx/error.log
```

### Test Refresh
1. Buka `https://luxoptic.id/arc/`
2. Login → navigasi ke **Daftar AWB** → URL jadi `https://luxoptic.id/arc/orders`
3. Tekan **F5/Ctrl+R** → harus tetap di halaman Daftar AWB (BUKAN balik ke landing Nginx)

---

## 🧠 Kenapa Bug "Refresh balik ke Nginx" Terjadi?

Tanpa `try_files`, alur refresh begini:
1. Browser → Nginx: `GET /arc/orders`
2. Nginx: cari file `/usr/share/nginx/html/arc/orders` → **tidak ada**
3. Nginx: fallback ke 404 / location `/` → serve landing page Nginx ❌

Dengan `try_files $uri $uri/ /arc/index.html`:
1. Browser → Nginx: `GET /arc/orders`
2. Nginx: cari file persis → tidak ada
3. Nginx: cari sebagai folder → tidak ada
4. Nginx: kasih `/arc/index.html` ✓
5. Browser load React app → `BrowserRouter basename="/arc"` strip prefix → router match `/orders` → tampil Daftar AWB ✓

Plus React side: di `App.js` sudah ditambahkan `<BrowserRouter basename={process.env.PUBLIC_URL || "/"}>` — saat di-build dengan `PUBLIC_URL=/arc`, basename otomatis jadi `/arc`. Jadi semua route (`/login`, `/orders`, dst.) tetap ditulis tanpa prefix di kode, tapi React Router otomatis sadar dia hidup di sub-path.
