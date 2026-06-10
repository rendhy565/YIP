#!/bin/bash
# ============================================================================
# ARC Business Suite — One-line installer for fresh Ubuntu/Debian VPS
# Usage: curl -fsSL https://your-domain/install.sh | sudo bash
#        or: sudo bash install.sh
# ============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
fail()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# Check root
[[ $EUID -ne 0 ]] && fail "Please run as root (sudo bash install.sh)"

# Detect OS
if ! [[ -f /etc/os-release ]]; then
    fail "Cannot detect OS"
fi
. /etc/os-release
log "Detected OS: $PRETTY_NAME"

INSTALL_DIR=/opt/arc
GIT_REPO=${ARC_GIT_REPO:-}

# 1. Install Docker
log "Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker installed"
else
    log "Docker already installed: $(docker --version)"
fi

# 2. Make sure docker compose v2 is available
if ! docker compose version &>/dev/null; then
    fail "Docker Compose v2 not available. Update Docker."
fi

# 3. Create install directory & fetch code
if [[ -d "$INSTALL_DIR" ]]; then
    warn "$INSTALL_DIR already exists — skipping clone. Run 'git pull' inside manually if needed."
else
    if [[ -n "$GIT_REPO" ]]; then
        log "Cloning $GIT_REPO into $INSTALL_DIR..."
        git clone "$GIT_REPO" "$INSTALL_DIR"
    else
        warn "ARC_GIT_REPO env var not set. Create $INSTALL_DIR manually and copy source."
        mkdir -p "$INSTALL_DIR"
    fi
fi

cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

# 4. Generate .env from example if missing
if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        cp .env.example .env
        log ".env created from .env.example"
    else
        fail "Neither .env nor .env.example found"
    fi
fi

# 5. Auto-generate strong secrets if user hasn't customized
JWT_RANDOM=$(openssl rand -hex 32)
MONGO_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
ADMIN_PW=$(openssl rand -base64 18 | tr -d '/+=' | head -c 18)
OPS_PW=$(openssl rand -base64 18 | tr -d '/+=' | head -c 18)
FIN_PW=$(openssl rand -base64 18 | tr -d '/+=' | head -c 18)

# Replace CHANGE_ME placeholders only if still present
sed -i.bak \
    -e "s|JWT_SECRET=CHANGE_ME_run_openssl_rand_hex_32_to_generate|JWT_SECRET=$JWT_RANDOM|" \
    -e "s|MONGO_ROOT_PASSWORD=CHANGE_ME_to_a_strong_password_min_16_chars|MONGO_ROOT_PASSWORD=$MONGO_PW|" \
    -e "s|SEED_ADMIN_PASSWORD=CHANGE_ME_admin_password|SEED_ADMIN_PASSWORD=$ADMIN_PW|" \
    -e "s|SEED_OPERATION_PASSWORD=CHANGE_ME_operation_password|SEED_OPERATION_PASSWORD=$OPS_PW|" \
    -e "s|SEED_FINANCE_PASSWORD=CHANGE_ME_finance_password|SEED_FINANCE_PASSWORD=$FIN_PW|" \
    .env

rm -f .env.bak
log ".env configured with auto-generated secrets"

# 6. Build & start
log "Building docker images (this takes ~3-5 minutes)..."
docker compose build

log "Starting services..."
docker compose up -d

# 7. Wait for health
log "Waiting for services to become healthy..."
sleep 15
docker compose ps

# 8. Final info
SERVER_IP=$(hostname -I | awk '{print $1}')
cat <<EOF

${GREEN}╔════════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║  ARC Business Suite — Installation Complete!                       ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════════╝${NC}

🌐 URL              : http://$SERVER_IP
📁 Install path     : $INSTALL_DIR

👤 Login credentials (SAVE THESE — they are random-generated):
   ┌──────────────┬─────────────────────────────────────┐
   │ Role         │ Credential                          │
   ├──────────────┼─────────────────────────────────────┤
   │ Administrator│ admin / $ADMIN_PW
   │ Operation    │ operation / $OPS_PW
   │ Finance      │ finance / $FIN_PW
   └──────────────┴─────────────────────────────────────┘

📚 Next steps:
   1. Login & change all passwords in /users
   2. Setup HTTPS (Caddy/Certbot) — see INSTALL.md
   3. Configure CORS_ORIGINS in .env to your domain
   4. Setup automated backup (cron)

📖 Documentation : $INSTALL_DIR/INSTALL.md
📋 Logs          : cd $INSTALL_DIR && docker compose logs -f

EOF
