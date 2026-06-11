# 💻 ARC Business Suite — Install di Localhost (Tanpa Docker)

Panduan install di laptop/PC Windows, macOS, atau Linux **tanpa Docker**.  
Cocok untuk: development, demo, atau self-host di komputer kantor.

---

## 📦 Yang Harus Di-Install Manual (sekali aja)

| Software | Versi | Link Download |
|---|---|---|
| **Python** | 3.11 | https://www.python.org/downloads/release/python-3119/ |
| **Node.js** | 20 LTS | https://nodejs.org/dist/v20.18.0/ |
| **Yarn** | Latest | `npm install -g yarn` |
| **MongoDB Community** | 7.0 | https://www.mongodb.com/try/download/community |
| **Git** | Latest | https://git-scm.com/downloads |

> **Catatan:** Tidak perlu Docker, tidak perlu MongoDB Compass GUI.

---

# 🪟 WINDOWS — Step by Step

### 1. Install software dasar
- Python 3.11 → ⚠️ **WAJIB centang "Add Python to PATH"** saat install
- Node.js 20 LTS → install default
- MongoDB 7 → centang "Install as a Service"
- Git → install default

Buka **Command Prompt baru**, verifikasi:
```cmd
python --version
node --version
mongosh --version
git --version
```

Install Yarn:
```cmd
npm install -g yarn
```

### 2. Clone repo
```cmd
cd C:\
mkdir projects
cd projects
git clone https://github.com/USERNAME/REPO.git arc
cd arc
```

### 3. Setup backend (sekali aja)
```cmd
cd C:\projects\arc\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Buat file `backend\.env` (salin dari template lalu edit):
```cmd
copy .env.example .env
notepad .env
```

Isi:
```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=arc_db
JWT_SECRET=ganti_random_minimal_32_karakter_xyz123abc456def789ghi
JWT_ALG=HS256
JWT_EXP_MIN=720
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=AdminLokal123
SEED_OPERATION_USERNAME=operation
SEED_OPERATION_PASSWORD=OpsLokal123
SEED_FINANCE_USERNAME=finance
SEED_FINANCE_PASSWORD=FinLokal123
SEED_DEMO_DATA=false
```

Save & close.

### 4. Setup frontend (sekali aja)
Buka CMD baru:
```cmd
cd C:\projects\arc\frontend
yarn install
```

Buat file `frontend\.env`:
```cmd
copy .env.example .env
```

### 5. Jalankan (tiap hari pakai)

**Cara Mudah — Double-Click:**
```
Double-click file: C:\projects\arc\start-local.bat
```

**Cara Manual — 2 CMD terpisah:**

CMD #1 (backend):
```cmd
cd C:\projects\arc\backend
venv\Scripts\activate
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

CMD #2 (frontend):
```cmd
cd C:\projects\arc\frontend
yarn start
```

Buka browser → http://localhost:3000  
Login: `admin / AdminLokal123` 🎉

### Stop
Tutup 2 CMD window itu (atau tekan Ctrl+C di masing-masing).

---

# 🍎 macOS — Step by Step

### 1. Install via Homebrew (sekali aja)
```bash
# Install Homebrew kalau belum ada
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install semua tools
brew install python@3.11 node@20 yarn git
brew tap mongodb/brew
brew install mongodb-community@7.0

# Start MongoDB sebagai service (auto-start saat boot)
brew services start mongodb-community@7.0
```

Verifikasi:
```bash
python3.11 --version
node --version
yarn --version
mongosh --eval "db.version()"
```

### 2. Clone & setup (sekali aja)
```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/USERNAME/REPO.git arc
cd arc

# Backend
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cat > .env << EOF
MONGO_URL=mongodb://localhost:27017
DB_NAME=arc_db
JWT_SECRET=$(openssl rand -hex 32)
JWT_ALG=HS256
JWT_EXP_MIN=720
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=AdminLokal123
SEED_OPERATION_USERNAME=operation
SEED_OPERATION_PASSWORD=OpsLokal123
SEED_FINANCE_USERNAME=finance
SEED_FINANCE_PASSWORD=FinLokal123
SEED_DEMO_DATA=false
EOF

cd ../frontend
yarn install
cp .env.example .env
cd ..
```

### 3. Jalankan (tiap hari pakai)

**Cara Mudah:**
```bash
cd ~/projects/arc
./start-local.sh
```

**Stop:**
```bash
./stop-local.sh
```

**Cara Manual — 2 terminal:**

Terminal #1:
```bash
cd ~/projects/arc/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Terminal #2:
```bash
cd ~/projects/arc/frontend
yarn start
```

Buka http://localhost:3000

---

# 🐧 LINUX (Ubuntu 22.04+) — Step by Step

### 1. Install dependencies (sekali aja)
```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip git curl gnupg lsof

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn

# MongoDB 7
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
   sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable mongod --now
```

### 2. Clone & setup (sama persis seperti macOS, lihat di atas)

### 3. Jalankan
```bash
cd ~/projects/arc
./start-local.sh    # start
./stop-local.sh     # stop
```

---

# 🔧 Operasi Sehari-hari

### Cek aplikasi jalan
```bash
# Backend
curl http://localhost:8001/api/health
# → {"status":"ok"}

# Frontend
# Buka browser ke http://localhost:3000
```

### Lihat log (kalau pakai start-local.sh)
```bash
tail -f logs/backend.log
tail -f logs/frontend.log
```

### Update kode (setelah pull dari Git)
```bash
cd ~/projects/arc
git pull

# Kalau ada deps baru:
cd backend && source venv/bin/activate && pip install -r requirements.txt && cd ..
cd frontend && yarn install && cd ..

# Restart
./stop-local.sh && ./start-local.sh
```

### Backup database
```bash
# macOS/Linux
mongodump --uri="mongodb://localhost:27017/arc_db" --archive --gzip > backup-$(date +%Y%m%d).gz

# Restore
mongorestore --uri="mongodb://localhost:27017/arc_db" --gzip --archive < backup-20260610.gz
```

```cmd
REM Windows
mongodump --uri="mongodb://localhost:27017/arc_db" --out "C:\backup-%date%"

REM Restore
mongorestore --uri="mongodb://localhost:27017/arc_db" "C:\backup-20260610"
```

---

# 🔥 Troubleshooting

### ❌ "MongoDB tidak jalan"

**Windows:**
```cmd
net start MongoDB
```

**macOS:**
```bash
brew services start mongodb-community@7.0
```

**Linux:**
```bash
sudo systemctl start mongod
sudo systemctl status mongod
```

### ❌ "Port 8001 / 3000 sudah dipakai"

```bash
# macOS/Linux
lsof -ti:8001 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

```cmd
REM Windows
netstat -ano | findstr :8001
taskkill /F /PID <PID>
```

### ❌ "ImportError" atau "ModuleNotFoundError" di backend

```bash
cd backend
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### ❌ "Cannot find module" di frontend

```bash
cd frontend
rm -rf node_modules yarn.lock   # Windows: rmdir /s node_modules
yarn install
```

### ❌ "Connection refused" backend tidak konek MongoDB

```bash
# Test koneksi MongoDB
mongosh --eval "db.adminCommand('ping')"
```

Kalau gagal:
- Cek service MongoDB jalan (lihat troubleshooting #1)
- Cek port 27017 tidak diblokir firewall

### ❌ Lupa password admin

Buka `backend/.env`, lihat `SEED_ADMIN_PASSWORD=...`

Kalau database sudah pernah di-seed dengan password lama:
```bash
# Reset database (HAPUS SEMUA DATA!)
mongosh --eval "use arc_db; db.dropDatabase()"

# Restart backend → auto re-seed dengan password baru di .env
```

### ❌ "Cannot read property of undefined" / page blank

Cek **Console di browser** (F12 → Console tab). Biasanya:
- REACT_APP_BACKEND_URL salah → cek `frontend/.env`
- Backend mati → cek tab Network

---

# 📂 Struktur Folder

```
arc/
├── backend/
│   ├── server.py              ← Main API server
│   ├── requirements.txt
│   ├── .env.example           ← Template — salin jadi .env
│   ├── .env                   ← Edit ini
│   └── venv/                  ← Auto-created
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── .env.example           ← Template — salin jadi .env
│   ├── .env                   ← Edit ini
│   └── node_modules/          ← Auto-created
├── start-local.sh             ← Mac/Linux: jalankan ini
├── start-local.bat            ← Windows: double-click
├── stop-local.sh
└── INSTALL-LOCAL.md           ← Anda di sini
```

---

# ⏭️ Quick Reference

```bash
# === FIRST TIME SETUP ===
# 1. Install Python 3.11, Node 20, MongoDB 7
# 2. git clone repo
# 3. Setup backend:
cd backend && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# Create .env (lihat panduan di atas)
# 4. Setup frontend:
cd ../frontend && yarn install
# Create .env

# === DAILY USE ===
./start-local.sh        # Mac/Linux
start-local.bat         # Windows (double-click)

# === STOP ===
./stop-local.sh         # Mac/Linux
# Windows: tutup 2 CMD window

# === UPDATE ===
git pull
cd backend && source venv/bin/activate && pip install -r requirements.txt && cd ..
cd frontend && yarn install && cd ..
./start-local.sh        # restart
```

---

🎉 **Selamat coding lokal!** Kalau ada error, cek section Troubleshooting di atas atau tanya saya.
