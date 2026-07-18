# 🚀 Deploy ARC + ARCWEB — Panduan Simpel (Tanpa Yarn)

## ✅ Konsep

**ARCWEB sudah pre-built** dan tersimpan di `/app/frontend/public/arcweb/` sebagai file statis. Deploy Anda **HANYA perlu build ARC** — ARCWEB otomatis ikut ter-serve.

```
Deploy Anda:
1. Pull git terakhir → dapat /app/frontend/public/arcweb/ (sudah build)
2. Build ARC frontend (craco/npm/webpack — whatever your tool is)
3. Frontend build otomatis copy public/arcweb/ → build/arcweb/
4. Nginx serve /arcweb/* dari build/arcweb/index.html
```

**Yarn TIDAK diperlukan** di VPS Anda. Cukup:
- `npm install` (atau tool build apa pun yang Anda pakai untuk ARC)
- `npm run build`

## 🔧 Kalau ARCWEB source berubah (jarang)

ARCWEB static di-generate dari `/app/arcweb/`. Kalau Anda ubah kode ARCWEB, perlu rebuild-nya. Command tersedia di ARC:

```bash
cd /app/frontend
npm run build:arcweb   # atau: yarn build:arcweb — auto-detect
```

Script ini fallback otomatis: coba `yarn` dulu, kalau tidak ada, pakai `npm ci`, atau `npm install`. Hasil build otomatis ter-copy ke `/app/frontend/public/arcweb/`.

**Tapi 99% kasus Anda tidak perlu ini** — cukup pakai versi pre-built yang sudah di-commit di repo.

## 📦 Deploy One-liner (VPS)

```bash
# Di server, di direktori repo Anda:
git pull                           # dapat kode terakhir + arcweb pre-built
cd frontend
npm install --production=false     # atau npm ci
npm run build                      # build ARC → dist/build/
# Restart service ARC (docker / pm2 / systemd — sesuai setup Anda)
```

## 🌐 URL Setelah Deploy

Anggaplah ARC dideploy di `https://app.luxoptic.id/arc/`:

| URL | Isi |
|---|---|
| `https://app.luxoptic.id/arc/login` | ARC TMS login |
| `https://app.luxoptic.id/arc/arcweb/` | ARCWEB landing (public) |
| `https://app.luxoptic.id/arc/arcweb/#/tracking` | Tracking page |
| `https://app.luxoptic.id/api/public/tracking/{code}` | Public API |

**Untuk custom domain nanti** (mis. `ar-cargo.com`), tinggal set nginx supaya root → serve ARCWEB, dan `arc.ar-cargo.com` → serve ARC. Detail di sesi diskusi migrasi domain sebelumnya.

## ❓ FAQ

**Q: Kenapa ARCWEB pre-built di-commit ke git?**  
A: Supaya deploy tidak butuh build tool tambahan untuk ARCWEB. Cukup ARC's build tool. File static ~1MB, minor overhead. Trade-off worth it untuk simplicity.

**Q: Bagaimana kalau saya update ARCWEB di dev, lupa build?**  
A: Perubahan tidak akan terlihat di production sampai `npm run build:arcweb` dijalankan. Warning: kalau lupa, deploy pakai versi lama. **Best practice**: setiap ubah ARCWEB, jalankan `npm run build:arcweb` sebelum commit.

**Q: Apakah masih perlu docker-compose service `arcweb`?**  
A: **TIDAK**. Setup 2 frontend service sudah tidak relevan. ARC frontend service tunggal cukup untuk keduanya. Docker-compose bisa disederhanakan (hapus service `arcweb`).

**Q: Bagaimana kalau saya mau serve ARCWEB dari domain lain (mis. ar-cargo.com)?**  
A: Salin isi `/app/frontend/public/arcweb/` ke server ARCWEB terpisah (nginx static hosting). Tetap tidak butuh yarn/npm — hanya file static.
