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

## Update (2026-06): Pipeline Penerimaan — month range (From–To)
- Backend `/api/reports/receivable-pipeline`: tambah param `month_from` & `month_to` (YYYY-MM). Filter tgl order kini rentang inklusif; auto-swap jika terbalik; `month` tunggal tetap didukung (backward compat). Response memuat `month_from`/`month_to`.
- Frontend `ReceivablePipeline.js`: MonthPicker tunggal → dua picker (Dari/Sampai bulan) + tombol Reset. State `monthFrom`/`monthTo`, label rentang, dan nama file export mengikuti rentang. Export Excel (client-side dari `data`) otomatis respect rentang.
- Verifikasi API: Agustus (open46/ny314/inv84) + September (open329/ny0/inv1) = rentang Agu–Sep (open375/ny314/inv85). Sum cocok persis. Export mengikuti data yg sama.

## Update (2026-06): Aturan akuntansi Panjar → BDD + default Operation/Rumah Tangga
- Panjar Open kini dicatat sebagai **1104 Biaya Dibayar di Muka (BDD)**, bukan 1108 lagi.
  - `create_cash_advance` & BKK-import create: DR 1104 / CR Kas. Konstanta `PANJAR_ASSET_CODE="1104"`.
  - Settle (semua flow) meng-CR 1104 (termasuk carry-over).
- Default akun beban saat settle (helper `cash_advance_default_expense_code`) — HANYA untuk porsi tanpa kategori/breakdown eksplisit:
  - Penerima cocok ke user role `operation` (match recipient_id atau recipient_name→users.full_name/username) → **5102 Beban Operasional Pengiriman**.
  - Selain itu → **6201 Beban Rumah Tangga**.
  - Baris kategori finance eksplisit (62xx) tetap seperti pilihan user.
- Migrasi retroaktif `backend/scripts/migrate_panjar_bdd.py` (idempoten) dijalankan:
  - 596 jurnal panjar di-relabel: 1108→1104 (394 create + 202 settle), 100 baris settle 5102→6201 (penerima non-operation).
  - Saldo 1108=0; 1104(BDD) menyerap saldo panjar; Neraca tetap balanced (verified via /api/reports/balance-sheet).
- Verified end-to-end: create+settle panjar recipient operation → 5102; recipient non-user → 6201; keduanya DR/CR 1104. Data uji dihapus.

## Update (2026-06): Re-deploy + restore DB baru + audit jurnal Panjar
- Restore ulang dari upload user ("Copy of Copy of arc_db.archive.gz") via `mongorestore --gzip --drop`: 24.525 dokumen.
  Koleksi utama: awb_orders 2202, invoices 857, journal_entries 9994, cash_advances 389 (Panjar), fixed_costs 877, users 10.
- Services jalan (supervisor): backend :8001, frontend :3000. Login admin/admin123 OK, GET /api/health OK.
- Fix lint config: `.oxlintrc.json` ignore `**/public/arcweb/**` (false positive di bundle minified).
- Audit jurnal Panjar Kerja (akun 1108):
  - Create panjar: DR 1108 Panjar Kerja / CR Kas-Bank (1101/1102). Terverifikasi balance.
  - Settle panjar: DR beban (5102 HPP / 62xx finance / awb_costs) + DR Kas (refund) / CR 1108. Balance.
  - Contoh nyata PNJ-202607-0001 (Rp3jt): create DR1108 3jt; multi-partial settle CR1108 total 2.693.638 = settled_amount. Cocok.
  - REKONSILIASI 1108 (temuan, bukan bug — data legacy/import):
    - Saldo buku besar 1108 = Rp315.451.543 (DR 422.578.601 / CR 107.127.058).
    - Outstanding Open panjar sesungguhnya = Rp208.654.600 (9 panjar Open).
    - Gap ~Rp106,8jt terutama dari 272 panjar berstatus "Settled" tapi settled_amount=0 & tanpa jurnal settle (total amount Rp57.185.000) + partial settle + 5 jurnal create "orphan" (panjar sudah dihapus, jurnal tertinggal).
    - Carry-over transferred belum dikonsumsi = 0.

## Update (2026-06): Revenue exclude PPN
- Requirement: revenue/Selling/Margin/Nilai AWB must EXCLUDE PPN (VAT); PPN only for invoice/payment.
- Definition chosen (user): selling = grand_total - tax_amount (DPP + addon, exclude PPN).
- Added helper `sellingOf()` in frontend/src/lib/utils.js.
- Changed: OrdersList (Sales/Margin totals, row Selling, receive modal "Nilai AWB (Exc. PPN)"), Recap (Selling/Margin), Costs prorata (basis + displays).
- Backend server.py: _generate_prorata_children._sales() = grand_total-tax_amount; candidate-awbs & cost-group children now return tax_amount & total_tariff.
- Kept WITH PPN: InvoicesCreated, Payments, receive modal "Total Invoice (preview)".
- Verified by testing_agent iteration_1.json: 100% pass. PPN rate in data ~1.1% (explains earlier ~1.011 Excel gap). Canonical test AWB 201189.
