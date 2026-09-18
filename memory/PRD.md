# ARC — TMS/ERP (AR Cargo) — Deployment PRD

## Origin
- Source cloned from private GitHub `rendhy565/ARC` (branch main).
- App = "ARC" (a.k.a TMS "Order to Cash"): FastAPI + Motor backend, React (craco) frontend.
- Database restored from user-provided `arc_db.archive.gz` (mongodump gzip archive).

## What was deployed (2026-06)
- Backend `/app/backend` (server.py ~722KB, all routes prefixed `/api`). Runs via supervisor uvicorn on :8001.
- Frontend `/app/frontend` (craco). Runs via supervisor `yarn start` on :3000.
- MongoDB local. `DB_NAME=arc_db` restored: 23,343 docs, 10 users, 2098 awb orders, 695 invoices, ~38 collections
  (invoices, payroll, journal_entries, awb_orders, employees, chart_of_accounts, customers, vendors, etc.).
- `.env` created:
  - backend: MONGO_URL, DB_NAME=arc_db, JWT_SECRET, CORS_ORIGINS=*
  - frontend: REACT_APP_BACKEND_URL=<preview url>
- No LLM used in this server.py version (no emergentintegrations/EMERGENT_LLM_KEY references found).

## Verified
- POST /api/auth/login (admin/admin123) → returns JWT + user.
- GET /api/health → {"status":"ok"}
- GET /api/orders, /api/customers → return real restored data.
- Frontend login page renders (TMS "Kelola Logistik dari Order hingga Lunas").

## Notes / Backlog
- arcweb/ (company profile SPA) also present in repo but NOT deployed here.
- Frontend calls API via `src/lib/api.js` using REACT_APP_BACKEND_URL + `/api`.
- User will send follow-up questions/requests next.
