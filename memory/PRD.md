# PRD — ARC TMS Business Suite

## Latest changes (Iteration 15 — 2026-06-22)

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
