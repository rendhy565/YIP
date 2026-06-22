# PRD — ARC TMS Business Suite

## Problem Statement
User pulled GitHub repo `rendhy565/ARC` and requested 17 major modifications to existing TMS (Transport Management System) application. ALL changes implemented in one batch with full reversibility (flows reverse properly when invoice/cost/PO/etc is cancelled/deleted, with warnings).

## Tech Stack
- Backend: FastAPI + MongoDB (Motor) — `/app/backend/server.py`
- Frontend: React 18 + Tailwind + react-router (basename `/arc`)
- Auth: JWT (admin/admin123, operation/operation123, finance/finance123)
- Accounting: PSAK-compliant journal engine with idempotent posting

## Implemented Modifications (Iteration 14 — 2026-06-22)

### Master & Input
1. **Customer = induk** (master), **Pengirim** = freetext with **memory + auto-suggest per customer** + tombol X untuk hapus dari suggestions (`/api/sender-suggestions`)
2. **Koli mandatory** (validasi backend & frontend, harus > 0)
3. **Service Lumpsum** ditambahkan + **FCL/FTL/Lumpsum = Charter mode** (single price IDR, tanpa berat pengali — field Qty Kg hilang otomatis)
4. **Perjanjian Rate**: tambah field **Minimum Berat (kg)**
5. **Polis & Asuransi**: nilai dari Input Order **auto-fill** ke form Penerimaan Barang (editable, checkbox auto-on jika ada nilai)

### Workflow
6. **Barang belum diterima → tidak boleh reconcile** (backend 400, frontend disabled + tooltip)
7. **Sorting AWB list** sampai millisecond (display tetap tanggal saja)
8. **Tanggal Terima** sudah ada baris + tombol; **POD** sekarang dipakai di modul PO (`/purchase-orders/{pid}/receive-pod`)

### Modul Baru
9. **Petty Cash / Panjar Non-AWB** (`/petty-cash`, `/api/petty-cash`):
   - Kategori: Operational / Lintas / Umum / Kantor / Lainnya
   - **Semua → HPP (5102 Beban Operasional Pengiriman)** = direct cost
   - Journal: DR 5102 / CR Kas (1101 default)
   - DELETE membalik jurnal (cascade)
10. **PO / Surat Perintah Vendor (Manifest)** (`/purchase-orders`, `/api/purchase-orders`):
    - Bisa **tanpa AWB** → table terpisah, no auto-cost
    - Bisa **dengan AWB** → **otomatis membuat Vendor Cost (Accrue)** di AWB + journal DR 5101 / CR 2101
    - Endpoint `receive-pod` untuk tandai POD diterima
    - DELETE cascade hapus linked cost + journals
11. **Aging Hutang Vendor** (`/reports/vendor-aging`, `/api/reports/vendor-aging`):
    - Bucket: 0-30 / 31-60 / 61-90 / 90+ hari
    - Drill-down per vendor → detail items

### Invoice & Piutang (Big Refactor)
12. **Create Invoice → hanya generate nomor** (idempotent). `invoice_date=null`, `ar_recognized=false`, `print_count=0`. **TIDAK** post AR journal.
13. **Klik Cetak pertama → POST `/api/invoices/{iid}/mark-printed`** → set `invoice_date`, set `first_printed_at`, post AR journal **DR 1201 / CR 1290 / CR 2210**, `ar_recognized=true`
14. **Cetak Ulang** → tombol beda warna (amber), notifikasi popup tanya "pakai tanggal lama / baru"; jika lewat bulan → tambahan warning ⚠
15. **Piutang baru tercatat saat Cetak** (sesuai req 13)
16. **1 Invoice multi-AWB** (`/api/invoices/bulk` dengan param `grouped: [[awb_ids], ...]`)
    - Popup UI di `/invoices` — drag/klik untuk group AWBs
    - Validasi: same customer dalam 1 group
17. **Cancel Invoice** (`/api/invoices/{iid}/cancel`) — AWB kembali ke Reconciled, jurnal AR dihapus, refuse jika ada AWB sudah Paid

### Settle Panjar Kerja
18. **Dropdown target: AWB atau Operation**
    - Target=AWB → auto-create awb_cost (existing behavior)
    - **Target=Operation → masuk sebagai petty_cash direct cost (HPP)** — tidak nempel AWB

### Dashboard Analitik
19. **Kolom Cashback dihapus** dari tabel detail dashboard analitik

### Reversal & Warning
20. Semua flow yang ada efek akuntansi (cancel invoice, delete petty cash, delete PO, revert reconcile) **menampilkan warning popup berisi efek** + membalik jurnal otomatis

## Architecture & Files
- `/app/backend/server.py` (6048 lines) — single FastAPI app dengan banyak endpoints
- `/app/frontend/src/App.js` — router dengan basename `/arc`
- `/app/frontend/src/components/Layout.js` — sidebar dengan section grouping
- `/app/frontend/src/pages/`:
  - **NEW**: PettyCash.js, PurchaseOrders.js, VendorAging.js
  - **MODIFIED**: OrderInput.js, OrdersList.js (millisec sort), Recap.js (block reconcile), Contracts.js (min_kg), PanjarKerja.js (operation target), Invoices.js (multi-AWB popup), InvoicesCreated.js (handlePrint + cancel + reprint warning), InvoicePrint.js (multi-AWB, invoice_date), AnalyticsDashboard.js (no cashback)

## What's been implemented (with dates)
- **2026-06-22 Iteration 14**: All 17+3 modifications implemented in single batch. Backend 30/30 pytest PASS. Frontend smoke OK. Testing agent fixed `serialize()` to handle list-of-ObjectId for multi-AWB invoice support.

## Pending / Future Backlog (P2)
- Refactor `/app/backend/server.py` — split into routers (currently 6048 lines)
- Add permission gate to `DELETE /api/sender-suggestions/{sid}` (currently any authed user can delete)
- Consider whether **LTL** should also be Charter (currently only FCL/FTL/Lumpsum)
- Bulk invoice cross-customer grouping → report ALL skip reasons per group (currently first-error-aborts)
- Vendor Aging — export to Excel
- PO module — add bulk receive POD, attachment support
- Petty Cash — kategori budget tracking per bulan

## Verified Working
- Login (admin/operation/finance)
- All new module endpoints
- Charter mode auto-detect
- Koli mandatory enforcement
- Sender memory & suggestions
- Invoice 2-phase (create → mark-printed)
- Multi-AWB invoice grouping
- Reconcile blocked without received_at
- Petty cash with all 5 categories
- PO with/without AWB
- Vendor aging buckets
- Cancel invoice reversal
- Panjar settle operation target
