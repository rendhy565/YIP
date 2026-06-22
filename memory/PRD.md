# PRD — ARC TMS Business Suite

## Latest changes (Iteration 16 — 2026-06-22)

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
