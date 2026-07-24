# ARC Business Suite — Auto Backup MongoDB (Rolling 30 Hari + Google Drive)

Backup otomatis MongoDB setiap hari **pukul 00:00 WIB**, disimpan lokal + di-upload ke Google Drive via `rclone`. Backup lebih dari **30 hari** akan dihapus otomatis (rolling). Tanpa intervensi manual setelah setup awal.

```
┌──────────────┐   mongodump      ┌────────────────┐   rclone copy   ┌──────────────┐
│  MongoDB     │ ───────────────▶ │  /var/backups  │ ──────────────▶ │ Google Drive │
│  (server)    │                  │  (30 hari)     │                 │  (30 hari)   │
└──────────────┘                  └────────────────┘                 └──────────────┘
                                          ▲
                                          │ dijalankan oleh cron
                                          │ setiap hari 00:00 WIB
```

---

## Isi Paket

| File | Fungsi |
|---|---|
| `backup-mongo.sh`   | Script utama: dump + upload + rolling delete |
| `backup.env.example`| Template konfigurasi |
| `install-backup.sh` | Installer: copy ke `/opt/arc-backup` + pasang cron |
| `restore-mongo.sh`  | Restore dari archive `.gz` |
| `BACKUP-SETUP.md`   | Panduan ini |

---

## 1. Persiapan di VPS (sekali saja)

### 1a. Install MongoDB Database Tools (`mongodump` / `mongorestore`)

**Ubuntu / Debian:**
```bash
# Ganti "ubuntu2204" sesuai versi OS Anda (cek: lsb_release -cs)
cd /tmp
wget https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.deb
sudo apt install -y ./mongodb-database-tools-*.deb
mongodump --version
```

**CentOS / RHEL / Rocky:**
```bash
sudo yum install -y https://fastdl.mongodb.org/tools/db/mongodb-database-tools-rhel80-x86_64-100.10.0.rpm
```

### 1b. Install `rclone`
```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

### 1c. Setup Google Drive remote di `rclone` (butuh browser sekali)

```bash
rclone config
```

Jawab prompt seperti ini:

| Prompt | Jawab |
|---|---|
| `n/s/q>` | `n` (new remote) |
| `name>` | `gdrive` |
| `Storage>` | ketik `drive` (Google Drive) |
| `client_id>` | *(kosong, Enter)* |
| `client_secret>` | *(kosong, Enter)* |
| `scope>` | `1` (Full access) |
| `service_account_file>` | *(kosong, Enter)* |
| `Edit advanced config? y/n>` | `n` |
| `Use auto config? y/n>` | **`y` kalau VPS punya browser** — akan buka browser lokal. **`n` kalau headless** — dapat URL, buka di laptop Anda, login, paste token balik ke terminal VPS |
| `Configure this as a Shared Drive? y/n>` | `n` |
| `Keep this "gdrive"? y/e/d>` | `y` |
| menu utama | `q` (quit) |

**Untuk VPS headless** (paling umum): jalankan `rclone authorize "drive"` di **laptop Anda** yang punya browser, ikuti login Google, lalu paste token yang keluar ke prompt di VPS.

Verifikasi:
```bash
rclone lsd gdrive:
rclone mkdir gdrive:ARC-Backups
rclone lsd gdrive:ARC-Backups   # harus muncul kosong tanpa error
```

> ⚠️ **Penting:** kalau nanti cron dijalankan sebagai user berbeda (misal `root`), pastikan setup `rclone config` juga dilakukan di user tersebut, atau copy file `~/.config/rclone/rclone.conf` ke user target.
> ```bash
> sudo mkdir -p /root/.config/rclone
> sudo cp ~/.config/rclone/rclone.conf /root/.config/rclone/rclone.conf
> ```

---

## 2. Install Script Backup

```bash
# Dari folder repo (yang berisi folder scripts/)
cd scripts
sudo ./install-backup.sh
```

Installer akan:
1. Cek dependencies (`mongodump`, `rclone`, `gzip`, `flock`, `crontab`)
2. Copy `backup-mongo.sh` → `/opt/arc-backup/`
3. Buat `/opt/arc-backup/backup.env` dari template (kalau belum ada)
4. Buat direktori backup & log
5. Pasang cron **`0 0 * * *` dengan `CRON_TZ=Asia/Jakarta`** untuk user `root`

---

## 3. Konfigurasi

Edit config:
```bash
sudo nano /opt/arc-backup/backup.env
```

Setidaknya isi:
```env
MONGO_URI="mongodb://localhost:27017"    # atau URI Atlas Anda
DB_NAME="arcdb"                          # sesuaikan (lihat backend/.env → DB_NAME)
RCLONE_REMOTE="gdrive"
RCLONE_DEST_PATH="ARC-Backups"
RETENTION_DAYS=30
```

Kalau MongoDB Anda pakai auth:
```env
MONGO_URI="mongodb://arc_user:PASSWORD@localhost:27017/arcdb?authSource=admin"
MONGO_AUTH_DB="admin"
```

---

## 4. Tes Manual

```bash
sudo /opt/arc-backup/backup-mongo.sh
sudo tail -n 50 /var/log/arc-backup.log
```

Cek file:
```bash
ls -lh /var/backups/arc-mongo/
rclone ls gdrive:ARC-Backups/
```

Kalau muncul `arc-mongo-<host>-<tanggal>.gz` di dua tempat → berhasil.

---

## 5. Verifikasi Cron

```bash
sudo crontab -l
```

Harus terlihat:
```
CRON_TZ=Asia/Jakarta
0 0 * * * /opt/arc-backup/backup-mongo.sh >> /var/log/arc-backup.log 2>&1
```

Cek layanan cron aktif:
```bash
systemctl status cron        # Ubuntu/Debian
systemctl status crond       # RHEL/CentOS
```

---

## 6. Bagaimana Rolling 30 Hari Bekerja

Setiap kali script jalan:

1. Bikin `arc-mongo-<host>-YYYY-MM-DD.gz` (nama unik per hari)
2. Upload ke `gdrive:ARC-Backups/`
3. **Hapus lokal**: semua file `arc-mongo-*.gz` di `/var/backups/arc-mongo/` yang `mtime > 30 hari` → `find ... -mtime +30 -delete`
4. **Hapus remote**: `rclone delete ... --min-age 30d --include "arc-mongo-*.gz"`

Jadi di hari ke-31, backup hari ke-1 otomatis terhapus. Tidak ada intervensi manusia.

Ubah retensi dengan mengedit `RETENTION_DAYS` di `backup.env`.

---

## 7. Restore

```bash
# Kalau file ada di lokal
sudo /opt/arc-backup/restore-mongo.sh /var/backups/arc-mongo/arc-mongo-vps-2026-01-15.gz

# Kalau harus ambil dulu dari Google Drive
rclone copy gdrive:ARC-Backups/arc-mongo-vps-2026-01-15.gz /tmp/
sudo /opt/arc-backup/restore-mongo.sh /tmp/arc-mongo-vps-2026-01-15.gz

# Restore ke DB berbeda (mis. staging)
sudo /opt/arc-backup/restore-mongo.sh /tmp/arc-mongo-vps-2026-01-15.gz arcdb_staging
```

> ⚠️ Restore menggunakan `--drop` — database tujuan akan **ditimpa total**.

---

## 8. Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| `mongodump: command not found` | Install MongoDB Database Tools (langkah 1a) |
| `rclone: Failed to create file system: didn't find section in config file` | Belum `rclone config` untuk user cron. Copy `rclone.conf` ke `/root/.config/rclone/` |
| Cron tidak jalan padahal manual OK | Cek `sudo grep CRON /var/log/syslog`; pastikan service cron aktif; TZ harus di baris `CRON_TZ=Asia/Jakarta` |
| Archive 0 byte / mongodump gagal | Cek `MONGO_URI`, kredensial, dan MongoDB memang running (`systemctl status mongod`) |
| Google Drive penuh | Backup akan tetap dibuat lokal, upload gagal (log warning). Bersihkan drive / upgrade / kurangi `RETENTION_DAYS` |
| Backup terlalu besar | Set `RCLONE_BWLIMIT="10M"` biar tidak makan bandwidth; atau kompres lebih dulu (default sudah `--gzip`) |
| Lock file tersangkut | `sudo rm /tmp/arc-backup.lock` (hanya kalau proses benar-benar mati) |

Cek jadwal cron berikut yang akan jalan:
```bash
sudo systemctl list-timers    # kalau pakai systemd timer (alternatif)
```

---

## 9. Uninstall

```bash
sudo crontab -l | grep -v backup-mongo.sh | grep -v CRON_TZ | sudo crontab -
sudo rm -rf /opt/arc-backup
# opsional:
sudo rm -rf /var/backups/arc-mongo /var/log/arc-backup.log
```

---

## 10. Catatan Keamanan

- File `backup.env` bisa berisi password MongoDB — installer set permission `0600` (root only).
- Token OAuth `rclone` disimpan di `~/.config/rclone/rclone.conf` — jaga file ini.
- Backup di Google Drive di-encrypt at-rest oleh Google, tapi kalau Anda ingin **encrypt sendiri** sebelum upload, tambahkan `rclone crypt` remote di atas `gdrive` (lihat https://rclone.org/crypt/).

Selesai. Semua otomatis 🚀
