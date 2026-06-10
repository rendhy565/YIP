#!/bin/bash
# ============================================================================
# ARC Business Suite — Local Dev Start Script (macOS / Linux)
# Usage: ./start-local.sh
# ============================================================================
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "============================================================"
echo "  ARC Business Suite — Starting Local Server"
echo "============================================================"
echo "  Root: $ROOT"
echo ""

# ── Pre-flight checks ──
fail() { echo -e "${RED}[✗] $*${NC}"; exit 1; }
ok()   { echo -e "${GREEN}[✓] $*${NC}"; }
warn() { echo -e "${YELLOW}[!] $*${NC}"; }

# Cek MongoDB jalan
if command -v mongosh &>/dev/null; then
    if mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; then
        ok "MongoDB jalan"
    else
        fail "MongoDB tidak jalan. macOS: 'brew services start mongodb-community@7.0' | Linux: 'sudo systemctl start mongod'"
    fi
else
    warn "mongosh tidak ditemukan — skip cek MongoDB. Pastikan MongoDB jalan di port 27017"
fi

# Cek venv
[[ -f "$ROOT/backend/venv/bin/activate" ]] || fail "Backend venv belum dibuat. Jalankan: cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
ok "Backend venv ready"

# Cek node_modules
[[ -d "$ROOT/frontend/node_modules" ]] || fail "Frontend deps belum di-install. Jalankan: cd frontend && yarn install"
ok "Frontend node_modules ready"

# Cek .env
[[ -f "$ROOT/backend/.env" ]] || fail "backend/.env belum ada"
[[ -f "$ROOT/frontend/.env" ]] || fail "frontend/.env belum ada"
ok ".env files ready"

# Kill existing processes on port 8001 & 3000 (kalau ada)
for port in 8001 3000; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        warn "Killing existing process on port $port (PID $pid)"
        kill -9 $pid 2>/dev/null || true
    fi
done

# Buat folder log
mkdir -p "$ROOT/logs"

# ── Start backend ──
echo ""
echo -e "${GREEN}[*]${NC} Starting Backend (port 8001)..."
cd "$ROOT/backend"
source venv/bin/activate
nohup uvicorn server:app --host 0.0.0.0 --port 8001 --reload > "$ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$ROOT/logs/backend.pid"
ok "Backend started (PID $BACKEND_PID)"

# Wait for backend health
echo "[*] Menunggu backend siap..."
for i in {1..30}; do
    if curl -s http://localhost:8001/api/health &>/dev/null; then
        ok "Backend ready"
        break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
        warn "Backend tidak respond dalam 30 detik. Cek logs/backend.log"
    fi
done

# ── Start frontend ──
echo ""
echo -e "${GREEN}[*]${NC} Starting Frontend (port 3000)..."
cd "$ROOT/frontend"
BROWSER=none nohup yarn start > "$ROOT/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$ROOT/logs/frontend.pid"
ok "Frontend started (PID $FRONTEND_PID)"

# ── Done ──
cat << EOF

${GREEN}============================================================${NC}
  ARC Business Suite — RUNNING
${GREEN}============================================================${NC}

  🌐 Frontend  : http://localhost:3000
  🔌 Backend   : http://localhost:8001/api/health

  📋 Logs:
     tail -f logs/backend.log
     tail -f logs/frontend.log

  ⏹️  Untuk stop:
     ./stop-local.sh
     (atau Ctrl+C lalu kill $BACKEND_PID $FRONTEND_PID)

  Tunggu 15-30 detik sampai frontend siap, lalu buka browser ke
  http://localhost:3000

EOF
