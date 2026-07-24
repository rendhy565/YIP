#!/usr/bin/env bash
# ==============================================================================
# ARC Backup — installer untuk VPS
# Menyalin script ke /opt/arc-backup dan memasang cron harian @ 00:00 WIB.
# Jalankan sebagai root:  sudo ./install-backup.sh
# ==============================================================================

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/arc-backup}"
CRON_MIN="${CRON_MIN:-0}"
CRON_HOUR="${CRON_HOUR:-0}"            # 00:00 (jam server) — dipaksa WIB via TZ=
CRON_TZ="${CRON_TZ:-Asia/Jakarta}"
CRON_USER="${CRON_USER:-root}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info()  { printf '\033[1;34m[i]\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
fatal() { printf '\033[1;31m[X]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fatal "Harus dijalankan sebagai root (pakai sudo)."

# 1. Cek dependencies wajib
info "Mengecek dependencies..."
MISSING=()
for bin in mongodump gzip find flock crontab; do
  command -v "$bin" >/dev/null 2>&1 || MISSING+=("$bin")
done
if command -v rclone >/dev/null 2>&1; then
  ok "rclone: $(rclone version | head -n1)"
else
  warn "rclone belum terinstall — upload ke Google Drive akan dilewati sampai Anda install."
fi
if ((${#MISSING[@]})); then
  fatal "Dependencies tidak ditemukan: ${MISSING[*]} — install dulu (lihat BACKUP-SETUP.md)."
fi
ok "Semua dependencies wajib tersedia."

# 2. Copy script & config
info "Menyalin file ke ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
install -m 0755 "$SCRIPT_DIR/backup-mongo.sh" "$INSTALL_DIR/backup-mongo.sh"

if [[ -f "$INSTALL_DIR/backup.env" ]]; then
  ok "backup.env sudah ada — tidak ditimpa."
else
  install -m 0600 "$SCRIPT_DIR/backup.env.example" "$INSTALL_DIR/backup.env"
  ok "Config dibuat di ${INSTALL_DIR}/backup.env — WAJIB diedit."
fi

# 3. Siapkan direktori backup & log
BACKUP_DIR="$(grep -E '^BACKUP_DIR=' "$INSTALL_DIR/backup.env" | tail -1 | cut -d= -f2- | tr -d '"'"'")"
LOG_FILE="$(grep -E '^LOG_FILE=' "$INSTALL_DIR/backup.env" | tail -1 | cut -d= -f2- | tr -d '"'"'")"
mkdir -p "${BACKUP_DIR:-/var/backups/arc-mongo}" "$(dirname "${LOG_FILE:-/var/log/arc-backup.log}")"
touch "${LOG_FILE:-/var/log/arc-backup.log}"
ok "Direktori backup & log siap."

# 4. Pasang cron
CRON_LINE="CRON_TZ=${CRON_TZ}
${CRON_MIN} ${CRON_HOUR} * * * ${INSTALL_DIR}/backup-mongo.sh >> ${LOG_FILE:-/var/log/arc-backup.log} 2>&1"

info "Memasang cron untuk user '${CRON_USER}' (${CRON_HOUR}:$(printf '%02d' "$CRON_MIN") ${CRON_TZ} setiap hari)..."
TMP_CRON="$(mktemp)"
crontab -u "$CRON_USER" -l 2>/dev/null | grep -v 'backup-mongo.sh' | grep -v '^CRON_TZ=' > "$TMP_CRON" || true
echo "$CRON_LINE" >> "$TMP_CRON"
crontab -u "$CRON_USER" "$TMP_CRON"
rm -f "$TMP_CRON"
ok "Cron terpasang."

# 5. Ringkasan
cat <<EOF

============================================================
  Instalasi selesai.
============================================================

  Edit config    :  sudo nano ${INSTALL_DIR}/backup.env
  Tes manual     :  sudo ${INSTALL_DIR}/backup-mongo.sh
  Lihat log      :  sudo tail -f ${LOG_FILE:-/var/log/arc-backup.log}
  Cek cron       :  sudo crontab -u ${CRON_USER} -l

  Jadwal         :  Setiap hari ${CRON_HOUR}:$(printf '%02d' "$CRON_MIN") ${CRON_TZ}
  Retensi        :  Rolling 30 hari (lokal + Google Drive)

  Kalau rclone belum di-setup, jalankan (sekali saja):
      rclone config           # buat remote bernama 'gdrive'
      rclone mkdir gdrive:ARC-Backups
      rclone lsd gdrive:      # verifikasi

============================================================
EOF
