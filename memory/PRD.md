# PRD — ARC TMS Business Suite


## Latest (2026-06-30) — Item #9 COMPLETE: Export FPK (Faktur Pajak Excel)
- **Endpoint**: `POST /api/invoices/export-fpk` body `{invoice_ids: [...]}` → returns xlsx
- **Template**: `/app/backend/templates/template_fpk.xlsx` (user-provided "TEMPLATE XML FPK EMR 25 Juni 26.xlsx")
- **Output PERSIS sama** dengan template:
  - 4 sheets utuh: Faktur, DetailFaktur, REF (386 baris kode referensi), Keterangan (instruksi DJP)
  - 11 threaded comments di header Faktur preserved
  - Column widths preserved (B=16.14, F=29, O=33.42, P=70.42, dll)
  - Data validation (dropdown "Normal" di C4:C106) preserved
  - Cell number formats (`@`, `0.00`, `mm-dd-yy`) preserved
- **Yang dinamis per invoice** (sesuai permintaan user):
  - **B (Tanggal Faktur)**: `DD/MM/YYYY` dari `invoice_date`
  - **H (Referensi)**: `invoice_number` (atau external_invoice_number jika di-import)
  - K, L, O, P, R: dari customer (NPWP 16-digit + 6 digit cabang = ID TKU 22 digit)
  - F, J (DPP): dari `total_tariff` aggregated multi-AWB
  - Formula DPP (`=G*F-H`) dan PPN (`=1.1%*J`) auto-applied per row
- **Konstanta tetap**: Jenis Faktur=Normal, Kode Transaksi=05, Negara=IDN, Tarif PPN=12, Jasa=B/000000/JASA PENGIRIMAN BARANG/UM.0033
- **Seller NPWP**: dari `settings.npwp_{company_name}` atau `settings.company_npwp` (configurable via Settings page)
- **UI**: Tombol "Export FPK (Faktur Pajak)" warna amber di `/arc/invoices/created` (selain Export REPORT AR & Print to PDF)
- **Tested**: 200 OK, file 31KB, struktur diverifikasi via openpyxl — semua format dipertahankan.

## Latest (2026-06-30) — Batch 2 of 9-item enhancement COMPLETE — 100% tested
1. **Import Invoice Number** (`POST /api/invoices/import-numbers`) — upload Excel (cols: AWB Number, Invoice Number, Status, Paid Date) → marks AWB as Invoiced/Paid. UI button on `/arc/invoices/created`.
2. **Multi-Receiver Payment per AWB** — `GET/POST /api/orders/{oid}/payments`, `DELETE /api/payment-receipts/{rid}`. Multiple partial payments per AWB; auto-marks Paid when total_paid≥grand_total; reverts to Invoiced on receipt delete. UI modal accessible via "Pembayaran" button.
3. **Activity Log** — middleware auto-records all mutating API calls. Admin page `/arc/activity-log` filters by date/module/action. Endpoint `GET /api/activity-logs`.
4. **RBAC Phase A (matrix)** — module × action permission table (`GET /api/rbac/matrix`, `POST /api/rbac/update`). Admin page `/arc/rbac`. Administrator bypass enforced (POST update for admin returns 400).
5. **Recurring Expense (Cost Automatic)** — CRUD at `/arc/recurring-expenses`. `POST /api/recurring-expenses/run-due` creates expense + journal + notification + advances next_due. Supports monthly/weekly/daily frequency.
6. **In-App NotificationBell** — sidebar bell with unread badge. `GET /api/notifications`, mark-read endpoints. Auto-refreshes every 60s.
- Code cleanups: removed dead-code branch in run-due notifications; added log_activity to payment receipt delete.
- Test report: `/app/test_reports/iteration_19.json` — 28/28 backend pytest pass, full UI verification.

## Latest (2026-06-30) — Batch 1 of 9-item enhancement: Export, Edit Selling, PPN verify
## Latest (2026-06-30) — Batch 1 of 9-item enhancement: Export, Edit Selling, PPN verify
1. **Export Open AWB** — `GET /api/orders/export/open?start_date=&end_date=` returns xlsx with import-compatible headers (Sheet "DATA ALL BASE", 34 columns matching `_HEADER_ALIAS`). Frontend button at OrdersList header. Use case: bulk edit offline → re-import.
2. **Edit Selling allowed for Reconciled status** — `PATCH /api/orders/{oid}/extended` previously locked to Open-only; now allows Open + Reconciled. Auto-recompute totals (including addons), auto re-post `sales_accrued` journal when amounts change.
3. **PPN explicit** — added explicit comment in `create_awb_order`: `tax_amount = total_tariff × tax_percentage / 100`. Addons (polis/asuransi/SPSI/forklift) NEVER taxed. grand_total = total_tariff + tax_amount + addons.
- Backlog from this session: Items #2 (Cost Automatic), #3 (Import Invoice Number), #4 (Activity Log), #5 (RBAC Fase A), #8 (Multi-receiver Payment), #9 (PPN format - waiting on user spec).

## Latest update (2026-06-29) — 6-point Expense module enhancement
1. **P&L date range**: replace month picker → start_date/end_date pickers. Backend `/api/reports/profit-loss?start_date=&end_date=` supported.
2. **Sub-Expense in P&L**: rincian per-kategori (COGS-typed & Operating Expense) ditampilkan inline di dalam Ringkasan card (di bawah waterfall) sebagai chip kompak.
3. **Mobile-friendly P&L**: 2 rows × 3 cols layout, font kompak (`text-base sm:text-xl lg:text-2xl`), fit dalam 1 page mobile (390px viewport).
4. **Master Kategori Expense** (new page `/expense-categories`): CRUD dengan role permission (finance/administrator). Sidebar di "Master & Laporan". Backend `PUT /api/expense-categories/{id}` baru. Show usage count, system-locked badge, search.
5. **Expense edit/delete** dengan role permission: tombol edit (Banknote icon) & delete (Trash2) muncul hanya untuk finance/administrator. Backend `PUT /api/fixed-costs/{id}` baru — auto re-post journal saat edit.
6. **Expense filter date range**: replace month picker → start_date/end_date di halaman Expense. Backend `GET /api/fixed-costs?start_date=&end_date=`.
- Permission via `useAuth` hook (not localStorage parse) for reliability.
- New module key `expense_categories` registered in `FEATURE_MODULES`.

## Latest (2026-06-28) — BKK Import: Auto-link Panjar ↔ Settlement + Overspend support
- **Auto-settle**: BKK-numeric `Laporan Operasional - X` (Dr filled) sekarang auto-link ke Panjar BKK-JV terdekat (recipient match, oldest open, advance_date ≤ settle_date).
- **Overspend allowed**: jika settlement > panjar, sisa di-debit ke akun kas (extra cash out). Field baru: `overspend_amount`, `refund_amount`.
- **Color coding di Panjar Kerja**: row Settled normal = hijau muda, Settled overspent = pink/merah dengan badge "OVERSPENT" + label "Kurang panjar: Rp X".
- **Journal entries balanced**: 
  - Normal: Dr 5102/COGS, Cr 1108 (panjar)
  - Refund: Dr 5102 + Dr 1101 (cash back) / Cr 1108
  - Overspend: Dr 5102 / Cr 1108 + Cr 1101 (extra cash out)
- **Dry-run preview**: simulasi panjar in-memory supaya bisa pratinjau hasil linking + overspend count sebelum import beneran.
- **Test result file Jan 2026**: 67 panjar imported → 66 auto-settled, 32 overspent, 81 standalone expenses. 0 errors. All journals balanced.

## Latest feature (2026-06-28) — BKK Excel Import
- **Endpoint** `POST /api/expense/import-bkk` (multipart upload, `?dry_run=true` for preview)
- **Logic**:
  - `BKK-JV` rows → **Panjar Kerja** (`db.cash_advances`) with auto-generated `PNJ-YYYYMM-XXXX` number. Journal: Dr 1108 / Cr 1101.
  - `BKK-numeric` rows → **Expense** (`db.fixed_costs`). Amount = `Dr` (settlement) else `Cr` (direct). Journal posted to category's account_code.
- **Auto-create categories** for unknown `Code` values (e.g. "Rumah Tangga", "Document" → new 62XX COA each).
- **Recipient parsing** from description (e.g. "Kasbon Operasional - Samsir" → "Samsir") for Panjar.
- **Idempotency**: skips duplicates by (`bkk_source_no`, `expense_date`/`advance_date`, `amount`).
- **Header detection** dynamic (looks for "No. BKK" + "Desc.").
- **Frontend** modal at Expense page with: file upload, Dry-run preview (count panjar vs expense, new categories list, errors), then confirm Import.
- Verified with user's `LAPORAN BKK JANUARI 2026.xlsx`: 67 panjar + 147 expense, 2 new categories (Rumah Tangga, Document), 0 errors.

## Latest tweaks (2026-06-28 — follow-up)
- **Marketing kategori → COGS** (posting_type changed from `expense`/6104 to `cogs`/5104). Migration in `seed_data` auto-syncs system-category posting_type & propagates to existing fixed_cost records.
- **Date picker** menggantikan month picker di form expense. New field `expense_date` (YYYY-MM-DD); `period_month` masih disimpan (auto-derived) untuk filter & copy. Tabel expense menampilkan `expense_date`. Backend accepts `expense_date` OR `period_month` for backward compat.

## Latest update (2026-06-28) — Expense module (replaces Fixed Cost / Overhead)
- **Label rename**: "Biaya Tetap (Overhead) / Fixed Cost" → **Expense** (sidebar, page, P&L)
- **Category posting rule**:
  - `Operation` (posting_type=`cogs`) → posts to **COGS** account `5102` → affects **Gross Margin**
  - All other categories (posting_type=`expense`) → posts to dedicated **Expense** account (6101–6199 + auto-create 62XX for custom) → affects **Net Profit**
- **Searchable combobox** with creatable categories (filter + Enter to create + "+ Tambah kategori baru" inline)
- **Auto-create COA** in 62XX range when user adds new custom expense category
- **New collection** `db.expense_categories` (replaces hardcoded `FIXED_COST_CATEGORIES`)
- **P&L splits**: Operation expense added to `total_cogs`; others stay in `total_fixed_cost` (renamed UI: "Expense")
- New endpoints: `GET /api/expense-categories`, `POST /api/expense-categories`, `DELETE /api/expense-categories/{id}`
- Legacy `GET /api/fixed-costs/categories` retained (returns names from DB) for backwards compat
- Files: `backend/server.py` (DEFAULT_EXPENSE_CATEGORIES, helpers, endpoints, P&L), `frontend/src/pages/FixedCosts.js` (full rewrite), `frontend/src/pages/ProfitLoss.js`, `frontend/src/components/Layout.js`
- Verified: backend curl test pass (Operation → 5102/1101, Konsumsi → 6201/1101); UI screenshot confirms combobox + badges + new layout

## Latest tweak (2026-02 follow-up)
- **Invoice cover description simplified** — Removed itemized list (1.1, 1.2, ...) on Cover row. Now shows ONLY "Biaya Pengiriman Barang {N} AWB". Detail per-AWB tetap ada di Lampiran. File: `/app/frontend/src/pages/InvoicePrint.js` (line 121-126).

## Latest changes (Iteration 18 — 2026-06-24)

### 10 UI/Feature improvements
1. **Import progress overlay** — circle spinner + indeterminate progress bar muncul saat `busy=true` di /import page (data-testid `import-loading-overlay`)
2. **Catatan optional** di Barang Diterima — field `received_notes` (textarea, 2 rows) di receive modal, disimpan ke `awb_orders.received_notes`
3. **Click Tgl Terima / Tgl POD untuk edit** — cells di /orders sekarang clickable. `openReceive(r)` & `openPod(r)` pre-fill ALL fields dari awb doc (including pod_date dari `r.pod_received_at`)
4. **Import PO Number Excel** — tombol di /invoices/created. Download template Excel via `/api/invoices/po-number-template` (kolom: Invoice Number, PO Number). Upload via `/api/invoices/import-po-numbers` (matched/skipped/not_found feedback)
5. **Inline PO input per invoice row** — textbox per row, tombol Save icon muncul kalau ada draft change. PATCH `/api/invoices/{iid}/po-number`
6. **No. PO di template invoice** — di bawah Invoice No (conditional render)
7. **Invoice template reformat** — TOP section sekarang "**To: Customer name + address + NPWP**" (bukan issuer). "Attn :" = consignee (PIC). Issuer/Company moved to BOTTOM near signature.
8. **Multi-AWB tampil semua** — Fixed: items table sekarang loop semua `awbList` dengan sub-row 1.1, 1.2, ... per AWB. Lampiran table juga loop semua AWB + TOTAL row jika count > 1.
9. **Cover desc multi-AWB** — "Biaya Pengiriman Barang {N} AWB" (N = jumlah AWB)
10. **Consignee = textarea** di /orders/new — rows=3, support longtext (alamat lengkap, PIC, no telp)

### New endpoints
- `PATCH /api/invoices/{iid}/po-number` — set/clear po_number per invoice
- `GET /api/invoices/po-number-template` — download Excel template
- `POST /api/invoices/import-po-numbers` — bulk import via Excel upload

### Verified by testing agent (iteration 18)
- Backend: **9/9 pytest PASS** (`/app/backend/tests/test_iteration18_features.py`)
- Frontend: **100% PASS** (all 10 flows verified)
- Test report: `/app/test_reports/iteration_18.json`
- Tests: receive-notes optional+saved, po-number set+clear+null, template xlsx download, import success+idempotent+not_found, multi-AWB awbs[] in /full, inline PO + save persists, invoice print "To"/"Attn"/"No. PO" structure, cover "Biaya Pengiriman {N} AWB", Consignee textarea rows=3

### Bug fix (post-test)
- Minor: `openPod` now pre-fills `pod_date` from `r.pod_received_at` (was always `todayStr()`)

### Testing agent code review (recommendations, not blockers)
- server.py is 6577 lines → recommend split into routers (deferred)
- `po_number` accepts any length string — consider max 100 chars validation
- `import-po-numbers` could use `bulk_write` for >500 rows performance
- Info row skip uses fragile `startswith('ℹ')` check

---

## Cumulative architecture (after iter18)

### Tech Stack
- Backend: FastAPI + MongoDB — `/app/backend/server.py` (~6577 lines)
- Frontend: React 18 + Tailwind + react-router (basename `/arc`)

### Modules
- **Master**: Customers (induk), Contracts (with min_kg), Vendors, Regions, Armada, Sender Memory
- **Order/AWB**: Input (Lumpsum + Charter + Koli + Sender suggest + Consignee textarea), List (Cost click, click-Terima-edit, click-POD-edit, millisec sort)
- **Receive**: Terima Barang (with optional Catatan) + Terima POD; grand_total auto-include addons
- **Reconcile**: 3-status check (cost + received + POD)
- **Cost**: Plotting, Settle Hutang Vendor (integrated Vendor Aging + Excel export)
- **Panjar Kerja**: Partial settle + History modal
- **PO/Manifest**: Multi-item + Send WA
- **Invoice**: 2-phase (create → print), Multi-AWB bulk, **PO Number inline + Excel import**, Cancel reversal, Reprint warning
- **Invoice Print Template**: "To" header + "Attn", multi-AWB items, PO number, issuer at bottom, lampiran multi-row
- **Analytics**: Dashboard (no WO, no Cashback, Total Biaya clickable)
- **Reports**: PnL, BS, TB, Vendor Aging (embedded), Excel exports
- **Admin**: Migrations (reverse-unprinted-ar)
- **Import**: Excel REPORT PENJUALAN with **progress overlay**

### Shared Components
- `CostListModal` — popup rincian cost (used in /orders, /recap, /analytics)
- `SearchableSelect`, `FilterPresets`, `Pagination`

## Implemented features (with iteration dates)
- 2026-06-22 Iter14: 17 major modifications
- 2026-06-22 Iter15: 7 fixes
- 2026-06-22 Iter16: 6 fixes
- 2026-06-23 Iter17: PO multi-item refactor + Send WA + recursive serialize
- 2026-06-24 Iter18: 10 UI/feature improvements (loading overlay, optional notes, click-to-edit dates, PO number import + inline, invoice template reformat, multi-AWB fix, Consignee textarea)

## Future Backlog
- Refactor server.py (~6577 lines) into router modules
- Replace native date inputs with shadcn Calendar
- Bulk write for import-po-numbers (large imports)
- po_number max length validation
- Email notifications for vendor aging 60+/90+ days
- PDF export per Panjar settle
- WA per-vendor phone

## Verified credentials
- admin/admin123, operation/operation123, finance/finance123

### PO / Surat Perintah Vendor — Multi-Item Refactor + Send WA
- **New PO schema**: header (vendor_name + po_date + notes) + **items array**. Each item has: origin, destination, armada, item_description (Isi Barang/Material), qty, harga (optional), awb_id (optional).
- **Harga & AWB optional** — boleh dikosongkan saat create, diisi nanti via PATCH endpoint.
- **Auto-link cost**: jika item punya BOTH `awb_id` AND `harga > 0` → otomatis create Vendor Cost (Accrue) di AWB itu + post journal DR 5101 / CR 2101. Setiap perubahan via PATCH otomatis reverse cost lama & re-create.
- **New endpoint**: `PATCH /api/purchase-orders/{pid}/items/{idx}` untuk update per-item.
- **DELETE pre-check**: refuse hapus PO jika ada cost yang sudah disettle (avoid partial cascade).
- **Send WA button** per PO — buka `wa.me/?text=...` (tanpa nomor — user pilih chat di WA). Template format:
  ```
  📌SCHEDULE PICK UP TGL 22 JUNI 2026
  
  1. ORIGIN : PT. SANGGAR - BANDUNG
  TUJUAN : PT. MNI - JABODETABEK
  ARMADA : FUSO KELAS BERAT
  MATERIAL : TIANG 7.3 (320)
  QTY : 320
  
  2. ORIGIN : ...
  ...
  ```
- **Expandable rows** di table — klik chevron untuk expand items + tombol Edit per baris.

### Backend infra fix
- `serialize()` sekarang **recursive** untuk nested dicts/lists — fix bug ObjectId serialization di documents dengan items array.

### Verified by testing agent (iteration 17)
- Backend: **17/17 PASS**
- Frontend: **100% PASS** (WA URL, multi-item form, expand, edit, save)
- Balance Sheet still balanced
- Regression: invoices, costs, panjar, orders all OK

---

## Cumulative architecture (after iter17)

### Tech Stack
- Backend: FastAPI + MongoDB — `/app/backend/server.py` (~6469 lines)
- Frontend: React 18 + Tailwind + react-router (basename `/arc`)

### Modules
- **Master**: Customers, Contracts (with min_kg), Vendors, Regions, Armada, Sender Memory
- **Order/AWB**: Input (Lumpsum + Charter + Koli + Sender suggest), List (Cost click via shared CostListModal, POD button, millisec sort)
- **Receive**: Terima Barang + Terima POD; grand_total auto-include addons (SPSI/Forklift/Polis/Asuransi)
- **Reconcile**: 3-status check (cost + received + POD)
- **Cost**: Plotting, Settle Hutang Vendor (integrated Vendor Aging + Excel export)
- **Panjar Kerja**: Partial settle + History modal
- **PO/Manifest**: Multi-item (each row origin/destination/armada/qty/harga/awb) + Send WA + auto-link cost
- **Invoice**: 2-phase (create → print sets date + posts AR), Multi-AWB bulk grouping, Cancel reversal, Reprint warning
- **Analytics**: Dashboard (WO removed, Cashback removed, Total Biaya clickable)
- **Reports**: PnL, BS, TB, Vendor Aging (embedded)
- **Admin**: Migrations (reverse-unprinted-ar with reverse-journal pattern)

### Shared Components
- `CostListModal` — popup rincian cost (used in /orders, /recap, /analytics)
- `SearchableSelect`, `FilterPresets`

## Implemented features (with iteration dates)
- 2026-06-22 Iter14: 17 major modifications
- 2026-06-22 Iter15: 7 fixes
- 2026-06-22 Iter16: 6 fixes
- 2026-06-23 Iter17: PO multi-item refactor + Send WA + recursive serialize

## Future Backlog
- Refactor server.py (~6469 lines) into router modules (deferred per user)
- Replace native date inputs with shadcn Calendar
- Email notifications for vendor aging 60+/90+ days
- PDF export per Panjar settle (history)
- WA per-vendor phone (store on Vendor master) — opt-in nanti
- Audit tz-naive datetime di seluruh backend

## Verified credentials
- admin/admin123, operation/operation123, finance/finance123

### 6 Issue Fixes from user iter15 feedback
1. **History Settlement per panjar** — New `History (N)` button on /panjar untuk setiap panjar yang punya `settle_history`. Modal shows 3 summary cards (Total Panjar / Sudah Settle / Sisa Outstanding) + table per event dengan breakdown details (target AWB/OPS, jumlah, deskripsi, notes).
2. **SPSI/Forklift/Polis/Asuransi → ADD to AWB grand_total** — receive endpoint now recompute `grand_total = base_tariff + base_tax + addons_total` dan simpan field `addons_total` di awb_orders. Tidak lagi hanya di invoice print — sekarang di field DB.
3. **POD mandatory before reconcile** — endpoint reconcile sekarang check 3 status: cost ada, `received_at`, dan `pod_received_at`. Jika POD belum diterima → 400 dengan list AWB-nya.
4. **CostListModal shared component** — extracted ke `/app/frontend/src/components/CostListModal.js`. Dipakai di /orders, /recap (Ready table), /analytics (Total Biaya). Same `data-testid='cost-list-modal'` di semua tempat.
5. **Migration reverse-unprinted-ar pakai reverse-journal pattern** — bukan delete. Audit trail tetap. `is_reversal=true` flag untuk idempotency (2nd run skip). Trial Balance dan Balance Sheet sekarang konsisten karena reverse journal terlihat di kedua endpoint.
6. **Receive delete ultra-narrow** — hanya match `source=receive AND cost_category=Operational AND sub_label in [SPSI, Sewa Forklift]`. Vendor accruals (manual/PO source) **TIDAK PERNAH** ter-delete.

### Bonus fix oleh testing agent
- **vendor-aging tz-naive datetime bug** — `(ref_date - cdate)` raised TypeError untuk legacy docs dengan naive datetime. Fixed dengan normalize ke UTC tz-aware sebelum subtraction.

### Verified by testing agent (iteration 16)
- Backend: **14/14 NEW iter16 tests PASS**
- Frontend: **4/4 critical clickable flows PASS** (panjar history, /orders cost, /recap cost, /analytics cost)
- Trial Balance balanced, Balance Sheet balanced
- Migration idempotent (2nd run skips)
- Test report: `/app/test_reports/iteration_16.json`

---

## Cumulative architecture (after iter16)

### Tech Stack
- Backend: FastAPI + MongoDB (Motor) — `/app/backend/server.py` (6332 lines)
- Frontend: React 18 + Tailwind + react-router (basename `/arc`)
- Auth: JWT (admin/admin123, operation/operation123, finance/finance123)
- Accounting: PSAK-compliant journal engine with reverse-journal pattern for AR reversal

### Modules
- **Master**: Customers (induk), Contracts (with min_kg), Vendors, Regions, Armada, Sender Memory (per-customer autocomplete)
- **Order/AWB**: Input (Lumpsum + Charter mode + Koli mandatory + Sender suggest), List (Cost click → shared modal, POD button, millisec sort)
- **Receive**: Tanggal Terima + Terima POD (separate phase). Updates grand_total to include SPSI/Forklift/Polis/Asuransi
- **Reconcile**: 3-status check — cost + received + POD
- **Cost**: Plotting, Settle Hutang Vendor (with integrated Aging widget + Export Excel)
- **Panjar Kerja**: Partial settle (AWB or Operation target) + History modal per panjar
- **PO/Manifest**: With/without AWB (no POD — POD belongs to AWB level)
- **Invoice**: 2-phase (create number → print sets date + posts AR), Multi-AWB bulk grouping, Cancel reversal, Reprint warning
- **Analytics**: Dashboard table (WO removed, Cashback removed, Total Biaya clickable)
- **Reports**: PnL, Balance Sheet, Trial Balance, Vendor Aging (embedded in Accrue page)
- **Admin**: Migrations (reverse-unprinted-ar with reverse-journal pattern), Wipe transactions

### Shared Components
- `CostListModal` — popup rincian cost + delete; dipakai di /orders, /recap, /analytics
- `SearchableSelect` — searchable dropdown
- `FilterPresets` — saved filter presets

## Implemented features (with iteration dates)
- **2026-06-22 Iter14**: 17 major modifications batch (Petty Cash, PO, Aging, Invoice 2-phase, etc.)
- **2026-06-22 Iter15**: 7 user feedback fixes (partial settle, SPSI as invoice addon, POD on AWB, cost popup, WO removed, Aging integrated, AR migration)
- **2026-06-22 Iter16**: 6 user feedback fixes (settle history, grand_total addons, POD mandatory reconcile, shared CostListModal, reverse-journal migration, narrow Vendor-safe delete)

## Future Backlog
- Refactor server.py into router modules (still 6332 lines — deferred per user)
- Replace native date inputs with shadcn Calendar
- Email notifications for vendor aging 60+ days
- PO bulk receive, attachment support
- tz-naive normalization audit across entire backend (legacy docs)

## Verified credentials
- admin/admin123 (administrator)
- operation/operation123 (operation)
- finance/finance123 (finance)

### 7 Modifications implemented + verified
1. **Petty Cash module removed from UI** (sidebar entry + route). API/collection still exists for back-compat. Functionality now lives in **Settle Panjar Kerja** with **Operation target** that posts direct to HPP 5102.
2. **Partial Settle Panjar Kerja**: status remains **Open** until full balance settled (settled_amount + refund_amount == amount). Each event recorded in `settle_history`. Outstanding panjar shows **remaining**, not gross. UI shows partial confirmation popup.
3. **SPSI / Sewa Forklift / Polis / Asuransi = INVOICE additions (not cost)**. No more `awb_costs` created during receive. They sit on `awb_orders` doc (`received_polis_amount`, `received_asuransi_amount`, `spsi_amount`, `sewa_forklift_amount`) and are added to invoice grand_total at print.
4. **Terima POD on Penerimaan Barang** (AWB level) — new endpoint `POST /api/orders/{oid}/receive-pod` with `pod_received_at`, `pod_signed_by`, `pod_notes`. PO module's POD removed.
5. **Click cost amount on /orders list → popup** showing all costs with **delete per row** (uses existing `DELETE /api/costs/{cid}` which has reversal warning if last cost).
6. **WO column removed** from /analytics dashboard.
7. **Vendor Aging integrated into Settle Hutang Vendor page** (no separate module). 5 buckets (Total / 0-30 / 31-60 / 61-90 / 90+) + per-vendor expandable + **Export Excel** button.
8. **Migration**: `POST /api/admin/migrate/reverse-unprinted-ar` — reverses AR journals for invoices without `invoice_date` (per PSAK: piutang baru tercatat saat faktur dicetak; sebelum cetak tetap PYMHD 1290).

### Verified by testing agent (iteration 15)
- Backend: **13/13 new tests PASS**, **29/30 regression PASS** (1 expected fail — PO POD intentionally removed)
- Frontend: **15/15 smoke PASS** — sidebar cleaned, all UI flows verified
- Test report: `/app/test_reports/iteration_15.json`

---

## Cumulative architecture

### Tech Stack
- Backend: FastAPI + MongoDB (Motor) — `/app/backend/server.py` (6291 lines, growing)
- Frontend: React 18 + Tailwind + react-router (basename `/arc`)
- Auth: JWT (admin/admin123, operation/operation123, finance/finance123)
- Accounting: PSAK-compliant journal engine

### Modules
- **Master**: Customers, Contracts (with min_kg), Vendors, Regions, Armada, Sender Memory
- **Order/AWB**: Input (with Lumpsum + Charter mode + Koli mandatory + Sender suggest), List (with Cost click popup, POD button, millisec sort)
- **Receive**: Tanggal Terima + Terima POD (separate phase)
- **Cost**: Plotting, Settle Hutang Vendor (with integrated Aging widget)
- **Panjar Kerja**: Partial settle support (AWB or Operation target)
- **PO/Manifest**: With/without AWB (no POD — PO is just vendor work order)
- **Invoice**: 2-phase (create number → print sets date + posts AR), Multi-AWB bulk grouping, Cancel reversal
- **Analytics**: Dashboard table (WO removed, Cashback removed)
- **Reports**: PnL, Balance Sheet, Trial Balance, Vendor Aging (embedded)
- **Admin**: Migrations (reverse-unprinted-ar), Wipe transactions

### File structure
- Backend: monolithic `server.py` (6291 lines) — future refactor planned
- Frontend pages: 30+ pages
- New in iter15: no new files; modifications across server.py, OrdersList.js, PurchaseOrders.js, PanjarKerja.js, AccrueSettlement.js, AnalyticsDashboard.js, Layout.js, App.js
- Removed (route/menu only): /petty-cash, /reports/vendor-aging (standalone)

## Future Backlog
- Refactor server.py into router modules (deferred)
- Shadcn Calendar instead of native date inputs in Terima Barang/POD modals
- Migration endpoint — consider reverse-journal pattern (audit trail) instead of delete
- Email notifications for vendor aging 60+ days
- PO bulk receive, attachment support

## Verified credentials (no changes since iter14)
- admin/admin123 (administrator)
- operation/operation123 (operation)
- finance/finance123 (finance)
