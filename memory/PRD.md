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

---

## Iteration 9 — Tanggal Terima popup + Excel REPORT AR + Excel Invoice (Master INV) (2026-06-15)

### Tanggal Terima (Barang Diterima) — popup baru di Daftar AWB
- Tombol **Terima** muncul di setiap AWB Open yang belum `received_at`.
- Popup modal mengisi:
  1. **Tanggal Terima** (default today)
  2. **Nama Penerima** (default dari `consignee` order)
  3. **Polis** (default dari `insurance_policy` order)
  4. **Nilai Asuransi** (default dari `insurance_amount` order)
  5. **SPSI** checkbox + input nilai (muncul saat di-check)
  6. **Sewa Forklift** checkbox + input nilai (muncul saat di-check)
  7. **Jenis Pekerjaan** dropdown: Kirim Barang / Dismantle Barang / Relokasi Barang
  8. **Moda** dropdown: Air / Trucking / Konsul
  9. Display read-only: Nilai AWB (Grand Total) → preview kolom tujuan di Report AR
- Setelah submit, AWB tersimpan `received_at`, `received_by_name`, `received_polis`, `received_asuransi_amount`, `spsi_amount`, `sewa_forklift_amount`, `work_type`, `mode`.
- Endpoint baru: `POST /api/orders/{oid}/receive`.

### Excel Export — REPORT AR (sesuai template user)
- `GET /api/exports/report-ar?month=YYYY-MM&customer_id=...&status_v=...`
- Sheet **REPORT AR** dengan **2-row header**: 
  - Main cols (1-17): Bulan, Tgl Pick Up, Tanggal Terima, Status Pengiriman, AWB, Vendor Name, Transport, From, Destination, No Mobil, Penerima, Qty, Koli, KG, Min Kg, Final KG, Harga /KG
  - 3 grup ber-warna: **Kirim Barang (hijau, R-Z)**, **Dismantle Barang (oranye, AA-AI)**, **Relokasi Barang (biru, AJ-AR)** — masing-masing 9 sub-kolom.
  - Trailing cols 45-50: Amount (Exc VAT), Keterangan, Harga, List Muatan, Asuransi, No Invoice.
- Setiap AWB → nilai-nilai (Polis, Insurance, SPSI, Sewa Forklift) ditaruh di grup sesuai `work_type`; Grand Total masuk ke sub-kolom sesuai `mode` (Air/Trucking/Konsul).
- Tombol **Export Report AR** di halaman /recap.

### Excel Export — Invoice (sesuai template Master INV)
- `GET /api/exports/invoice/{invoice_id}` (single) & `POST /api/exports/invoices/bulk` (multi-sheet).
- Layout mengikuti template: Title INVOICE, blok issuer (company_name + alamat + NPWP), Invoice No / Date / Due Date, **Attn dari Consignee**, alamat customer, line items (biaya pengiriman + Asuransi + Polis + SPSI/Forklift bila ada), summary block (Jumlah / PPN / Sub Total / Asuransi / Polis / SPSI / Sewa Forklift / TOTAL), terbilang Bahasa Indonesia, blok tanda tangan dengan **signer per company** dari settings.
- Tombol bulk **Export Excel** di halaman /invoices (1 select → single file, 2+ → multi-sheet workbook).

### Settings — Per Issuer
- Setting baru per perusahaan issuer (Pradana / Pratama):
  - `signer_PT. Abirama Mitra Pradana` / `signer_PT. Abirama Mitra Pratama`
  - `address_PT. Abirama Mitra Pradana` / `address_PT. Abirama Mitra Pratama`
  - `npwp_PT. Abirama Mitra Pradana` / `npwp_PT. Abirama Mitra Pratama`
- UI: section "Per Issuer — Signer / Alamat / NPWP" di /settings.
- Invoice Excel otomatis pakai signer & alamat yang sesuai dengan `awb.company_name`.

### Helper baru
- `_terbilang_id(n)` — number-to-Indonesian-words untuk invoice (Satu, Sebelas, Sepuluh, Seratus, Seribu, Sejuta, …).

### Backend files modified
- `/app/backend/server.py`:
  - `ReceiveAwbIn` model + `POST /api/orders/{oid}/receive`.
  - Seed 6 per-issuer settings.
  - Imports: `StreamingResponse`, `io`, `openpyxl`, styles.
  - Endpoints: `/api/exports/report-ar`, `/api/exports/invoice/{id}`, `/api/exports/invoices/bulk`.
  - `_build_invoice_sheet`, `_fetch_invoice_bundle`, `_terbilang_id`, `_ar_group_start`, `_ar_subcol_offset`.

### Frontend files modified
- `/app/frontend/src/pages/OrdersList.js` — Terima button + Receive modal (semua field + 2 dropdown + preview).
- `/app/frontend/src/pages/Recap.js` — `export-report-ar-btn`.
- `/app/frontend/src/pages/Invoices.js` — bulk-export-btn pakai backend Excel format.
- `/app/frontend/src/pages/Settings.js` — section Per Issuer.

### Testing
- **Backend iter-5**: 34/34 PASS (15 baru + 19 regresi).
- **Frontend iter-6**: 5/5 acceptance criteria PASS (modal flow, REPORT AR download, single/bulk invoice download, settings persistence).


---

## Iteration 10 — Numeric Polis, Auto-Cost SPSI/Forklift, Bulk Reject, Invoice Excel Template, Logo & Bank Settings, Panjar Breakdown (2026-06-15)

### Input Order
- Via dropdown: label langsung "Darat / Laut / Udara" (tanpa prefix D-/L-/U-).
- PPN 12% dihilangkan (auto delete dari DB at startup, seed only 0/1/11).
- Polis bukan teks — sekarang **Nilai Polis (IDR)** numeric. Bersama Nilai Asuransi, keduanya jadi **penambah Grand Total** invoice.

### Penerimaan (Receive)
- **SPSI** & **Sewa Forklift** sekarang otomatis tersimpan sebagai **awb_costs (cost_category=Operational, source=receive)** pada AWB tersebut.
- Idempotent: re-receive akan replace cost lama (delete+insert).
- Di invoice, dirinci sebagai line item terpisah (SPSI / Sewa Forklift).

### Recap
- Tabel "Sudah Reconciled" sekarang punya checkbox + **Bulk Reject → Open** (multi-select).
- Endpoint: `POST /api/orders/bulk-revert-to-open`.

### Invoice
- Halaman dipisah:
  - `/invoices` — **Pembuatan Invoice** (dari AWB Reconciled).
  - `/invoices/created` — **Invoice Tercetak** dengan **filter search (no invoice/AWB) + filter customer**, tombol Print to PDF, **Export Invoice Excel**, dan **Export REPORT AR (filtered)** yang meneruskan data reconcile.
- Template Excel **disesuaikan dengan screenshot AR Cargo**:
  - Logo di kiri atas (dari setting `invoice_logo_b64`).
  - Grey banner "INVOICE" putih bold di tengah (fill 7F7F7F, font color FFFFFF).
  - Issuer block (B7-B9) + Meta block (P7-W9: Invoice No / Date / Due Date).
  - Attn dari Consignee.
  - Table header dark band (fill 595959, font color FFFFFF): No | DESCRIPTION | AMOUNT.
  - Line items: Biaya Pengiriman (dengan sub-rows Tanggal/Origin/Tujuan) + Asuransi + Polis + SPSI + Sewa Forklift (conditional).
  - Summary right: Jumlah / >> PPN N% / Sub Total / >> Asuransi / >> Polis / >> Adm / >> Materai / TOTAL (bold + light grey fill).
  - Terbilang Bahasa Indonesia di bawah.
  - **BANK ADDRESS box** di kiri bawah: bank_name (default Mandiri) dark band + A/N + A/C dari setting per issuer.
  - Signature block kanan bawah dengan "Jakarta, {date_id}" dan signer name per issuer.
  - **Ref. PO No. dihilangkan** (akan diprint terpisah per request).
  - **Faktur Pajak dihilangkan** (diprint dari CORETAX).
  - Format tanggal Indonesia (Mei 2026 dst).
- Lampiran invoice tetap (tab terpisah saat bulk).

### Settings
- **Logo Invoice** upload (PNG/JPG/WebP, max 2MB) via `POST /api/settings/invoice-logo`, disimpan base64 di `invoice_logo_b64`.
- **Per Issuer (Pradana / Pratama)** sekarang termasuk Bank: `bank_name_*`, `bank_holder_*`, `bank_account_*`.
- `SettingIn.key_name` jadi optional (PUT pakai path param saja).

### Panjar Kerja
- Modul settle sekarang menerima **`awb_breakdown: [{awb_id, amount, description}]`** list AWB + nominal.
- Validasi `sum(breakdown) + refund_amount == panjar amount` (banner balanced/unbalanced di UI).
- Setelah settle: otomatis **create awb_costs (Operational, source=cash_advance_settle)** untuk setiap AWB di breakdown — nilainya jadi penambah cost AWB ybs.

### Testing
- Backend **iter-7: 17/17 PASS** (new test file `test_iteration10_features.py`).
- Frontend **iter-8: 9/9 PASS** (full E2E: order creation 221.000, bulk revert, invoices split, receive modal, panjar breakdown, settings logo + bank, sidebar update).
- Old regression files `test_iteration3_features.py` & `test_iteration4_receive_exports.py` **dihapus** (kontrak berubah).

### Files touched
- Backend: `/app/backend/server.py` (banyak — model OrderIn/ReceiveAwbIn/CashAdvanceSettleIn, seed bank settings, tax_ppn_12 cleanup, bulk-revert, invoice excel rewrite, logo upload, cash advance breakdown side-effects).
- Frontend: `OrderInput.js`, `Contracts.js`, `Recap.js`, `Invoices.js` (slimmed), `InvoicesCreated.js` (new), `OrdersList.js`, `PanjarKerja.js`, `Settings.js`, `App.js`, `Layout.js`.

---

## Iteration 11 — City Format, Receive Checkboxes, Recap Search, Invoice Filter OR, Panjar All-AWB, AR Cargo HTML Template (2026-06-16)

### Input Order
- **Origin / Destination** datalist sekarang berformat "NAMA KOTA - SINGKATAN" (mis. JAKARTA - JKT, SURABAYA - SBY). Field tidak dipaksa uppercase lagi.
- Label "Qty Isi per Koli" → **"Qty"** (lebih ringkas).
- Calc panel: Grand Total AWB = `tarif*qty + PPN` saja (Polis & Asuransi pindah ke **Penambah Default** kuning informational + Estimasi Invoice max).

### Penerimaan (Receive modal)
- 4 checkbox seragam: **Polis / Asuransi / SPSI / Sewa Forklift** (default OFF).
- Auto-ON saat modal buka jika order punya nilai (`polis_amount` / `insurance_amount` > 0).
- Input nilai numeric muncul saat di-check, bisa di-override.
- **Realtime preview total invoice** (Nilai AWB + 4 penambah) tampil di amber box di bawah daftar checkbox.
- Backend kontrak baru: `received_polis_amount` / `received_asuransi_amount` hanya tersimpan jika checkbox enabled = True.

### Rekap & Rekonsiliasi
- **3 search bar terpisah** per-table: `search-nocost`, `search-ready`, `search-reconciled`.
- Filter cari berdasarkan AWB / Customer / Reff / Consignee.
- **Selection persisten**: AWB yang sudah di-checklist tidak hilang saat user filter mencari yang lain.

### Invoice Tercetak
- **Filter OR**: Cari (No Invoice / AWB / Customer) **OR** Filter Customer — tidak lagi AND.
- Row muncul jika MATCH salah satu filter yang aktif.

### Panjar Kerja
- Settle modal breakdown dropdown sekarang list **semua AWB** (any status: Open / Reconciled / Invoiced / Paid), bukan hanya Open. Setiap option diberi label status untuk kejelasan.

### Invoice HTML Print View (`/invoices/:id/print`)
- Layout **AR Cargo template** persis screenshot:
  - Logo (dari setting) di pojok kiri atas.
  - **Grey banner "INVOICE"** putih bold di tengah.
  - Issuer kiri + Meta kanan (Invoice No / Date / Due Date) format ID.
  - Attn dari Consignee.
  - Table header **dark band** (#595959) putih: No / DESCRIPTION / AMOUNT.
  - Line items: Biaya Pengiriman dengan sub-rows (Tanggal / Origin / Tujuan) + Asuransi / Polis / SPSI / Sewa Forklift (conditional).
  - Summary kanan: Jumlah / >> PPN N% / Sub Total / >> Asuransi / >> Polis / >> Adm / >> Materai / TOTAL (bold + light grey fill).
  - **Terbilang Bahasa Indonesia** di kiri bawah (italic).
  - **BANK ADDRESS box** kiri bawah: bank_name dengan dark band + A/N + A/C (dari setting per issuer).
  - Signer kanan bawah "Jakarta, {id_date}" + nama signer.
  - **Faktur Pajak** & **Ref. PO No.** dihilangkan (akan diprint terpisah dari CORETAX).
  - Halaman 2: **Lampiran Invoice** dengan tabel header dark band.
- Tombol "Cetak Invoice + Lampiran" (`window.print()`) → CSS `@media print` siap untuk Save as PDF.

### Backend changes
- `ReceiveAwbIn`: tambah `polis_enabled` & `asuransi_enabled` (default False).
- Receive endpoint: `received_*_amount = amount × enabled_flag`. Backward-compat (missing flag → False → 0).
- `/api/invoices/{iid}/full` extend response `company` dengan `signer / bank_name / bank_holder / bank_account / logo_b64`.

### Testing
- Backend `iteration_9.json`: **5/5 PASS** (polis/asuransi flag semantics, /full endpoint, backward-compat).
- Frontend `iteration_9.json`: **11/11 PASS** (city datalist, Qty label, receive modal real-time, recap search preserve selection, invoice filter OR, panjar all-AWB, AR Cargo HTML template all sections verified).

### Files touched
- Backend: `/app/backend/server.py` (ReceiveAwbIn, receive endpoint, invoice_full).
- Frontend: `OrderInput.js` (cities + Qty + calc panel), `OrdersList.js` (receive modal 4-checkboxes + preview), `Recap.js` (3 search bars + filtered memos + preserved selection), `InvoicesCreated.js` (OR filter), `PanjarKerja.js` (allOrders), `InvoicePrint.js` (full rewrite AR Cargo template).

---

## Iteration 12 — Invoice Company Filter (2026-06-16)

### Hotfix
- **Filter Company** ditambahkan di `/invoices/created` (sebelumnya hanya Customer).
- Opsi: `PT. Abirama Mitra Pradana` / `PT. Abirama Mitra Pratama`.
- **OR logic** dengan search + customer (independent — match salah satu = tampil).
- Backend `GET /api/invoices` extend: tiap row sekarang punya `company_name` & `customer_id`.
- Tabel daftar invoice tambah kolom **Company**.
- Verified live: filter Company=Pradana → 23/38; + search "ZZZNONEXIST" → tetap 23 (membuktikan OR).

---

## Iteration 13 — Toggle AND/OR Mode Filter Invoice (2026-06-16)

### Filter mode toggle
- Tombol toggle **OR / AND** di atas filter row (default OR).
- `OR (cocok salah satu)` — row tampil jika match minimal 1 filter aktif.
- `AND (harus cocok semua)` — row tampil hanya kalau match SEMUA filter aktif.
- Counter "X filter aktif" muncul di kanan untuk transparansi.
- Verified live:
  - OR + Company=Pradana + search "ZZZNONEXIST" → **23/38** rows.
  - AND + Company=Pradana + search "ZZZNONEXIST" → **0** rows.
  - AND + Company=Pradana + no search → **23** rows.

---

## Iteration 14 — Reusable Filter Toolbar (OR/AND + Presets) (2026-06-16)

### Komponen baru
- `/app/frontend/src/components/FilterPresets.js` — reusable filter toolbar:
  - **Mode Filter toggle** OR / AND
  - **Preset Save/Load/Manage** (localStorage per page+browser, key `filterPresets:{storageKey}`)
  - Modal "Simpan Preset" dengan field nama
  - Dropdown "Muat preset"
  - Hover menu "Kelola" untuk hapus preset
  - Counter "X filter aktif" otomatis

### Diterapkan di 3 halaman
- **`/invoices/created`** (storageKey: `invoices`) — OR/AND + presets untuk Search + Customer + Company
- **`/orders`** (storageKey: `orders`) — search bar baru (AWB/Customer/Consignee/Reff/Rute) + Status + Customer dengan OR/AND + presets. Server-side fetch sekarang ALL, filter client-side.
- **`/recap`** (storageKey: `recap`) — Bulan + Customer (global filter) dengan OR/AND + presets. Per-table search bar tetap independent untuk granular per-card filter.

### Backend tweak
- `GET /api/orders` response setiap row sekarang punya `customer_id` (string) explicit. Sebelumnya hanya `customer_name`. Diperlukan untuk client-side filtering.

### Verifikasi live
- /orders: Save preset "Open AWB Search" (search=AWB, status=Open) → clear filter → load preset → kedua field ter-restore (search='AWB', status='Open'). Counter "2 filter aktif · 74 dari 124 baris" tampil. Toast hijau "Preset … dimuat".
- /recap: Toolbar tampil di atas Bulan/Customer filter. Mode AND default.
- /invoices/created: Filter Company + Customer + Search dengan toggle OR/AND tetap berfungsi (regression iter-13 dipertahankan).

### Files touched
- New: `/app/frontend/src/components/FilterPresets.js`
- Updated: `OrdersList.js` (client-side filter, FilterPresets import), `Recap.js` (passGlobal helper, reconciledGlobal memo), `InvoicesCreated.js` (FilterPresets dgn storageKey="invoices"), `server.py` (list_orders adds customer_id).

---

## Iteration 15 — Searchable Selects, Recap Month Dropdown, Pagination Everywhere, Accrue Reclass, Hide Empty Sidebar Sections (2026-06-16)

### Komponen baru
- `/components/SearchableSelect.js` — combobox dengan type-to-filter, support clear, sub-label, datatest-id terstruktur.
- `/components/Pagination.js` — pagination + `usePagination` hook. Size selector 25 / 50 / 100 / Semua, dengan **warning modal** saat pilih "Semua" untuk dataset besar.

### Applied SearchableSelect
- **OrderInput** — dropdown Customer.
- **Costs (Plotting Biaya)** — dropdown AWB di modal Tambah Biaya.
- **PanjarKerja** — dropdown AWB di setiap breakdown row settle.

### Filter + Search + Pagination
- **Invoices (Pembuatan Invoice)** — search AWB/Customer/Rute + filter Customer + FilterPresets OR/AND + pagination.
- **Payments (Pembayaran Closing)** — search + filter Customer + FilterPresets + pagination.
- **AccrueSettlement (Settle Hutang Vendor)** — search + filter Vendor + FilterPresets + pagination + **Paid Vendor list dengan search & pagination terpisah**.
- **OrdersList** — pagination ditambahkan.
- **InvoicesCreated** — pagination + Export Invoice Excel button **dihapus** (sudah ada Export REPORT AR). Print to PDF tetap di toolbar (sudah multi-checkmark).

### Accrue (Settle Hutang Vendor) — perubahan
- Tombol **"Tandai Cash"** diganti jadi **"Paid"** (dengan icon CheckCircle2 hijau).
- **List Paid Vendor** baru di bawah list Hutang, dengan tombol **Reclass** per row untuk balik ke Hutang Vendor (Accrue).
- Backend endpoint baru: `POST /api/costs/{cid}/reclass-to-accrue` (finance only). Reverse journal: DR Cash / CR Hutang 2101.
- Total Paid Vendor tampil di header bar (emerald, kanan).

### Recap — Bulan Dropdown
- `<Input type="month">` native diganti dengan **2 select terpisah**: Tahun (6 tahun range) + Bulan (Jan–Des bahasa Indonesia). Sinkron otomatis ke format YYYY-MM untuk filter.

### Sidebar — hide empty section labels
- Layout.js 2-pass logic: pertama filter item visible per role/perm, lalu prune section header yang tidak punya child setelahnya.
- Hasil: untuk role **Finance**, label "Sistem" tidak muncul lagi (verifikasi via screenshot — hanya Order to Cash / Biaya / Master & Laporan / Akunting (PSAK) yang tampak).

### Backend
- `/app/backend/server.py`: tambah endpoint `POST /api/costs/{cid}/reclass-to-accrue`.

### Files touched
- New: `SearchableSelect.js`, `Pagination.js`
- Updated: `OrderInput.js`, `Costs.js`, `PanjarKerja.js`, `Recap.js`, `Invoices.js`, `Payments.js`, `AccrueSettlement.js`, `OrdersList.js`, `InvoicesCreated.js`, `Layout.js`, `server.py`

## Iteration 10 — Bulk Print to PDF + Recap Pagination (2026-02-16)

### Bulk Print to PDF (Invoice Tercetak)
- **InvoicePrint.js** refactor: extracted reusable `InvoicePrintBody` + `InvoicePrintStyles` named exports so a single invoice render is shared with the bulk page.
- **InvoicePrintBulk.js (NEW)**: `/invoices/print-bulk?ids=id1,id2,...` fetches all selected invoices in parallel via `/api/invoices/:id/full` and stacks them in one document (page-break after each invoice + lampiran). Single **Cetak Semua (N)** button at the top so user presses Ctrl+P **once** to save all as one combined PDF.
- **InvoicesCreated.js**: `bulkPrint()` now opens a single combined tab instead of one tab per invoice.
- **App.js**: registered route `/invoices/print-bulk` under `<Protected>`.

### Recap — Pagination (gap fix from iteration 9)
- Added `Pagination` + `usePagination` to all 3 tables on `/recap` (Open-no-cost, Ready-to-reconcile, Reconciled) with isolated reset keys per table-search.

### Testing
- `iteration_10.json`: Bulk Print verified end-to-end (toolbar count, new tab opens at /print-bulk URL, stacked layout, single-row Print still works). All regressions (Pagination on /orders/invoices/created/accrue, AND/OR filter, Reclass UI, SearchableSelect) pass. /recap pagination gap fixed post-test.

### Files touched
- New: `pages/InvoicePrintBulk.js`
- Updated: `pages/InvoicePrint.js`, `pages/InvoicesCreated.js`, `pages/Recap.js`, `App.js`

## Backlog / P2
- **"Tanggal Terima" Checklists** in the Receive popup (BAST, Surat Jalan, Faktur, etc.) mapping to DB booleans (deferred by user "Nanti dulu").
- `server.py` refactor (~4800 lines) into routes/models/services modules — pending user approval.


## Iteration 11 — Finance Tax Automation Sprint 1 + 3-lite (2026-02-16)

### Background — UAT Audit Findings
User memberikan 4 skenario UAT pajak. Audit menyimpulkan:
- PPN Keluaran sudah OK (auto-jurnal ke 2210)
- PPN Masukan TIDAK ada (akun 1401 belum ter-seed, tidak ada modul pembelian)
- PPh 23 TIDAK auto-dipotong saat bayar vendor (vendor.pph_type ada tapi tidak dipakai)
- Tutup buku TIDAK ada penjurnalan rekonsiliasi PPN

User memilih: Sprint 1 (PPh 23 auto-deduct) + Sprint 3 lite (popup manual PPN Masukan) + permission per-user untuk feature modules.

### Backend changes (`server.py`)
- **COA seed extended** (L298-310): tambah akun pajak baru — 1401 PPN Masukan, 1402 PPN Lebih Bayar/Kompensasi, 2221 Hutang PPh 21, 2223 Hutang PPh 23, 2230 Hutang PPN Kurang Bayar (idempotent).
- **MODULES list extended** (L101-126): 5 feature modules (accounting, hr, tax, asset, bank_recon) ditandai `is_feature=True` dan masuk ke daftar MODULES → otomatis muncul di User Management permission grid.
- **`require_feature(key)` (L2370-2385)** sekarang DUAL CHECK: (1) feature flag global ON + (2) user.permissions contains key (admin bypass). Menutup celah "modul ON = semua user dapat akses".
- **Helper baru** (`pph_info_for_vendor`, `fmt_idr`, `PPH_RATES` map): mapping pph_type → (rate, COA, label). PPh23 2% → 2223, PPh15 2% → 2223, PP23UMKM 0.5% → 2223.
- **`settle_cost` (L1089-1165)** dimodifikasi: lookup vendor by name → kalau pph_type set, otomatis hitung pph_amount + post journal 3-baris (DR 2101 gross / CR Cash net / CR 2223 pph) + insert ke `db.pph_records` dengan flag `auto_generated=True`.
- **Endpoint baru `/api/tax/ppn-masukan`** (L2540-2620) — POST/GET/DELETE manual PPN Masukan input. Auto-post journal DR Beban + DR 1401 PPN Masukan / CR Kas. Hapus juga menghapus journal terkait (kecuali period locked).

### Frontend changes
- **`TaxModule.js`** (full rewrite): tambah modal popup "Input PPN Masukan" dengan live preview DPP/PPN/Total, dropdown akun beban (filter type=expense/cogs) dan akun kas. PPh tab tampilkan badge "AUTO" untuk record yg auto-generated, sembunyikan delete button untuk row auto.
- **`Settings.js`**: banner peringatan kuning di section Aktivasi Modul yang link ke User Management — memberi tahu admin bahwa permission per-user tetap perlu di-grant.
- **`Users.js`**: tidak perlu diubah — sudah render `MODULES.map(...)` jadi 5 feature keys otomatis muncul (jadi total 18 checkbox).

### Testing
- `iteration_11.json`: 100% pass (11/11 backend pytest + semua frontend flows). 
- Backend test file: `/app/backend/tests/test_iteration11_tax.py` (idempotent).

### Files touched
- Backend: `server.py` (COA seed, MODULES, require_feature, settle_cost, PPN masukan endpoints, helpers)
- Frontend: `TaxModule.js` (rewrite), `Settings.js` (banner)
- Tests: `backend/tests/test_iteration11_tax.py` (NEW, by testing agent)

## Backlog / P1-P2 (Updated)
- **Sprint 2 PROPOSAL** (P0): Rekonsiliasi PPN otomatis di Tutup Buku — `close_period` harus auto-post jurnal:
  - Jika PPN Keluaran > Masukan → DR 2210 / DR 1401 / CR 2230 (Hutang PPN Kurang Bayar)
  - Jika PPN Masukan > Keluaran → DR 1402 (PPN Kompensasi) / CR 1401 untuk selisih
- **Sprint 3 FULL** (P1): Modul Purchase Invoice lengkap dengan UI list + faktur pajak validation.
- **PPh 21 rate** (P2): payroll masih hardcoded 5% — buat tabel TER/progressive.
- **"Tanggal Terima" Checklists** di modal Penerimaan AWB (P2).
- Refactor `server.py` ~4900 baris (P3).


## Iteration 12 — PSAK 72 Revenue Recognition: PYMHD Model (2026-02-16)

### Background
User UAT menemukan **/pnl (Laba Rugi Order) ≠ /income-statement (Akunting)** untuk bulan Januari (dan bulan-bulan lain). Audit mendapati sistem lama post jurnal `DR 1201 / CR 4101 / CR 2210` **saat AWB dibuat** — revenue langsung diakui meski jasa belum dilaksanakan. /pnl filter `has_cost` → exclude AWB tanpa cost; /income-statement tidak filter → keduanya divergen.

User memilih: **terapkan PSAK 72** dengan model PYMHD (Pendapatan Yang Masih Harus Diterima). Revenue diakui hanya saat ada cost (= bukti jasa berjalan) atau reconciled.

### COA additions
- **`1290 PYMHD (Pendapatan Yang Masih Harus Diterima)`** — asset, normal debit
- **`2390 Pendapatan Belum Diakui (Unearned Revenue)`** — liability, normal credit

### Alur jurnal BARU (untuk AWB created mulai sekarang)
1. **Create AWB** → `DR 1290 / CR 2390` sebesar DPP (PPN belum di-post — sesuai aturan Faktur Pajak terbit saat invoice).
2. **Cost pertama ditambahkan** atau **status di-Reconcile** (mana lebih dulu) → `DR 2390 / CR 4101` = revenue recognized. Idempotent via flag `order.revenue_recognized`.
3. **Invoice dibuat** → `DR 1201 (gross) / CR 1290 (DPP) / CR 2210 (PPN)` — clear PYMHD jadi Piutang real + Faktur Pajak terbit.
4. **Customer bayar** → `DR 1101 Kas / CR 1201 Piutang` (unchanged).

### Implementation details
- **Helper baru `recognize_revenue_for_awb(awb_id, user_id, trigger_date)`** (server.py): idempotent, retry dengan tanggal current jika period locked.
- **Field baru** di `awb_orders`: `revenue_recognized: bool`, `revenue_recognized_at: datetime`.
- **POST /api/orders** (L946): ubah jurnal jadi PYMHD.
- **POST /api/costs** (L1049): trigger recognize_revenue di akhir.
- **POST /api/orders/reconcile** (L1205): defensive recognize_revenue.
- **POST /api/invoices** + **POST /api/invoices/bulk**: post jurnal `DR 1201 / CR 1290 / CR 2210`.
- **DELETE /api/orders** (L3869): cascade delete journal baru `awb_order_pymhd` dan `awb_revenue_recognition`.
- **Startup migration** (idempotent): mark all existing AWBs `revenue_recognized=True` untuk cegah double-post.
- **Endpoint admin baru** `POST /api/admin/migrate-pymhd?dry_run=false`: backfill historical AWBs (yang belum invoiced) ke model PYMHD. Old `awb_order` journals dihapus, jurnal baru `awb_order_pymhd` + (kalau ada cost) `awb_revenue_recognition` di-post dengan tanggal sesuai.

### Verifikasi Live (2026-06)
| | Sebelum migrasi | Setelah migrasi |
|---|---:|---:|
| `/pnl total_revenue` | Rp 2.171.000 | Rp 2.171.000 |
| `/income-statement total_revenue` | Rp 3.928.000 ❌ | **Rp 2.171.000** ✅ |
| Selisih | Rp 1.757.000 | **Rp 0** ✅ |

86 AWB historical (non-invoiced) berhasil dimigrasikan. AWB yang sudah Invoiced TIDAK disentuh (jurnal lama tetap valid sebagai Piutang final).

### Files touched
- `server.py`: COA seed, helper `recognize_revenue_for_awb`, POST /api/orders, POST /api/costs, POST /api/orders/reconcile, POST /api/invoices, POST /api/invoices/bulk, DELETE /api/orders, startup migration, POST /api/admin/migrate-pymhd.

## Backlog / Next
- **Sprint 2 (P0):** Rekonsiliasi PPN otomatis di Tutup Buku — saldo 2210 vs 1401 di-net ke 2230 (kurang bayar) atau 1402 (kompensasi).
- **Sprint 3 FULL (P1):** Modul Purchase Invoice komplit dengan UI + e-Faktur format.
- **PPh 21 progressive rate / TER (P2).**
- **"Tanggal Terima" Checklists** (P2).
- **Reverse cost deletion**: kalau cost terakhir dihapus dari AWB, reverse recognition jurnal agar PYMHD balance kembali (saat ini cost delete tidak men-reverse).


## Iteration 13 — PYMHD Dashboard Panel + Reverse Cost Deletion (2026-02-16)

### Two enhancements per user request after iteration 12

**1. Dashboard PYMHD Pipeline panel**
- Endpoint baru `GET /api/dashboard/pymhd-pipeline`: total saldo PYMHD, breakdown recognized vs unrecognized, status (Open/Reconciled), top customer.
- Frontend `Dashboard.js`: panel baru `data-testid='pymhd-pipeline-panel'` di antara KPI cards dan Pintasan. Top 5 customer table dengan kolom AWB / Total / Belum Ada Cost.

**2. Reverse Cost Deletion dengan warning gate + audit flag**
- `DELETE /api/costs/{cid}` sekarang accept query param `?confirm=true`:
  - Tanpa confirm + ini cost terakhir di AWB + revenue sudah recognized → return `{ok:false, needs_confirmation:true, warning, awb_number, reversal_amount}` (cost belum dihapus).
  - Dengan confirm → cost dihapus + (kalau AWB belum invoiced) post jurnal `DR 4101 / CR 2390` dengan flag `is_reversal=true`, reset `awb.revenue_recognized=false`.
  - AWB yg sudah Invoiced: reversal=null (PYMHD sudah ter-clear ke Piutang).
- `post_journal` extended dengan parameter `extra_fields` agar bisa inject `is_reversal=true` ke journal entry doc.
- Frontend `Costs.js` `del()`: 2-step confirm (browser confirm + warning text) + `toast.warning` saat reversal sukses.

### Testing (iteration_13.json — 100% pass, 7/7 backend pytest + all frontend)
- Pipeline endpoint untuk admin/finance/operation
- Warning gate tanpa confirm
- Confirmed delete + 4101/2390 reversal journal dengan is_reversal=true
- Non-last cost no-warning
- Invoiced AWB no-reversal
- Frontend PYMHD panel + cost delete 2-step dialog flow

### Files touched
- Backend: `server.py` — `post_journal` extra_fields support, DELETE /api/costs/{cid} dengan warning gate + reversal, GET /api/dashboard/pymhd-pipeline.
- Frontend: `pages/Dashboard.js` (PYMHD panel), `pages/Costs.js` (warning dialog + reversal toast + data-testid).
- Tests (NEW): `backend/tests/test_iteration13_pymhd_reversal.py`.

## Backlog / Next
- **Sprint 2 PPN (P0):** Rekonsiliasi PPN otomatis di Tutup Buku.
- **Sprint 3 FULL Purchase Invoice (P1).**
- **PPh 21 progressive/TER (P2).**
- **"Tanggal Terima" Checklists** (P2).
- **UX:** ganti `window.confirm()` di delete cost dengan shadcn AlertDialog modal non-blocking (P3, kosmetik).


## Iteration 14 — Excel Import PYMHD Alignment (2026-02-16)

### Background
User UAT bertanya: apakah fitur **Import Excel** sudah memasukkan revenue belum-ada-cost sebagai PYMHD? Sebelum modifikasi PSAK 72, nilai tersebut tidak di-includekan / langsung di-recognize sebagai 4101.

Audit `_parse_excel` (`server.py` L3560+): per-row import post jurnal LAMA `DR 1201 / CR 4101 / CR 2210` (`reference_type='awb_order'`) tanpa PYMHD. AWB tanpa cost tetap tampil di /income-statement tapi tidak di /pnl → divergen lagi.

### Fix
- **Hapus per-row sales journal** lama dari Excel importer (line 3778-3793) dan per-row payment journal (line 3807-3821).
- **Track imported AWB IDs** di summary (`_imported_awb_ids` internal).
- **Post-import PYMHD sweep** di akhir `_parse_excel`: per AWB,
  1. Post jurnal PYMHD `DR 1290 / CR 2390` sebesar DPP.
  2. Kalau `has_cost OR has_invoice` → post recognition `DR 2390 / CR 4101` dan set `revenue_recognized=True`.
  3. Kalau invoice eksternal ada → post `DR 1201 / CR 1290 / CR 2210` (clearance + PPN).
  4. Kalau status Paid → post `DR 1101 / CR 1201` (payment).
- **STRICT recognition trigger**: hanya `has_cost OR has_invoice` (drop status="Reconciled" trigger karena status di Excel kadang ambigu — "Belum Inv" → "Reconciled" tapi belum ada cost).
- Summary baru: `pymhd_posted`, `recognitions_posted`, `invoice_journals_posted`, `payment_journals_posted`.

### Verifikasi Live (test /tmp/test_import_pymhd.py, bulan 2026-02)
| AWB | Cost | Invoice | Jurnal Posted | revenue_recognized |
|---|:---:|:---:|---|:---:|
| AWB-IT14A | ❌ | ❌ | PYMHD only | False (murni PYMHD) |
| AWB-IT14B | ✅ Rp 600rb | ❌ | PYMHD + Recognition | True |
| AWB-IT14C | ✅ Rp 900rb | ✅ INV-IT14-001 | PYMHD + Recognition + Invoice clearance | True |

`/pnl total_revenue` = `/income-statement total_revenue` = **Rp 5.000.000** ✅ (sinkron)
PYMHD pipeline Rp 12.147.000 (95 AWB), unrecognized Rp 7.102.000 — termasuk AWB-IT14A yang tanpa cost.

### Files touched
- `backend/server.py`: `_parse_excel` — track imported AWB IDs, hapus per-row sales/payment journals, tambah post-import PYMHD sweep.
- Test (manual): `/tmp/test_import_pymhd.py`.

## Backlog
(unchanged dari iterasi 13)


## Iteration 15 — Status Discipline (Open vs Reconciled vs Invoiced) (2026-02-16)

### User's rule (verbatim)
"Saat import apabila ada nomor invoice tp belum ada cost, tetap statusnya open. Tp saat dimasukkan cost, dan reconcile, status invoicenya langsung sudah invoiced. Tidak lagi bisa klik tombol create invoice untuk AWB tersebut."

### Implementation
**1. Excel import status normalization** (`_parse_excel` post-import sweep):
- `if not has_cost: status = "Open"` (force, regardless of Excel mapping).
- Berlaku JUGA untuk AWB yang punya external invoice number tapi belum ada cost — invoice doc tetap dibuat, tapi awb.status = Open.

**2. Reconcile auto-promote** (`POST /api/orders/reconcile`):
- Untuk setiap AWB yang di-reconcile: cek apakah punya `invoice` doc.
- Kalau **YA** → status = **"Invoiced"** (bukan "Reconciled"), post invoice clearance journal (`DR 1201 / CR 1290 / CR 2210`) IF belum di-post (idempotent via reference_type+id check).
- Kalau **TIDAK** → status = "Reconciled" (alur normal — user nanti klik "Buat Invoice").
- Response sekarang return `promoted_to_invoiced` + `promoted_to_reconciled`.

**3. Frontend efek samping (otomatis tanpa code change)**:
- `/invoices` (Pembuatan Invoice) query `status_v=Reconciled` → AWB yang sudah auto-promote ke Invoiced TIDAK muncul → tombol "Buat Invoice" otomatis tidak ada.
- `/invoices/created` (Invoice Tercetak) tetap menampilkan invoice yang sudah ada.

### Verifikasi live (test /tmp/test_invoice_open_flow.py)
| Tahap | Status | Hasil |
|---|---|---|
| Import Excel: invoice ada, no cost | **Open** | ✅ Sesuai rule user (forced) |
| User input cost 200rb | Open | ✅ Cost & journal posted |
| User klik Reconcile | **Invoiced** | ✅ Auto-promote (bukan Reconciled) |

Curl verify: `GET /api/orders?status_v=Reconciled` → AWB-IT14D **tidak ada** → tombol "Buat Invoice" otomatis hilang dari UI ✅.

### Files touched
- `backend/server.py`:
  - `_parse_excel` post-import sweep — status normalization (force "Open" jika no cost).
  - `POST /api/orders/reconcile` — auto-promote ke Invoiced + idempotent invoice journal.

## Backlog (unchanged)
- Sprint 2 PPN Reconciliation (P0), Sprint 3 Purchase Invoice (P1), PPh21 TER (P2), Tanggal Terima Checklists (P2), Aging PYMHD breakdown (P2).

