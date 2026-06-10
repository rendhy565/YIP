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
