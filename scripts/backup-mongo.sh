#!/usr/bin/env bash
# ==============================================================================
# ARC Business Suite — MongoDB Auto Backup (rolling 30 hari + Google Drive)
# ------------------------------------------------------------------------------
# - mongodump ke archive .gz per hari
# - simpan di lokal + upload ke Google Drive (via rclone)
# - hapus otomatis backup > RETENTION_DAYS di lokal & remote
# - safe untuk cron (set -e, trap error, lock file)
# ==============================================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 1. Load config ----------
CONFIG_FILE="${BACKUP_ENV_FILE:-${SCRIPT_DIR}/backup.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/arc-mongo}"
LOG_FILE="${LOG_FILE:-/var/log/arc-backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-}"                       # kosong = dump SEMUA database
MONGO_AUTH_DB="${MONGO_AUTH_DB:-}"           # kosong = mongodump auto-detect dari URI

RCLONE_ENABLED="${RCLONE_ENABLED:-true}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_DEST_PATH="${RCLONE_DEST_PATH:-ARC-Backups}"
RCLONE_BWLIMIT="${RCLONE_BWLIMIT:-}"         # cth: 10M utk 10 MB/s

LOCK_FILE="${LOCK_FILE:-/tmp/arc-backup.lock}"

# ---------- 2. Helpers ----------
mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S %Z')" "$*" | tee -a "$LOG_FILE"
}

on_error() {
  local exit_code=$?
  log "ERROR: backup gagal (exit=$exit_code) di line ${BASH_LINENO[0]}"
  exit "$exit_code"
}
trap on_error ERR

# ---------- 3. Lock supaya tidak overlap ----------
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP: backup sebelumnya masih jalan (lock: $LOCK_FILE)"
  exit 0
fi

TS_START=$(date +%s)
DATE_TAG="$(date +'%Y-%m-%d')"
HOSTNAME_TAG="$(hostname -s 2>/dev/null || echo host)"
ARCHIVE_NAME="arc-mongo-${HOSTNAME_TAG}-${DATE_TAG}.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

log "===== START backup ARC MongoDB ====="
log "Target      : ${MONGO_URI} db='${DB_NAME:-<ALL>}'"
log "Archive     : ${ARCHIVE_PATH}"
log "Retention   : ${RETENTION_DAYS} hari"
log "Rclone      : ${RCLONE_ENABLED} (${RCLONE_REMOTE}:${RCLONE_DEST_PATH})"

# ---------- 4. Cek dependencies ----------
for bin in mongodump gzip find flock; do
  command -v "$bin" >/dev/null 2>&1 || { log "FATAL: '$bin' tidak ditemukan di PATH"; exit 127; }
done

# ---------- 5. mongodump ----------
DUMP_CMD=(mongodump --uri="$MONGO_URI"
          --archive="$ARCHIVE_PATH"
          --gzip
          --quiet)

[[ -n "$MONGO_AUTH_DB" ]] && DUMP_CMD+=(--authenticationDatabase="$MONGO_AUTH_DB")
[[ -n "$DB_NAME"       ]] && DUMP_CMD+=(--db="$DB_NAME")

log "Menjalankan mongodump..."
"${DUMP_CMD[@]}"

if [[ ! -s "$ARCHIVE_PATH" ]]; then
  log "FATAL: archive kosong / tidak terbuat"
  exit 1
fi

ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
log "OK dump lokal: ${ARCHIVE_PATH} (${ARCHIVE_SIZE})"

# ---------- 6. Upload ke Google Drive ----------
if [[ "$RCLONE_ENABLED" == "true" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    RCLONE_ARGS=(copy "$ARCHIVE_PATH" "${RCLONE_REMOTE}:${RCLONE_DEST_PATH}/"
                 --transfers=2 --checkers=4 --retries=3 --low-level-retries=10
                 --log-file="$LOG_FILE" --log-level=INFO)
    [[ -n "$RCLONE_BWLIMIT" ]] && RCLONE_ARGS+=(--bwlimit "$RCLONE_BWLIMIT")

    log "Upload ke ${RCLONE_REMOTE}:${RCLONE_DEST_PATH}/..."
    rclone "${RCLONE_ARGS[@]}"
    log "OK upload"

    log "Menghapus backup remote > ${RETENTION_DAYS} hari..."
    rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST_PATH}/" \
      --min-age "${RETENTION_DAYS}d" \
      --include "arc-mongo-*.gz" \
      --log-file="$LOG_FILE" --log-level=INFO || log "WARN: rclone delete remote gagal (dilewati)"
  else
    log "WARN: rclone tidak terinstall — upload dilewati"
  fi
else
  log "Rclone dinonaktifkan (RCLONE_ENABLED=false) — upload dilewati"
fi

# ---------- 7. Rolling delete lokal ----------
log "Menghapus backup lokal > ${RETENTION_DAYS} hari..."
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'arc-mongo-*.gz' -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
log "Dihapus ${DELETED} file lokal lama"

# ---------- 8. Selesai ----------
TS_END=$(date +%s)
log "===== SELESAI dalam $((TS_END - TS_START)) detik ====="
exit 0
