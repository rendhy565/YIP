# PRD — AR Cargo TMS (Order → Cash)

## Latest thread requirements
1. Total Sales terfilter tampil di Daftar AWB ✅
2. Prorata Vendor: 1 tagihan vendor split proporsional ke banyak AWB berdasarkan sales ✅
3. Auto-backup MongoDB rolling 30 hari + upload Google Drive (cron 00:00 WIB) ✅
4. **HR Attendance Enhancement (Feb 2026)** — Edit absen + Import Lembur + Jam kerja flexible per-hari + Auto-flag telat & kurang jam + Field ID Karyawan manual ✅
5. **Payroll dengan Lembur (Feb 2026)** — Auto-hitung gaji pokok + uang makan (hanya Hadir) + lembur (jam × rate manual) → slip gaji + jurnal ✅

## Completed features (Feb 2026 — session update)
- ✅ **Payroll Cutoff Day** (`payroll_cutoff_day`, default 25) — Periode "YYYY-MM" = tanggal (cutoff+1) bulan itu s/d cutoff bulan berikutnya. Contoh cutoff=25, "Juni 2026" = 26 Jun – 25 Jul. Berlaku untuk:
  - `list_attendance` (filter month=YYYY-MM pakai range cutoff)
  - `run_payroll` (query attendance + hitung working_days pakai range cutoff)
  - Slip payload menyimpan `period_start` & `period_end`
  - UI Attendance: label periode menampilkan "PERIODE (cutoff tgl N)" untuk indikasi.
- ✅ **Bulk Select & Delete Attendance** — Checkbox per row + select-all header + tombol "Hapus Terpilih (N)" muncul saat ada seleksi. Endpoint `POST /api/hr/attendance/bulk-delete` accept `{ids: []}`. Selection auto-clear saat ganti bulan/karyawan.
- ✅ **Field `employee_no` (ID Karyawan manual)** di master karyawan (`EmployeeIn.employee_no`). Bisa dipakai lookup di import Attendance (header `employee_no`, kolom fallback ke `employee_id/nik/nama`). Tampil di form Kepegawaian + kolom toggleable di tabel.
- ✅ **Attendance Edit modal** — tombol Edit di setiap row absen, share modal dengan Add, isi otomatis dari row.
- ✅ **Import Lembur di Attendance** — `overtime_hours` + `overtime_rate` di `AttendanceIn`; kolom template XLSX ditambah + parser import. Manual input di modal Add/Edit juga.
- ✅ **Flexible Working Hours per hari** — `attendance-config.work_schedule` = dict `{"mon": {"in":"08:00","out":"17:00"}, ...}` override default `work_hour_in/out`. UI Settings ada baris per hari kerja (dari `work_days`) — kosongkan untuk pakai default.
- ✅ **Auto-flag Telat & Kurang Jam** — `_compute_late_underhours` di backend dijalankan setiap create/update/import attendance. Config `late_threshold_minutes` (default 5). Field baru: `is_late`, `is_under_hours`, `late_minutes`, `worked_minutes`, `required_minutes`. UI: badge TELAT & KURANG JAM di kolom Flag.
- ✅ **Payroll dengan Lembur** — `run_payroll` menghitung `lembur_total = sum(overtime_hours × overtime_rate)` per karyawan. Slip payload berisi `gaji_pokok_net`, `uang_makan` (hanya hari Hadir), `lembur_jam`, `lembur_total`, `gross`, `net`. UI Payroll table diupdate menampilkan kolom Uang Makan, Lembur, Gross, Net + Hadir/Kerja.
- ✅ **Employee ID display di Slip Payroll** — kolom Karyawan menampilkan `employee_no` di sub-line.
- ✅ Template XLSX absensi mendukung header `employee_no` (baris pertama kolom).

## Architecture
- Frontend: React + TailwindCSS, halaman di `/app/frontend/src/pages`
- Backend: FastAPI monolith `server.py` (~10,300 lines) + PyMongo
- MongoDB collections: `awb_orders`, `awb_costs`, `cost_groups`, `invoices`, `fixed_costs`, `recurring_expenses`, `employees`, `attendance`, `public_holidays`, `payroll`, `settings`
- Auth: JWT + granular permission

## Completed features (Feb 2026 — earlier)
- ✅ **Carry-Over Sisa Panjar antar Penerima Sama** (Jan 2026): checkbox "Transfer sisa ke panjar berikutnya" di settle modal → sisa jadi carry-over (`carry_over_transferred=true`, `carry_over_amount=X`), status jadi Settled. Panjar baru dengan penerima sama bisa apply carry-over via checkboxes di settle modal — otomatis budget +carry saat validasi actual+refund. Marking source panjar `carry_over_consumed_by/consumed_number/consumed_at`. Journal balance rapi: CR 1108 di-split memo "Carry-over dari PNJ-X" + panjar sekarang. Validasi backend: penerima harus sama, source tidak boleh sudah consumed
- ✅ **Custom Approval Flow per Panjar Kerja** (Jan 2026): `CashAdvanceIn.custom_approval_steps` optional; form Panjar punya builder alur (default dari template global `cash_advance`, tapi bisa add/edit/reorder/remove per pengajuan). BPV template selalu menambahkan **2 kolom FIXED "Disetujui Oleh: Amrullah" + "Disetujui Oleh: Abidin"** di akhir signature (untuk tanda tangan fisik owner). Preview alur ditampilkan live saat user edit
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

## Update — 2026-06 · Month picker for date filters
- Converted report/list **date filters** from `type="date"` to **month picker** (`type="month"`, no day selection):
  - ProfitLoss (Dari/Sampai Bulan), FixedCosts/Expense filter, AnalyticsDashboard (Bulan Dari/Sampai), Neraca (Per Bulan → akhir bulan), VendorAging (As of month → akhir bulan).
  - Month range expands to full-date boundaries before hitting backend: start=`monthStart` (tgl 1), end=`monthEnd` (tgl terakhir). Helpers in `frontend/src/lib/utils.js`.
- Transaction-entry dates (order/pickup/payment/PO/POD/expense_date, etc.) kept as **date picker** (time-sensitive) — unchanged.
- ActivityLog kept as date picker (audit trail). Timestamps now render in **WIB (Asia/Jakarta)**; backend `/api/activity-logs` filter boundaries interpreted in WIB (GMT+7).

## Update — 2026-06 · Dropdown MonthPicker + WIB timestamp fix
- New reusable component `frontend/src/components/MonthPicker.js`: dropdown Bulan + Tahun (tanpa ketik manual, tanpa tanggal). Value tetap "YYYY-MM". Prop `allowEmpty` untuk filter opsional.
- Semua 20 input `type="month"` di aplikasi diganti ke `<MonthPicker>` (ProfitLoss, FixedCosts, Analytics, Neraca, VendorAging, LaporanLabaRugi, BukuBesar, SaldoAwal, TaxModule, BankReconciliation, NeracaSaldo, Costs, AssetModule, LaporanArusKas, HrPayroll, JournalUmum).
- WIB fix: MongoDB mengembalikan datetime naive (tanpa offset) → browser salah anggap local. Helper `parseServerDate()` di utils.js menambahkan 'Z' agar diparse sebagai UTC. `fmtDate`/`fmtDateTime` + Activity Log kini render WIB (Asia/Jakarta) dengan benar.

## Update — 2026-06 · Submenu Kontrak Kerja (PKWT) di HR & Payroll
- Menu baru **HR & Payroll → Kontrak Kerja** (`/hr/contracts`). Halaman list semua karyawan + kontrak kerjanya (awalnya blank; tombol "Buat Kontrak" per karyawan).
- Backend: collection `employment_contracts` + CRUD `/api/hr/contracts` (GET list join karyawan, GET/{id}, POST, PUT, DELETE) — semua `require_feature("hr")`. Model `EmploymentContractIn` menyimpan semua variabel PKWT (No kontrak, para pihak, jabatan, jangka waktu, gaji pokok + uang makan + terbilang, dll).
- Frontend: `pages/KontrakKerja.js` (list + form modal, prefill identitas dari master karyawan, auto-terbilang Rupiah editable) + `components/ContractPrint.js` (template PKWT A4 siap print sesuai lampiran "Draft PKWT Reeza Marwan", Pasal 1-7, field kosong tampil garis bawah).
- CATATAN: **Feature flag `hr` di-set ON** agar menu tampil (sebelumnya OFF). Bisa ditoggle admin via feature flags bila perlu.

## Update — 2026-06 · Kontrak Kerja: Export Word/PDF + Kop + Riwayat
- **Export Word (.docx)** & **PDF**: endpoint `/api/hr/contracts/{id}/docx` (python-docx) & `/pdf` (weasyprint). Page-break rapi (tiap Pasal & blok TTD `page-break-inside: avoid`), layout estetik. Tombol "Word" & "PDF" di modal cetak (ContractPrint).
- **Kop surat**: logo AR CARGO (dari lampiran "KOP SURAT (AR NEW LOGO)"), dioptimasi → `backend/assets/ar_cargo_logo.png` + `frontend/public/ar-cargo-logo.png`. Header pakai nama perusahaan + kop_address/website/tagline dari settings. TTD digital di-skip; disediakan space TTD basah.
- **Riwayat Kontrak**: satu karyawan bisa punya banyak kontrak (perpanjangan). List menampilkan kontrak terbaru + toggle "Riwayat (N)" yang expand semua kontrak (Edit/Print/Hapus per kontrak). Tombol "Baru" untuk buat kontrak perpanjangan.
- Deps baru: python-docx==1.2.0, weasyprint==69.0 (sudah di requirements.txt). Modul generator: `backend/contract_docs.py`.

## Update — 2026-06 · Fix deploy (500) + slim requirements + review deploy cmd
- **Root cause 500 (Word/PDF/Print)**: `contract_docs.py` import weasyprint di top-level; weasyprint butuh system lib (pango/cairo) yang tak ada di Docker → modul gagal import → ketiga endpoint 500.
- **Fix**: ganti engine PDF ke **xhtml2pdf** (pure-python, tanpa system lib). weasyprint dihapus. HTML kontrak dibuat table-based agar kompatibel xhtml2pdf. python-docx tetap untuk .docx. Print button = buka PDF server di tab baru.
- **requirements.txt dirampingkan**: hapus emergentintegrations, litellm, openai, google-*, boto3, pandas, numpy, stripe, dll (tidak diimport). Sisakan hanya deps runtime (fastapi, uvicorn, motor/pymongo, pydantic, PyJWT, python-jose, bcrypt, python-dotenv, openpyxl, python-docx, xhtml2pdf, Pillow). Diverifikasi install bersih di venv baru.
- **Deploy commands**: direview & dirampingkan di `/app/DEPLOY.md` (ARC-only pakai rsync --exclude arcweb, tambah npm install). Catatan: pastikan `backend/assets/ar_cargo_logo.png` ikut ke image Docker.

## Update — 2026-06 · Modul Amortisasi Beban (Prepaid, PSAK)
- Submenu baru **Akunting (PSAK) → Amortisasi Beban** (`/accounting/amortization`, feature "accounting").
- Ambil beban yang SUDAH ada (dari `fixed_costs`, termasuk history) → tidak buat beban baru.
- COA baru: `1104 Biaya Dibayar di Muka` (auto-seed via DEFAULT_COA idempotent).
- Jurnal: (1) reklas bulan asal `Dr 1104 / Cr Beban` (netralkan PnL akrual bulan itu); (2) N× bulanan `Dr Beban / Cr 1104`. Kas tidak disentuh (basis kas tetap, PnL PSAK akrual jadi rata).
- Stop di tengah → hapus jurnal bulan depan, sisa prepaid dibebankan sekaligus di bulan stop. Delete → reverse semua jurnal (beban kembali penuh di bulan asal).
- Endpoints: GET `/api/amortizations`, `/available-expenses`, `/{id}`; POST `/`, `/{id}/stop`; DELETE `/{id}`. Guard `_require_accounting`.
- Terverifikasi: PnL PSAK (income-statement) sebar 1jt/bulan (bukan 12jt sekaligus), Neraca prepaid 11jt→10jt, stop melumpsum sisa. Cash-basis `profit-loss` (ProfitLoss.js) tetap tampil kas penuh (memang beda basis).
- File: `pages/Amortisasi.js`. Menu di Layout.js, route di App.js.
- Update 2026-06: Field "Pilih Beban" di form Amortisasi kini pakai `SearchableSelect` (combobox ketik-untuk-cari, filter label+sub) menggantikan dropdown murni. Verified via screenshot.
- Update 2026-08: **Koreksi tanggal jurnal pengakuan revenue**. Root cause selisih revenue P&L Order vs P&L Akunting: 381 jurnal `awb_revenue_recognition`/`awb_revenue_reversal` (a.l. 247 order Mei) di-posting batch 25-Jun (input telat), sehingga income-statement menaruh revenue di Juni (bukan bulan jasa). P&L Order pakai tanggal order jadi tidak terpengaruh. Fix: script `scripts/fix_revenue_journal_dates.py` set `date`+`period_month` jurnal = `order.created_at`. UPDATE: script kini juga memindahkan jurnal `cost` (COGS akun 5xxx, ref via awb_costs.awb_id→order) supaya MATCHING revenue & beban di bulan yang sama. Terverifikasi lokal: Mei rev 0→1.449.078.580 & COGS 51jt→1.037.692.477 (cocok persis dg P&L Order, gross 411.386.103); Juni terdeflasi. Idempotent. Jalankan produksi: `docker cp scripts/fix_revenue_journal_dates.py arc-backend-1:/tmp/fix.py && docker exec arc-backend-1 python3 /tmp/fix.py [--apply]`. CATATAN: fix utk DATA LAMA; pencegahan ke depan (Opsi C) BELUM diimplementasi.
- Update 2026-06: **Laba Rugi (Order)** (`/api/reports/profit-loss`, ProfitLoss.js) kini AMORTISASI-AWARE (atas permintaan user, agar konsisten dg Laba Rugi Akunting). Logika: untuk tiap amortisasi aktif, kurangi `total_amount` di bulan asal (reklas prepaid) & tambahkan slice bulanan sesuai `schedule` (skip status `cancelled`, ikutkan `stopped_lumpsum`) pada kategori beban (fixed/cogs sesuai `posting_type`). Kategori bernilai 0 dibersihkan. Berlaku utk filter `month` maupun `start_date/end_date`. Verified via curl: THR 12jt di Feb → Feb 11jt (10 rutin+1 slice), Mar..Jan2027 masing2 1jt. Catatan: sheet detail Excel (`fixed_costs`) masih list nominal mentah (breakdown+summary sudah teramortisasi).
- Update 2026-08: **Activity Log detail** (backend `server.py` middleware + `ActivityLog.js`). Ganti BaseHTTPMiddleware→pure-ASGI `ActivityLogMiddleware` (tee body tanpa re-inject; fix RuntimeError "Unexpected message received: http.request"). Log kini simpan: `action_label` (Buat/Ubah/Hapus + sub-aksi ramah spt "Ubah Info Tambahan", "Tandai Lunas", dll), `module_label` (Order/Invoice/Plotting Biaya/Expense/...), `entity_label` (No AWB/No Invoice/No PO/nama/desc+nominal via lookup DB), `changes`+`details` (field yg dikirim, password/token diredact). DELETE: identitas di-pra-resolusi sebelum handler (record keburu terhapus). Frontend: kolom Aksi/Modul/Target/Detail + baris expand "Detail Perubahan", filter modul pakai label ramah. Hanya aktivitas BARU yg detail (log lama tetap format lama, sesuai kesepakatan user). Verified via curl+screenshot: Customer CRUD, Expense create, Order PATCH extended ("Ubah Info Tambahan Order: AWB 205605 — catatan=..., no_container=..."). Perlu deploy backend+frontend.
- Update 2026-08: **Modul Kasbon Karyawan** (submenu HR, `/hr/kasbon`, `KasbonKaryawan.js` + backend `employee_kasbon`). Pinjaman karyawan resmi: akun baru **1109 Piutang Karyawan (Kasbon)**. Alur: (1) input kasbon → jurnal pencairan `Dr 1109 / Cr 1101 Kas` (sumber fixed Kas dulu). (2) Cicilan rata otomatis (principal÷N) mulai `start_period`, dipotong tiap payroll. (3) Payroll: `Dr 6101 gross / Cr {bank} netto / Cr 1109 total_kasbon` — gross full, transfer berkurang, kasbon reverse piutang. Cap: potong maks sebesar gross, sisa geser ke bulan berikut (outstanding turun sesuai yg terpotong). Fitur: pelunasan dipercepat (`/settle` → Dr Kas/Cr 1109), batal (DELETE, hanya jika belum ada cicilan, reverse jurnal pencairan). delete_payroll me-restore outstanding + hapus payment. GANTI TOTAL kasbon lama (`payroll_kasbon` per-periode) — endpoint & UI lama dihapus; HrPayroll kini arahkan ke menu Kasbon Karyawan, selector "Kasbon dari (Petty Cash)" dihapus, preview jurnal payroll pakai Cr 1109. Terverifikasi via curl+screenshot pakai data produksi restore: create 30jt/3, disbursement journal, simulate (Amrullah gross15jt→potong10jt→net5jt), run payroll (jurnal Dr6101 49jt/Cr1101 39jt/Cr1109 10jt balanced, outstanding 30→20jt), delete payroll restore→30jt, settle→0/settled, cancel reverse. CATATAN: data payroll_kasbon lama (kalau ada) kini diabaikan. Perlu deploy backend+frontend.
- Update 2026-08: **Import Absensi anti-timpa (MERGE)**. Sebelumnya import `$set` seluruh dokumen → input manual (jam pulang/lembur) hilang saat import ulang. Fix: endpoint `/api/hr/attendance/import` kini punya param `mode` (merge default / overwrite) + `dry_run`. MERGE hanya update field yang benar-benar ada di file, mempertahankan field lama (check_out/overtime/status/note) + recompute metrics dari nilai final; upsert `$set`+`$setOnInsert(created)`. `dry_run=true` mengembalikan daftar `conflicts` (field lama yg akan hilang/berubah) tanpa menulis. Frontend `Attendance.js`: toggle Mode (Merge=rekomendasi / Timpa Total), file pick → dry-run → layar PREVIEW konflik → tombol Konfirmasi/Tetap Lanjutkan. Terverifikasi curl+screenshot: manual input jam pulang 17:00+lembur3 → import file jam_masuk saja: MERGE pertahankan (0 konflik, check_out/lembur utuh); OVERWRITE dry-run deteksi 2 konflik (17:00→kosong, 3→0) tanpa menulis; overwrite beneran menimpa. Perlu deploy backend+frontend.
