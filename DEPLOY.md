# Panduan Deploy ARC (review + versi ramping)

Catatan penting sebelum deploy:
- Backend PDF/Word kini **pure-python** (python-docx + xhtml2pdf). **weasyprint sudah dihapus** → tidak perlu system lib (pango/cairo) di Docker.
- Pastikan file berikut ikut ter-commit ke git & masuk image Docker backend:
  - `backend/assets/ar_cargo_logo.png` (logo kop untuk PDF/DOCX)
  - Dockerfile backend sebaiknya `COPY backend/ /app/` (bukan copy file per-file), agar folder `assets/` ikut.
- Logo kop di frontend: `frontend/public/ar-cargo-logo.png` (otomatis ikut saat `npm run build`).

---

## 1) Frontend ARC saja  (versi ramping — pakai rsync, tanpa dance /tmp)
```bash
cd ~/ARC && git pull origin main && \
cd frontend && npm install && npm run build && cd .. && \
sudo rsync -a --delete --exclude 'arcweb/' frontend/build/ /usr/share/nginx/html/arc/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/arc && \
sudo chmod -R 755 /usr/share/nginx/html/arc && \
echo "✅ ARC Frontend deployed (arcweb otomatis dipertahankan)"
```
`rsync --delete --exclude arcweb/` menggantikan file ARC lama + hapus file usang, TANPA menyentuh folder `arcweb/`. Menggantikan 5 baris cp/rm/mv jadi 1 baris aman.

## 2) Frontend ARCWEB saja  (sudah oke)
```bash
cd ~/ARC && git pull origin main && \
cd arcweb && npm install && npm run build && cd .. && \
sudo rsync -a --delete arcweb/build/ /usr/share/nginx/html/arc/arcweb/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/arc/arcweb && \
sudo chmod -R 755 /usr/share/nginx/html/arc/arcweb && \
echo "✅ ARCWEB Frontend deployed"
```

## 3) Backend  (sudah oke)
```bash
cd ~/ARC && git pull origin main && \
docker compose up -d --build backend && \
docker logs arc-backend-1 --tail 20 && \
echo "✅ Backend deployed"
```

## 4) All  (+ npm install untuk frontend, aman saat dependency berubah)
```bash
cd ~/ARC && git pull origin main && \
cd arcweb  && npm install --silent && npm run build && cd .. && \
cd frontend && npm install --silent && npm run build && cd .. && \
sudo rsync -a --delete --exclude 'arcweb/' frontend/build/ /usr/share/nginx/html/arc/ && \
sudo rsync -a --delete arcweb/build/ /usr/share/nginx/html/arc/arcweb/ && \
sudo chown -R www-data:www-data /usr/share/nginx/html/arc && \
sudo chmod -R 755 /usr/share/nginx/html/arc && \
docker compose up -d --build backend && \
echo "✅ ALL deployed (ARC + ARCWEB + Backend)"
```

## Ringkasan perubahan vs command lama
1. **ARC-only**: buang dance `cp arcweb → /tmp → rm arc/* → mv balik`. Ganti 1 baris `rsync --delete --exclude arcweb/`. Lebih pendek, tak ada downtime wipe, arcweb aman.
2. **Tambah `npm install`** sebelum `frontend build` (dulu hanya ada di arcweb). Mencegah build gagal saat ada dependency baru.
3. **All**: pakai rsync juga; tak perlu `rm -rf arc/*` global.
4. Sisanya sudah benar.
