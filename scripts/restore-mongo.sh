#!/usr/bin/env bash
# ==============================================================================
# ARC Backup — restore dari archive .gz
# Usage:
#   ./restore-mongo.sh <archive.gz> [target-db-name]
#
# Contoh:
#   sudo ./restore-mongo.sh /var/backups/arc-mongo/arc-mongo-vps-2026-01-15.gz
#   sudo ./restore-mongo.sh arc-mongo-vps-2026-01-15.gz arcdb_staging   # rename db
#
# Kalau file belum ada di lokal, download dulu dari Google Drive:
#   rclone copy gdrive:ARC-Backups/arc-mongo-vps-2026-01-15.gz /tmp/
# ==============================================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${BACKUP_ENV_FILE:-${SCRIPT_DIR}/backup.env}"
[[ -f "$CONFIG_FILE" ]] && { set -a; source "$CONFIG_FILE"; set +a; }

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-}"
MONGO_AUTH_DB="${MONGO_AUTH_DB:-admin}"

ARCHIVE="${1:-}"
TARGET_DB="${2:-$DB_NAME}"

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: $0 <archive.gz> [target-db-name]"
  exit 1
fi

echo "!!! Restore akan MENIMPA database '$TARGET_DB' di $MONGO_URI"
read -r -p "Ketik 'YES' untuk lanjut: " CONFIRM
[[ "$CONFIRM" == "YES" ]] || { echo "Dibatalkan."; exit 1; }

RESTORE_CMD=(mongorestore --uri="$MONGO_URI"
             --archive="$ARCHIVE" --gzip
             --authenticationDatabase="$MONGO_AUTH_DB"
             --drop)

if [[ -n "$TARGET_DB" && -n "$DB_NAME" && "$TARGET_DB" != "$DB_NAME" ]]; then
  RESTORE_CMD+=(--nsFrom="${DB_NAME}.*" --nsTo="${TARGET_DB}.*")
fi

echo "Menjalankan: ${RESTORE_CMD[*]}"
"${RESTORE_CMD[@]}"
echo "OK — restore selesai."
