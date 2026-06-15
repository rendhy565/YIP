# ARC Business Suite — Product Requirements Document

## Problem Statement
User connected GitHub repo `rendhy565/ARC` (TMS — Trucking Management System for Indonesian logistics company) and asked:
1. Apakah ada modul akunting? — Backend sudah ada endpoint akunting (PSAK), tapi belum ada UI frontend
2. Apa yang kurang untuk run perusahaan full? — HR, Tax, Asset, Bank Reconciliation
3. Permintaan: Buat semua, tapi dengan feature toggle ON/OFF di Settings (admin only). Jika OFF tidak boleh ganggu sistem

## Tech Stack
- Backend: FastAPI (Python) + MongoDB (motor async)
- Frontend: React 18 + React Router v6 + TailwindCSS + Axios + Sonner toast + Lucide icons
- Auth: JWT, 3 roles (administrator, operation, finance)
- PSAK-compliant Chart of Accounts (1xxx-6xxx), double-entry journal engine

## User Personas
- **Administrator** — Full access; manages users, modules, master data, period closing
- **Operation** — Order input, AWB tracking, cost plotting, reconciliation, invoicing
- **Finance** — Payment recording, vendor settlement, fixed costs, payroll, tax records, bank recon

## Core Requirements (static)
- Order-to-Cash flow: Input Order → Plotting Biaya → Rekap & Rekonsiliasi → Invoice → Payment
- Akunting PSAK lengkap: COA, Jurnal, Buku Besar, Trial Balance, Neraca, Laba Rugi, Arus Kas, Tutup Buku
- Modul opsional (toggleable): HR & Payroll, Pajak (PPN/PPh), Aset Tetap & Depresiasi, Rekonsiliasi Bank
- Multi-role permission per modul
- Auto-journal: penjualan, cost, payment, fixed-cost, payroll, depresiasi → semua double-entry balanced

## What's Been Implemented (2026-06-09)

### Iteration 1 — Backend bootstrap fix
- Diagnosed: backend not starting due to `pydantic 2.9.2` vs `pydantic_core 2.46.4` version mismatch
- Reinstalled `pydantic_core==2.23.4` → login works, MongoDB connected, all seed data intact

### Iteration 2 — Akunting + 4 Modul Tambahan + Feature Flag System

#### A. Feature Flag System (NEW)
- `db.feature_flags` collection auto-seeded on startup
- 5 modules: `accounting` (default ON), `hr`, `tax`, `asset`, `bank_recon` (default OFF)
- Backend: `GET /api/feature-flags` (all users), `PUT /api/feature-flags/{key}` (admin only) → returns 403 for non-admin
- Backend: `require_feature(key)` dependency → returns 503 with Indonesian message when module disabled
- Frontend: `FeatureFlagsProvider` + `useFeatureFlags()` + `FeatureGate` component → routes redirect to `/` if module off
- Frontend: Sidebar `Layout.js` hides entire menu section if its feature is off
- Toggle UI in Settings (admin only) with `data-testid="feature-toggle-{key}"`

#### B. 8 Akunting Pages (NEW frontend, existing backend)
1. `/accounting/coa` — Chart of Accounts (CRUD by admin, sistem accounts protected)
2. `/accounting/journal` — Jurnal Umum (auto + manual posting, balance validator, filter by period/ref/account)
3. `/accounting/ledger` — Buku Besar (mutasi per akun + saldo berjalan)
4. `/accounting/trial-balance` — Neraca Saldo (per period)
5. `/accounting/balance-sheet` — Neraca (Aset/Liabilitas/Ekuitas, seimbang ✓)
6. `/accounting/income-statement` — Laporan Laba Rugi formal (Pendapatan - HPP - Beban)
7. `/accounting/cash-flow` — Arus Kas (Operasi/Investasi/Pendanaan, direct method)
8. `/accounting/opening-closing` — Saldo Awal & Tutup Buku Periodik (admin)

#### C. 4 Modul Tambahan (NEW, gated by toggle)
- **HR & Payroll** (`/hr`) — Master karyawan + run payroll bulanan + auto-jurnal Dr 6101/Cr Kas/Cr 2220 PPh21
- **Pajak** (`/tax`) — Ringkasan PPN Keluaran/Masukan dari jurnal + catatan PPh manual
- **Aset Tetap** (`/assets`) — Master aset PSAK 16 + run depresiasi garis lurus + auto-jurnal Dr 6105/Cr 1502
- **Rekonsiliasi Bank** (`/bank-recon`) — Input mutasi bank + auto-find kandidat jurnal (±7 hari, ±Rp1) + match/unmatch

#### D. Bug Fixes
- Balance Sheet **contra-asset (1502 Akumulasi Penyusutan)** bug: sebelumnya +8M ditambahkan ke total aset. Fix: untuk type=asset, raw `debit-credit` (tidak flip sign) → contra-asset muncul negatif & mengurangi total dengan benar
- HR Payroll **ObjectId serialization** bug: legacy payroll docs punya raw ObjectId di `slip.employee_id`. Fix: serialize() di `list_payroll` convert nested ObjectId → str

#### E. Sidebar/Branding
- Brand: TMS → **ARC Business Suite** (lebih general untuk multi-module)
- Menu reorganized: Order to Cash · Biaya · Master & Laporan · Akunting (PSAK) · HR · Tax · Asset · Bank Recon · Sistem

## Testing Status
- Backend: 92% (36/39 pytest), balance-sheet & payroll fixed → expected 100%
- Frontend: 95%+ verified via screenshots (login, COA, Settings toggle, Balance Sheet, Income Statement, Cash Flow, HR enable→navigate)
- Feature gating verified: 503 when OFF, 403 for non-admin toggle, redirect to `/` when frontend route OFF
- Auth: admin/admin123, operation/operation123, finance/finance123 — all working

## Prioritized Backlog

### P0 — Blocker
- (none — all critical paths working)

### P1 — Next Iteration
- Period reset for payroll/depreciation re-run (currently 400 if period already processed)
- Hide entire "Aktivasi Modul" section from non-admin (currently visible but disabled)
- Income Statement export to PDF/Excel
- Audit log: who toggled which feature/edited which journal

### P2 — Backlog
- Multi-currency support (USD/SGD)
- Purchase Order & Goods Receipt module
- Budget vs Actual tracking
- CRM lite (leads, sales pipeline)
- Approval workflow (multi-level for big costs)
- WhatsApp/Email notifications (invoice due, payroll release)
- Mobile/PWA for field drivers
- Multi-branch support
- E-Faktur PPN integration

## Future Enhancements (user-suggested)
- User akan kembangkan format laporan akunting sendiri di iterasi berikutnya
- Consider: Tax module needs deeper PPh21 calculation per PTKP (currently flat 5%)

### Iteration 3 (2026-06-09) — Excel Import Pipeline + Real Master Data

#### A. Schema Extension
- **`vendors`** collection baru (master vendor): name, code, armada_type, npwp, address, bank_account, pph_type
- **`awb_orders`** tambah field: `wo_number`, `destination_city`, `region`, `intracity`, `cashback_amount`, `pph_final`, `fleet_type`, `armada_type`, `external_invoice_number`, `notes`, `items[]` (array multi-line per AWB)
- **`customers`** tambah field: `short_name`, `region`, `category`
- **`awb_costs`** tambah field: `vendor_id`, `armada_type`, `fleet_type`
- **`invoices`** tambah field: `external_invoice_number` (preserve customer's invoice format)
- **Master constants**: `/api/masters/regions` (16 wilayah), `/api/masters/fleet-types` (CDE/CDD/TRONTON/dll), `/api/masters/armada-types`

#### B. Wipe & Import Endpoints
- `POST /api/admin/wipe-transactions` (admin only, requires `confirm: "HAPUS SEMUA DATA"`) — clears 15 collections, sets `skip_dummy_seed` flag so backend restart never re-seeds
- `POST /api/import/excel/list-sheets` — returns all sheets with row counts & is_data_sheet detection + recommended sheet
- `POST /api/import/excel` (multipart): file + dry_run + sheet_names. Smart auto-pick prefers `DATA ALL BASE (2)` to avoid overlap

#### C. Import Logic
- Header detection: 50+ aliases mapped to canonical keys (`'NO. WO'→wo_number`, `'TGL. PICK UP'→pickup_date`, dll)
- Auto-create customer (with short_name, region, category) & vendor (with armada_type) on first encounter
- Duplicate AWB → appends to `items[]` array + increments `total_tariff`/`tax_amount`/`grand_total`
- Auto-generate journal entries: Sales (1201/4101/2210), Cost (5xxx-6xxx/2101 or 1101), Payment (1101/1201)
- Status mapping: Excel `STATUS PENAGIHAN`/`STATUS PEMBAYARAN` → ARC `status` (Open/Reconciled/Invoiced/Paid)

#### D. Import Wizard UI (`/import` — admin only)
- Danger Zone: typed-confirmation wipe button
- 4-step stepper: Upload → Pick Sheets → Preview (dry-run) → Execute
- KPI cards with green/amber/white based on status (created/errors/skipped)
- Per-sheet drill-down with row count breakdown
- Sample errors shown with limit

#### E. Real Data Imported (REPORT PENJUALAN.xlsx)
- 30 Customer, 17 Vendor, 592 AWB unik
- 413 cost entries, 198 invoice records
- **1028 journal entries** auto-posted
- Result: Revenue Rp 2,57 M · Gross Profit 66.9% · Balance Sheet seimbang Rp 2,06 M

#### F. Fixes
- `balanced` check di balance-sheet pakai tolerance < Rp 0,5 (floating-point rounding-safe)
- Disable auto-dummy-seed setelah wipe (via `settings.skip_dummy_seed` flag) — backend restart tidak akan re-seed dummy
- Sidebar menu items also respect `adminOnly` flag (sebelumnya cuma section-level)

### Iteration 7 (2026-06-11) — Repo Cleanup: Fokus Localhost (Hapus VPS/Docker) ✅
User memutuskan fokus deployment localhost dulu, repo dibersihkan dari semua file VPS/Docker:
- DELETED: `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `.dockerignore`, `install.sh`, `INSTALL.md`, root `.env.example`
- NEW: `backend/.env.example` + `frontend/.env.example` (template localhost, env var names sesuai server.py: `JWT_ALG`, `JWT_EXP_MIN`)
- `INSTALL-LOCAL.md` dirapikan: env var names dibetulkan (sebelumnya salah `JWT_ALGORITHM`/`JWT_EXPIRE_HOURS`/`CORS_ORIGINS` yang tidak dipakai backend), section perbandingan VPS dihapus, instruksi pakai `cp .env.example .env`
- `README.md` ditulis ulang: deskripsi app + quick start localhost
- `.gitignore` dilengkapi: `node_modules/`, `__pycache__/`, `venv/`, `logs/`, `*.pid`, `frontend/build/`
- Catatan: CORS backend hardcoded `allow_origins=["*"]` di server.py — env CORS_ORIGINS tidak pernah dipakai
- Verified: backend health OK + login admin OK setelah cleanup

### Iteration 6 (2026-02-10) — Saved Views (Personal + Shared) ✅

#### A. Backend (`saved_views` collection)
- `GET /api/analytics/saved-views` — list own + shared views (returns `is_mine`, `owner_username` per row)
- `POST /api/analytics/saved-views` — create view {name, filters, is_shared}, validates name (1-80 chars)
- `GET /api/analytics/saved-views/{vid}` — fetch single view (403 jika private dan bukan owner)
- `PATCH /api/analytics/saved-views/{vid}` — rename / toggle share / update filters (owner only)
- `DELETE /api/analytics/saved-views/{vid}` — owner atau admin

#### B. Frontend (`/analytics`)
- Saved Views bar di atas filter card dengan chip per view (`[data-testid="saved-view-{id}"]`)
- Chip menampilkan: icon globe/lock (shared/private), nama view, owner username jika bukan milik sendiri
- Tombol per chip: Share link (copy URL), Toggle share (owner only), Delete (owner only)
- Modal "Simpan View Baru" dengan input nama + preview filter aktif + checkbox share
- Deep-link via URL `?view={id}` — auto-apply filter saat page load
- Active view badge "Aktif: {name}"

#### C. Verification (2026-02-10)
- ✅ List awal kosong → POST create private (admin) → POST create shared (admin) → Operation hanya lihat 1 shared view (is_mine=false)
- ✅ Operation DELETE/GET private = 403; GET shared = 200; admin PATCH rename+unshare = 200
- ✅ Validation empty name = 400
- ✅ UI: modal render, view chip muncul, toast confirm, "Aktif" badge, deep-link `?view={id}` apply filter "JKT"
- ✅ Operation hanya lihat tombol share-link (tidak ada delete/toggle untuk view milik admin)

### Iteration 5 (2026-02-10) — Excel Export + Row Actions + No Auto-Seed (VERIFIED)

#### A. Backend
- `GET /api/analytics/awbs-detail/export` — Streams XLSX file dengan semua filter sama seperti detail table (23 kolom × N rows). Verified: 78KB, 585 rows, valid openpyxl format
- `DELETE /api/orders/{oid}` — Admin only (403 untuk non-admin). Cascade delete: awb_costs, invoices, journal_entries (3 reference types)
- `PATCH /api/orders/{oid}/status` — Drop allowed untuk semua user. Status lain (Open/Reconciled/Invoiced/Paid) hanya admin (403 untuk operation)
- `seed_data()` di startup gated by `SEED_DEMO_DATA` env (default false). DB sekarang persistent across restart

#### B. Frontend (`/analytics`)
- `[data-testid="export-excel-btn"]` di header table — download XLSX via Blob API
- Per-row action column "Aksi" dengan:
  - `[data-testid="drop-btn-{awb_number}"]` — semua user, kecuali AWB yang sudah status Drop
  - `[data-testid="delete-btn-{awb_number}"]` — admin only (conditional render via `isAdmin`)
- Confirmation modal sebelum drop/delete

#### C. Verification (2026-02-10)
- ✅ Admin login → 50 delete + 50 drop buttons rendered, export button works
- ✅ Operation login → 0 delete + 50 drop buttons (role-gating works)
- ✅ Backend: admin DELETE 200, operation DELETE 403, operation PATCH Drop 200, operation PATCH Paid 403
- ✅ Excel export: 200, 78KB, valid xlsx, 23 cols

### Iteration 4 (2026-06-09) — Dashboard Analitik dengan Multi-Filter

#### A. Backend Analytics
- `GET /api/analytics/dashboard` — KPI + monthly_series + region/customer/fleet/armada/status breakdown. Accepts filters: period_from, period_to, customer_id, region, status, fleet_type, armada_type
- `GET /api/analytics/awbs-detail` — Paginated wide table dengan 22+ kolom. Supports filter + search (awb_number/wo_number/external_invoice/destination/destination_city) + sort by created_at/awb_number/grand_total/total_tariff/status

#### B. Frontend `/analytics` page
- **Multi-filter bar** (8 dimensi): tanggal range, customer dropdown, wilayah, status, jenis armada, tipe armada, search
- **6 KPI cards** berwarna (blue/emerald/cyan/orange/purple/rose): Total AWB · Selling · Inv+PPN · Biaya · Gross Margin · Piutang
- **Charts (recharts)**:
  - Tren Bulanan (BarChart Selling vs Biaya vs Margin)
  - Distribusi Status (PieChart donut)
  - Breakdown Wilayah (horizontal BarChart top 10)
  - Top 10 Customer (horizontal BarChart)
- **Detail AWB wide table** (22 kolom, sticky AWB column kiri, sortable, paginated 25/50/100/200): AWB · WO · Pickup · Customer · Wilayah · Kota/Tujuan · Tipe Armada · Jenis Armada · Vendor Utama · Item Lines · Kg · Selling · PPN · Inv+PPN · Cashback · PPh 2% · Total Biaya · Margin Rp · Margin % · Status · No Inv Eksternal · Tgl Bayar

#### C. Dependencies added
- `recharts` (frontend)


## Session 2026-06-12 — UI fixes & VPS sub-path routing

### Requests by user
1. Pindahkan tombol "Delete line" (Hapus AWB) ke Daftar AWB
2. Tambahkan tombol "Customer Baru" di form Input Order
3. Fix bug: refresh di VPS balik ke landing Nginx

### Changes
- **`OrdersList.js`**: Added "Aksi" column with Drop (any user) + Hapus (admin only) buttons. Reuses `/api/orders/{id}/status` (PATCH) and `/api/orders/{id}` (DELETE) endpoints. Status filter now includes "Drop".
- **`OrderInput.js`**: Added "+ Customer Baru" link beside Customer label → opens quick-add modal (Nama, Detail Perusahaan, NPWP, Alamat) → POST `/api/customers` → reloads dropdown → auto-selects newly created customer.
- **`AnalyticsDashboard.js`**: Removed Drop/Hapus buttons + Aksi column (moved to OrdersList). Cleaned up unused imports (`Trash2`, `MinusCircle`, `useAuth`, `isAdmin`) and dead handler functions (`dropAwb`, `deleteAwb`).
- **`App.js`**: `<BrowserRouter basename={process.env.PUBLIC_URL || "/"}>` — enables app to live at sub-path `/arc/` on VPS while remaining at root in dev preview.
- **`package.json`**: Added `build:arc` script (`PUBLIC_URL=/arc craco build`) for VPS production build.
- **`DEPLOY-VPS-ARC.md`** (new): Complete VPS deployment & Nginx config snippet (with `try_files $uri $uri/ /arc/index.html;`) to fix refresh-to-Nginx bug.

### Files touched
- `/app/frontend/src/pages/OrdersList.js`
- `/app/frontend/src/pages/OrderInput.js`
- `/app/frontend/src/pages/AnalyticsDashboard.js`
- `/app/frontend/src/App.js`
- `/app/frontend/package.json`
- `/app/DEPLOY-VPS-ARC.md` (new)

### Verified
- E2E playwright: login → /orders/new → new-customer-btn → modal open → save → toast "Customer dibuat" → dropdown auto-selected ✓
- /orders page renders new "Aksi" column header ✓
- Frontend bundle still served at root in Emergent preview (PUBLIC_URL empty) ✓


---

## Iteration 8 — Major Input/Recap/Invoice/Payment/Panjar overhaul (2026-06-15)

### Input Order (Order Input) — expanded
- **Manual AWB number** input (with uniqueness check); falls back to auto-gen if blank.
- **Reff No** (opsional), **Tanggal Pickup** manual, **Company issuer** dropdown (PT. Abirama Mitra Pradana / Pratama).
- **Customer + Consignee** side-by-side (2-col grid).
- **Perjanjian Rate** label (renamed from Kontrak); contract dropdown auto-fills Origin/Destination/Tariff/Via and locks them.
- **Origin / Destination** with datalist of default Indonesian cities (free input + suggestions).
- **Service** dropdown: LCL / FCL / LTL / FTL / AIR.
- **Via** dropdown: D — Darat / L — Laut / U — Udara (mirror on Contracts form).
- **Status Pengiriman**: Reguler / Project / blank (blank → not shown on invoice).
- **Koli (jumlah) + Qty isi per Koli** manual.
- **Armada / Driver / Nopol** section.
- **Asuransi** radio (Ya/Tidak) + No. Polis + Nilai Asuransi (conditional).
- **PPN** options now include 0 / 1 / 11 / 12 %.

### Contracts → "Perjanjian Rate"
- New **Via** column + dropdown D/L/U in add modal. Sidebar label renamed.

### Rekap & Rekonsiliasi
- **3 tabel terpisah**:
  1. *Open — Belum Ada Cost (Perlu Plotting Biaya)* — AWB tanpa cost, tidak bisa direkonsiliasi.
  2. *Ready to Reconcile — Sudah Ada Cost* — checkbox select-all/per-row, tombol Reconcile aktif, kolom Cost/Margin.
  3. *Sudah Reconciled — Tangani Reject* — tombol revert ke Open.
- **Plot Biaya modal** langsung di list (kategori Vendor / Operational / Lintas / Marketing).
- **Edit AWB modal** untuk row Open: ubah seluruh field (recalculate totals otomatis bila tarif/qty/PPN berubah).
- Backend `POST /api/orders/reconcile` sekarang menolak AWB tanpa cost (`skipped_no_cost` counter, HTTP 400 kalau none qualify).

### Invoice
- **Bulk Create Invoice** dari Reconciled (checkbox + tombol `POST /api/invoices/bulk`).
- **Bulk Print to PDF** (membuka print pages di tab baru → Ctrl+P → Save as PDF).
- **InvoicePrint** menampilkan Reff No, Consignee, Service/Via, Koli, Asuransi; **Status Pengiriman disembunyikan jika blank**.

### Payments
- **Bulk Mark Paid** + single Mark Paid keduanya buka modal seragam.
- Field **No. Invoice yang Dibayar** (`payment_invoice_number`) dan **Tanggal Bayar** (`paid_date`) ⇒ tersimpan di `awb_orders` dan jurnal.
- Endpoint `POST /api/payments/bulk-mark-paid`.

### Panjar Kerja (modul baru)
- Sidebar entry baru "Panjar Kerja". CRUD ala vendor master tapi berisi cash advance.
- Penomoran `PNJ-YYYYMM-XXXX`. Status Open → Settled.
- Jurnal otomatis: terbit → Dr 1108 Panjar Kerja / Cr Kas. Settle → Dr 5105 Beban Panjar Kerja (+ Dr Cash refund) / Cr 1108.

### Marketing as separate COGS
- Akun baru **5104 Beban Marketing (COGS)**; kategori `Marketing` di Plotting Biaya & modal Plot Biaya.

### COA additions
- **1108 Panjar Kerja** (asset, current_asset)
- **5104 Beban Marketing (COGS)** (cogs)
- **5105 Beban Panjar Kerja** (cogs)
- **Tax setting** tambah `tax_ppn_1` (PPN 1%).

### Backend endpoints touched
- `POST /api/orders` — many new optional fields, manual AWB uniqueness.
- `PATCH /api/orders/{oid}/extended` — extended dengan field baru + recalc totals + status guard (hanya Open untuk non-admin).
- `POST /api/orders/reconcile` — guard "must have cost".
- `POST /api/invoices/bulk` — bulk create.
- `POST /api/orders/{oid}/mark-paid` — `payment_invoice_number` + `paid_date`.
- `POST /api/payments/bulk-mark-paid` — bulk closing.
- `GET / POST /api/cash-advances`, `POST /api/cash-advances/{cid}/settle`, `DELETE` (admin only).

### Testing
- **Backend**: `iteration_3.json` — 19/19 PASS (100%).
- **Frontend**: `iteration_4.json` — 8/9 PASS, fixed sole HIGH bug (Card prop-spread).

### Files touched
- Backend: `/app/backend/server.py`
- Frontend pages: `OrderInput.js`, `Contracts.js`, `Recap.js`, `Invoices.js`, `Payments.js`, `InvoicePrint.js`, `Costs.js`, `PanjarKerja.js` (new)
- Frontend infra: `App.js` (route /panjar), `components/Layout.js` (sidebar), `components/ui.js` (Card prop-spread fix).

### Deferred (per user)
- "Tanggal Terima" module (checklist disamakan Excel Report AR — menunggu detail kolom checklist dari user).
- Modul "Dismantle" terpisah (menunggu konfirmasi user).
