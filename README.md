# ARC Business Suite

Sistem ERP/TMS lengkap: Order Management, Accounting (PSAK), HR & Payroll, Tax, Asset, Bank Recon, dan Analytics Dashboard.

**Tech stack:** React + FastAPI + MongoDB

## 🚀 Instalasi

Lihat panduan lengkap di **[INSTALL-LOCAL.md](INSTALL-LOCAL.md)** — step by step untuk Windows, macOS, dan Linux.

Ringkasan cepat:

```bash
# 1. Install Python 3.11, Node 20, Yarn, MongoDB 7
# 2. Clone repo, lalu:

# Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # lalu edit sesuai kebutuhan

# Frontend
cd ../frontend
yarn install
cp .env.example .env

# Jalankan (dari root repo)
./start-local.sh            # Mac/Linux
start-local.bat             # Windows (double-click)
```

Buka http://localhost:3000 → login dengan akun seed di `backend/.env`.
