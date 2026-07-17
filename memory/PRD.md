# PRD — AR Cargo TMS (Order → Cash)

## Latest thread requirements
1. Total Sales terfilter tampil di Daftar AWB ✅
2. Prorata Vendor: 1 tagihan vendor split proporsional ke banyak AWB berdasarkan sales ✅

## Architecture
- Frontend: React + TailwindCSS, halaman di `/app/frontend/src/pages`
- Backend: FastAPI monolith `server.py` (~9200 lines) + PyMongo
- MongoDB collections: `awb_orders`, `awb_costs`, `cost_groups` (new), `invoices`, `fixed_costs`, `recurring_expenses`, `employees`, `settings`
- Auth: JWT + granular permission

## Completed features (Feb 2026)
- ✅ Analytics date inclusive filter
- ✅ PPN 1.1%, Armada dropdown, FCL variants
- ✅ AWB inline duplicate check (blur) — blocking modal masih pending
- ✅ Live thousand separator, Order Schedule, Tracking History modal
- ✅ Invoice header revamp (HTML & Excel)
- ✅ HR Master Karyawan (dengan Alamat KTP kontak darurat)
- ✅ Import Invoice Number multi-AWB grouping
- ✅ Payments module (kolom Invoice No + retain Paid AWBs)
- ✅ Recurring Expense Dashboard Widget (3 varian pink/merah/hijau) + permission gate `fixed_costs`
- ✅ Deep-link `?recurring=id` → auto-open modal Laksanakan Pembayaran
- ✅ Filter Bulan di Pembuatan Invoice
- ✅ **Total Sales/Cost/Margin/Qty terfilter di Daftar AWB**
- ✅ **Prorata Vendor Cost: 1 tagihan Rp X split proporsional ke N AWB berdasarkan grand_total (sales)**
  - Backend: `cost_groups` collection + endpoints POST/PUT/DELETE/refresh + candidate-awbs
  - Frontend: modal Prorata di Plotting Biaya + entry point tombol di Settle Hutang Vendor (deep-link `?prorata=1`)
  - Child cost tagged `is_prorata=true` + `cost_group_id` + `prorata_share_pct`
  - Journal per-child (DR 5101 / CR 2101), settle per-child (existing flow)
  - Refresh recompute berdasarkan grand_total AWB saat ini (blocked jika ada child settled)

## Pending / Backlog
### P1
- [ ] Blocking modal duplicate AWB (saat submit)
- [ ] FTL Multidrop mechanics — klarifikasi

### P2
- [ ] Schedule fields Air (MAWB/HAWB/flight) & Land (truck plate/driver)
- [ ] Filter bulan di halaman Invoice Tercetak
- [ ] Fitur Export Word "Form Data Karyawan" (Elvina template)
- [ ] Refactor `server.py` monolith

### P3 — Integrasi Eksternal (Backlog Diskusi)
- [ ] **Integrasi Coretax DJP** — auto-generate Faktur Pajak Keluaran ke Coretax API saat invoice dibuat
  - **Prerequisites dari user (legal/admin)**: sertifikat elektronik DJP aktif, registrasi ASP di portal Coretax, Client ID+Secret sandbox & production, IP whitelist, private key .p12, NPWP+NITKU perusahaan
  - **Timeline aplikasi ASP di DJP**: 2-4 minggu
  - **Alternatif quick-win**: Export Coretax-ready Excel/XML untuk manual upload di `coretax.pajak.go.id` (1-2 hari kerja, tidak perlu credentials)
  - **Phase implementation**:
    - P0 Foundation: NPWP company + toggle ON/OFF + log table (1 hari)
    - P1 Sandbox: OAuth flow + sign + POST test faktur (2-3 hari)
    - P2 Production FPK: auto-post FPK + simpan NSFP + tampilkan QR (2-3 hari)
    - P3 Reconcile & Retry: manual retry, cancel/replace faktur (2 hari)
    - P4 Optional Advance: FPM sync + SPT PPN Masa auto-file (5+ hari)
  - **Endpoint utama Coretax**: `POST /api/v1/tax-invoice` (OAuth2 Bearer + TLS 1.3)
  - **Response**: NSFP (Nomor Seri Faktur Pajak) + QR code
  - **Rate limit**: 1000 req/jam default
  - **Ref**: DJP Developer Portal `developer.djp.pajak.go.id`, sandbox tersedia untuk testing

## Key files of reference
- Backend: `/app/backend/server.py`
  - Prorata: baris ~1880-2110 (cost_groups endpoints)
  - Recurring: baris ~8478 (upcoming)
- Frontend: 
  - `/app/frontend/src/pages/Costs.js` (prorata modal + groups panel)
  - `/app/frontend/src/pages/AccrueSettlement.js` (entry point tombol)
  - `/app/frontend/src/pages/OrdersList.js` (filtered totals bar)
  - `/app/frontend/src/pages/Invoices.js` (filter bulan)
  - `/app/frontend/src/pages/HrPayroll.js` (form karyawan)
  - `/app/frontend/src/components/RecurringNotifications.js`

## Key API Endpoints
- `GET /api/cost-groups` — list groups + children preview
- `POST /api/cost-groups` — create + auto-generate proportional children
- `PUT /api/cost-groups/{id}` — update + regenerate (block if any settled)
- `POST /api/cost-groups/{id}/refresh` — recompute (block if settled)
- `DELETE /api/cost-groups/{id}` — delete + cascade children (block if settled)
- `GET /api/cost-groups/candidate-awbs?period_month=YYYY-MM` — list AWB eligible
- `GET /api/recurring-expenses/upcoming` — dashboard notif widget
- `POST /api/recurring-expenses/{id}/execute-once`
- `GET /api/orders/check-awb` — duplicate check
- `POST /api/invoices/import-numbers` — bulk grouping

## Prorata Logic (Critical Info)
- Fetch AWBs by IDs → sum `grand_total` = total_sales
- Per AWB amount = `total_amount * (awb.grand_total / total_sales)`
- Last row absorbs rounding residual to guarantee SUM=exact total
- Each child: `awb_costs` record with cost_category="Vendor", payment_type="Accrue", is_settled=false, is_prorata=true, cost_group_id (ref), prorata_share_pct
- Description: `[Prorata Vendor: X — Total Rp Y] Z% dari sales — user_description`
- Journal per child: DR 5101 / CR 2101
- Triggers revenue recognition (PSAK 72) per AWB

## Test credentials
See `/app/memory/test_credentials.md`
