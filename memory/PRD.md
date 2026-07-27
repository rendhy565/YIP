# PRD — AR Cargo TMS (Order → Cash)

## Latest thread requirements
1. Total Sales terfilter tampil di Daftar AWB ✅
2. Prorata Vendor: 1 tagihan vendor split proporsional ke banyak AWB berdasarkan sales ✅
3. Auto-backup MongoDB rolling 30 hari + upload Google Drive (cron 00:00 WIB) ✅

## Architecture
- Frontend: React + TailwindCSS, halaman di `/app/frontend/src/pages`
- Backend: FastAPI monolith `server.py` (~9200 lines) + PyMongo
- MongoDB collections: `awb_orders`, `awb_costs`, `cost_groups` (new), `invoices`, `fixed_costs`, `recurring_expenses`, `employees`, `settings`
- Auth: JWT + granular permission

## Completed features (Feb 2026)
- ✅ **Settle Panjar → Target Finance** (Jan 2026): breakdown row punya 3 opsi target — AWB / Operation / **Finance**. Untuk Finance, muncul dropdown kategori expense dengan tombol Add New inline (buat kategori baru + auto-create COA 62xx). Hasil settle Finance → auto-insert ke `fixed_costs` (halaman Expenses) + journal DR expense_account / CR 1108 → langsung tampil di P&L
- ✅ **BPV (Bank Payment Voucher) replace BKK di Panjar Kerja** (Jan 2026):
  - 2 master baru: `payment_recipients` & `payment_senders` (nama/bank/account) — CRUD lengkap
  - `CashAdvanceIn` extended: recipient_id/bank/account, sender_id/name/bank/account (snapshot), ppn_amount, pph_amount, reff_number
  - Form Panjar Kerja: dropdown Penerima + Add New inline modal, dropdown Rekening Pembayar + Add New, input PPN/PPH manual, REFF#
  - `BPVPrintTemplate.js` baru (A4 landscape, header PT + logo, 2-kolom Dibayarkan Kepada/Dari, table DESCRIPTION/NILAI/PPN/PPH/TOTAL, tandatangan dinamis dari approval workflow: Dibuat/Diperiksa/Disetujui Oleh)
  - `BKKPrintTemplate.js` deprecated (masih ada di repo untuk referensi)
- ✅ Auto-backup MongoDB harian (`/app/scripts/`): mongodump gzip → rolling 30 hari lokal + upload Google Drive via rclone, cron `0 0 * * *` `CRON_TZ=Asia/Jakarta`, installer + restore script + panduan
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

---

## 2026-02-21: Approval Workflow Module + BKK Print

### Delivered
- **Generic Approval Workflow** (backend + frontend):
  - Configurable per `document_type` in admin settings
  - Multi-step sequential approval (e.g., "Di Cek Oleh" → "Approval MGR")
  - Approvers selected by USER (bukan role) — per step
  - Auto-create approval when panjar dibuat
  - Approve/Reject actions with mandatory note on reject
  - Sidebar badge count (polling 45s) untuk pending approvals user
  - Pages:
    - `/approvals` — list & take action (tabs: Pending Saya / Pengajuan Saya / Semua)
    - `/approvals/config` — admin only, configure per doc_type
- **BKK (Bukti Kas Keluar) Print** untuk Panjar Kerja:
  - Template mimicking form fisik PT ABIRAMA MITRA PRATAMA
  - Layout: header + tabel Referensi/Rincian/Nominal + 4 signature boxes
  - Baris pertama: Keperluan (positive) + amount pengajuan
  - Baris berikutnya (kalau ada awb_breakdown saat settle): AWB dengan amount NEGATIF (pengurang)
  - JUMLAH TOTAL = SUM baris (positif - negatif)
  - Signatures auto-fill: Diajukan Oleh, Di Cek Oleh, Approval MGR (dari approval), Penerimaan Klaim (recipient)
  - Print button HANYA MUNCUL jika `approval_status == "Approved"`
  - Print via `window.print()` (browser dialog → bisa save PDF)
  - CSS @media print + @page A5 landscape

### Files Added/Modified
- **NEW**: `/app/backend/server.py` — 200 lines approval module (lines ~4661+)
  - Models: `ApprovalStepConfig`, `ApprovalConfigIn`, `ApprovalActionIn`
  - Endpoints:
    - `GET/POST /api/approval-configs` (admin only for POST)
    - `GET /api/approval-configs/{doc_type}`
    - `DELETE /api/approval-configs/{doc_type}` (admin only)
    - `GET /api/approvals?scope=pending_for_me|mine|all`
    - `GET /api/approvals/pending-count` — sidebar badge
    - `GET /api/approvals/{aid}`
    - `POST /api/approvals/{aid}/approve|reject`
  - Helper: `_create_approval_request(doc_type, doc_id, ...)` — hook into panjar create
- **NEW**: `/app/frontend/src/pages/Approvals.js`
- **NEW**: `/app/frontend/src/pages/ApprovalConfig.js`
- **NEW**: `/app/frontend/src/components/BKKPrintTemplate.js`
- **MODIFIED**: `/app/frontend/src/pages/PanjarKerja.js` — add Print button, Approval column, ApprovalStatusPill
- **MODIFIED**: `/app/frontend/src/components/Layout.js` — sidebar section "Approval" with badge count polling
- **MODIFIED**: `/app/frontend/src/App.js` — routes `/approvals` & `/approvals/config`
- **MODIFIED**: `/app/backend/server.py` `create_cash_advance` — auto-create approval

### DB Collections (New)
- `approval_configs`: `{document_type, enabled, steps:[{name, approver_ids[]}], updated_by, created_at, updated_at}`
- `approvals`: `{document_type, document_id, document_number, document_snapshot, status, current_step_idx, steps:[{name, approver_ids[], status, approved_by, approved_by_name, approved_at, note}], requested_by, requested_at, completed_at}`

### AWB Order Related Cascade
- `cash_advances` now has `approval_id` + `approval_status` fields (nullable)

### Extension Path
- Bisa reuse untuk dokumen lain (invoice, PO, dll) — cukup:
  1. Create approval config di admin UI (tambah entry di DOC_TYPES di ApprovalConfig.js)
  2. Panggil `_create_approval_request()` saat dokumen dibuat
  3. Show `approval_status` di list dokumen
  4. Gate action (print, submit, dll) berdasarkan status Approved

---

## 2026-02-21 (evening): BKK Enhancements + Order Input Fixes

### Delivered
- **Signature Boxes dinamis** — auto-adjust ke jumlah approval steps + label sesuai config
  - Layout: `[Diajukan Oleh] + [1..N steps] + [Penerimaan Klaim]`
  - Grid columns responsive (3-6 cols)
  - Penerimaan Klaim = pengaju (bukan recipient, sesuai spec)
- **Logo BKK dari settings** — fetch `invoice_logo_b64` + `kop_address` dari `/api/settings`
  - Fallback text placeholder "AR CG" kalau logo kosong
- **BKK Auto-populate saat settled**:
  - Row 1: purpose (positive amount = pengajuan)
  - Rows 2+: dari `settle_history[].breakdown` (support partial settle multi-batch)
    - Referensi = `awb_number` atau "OPERATION"
    - Nominal = NEGATIF (pengurang)
  - Row Refund: kalau `refund_amount > 0` (juga negatif)
  - Total = Positive - Sum(Negative) = residual (biasanya 0 kalau fully settled)
- **Duplicate AWB Blocking Modal** (Order Input)
  - Inline warning tetap ada (real-time on blur/change)
  - Modal blocking muncul saat click Simpan AWB kalau AWB duplikat
  - Interceptor di `onClick` submit button — bypass HTML5 form validation
  - Modal single-action: "Ganti Nomor AWB" (close & fokus lagi ke input)
- **ETA "01 Jan 1970" fix** — sudah tercakup di formatDate baru (year <2000 return "-")

### Files Modified
- `/app/frontend/src/components/BKKPrintTemplate.js` — dynamic signatures, logo from settings, breakdown flatten from settle_history
- `/app/frontend/src/pages/PanjarKerja.js` — fetch settings, pass to BKKPrintTemplate
- `/app/frontend/src/pages/OrderInput.js` — dup modal + interceptor

---

## 2026-02-22: HR Module — Attendance + Custom Payroll Rules

### Delivered
- **Attendance / Absensi Module** (new):
  - 4 status: Hadir, Sakit, Izin, Alfa
  - Manual entry via UI (add/edit/delete)
  - **Import Excel (.xlsx) / CSV** dengan auto-detect format:
    - Format A: employee_id / nik / nama, tanggal, status
    - Format B: employee_id / nik / nama, tanggal, check_in, check_out (status derived: ada check_in → Hadir, kosong → Alfa)
  - Auto-match employee by employee_id → NIK → nama
  - Upsert per (employee, date) — bisa overwrite duplicate
  - Download template CSV button
  - Summary chips: Hadir/Sakit/Izin/Alfa counts
  - Filter by month + karyawan
- **Employee Table dengan Column Toggle**:
  - Wajib tampil: Nama, Posisi, Gaji Pokok, Status, Aksi
  - Toggleable (17 kolom): Nickname, Tanggal Lahir, Jenis Kelamin, Status Pernikahan, No HP, Email, Alamat KTP/Domisili, NIK, NPWP, Kendaraan, SIM, Bank, BPJS, Join Date, Meal Allowance, Allowance
  - Modal "Atur Kolom Tabel" (icon Settings)
  - Persistence via `localStorage` (per-browser)
  - Default: Nickname + No HP + Bank
- **Payroll Custom Rules** (rewrite):
  - Working days auto-calc dari calendar (Sen-Sabtu = kerja, Minggu libur)
  - Untuk tiap karyawan aktif:
    - `hari_hadir` = count(Hadir); `hari_sakit`, `hari_izin`, `hari_alfa` = count masing2
    - `hari_missing` = working_days - recorded → default treated as Hadir (optimis)
    - **Deduction Alfa** = (base_salary / working_days) × hari_alfa (proporsional)
    - **Uang Makan** = meal_allowance × hari_hadir_effective (HANYA dibayar saat Hadir)
    - Sakit / Izin (disetujui) → base_salary tetap penuh, tapi uang makan tidak dibayar
    - Gross = Net = gaji_pokok_net + uang_makan (tidak ada tunjangan lain di logic, tidak ada pajak)
  - Journal auto-post: Dr 6101 (Beban Gaji) / Cr 1101 (Kas)
- **Employee Model**:
  - Field baru: `meal_allowance` (uang makan HARIAN, default 0)
  - Field lama `allowance` tetap ada tapi TIDAK dipakai di payroll (bisa dihapus manual nanti)

### Files Modified
- **NEW**: `/app/frontend/src/pages/Attendance.js`
- **MODIFIED**: `/app/backend/server.py` — Employee.meal_allowance, payroll logic rewrite, attendance endpoints + import
- **MODIFIED**: `/app/frontend/src/pages/HrPayroll.js` — Column toggle system, meal_allowance form field
- **MODIFIED**: `/app/frontend/src/App.js` — route `/hr/attendance`
- **MODIFIED**: `/app/frontend/src/components/Layout.js` — sidebar "Absensi"

### DB Collections (New)
- `attendance`: `{employee_id, date (YYYY-MM-DD), status, check_in?, check_out?, note?, created_at, created_by}`
  - Unique per (employee_id, date) — upsert on duplicate

### API Endpoints (New)
- `GET /api/hr/attendance?month=YYYY-MM&employee_id=...`
- `POST /api/hr/attendance`
- `PUT /api/hr/attendance/{aid}`
- `DELETE /api/hr/attendance/{aid}`
- `POST /api/hr/attendance/import` (multipart file upload)

### Test Sample (verified end-to-end)
- Employee: base 5jt, meal 25rb/hari
- Feb 2026: 24 working days | 20 Hadir + 2 Sakit + 1 Izin + 1 Alfa
- Calculation:
  - Deduction alfa = (5jt / 24) × 1 = Rp 208.333,33
  - Gaji pokok net = Rp 4.791.666,67
  - Uang makan = 25rb × 20 = Rp 500.000
  - **Total = Rp 5.291.666,67** ✅
