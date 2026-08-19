# PRD — AR Cargo TMS (Order → Cash)

## Import COST (Update Cost / Timpa + Jurnal) (Jun 2026)
- **Kebutuhan:** importer "Import Data Excel" lama bersifat ADD/append (push item revenue + inc total + insert cost tiap kali; baris Selling<=0 di-skip) → tidak aman untuk upload ulang / update cost bertahap (revenue dobel, atau cost-only ter-skip). Solusi: importer COST terpisah. Pilihan user: jurnal langsung + timpa.
- **Backend** (`server.py`): `_pick_cost_sheet` (pilih sheet DATA ALL BASE (2)/(...) via `_find_header_row`), `_parse_cost_rows` (baca AWB + Vendor1/2 total/status, Biaya Ops→Operational, Uang Jalan→Lintas), `_cost_match` (cocokkan by awb_number, gabung baris duplikat, hitung old vs new). Endpoint:
  - `POST /api/import/cost/preview` → matched, not_found[], old_costs_to_replace/sum, new_costs/sum, items[].
  - `POST /api/import/cost/apply` → TIMPA: hapus semua awb_costs AWB tsb + `journal_entries` ref cost, lalu insert cost baru + post jurnal (Dr beban 5101/5102/5103 / Cr 2101 hutang; jika status "sudah bayar" → Cr 1101 kas). Revenue & jurnal revenue TIDAK disentuh.
- **Frontend** (`ImportExcel.js`): kartu "Update Cost (Timpa)" (`cost-import-card`) → upload → `cost-import-preview-btn` (ringkasan + tabel per-AWB) → `cost-import-apply-btn` (konfirmasi timpa) → hasil.
- **Verifikasi:** parse file asli (304 baris cost, total 854jt cocok). Apply sintetis: 3 cost + jurnal balance (DR=CR=1.378.500), revenue tetap, apply ke-2 (timpa) tidak dobel (tetap 3), not_found benar. UI preview file asli via screenshot (304 cocok/416 baru/316 timpa/0 not-found). Data live TIDAK diubah (apply tidak dijalankan di live). Testing agent TIDAK dipakai.


## "Attn" pada Invoice dari Nama Attn Customer (Jun 2026)
- **Kebutuhan:** baris "Attn" di invoice cetak diambil dari field "Nama Attn" di Master Customer.
- **Backend:** `CustomerIn` += `attn` (persist via model_dump di create/update). `invoice_docs.py` baris Attn: `customer.attn or awb.consignee or ''` (fallback ke consignee bila kosong).
- **Frontend** (`Customers.js`): input "Nama Attn" (`customer-attn-input`) di form tambah/edit, disertakan di payload & saat edit.
- **Verifikasi:** unit PDF (attn dipakai + fallback consignee), API create/persist attn (customer sementara lalu dihapus), UI form via screenshot. Testing agent TIDAK dipakai.

## Fix Header Responsif (PageHeader) (Jun 2026)
- **Bug:** di layar sempit, banyak tombol aksi menggencet judul jadi teks vertikal 1 huruf/baris (mis. Invoice Tercetak).
- **Fix:** `components/ui.js` PageHeader → tambah `md:flex-wrap` di container + `whitespace-nowrap` pada judul; blok tombol turun rapi di bawah judul saat sempit. Berlaku semua halaman. Diuji @900px & @1150px via screenshot.


## Popup Detail AWB & Invoice + Template/Ringkasan Import (Jun 2026)
- **Template Excel:** endpoint `GET /api/import/qty-tariff/template` (header: AWB, Qty, Harga /KG + 2 baris contoh). Tombol "Unduh Template Excel" di modal import.
- **Ringkasan setelah Apply:** modal import kini menampilkan panel hasil (`qty-tariff-result`): jumlah diupdate/qty/tarif + daftar AWB tidak ditemukan (dengan tombol Salin) + tombol Selesai. Tidak langsung tutup.
- **Detail AWB:** komponen `components/AwbDetailModal.js` (fetch `GET /orders/{id}`). Di **Daftar AWB** (`OrdersList.js`), No. AWB kini bisa diklik (`awb-detail-btn-*`) → popup detail inputan (Umum, Rute & Barang, Nilai, Status & Tanggal). Baris opsional hanya tampil bila >0 (fix bug render "0").
- **Detail Invoice:** komponen `components/InvoiceDetailModal.js` (fetch `GET /invoices/{id}/full`). Di **Invoice Tercetak** (`InvoicesCreated.js`), No. Invoice kini bisa diklik (`invoice-number-*`) → popup header + tabel rincian AWB (DPP/PPN/Grand) + total.
- **Verifikasi:** template endpoint OK (header benar). Kedua popup diuji via screenshot (buka & tampil data benar). Testing agent TIDAK dipakai.


## Import Qty & Tarif/Kg (display-only, tidak ubah akuntansi) (Jun 2026)
- **Kebutuhan:** invoice sudah diproses tapi kolom Qty & Tarif/Kg kosong; user punya data Excel. Isi kolom tampilan lampiran SAJA — total invoice & jurnal TIDAK boleh berubah (user: Qty×Tarif belum tentu = total). Cocokkan by No. AWB. Semua AWB.
- **Backend** (`server.py`): `_parse_qty_tariff_rows(ws)` (cari header row yg memuat 'AWB', map kolom AWB/Qty/'Harga /KG', flexible), `_qty_tariff_match(rows)` (cocokkan by awb_number regex, hitung computed=qty*tarif & flag mismatch vs total_tariff). Endpoint:
  - `POST /api/import/qty-tariff/preview` (multipart) → ringkasan: total_rows, matched, not_found[], qty_to_fill, tariff_to_fill, mismatch_count, items[].
  - `POST /api/import/qty-tariff/apply` (multipart) → set HANYA `qty_kg` & `tariff_per_kg`. TIDAK menyentuh total_tariff/tax/grand_total/jurnal.
- **Frontend** (`InvoicesCreated.js`): tombol header `import-qty-tariff-btn` + modal (`qty-tariff-import-modal`): upload → `qty-tariff-preview-btn` (preview tabel per-AWB old→new, warning mismatch & not-found) → `qty-tariff-apply-btn`.
- **Verifikasi:** file tes kecil (4 AWB asli + 1 not-found). Preview benar (4 cocok, qty 4/tarif 3, 1 mismatch, 1 not-found). Apply: qty_kg & tariff_per_kg terisi; total_tariff/tax/grand_total & jumlah jurnal SEMUA tetap; nilai asli di-restore setelah tes. UI diverifikasi via screenshot. Catatan: upload file BESAR (5MB+) via curl shell gagal (HTTP 000) tapi via UI/file kecil normal. Testing agent TIDAK dipakai.


## Perbaikan Layout PDF Invoice v2 — Meta, Signer, Lampiran (Jun 2026)
- **Meta block:** titik dua dikembalikan ke kolom sendiri (terpisah dari label) & sejajar (label `width=72`, colon `width=10`), nilai menempel rapi setelah colon. (Revisi dari versi glued yang ditolak user.)
- **Signer:** nama signer diturunkan (6 `<br/>` ruang tanda tangan) sehingga tepat di atas nama perusahaan hanya berjarak ~1 baris (`margin-top:6px`); NPWP tetap ±sejajar dengan A/C.
- **Lampiran (hal.2):** `table-layout:fixed` + lebar kolom eksplisit (Tujuan 14%, Origin 10%, Goods 11%, No.AWB 12%, dst). Teks panjang kini WRAP di dalam sel, tabel tidak ter-override, semua teks terbaca.
- **Verifikasi:** render sampel (tujuan panjang + AWB 12 digit) → inspeksi gambar hal.1 & hal.2. Tetap 2 halaman. Testing agent TIDAK dipakai.

## Perbaikan Layout PDF Invoice — Meta Block & Signer (Jun 2026)
- **Meta block (Invoice No/No. PO/Date/Due Date)** di `invoice_docs.py`: label + `:` digabung jadi satu sel lebar tetap (`width=78`, nowrap) → colon menempel 1 spasi setelah label, nilai langsung setelah colon (tidak lagi terdorong ke kanan). PO row ikut format sama.
- **Blok tanda tangan:** hilangkan border kotak. Spasi tanda tangan pakai `<br/>` (bukan div height yang di-collapse xhtml2pdf). Diukur presisi via PyMuPDF: NPWP kini sejajar dengan baris `A/C :` di bank box (NPWP y≈652 vs A/C y≈642). Tetap 2 halaman.
- **Verifikasi:** render sampel 8-AWB → cek koordinat teks (A/C vs NPWP) + inspeksi gambar halaman 1. Testing agent TIDAK dipakai.


## Bulk Download ZIP + Atur Tanggal (Jun 2026)
- **Kebutuhan:** modal Bulk Download ZIP juga bisa pilih tanggal; setelah download, tanggal cetak (invoice_date + jurnal AR) tiap invoice ikut di-update. Sisanya tidak diubah.
- **Backend** (`server.py`): `BulkInvoiceDownloadIn` += `print_date`. Di `bulk_invoice_download`, bila `print_date` diisi → `_apply_invoice_print(inv, print_date, False, user_id)` sebelum render tiap invoice (set invoice_date + post/re-date jurnal AR).
- **Frontend** (`InvoicesCreated.js`): modal bulk-download tambah input tanggal (`bulk-download-date-input`, default hari ini, wajib), dikirim di POST `/bulk-download`, dan `load()` setelah selesai. Toast: "tanggal cetak diupdate".
- **Self-test:** sintetis invoice → bulk-download 2026-09-12 (ZIP OK, invoice_date+jurnal balance 505.500 dated 12-09), re-download 2026-10-03 (jurnal re-dated, tetap 1 & balance). UI modal date-input terverifikasi via screenshot. Data live bersih. Testing agent TIDAK dipakai.


## Atur Tanggal Invoice saat Cetak (Individual & Bulk) — server-side PDF (Jun 2026)
- **Kebutuhan user:** saat cetak invoice (individual & bulk) muncul pilihan atur tanggal. Keputusan user: (1a) pop-up date-picker tiap cetak; (2b) tanggal IKUT mengubah data akuntansi (jurnal AR di-re-date); (3a) kedua jalur pakai server-side PDF; (4a) kosong = pakai invoice_date yang ada.
- **Backend** (`server.py`): refactor logika `mark-printed` → helper `_apply_invoice_print(inv, print_date, use_old_date, posted_by)`. First print → post jurnal AR dgn tanggal terpilih. **Re-print dgn tanggal beda → rebuild jurnal AR (`rebuild_invoice_ar_journal`) sehingga tanggal jurnal ikut berubah** (sebelumnya tidak). Endpoint baru `POST /api/invoices/bulk-print-pdf` {invoice_ids[], print_date} → terapkan tanggal ke tiap invoice + jurnal, lalu render SATU PDF gabungan.
- **`invoice_docs.py`:** dipecah jadi `_render_invoice_inner()` (isi body) + `render_invoice_html()` (wrapper) + `render_invoices_pdf_combined([...])` (banyak invoice → 1 PDF, page-break antar invoice). `render_invoice_pdf(data, override_date=None)`.
- **Frontend** (`InvoicesCreated.js`): `handlePrint`/`bulkPrint` kini buka modal date-picker (`data-testid="print-date-modal"`, input `print-date-input`, tombol `confirm-print-btn`). Single: mark-printed{print_date} → GET `/pdf` (blob) buka tab. Bulk: POST `/bulk-print-pdf` (blob) buka tab. Ganti `window.print()` browser lama.
- **Self-test:** sintetis 2-AWB invoice → first print 2026-06-10 (jurnal balance 808.800), re-print 2026-07-20 (jurnal RE-DATED, tetap 1 & balance), bulk-print-pdf 2026-08-05 (PDF gabungan + jurnal re-dated), single `/pdf` OK. PDF renderer (single/override/combined) OK. Data live di-restore bersih. Testing agent TIDAK dipakai (dilarang user). UI modal terverifikasi via screenshot.


## Jadwal Kerja Absensi per Karyawan + Tanda Telat (Jun 2026)
- **Kebutuhan:** jam masuk/pulang bisa custom PER HARI PER ORANG (Senin beda dari Selasa dst); kosong = ikut global; absen telat diberi tanda.
- **Backend** (`server.py`): `EmployeeIn` += `work_days[]`, `work_schedule` (per-hari `{"mon":{"in","out"},...}`), + legacy `work_hour_in/out`. Helper `_effective_att_config(cfg, employee)` overlay jadwal per-karyawan (termasuk merge per-hari `work_schedule`) di atas global. `_get_day_schedule` sudah pilih jam sesuai hari. Dipakai di create/update attendance & Excel import. Badge TELAT/KURANG JAM sudah ada di Attendance UI.
- **Frontend** (`HrPayroll.js`): section "Jadwal Kerja per Hari" = tabel 7 hari (checkbox hari kerja + jam masuk + jam pulang per hari). Kosong → "ikut global"; tak dicentang → "libur".
- **Self-test:** karyawan Senin 08:00 & Sabtu 09:00 → Senin 08:20=Telat20m, Sabtu 08:50=tidak telat, Sabtu 09:20=Telat20m (per-hari terbukti). Sebelumnya juga override vs global terbukti. Data test dibersihkan; data live utuh. Testing agent TIDAK dipakai.

## Vendor Dropdown di Rekap & PO (Jun 2026)
- `Recap.js` (modal Plot Biaya) & `PurchaseOrders.js` (form Buat PO): input vendor free-text → `VendorSelect` (dropdown master + quick-add "Baru"). Tidak ada lagi ejaan vendor baru liar. Verifikasi: parse OK + PO form render dropdown+Baru.

## Merge Vendor (Master Vendor) (Jun 2026)
- **Kebutuhan:** beberapa vendor sebenarnya sama tapi beda ejaan → gabung jadi satu.
- **Backend** `POST /api/vendors/merge` {vendor_ids[], target_name, dry_run}: 
  - dry_run → ringkasan (vendors_merged, vendors_to_delete, costs/pos/pph_affected, resulting_pph_type/reviewed).
  - eksekusi → update_many `vendor_name` di awb_costs/purchase_orders/pph_records ke target_name; pilih 1 vendor kanonik (nama==target, atau donor ber-PPh, atau pertama), set PPh hasil (warisi dari donor jika kanonik kosong; reviewed=any), hapus vendor duplikat. Cek bentrok nama vendor lain. Jurnal TIDAK berubah (pakai kode akun).
  - Nama kanonik: pilih salah satu terpilih ATAU ketik baru.
- **Frontend** `MasterVendor.js`: checkbox per baris + bar "Gabung Vendor" (≥2 terpilih) + modal (input nama + chip pilihan + tombol Pratinjau → ringkasan → Gabungkan Sekarang).
- **Self-test:** seed 2 vendor+data dummy → preview akurat (PPh23 terwarisi) → eksekusi → referensi pindah, duplikat terhapus → cleanup. UI render (checkbox/bar/modal/preview) OK. Data live utuh. Testing agent TIDAK dipakai.


- **Kebutuhan:** bayar DP dulu, sisa belakangan. Keputusan user: input BRUTO, PPh 23 proporsional tiap bayar, status "Sebagian"+riwayat, 1 akun kas (default 1101), bisa void per pembayaran.
- **Backend** (`server.py`):
  - Helper `_record_vendor_payment()` — catat 1 pembayaran: DR 2101 (bruto) / CR Kas (net) / CR 2223 (PPh proporsional). Update `paid_amount`, `payments[]`, `settle_status` (partial/paid). Jurnal `reference_type="vendor_payment"`, `reference_id=pid`.
  - `POST /api/costs/{cid}/pay` (parsial, cegah overpay, warning gate PPh) · `settle_cost` kini bayar SISA (pakai helper) · bulk-settle tetap · `POST /api/costs/{cid}/payments/{pid}/void` (jurnal balik, hapus pph_record, revert status).
  - `reclass-to-accrue` di-upgrade: balik semua `payments[]` (fallback legacy). Vendor-aging pakai sisa (amount − paid_amount).
  - Cost fields baru: `paid_amount`, `payments[]` (pid, amount, pph_amount, net_paid, pph_rate, pph_account, cash_account_code, paid_at, paid_by), `settle_status`.
- **Frontend** (`AccrueSettlement.js`): tombol **Bayar** (parsial, prompt bruto) + **Lunasi** (sisa) per baris; kolom Terbayar/Sisa; modal **Riwayat Pembayaran** dgn tombol void. Total & bulk pakai sisa.
- **Self-test (curl+screenshot):** DP 500rb→PPh10rb/net490rb/partial; lunasi 1.215jt→PPh24.3rb/lunas; total PPh 34.300=2%×1.715jt; jurnal 2101/2223/1101 balance; void balik benar; UI render Bayar/Lunasi. Data live di-restore bersih (semua mutasi test dihapus). Testing agent TIDAK dipakai.


- **Konteks:** Semua 48 vendor `pph_type` kosong → PPh 23 tak pernah kepotong (2223 = 0). Penyebab: tak ada UI kelola master vendor; nama vendor selalu free-text.
- **Solusi (Opsi B — quick-add + antrian review):**
  - **Halaman baru `MasterVendor.js`** (route `/vendors`, menu "Master Vendor", perm `accrue` → Finance/Admin). Kelola vendor: nama, NPWP, **jenis PPh** (PPh23 2% / PPh15 2% / PP23UMKM 0,5% / Non-PPh), rekening. Simpan = tandai `pph_reviewed=true`. Ada nudge + filter "N vendor belum dikonfigurasi PPh".
  - **Quick-add** `POST /api/vendors/quick` (idempotent, `pph_reviewed=false`) — Operation bisa tambah vendor baru saat input biaya tanpa terblok.
  - **`components/VendorSelect.js`**: dropdown vendor master + tombol "＋ Baru" — dipakai di form Biaya (single + prorata) di `Costs.js`. Vendor free-text diganti pilihan master (nama konsisten → settle pasti nemu pph_type).
  - **Warning gate saat settle** (`SettleIn.force`): kalau vendor `pph_reviewed` belum true → `settle_cost` balikin `needs_confirmation` (tanpa write); Finance konfirmasi dulu. `bulk-settle` auto `force=True`. `AccrueSettlement.settle` handle needs_confirmation.
  - `VendorIn` += `pph_reviewed` (default true saat disave via master).
- **Catatan pajak (dikonfirmasi user):** DPP di luar PPN (benar), tak ada vendor non-NPWP (tak perlu 4%), settle sebulan yang sama (timing aman).
- **Self-test (curl+screenshot):** quick-add idempotent ✓, master update set PPh23+reviewed ✓, gate fires + no-write ✓, Master Vendor & Cost form render ✓. Testing agent TIDAK dipakai (dilarang user).
- **Backfill Master Vendor otomatis (startup):** `seed_data()` memindai nama vendor dari `awb_costs` (Vendor) & `purchase_orders`, insert yang belum ada ke `db.vendors` (`pph_reviewed=false`, `backfilled=true`). Idempotent. Verifikasi preview: 48→50 (KALIMA, MU Trans ikut), 0 tertinggal. Jadi saat deploy Master Vendor otomatis terisi dari historikal.
- **Data live user (arc_db) di-restore ke preview `tms_db`** (10.505 dok, Aug 11). Kondisi sehat: 1290=2,79 M (=Open+Reconciled), 1201=3,31 M. 6,75 M yg dulu dilihat = akumulasi debit kotor 1290, bukan saldo net.


## Fix Jurnal AR Hilang (Jun 2026) — saldo 1290 menggelembung
- **Akar masalah:** endpoint `POST /api/invoices/import-numbers` menandai AWB Invoiced/Paid + buat dokumen invoice TAPI tidak memposting jurnal clearance `DR 1201 / CR 1290 (+CR 2210)`. Jurnal AR hanya keposting saat cetak (`mark-printed`). Data via import → 1290 (Belum Ditagih) menggelembung, 1201 (AR) kosong. (Preview: 405/409 invoice tercetak tapi hanya 1 ar_recognized.)
- **Fix kode** (`server.py`): tambah helper `ensure_invoice_ar_posted()` & `ensure_awb_payment_posted()` (idempotent via flag `ar_recognized` + cek `reference_type`). `import-numbers` kini posting jurnal AR utk Invoiced, dan AR+pembayaran (`DR 1101/CR 1201`, ref `payment`) utk Paid, di akhir proses. Diverifikasi end-to-end + idempotent via curl.
- **Script koreksi data lama:** `/app/backend/scripts/fix_missing_ar_journals.py` (dry-run default, `--apply` utk terapkan). Dijalankan user sendiri di VPS. Dry-run preview: 1290 6,16 M → 1,61 M; 1201 151 jt → 4,70 M (408 jurnal). Terpisah dari `fix_pymhd_journal_amounts.py` (yg sudah dijalankan user).


## COA Terminology Rename (Jun 2026) — permintaan direksi
- ✅ Rename akun COA (label-only, flow jurnal double-entry TIDAK diubah):
  - `1201` (Piutang Usaha / AR) → **"PYMHD (Piutang Usaha)"**
  - `1290` (Unbilled Revenue) → **"Pendapatan Belum Ditagih (NY PO)"**
- Alasan: direksi mau AR disebut "PYMHD" (Pendapatan Yang Masih Harus Diterima).
- Implementasi: `DEFAULT_COA` di `server.py` diubah + blok force-`$set` di `seed_data()` (berlaku otomatis di DB lama saat backend startup/deploy, tidak perlu langkah manual).
- Dashboard panel "Pipeline PYMHD" (order belum-invoice = 1290) → dilabeli ulang **"Pipeline NY PO"** agar konsisten global. Permission label `view_pymhd_panel` → "Panel Pipeline NY PO".
- ReceivablePipeline sudah konsisten sejak awal (PYMHD=AR, NY-PO=belum invoice).
- Verifikasi: curl `/api/accounts` & `/api/reports/balance-sheet` mengembalikan nama baru; Dashboard visual OK. (Testing agent BANNED oleh user — manual verify only.)
- Catatan deploy: script `fix_pymhd_journal_amounts.py` (koreksi saldo PYMHD legacy) belum dijalankan user — akan dijalankan sekalian saat deploy ini.


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
_Backlog dikosongkan atas permintaan user (2026-06). Tidak ada item yang direncanakan untuk dieksekusi._

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
- Update 2026-08: **Sidebar collapse per kategori** (`Layout.js`). Header section jadi tombol toggle (chevron), submenu bisa disembunyikan; state disimpan di localStorage (`sidebar_collapsed`); section berisi route aktif auto-expand. Verified via screenshot (collapse-all 37→1 link, expand per kategori).
- Update 2026-08: **Edit riwayat settle Panjar (saat Open)**. Tiap ronde settle kini di-tag `round_id` (di settle_history, jurnal via extra_fields, awb_costs & fixed_costs turunan). Endpoint baru `DELETE /api/cash-advances/{cid}/settle/{round_id}`: hanya jika status=="Open" (kalau "Settled" → 400 terkunci); me-reverse jurnal+biaya ronde tsb, un-consume carry-over, hitung ulang settled/refund/remaining, pull ronde dari history. Frontend `PanjarKerja.js`: kolom "Aksi" di modal History (muncul saat status≠Settled); ronde lama tanpa round_id tampil "—". Verified via curl (partial settle→tag→delete reverse→remaining balik; Settled→400) + screenshot modal. Perlu deploy backend+frontend.
- Update 2026-06: **Fix tombol Aksi settle Panjar tidak muncul (data lama)**. Root cause: settle_history ronde lama dibuat sebelum fitur round_id, jadi tak punya round_id → frontend render "—" (tak ada tombol hapus) meski status Open. Fix: fungsi self-heal `backfill_settle_round_ids()` dipanggil di lifespan startup — assign round_id ke tiap ronde legacy + tag jurnal/awb_costs/fixed_costs turunannya via match (amount + tanggal). Idempotent (skip ronde yg sudah punya round_id). Juga fix bug key carry-over di DELETE endpoint (`panjar_id`, sebelumnya cek `source_id/cash_advance_id` yg tak pernah cocok). Terverifikasi testing_agent (iteration_29): PNJ-202607-0004 7/7 ronde ter-tag, 6 jurnal + 6 fixed_costs ter-tag, UI kini tampilkan 7 tombol Trash; DELETE ronde Settled →400 (locked), unknown →404. Perlu deploy backend (startup akan auto-heal data produksi).
- Update 2026-06: **3 fitur baru (P&L amort marker, Pipeline Penerimaan, PPh21 Karyawan)** — semua terverifikasi testing_agent (iteration_30, 100%, 6/6 pytest).
  1. **Penanda Amortisasi di P&L (Order)**: `/api/reports/profit-loss` kini kembalikan `amort_breakdown` (bucket Expense) & `amort_cogs_breakdown` (bucket COGS) = nominal slice amortisasi per kategori dalam periode. Frontend `ProfitLoss.js`: kartu kategori yang mengandung slice amortisasi diberi label oranye "(Amortisasi)" + sub-line "amort: Rp X" + tooltip.
  2. **Laporan Pipeline Penerimaan Kas** (`/pipeline`, `ReceivablePipeline.js`, menu Master & Laporan): endpoint `GET /api/reports/receivable-pipeline?month=YYYY-MM`. Dua bucket — **NY-PO (Not Yet PO)** = order status `Reconciled` (selesai, belum invoice, nunggu PO customer → bahan eskalasi); **PYMHD** = order status `Invoiced` (belum dibayar / AR berjalan). 3 kartu ringkasan + 2 tabel + filter bulan + export Excel. Juga dipakai sebagai panel dashboard (backlog kalau perlu).
  3. **PPh21 Karyawan (nett, metode TER PMK 168/2023)**:
     - Master karyawan: field baru `ptkp_status` (dropdown TK/0..TK/3, K/0..K/3).
     - Tabel TER resmi A/B/C (Lampiran PMK 168) sebagai konstanta backend + progresif Pasal 17 (UU HPP) untuk hitung ulang Desember. PTKP→kategori: A={TK/0,TK/1,K/0}, B={TK/2,TK/3,K/1,K/2}, C={K/3}.
     - Dihitung otomatis saat run payroll (basis bruto bulanan = gaji pokok net + uang makan + lembur). NETT → TIDAK memotong net karyawan (ditanggung perusahaan). Disimpan per-slip (`pph21`, `ptkp_status`, `ter_category`, `ter_rate`, `pph21_bruto`) + `total_pph21` & `pph21_status` di dok payroll. Payroll lama tanpa field dihitung on-the-fly (TER bulanan).
     - COA baru **6106 Beban PPh21 Karyawan (Ditanggung Perusahaan)** + kategori expense "PPh21 Karyawan".
     - Menu HR baru **PPh21 Karyawan** (`/hr/pph21`, `Pph21.js`): list per periode + rincian per karyawan (expand). Tombol "Bayar PPh21" → `POST /api/hr/pph21/{payroll_id}/pay` (pilih rekening + tanggal) → insert `fixed_costs` (muncul di Expenses) + jurnal Dr 6106 / Cr Kas, status jadi `paid`. Skip aturan +20% non-NPWP (sesuai permintaan user). `delete_payroll` me-reverse pembayaran PPh21 juga.
  Perlu deploy backend+frontend.
- Update 2026-06: **Optimasi build produksi frontend** (keluhan deploy lambat di VPS). (1) `craco.config.js`: ganti minifier Terser→**esbuild** (EsbuildPlugin) via esbuild-loader — fase minify jauh lebih cepat. (2) `frontend/.env.production` (baru): `GENERATE_SOURCEMAP=false`, `DISABLE_ESLINT_PLUGIN=true`, `INLINE_RUNTIME_CHUNK=false`, `TSC_COMPILE_ON_ERROR=true` — hanya berlaku saat `npm run build` (tidak ganggu dev/preview, tidak sentuh REACT_APP_BACKEND_URL). Hasil: cold build 16s / warm 6s, "Compiled successfully" TANPA blok [eslint]. Catatan penting: webpack persistent filesystem cache TIDAK jalan di build produksi CRA (react-scripts tak panggil compiler.close()), jadi yang menyelamatkan repeated build = cache babel-loader di node_modules/.cache → JANGAN pakai `npm ci` (menghapus node_modules); pakai `npm install` + skip kalau package-lock tak berubah. Perintah deploy diperbarui di jawaban ke user.
- Update 2026-06: **PPh21 opt-in per karyawan** (`pph21_active`). Field baru di master karyawan (checkbox "Hitung PPh21?" di `HrPayroll.js`, default OFF). Backend `_calculate_payroll_slips`: PPh21 dihitung hanya jika `pph21_active`=true, else 0 + slip tandai `pph21_active`. `_enrich_pph21_slips` (endpoint `/api/hr/pph21`) meng-EXCLUDE karyawan non-aktif dari list (pakai flag slip, fallback master utk payroll lama). `list_pph21`/`pay_pph21` bangun map `_active`. `list_employees` kini default `pph21_active=False` & `ptkp_status="TK/0"` utk dok lama (schema konsisten). Terverifikasi testing_agent iteration_31 (frontend 100%; baseline all-inactive→0 slips; aktifkan Abidin PTKP K/1→TER B 6%×15jt=900rb; net karyawan tidak berkurang/nett) + minor serializer default sudah difix & dicek curl. Perlu deploy backend+frontend.
- Update 2026-06: **FIX BUG kritikal Bulk Mark-Paid + Undo + filter bulan AWB + hapus subtitle** (verified testing_agent iteration_32, 100%).
  - Root cause bug: di Payments.js, `toggleAll`/`selectableRows` pakai set `rows` (semua) bukan `filtered` → select-all menandai SEMUA outstanding walau sedang difilter. Fix: `filtered` (termasuk monthFilter), `selectableRows/selectableIds/allSelected/toggleAll` berbasis `filtered`; selection auto-clear saat filter (q/customer/bulan) berubah; `submitBulk` batasi awb_ids ke selectableRows. Backend `bulk_mark_paid` sendiri sudah benar (hanya id yang dikirim).
  - Recovery insiden: 37 order yang salah ter-Paid (1 batch, paid_at sama, tanpa no invoice) sudah di-revert ke Invoiced + jurnal payment dihapus (via DB). Baseline balik ke 0 Paid / 721 Invoiced.
  - Undo baru: helper `_revert_one_paid` + `POST /api/orders/{oid}/revert-paid` (single) & `POST /api/payments/bulk-revert-paid` (bulk) — set status Invoiced, hapus jurnal payment, unset paid_at/payment_invoice_number. Ditolak (400) jika ada payment_receipts (multi-bayar). UI: tombol "Batalkan Lunas" (data-testid revert-paid-<id>) di baris Paid.
  - Filter bulan AWB: dropdown "Bulan AWB" (data-testid payments-month-filter) berdasarkan tanggal AWB (created_at), label Indonesia + "Semua Bulan".
  - Subtitle: `PageHeader` (ui.js) tidak lagi render `subtitle` → hint/tutorial abu-abu di SEMUA halaman hilang (kesan lebih profesional). Prop subtitle dibiarkan (no-op).
  Perlu deploy backend+frontend.
- Update 2026-06: **(a) Skrip revert bulk-paid utk VPS, (b) field Asuransi di Edit AWB, (c) panduan deploy zero-downtime**.
  (a) `/app/scripts/revert_bulk_paid.py` — kelompokkan order Paid per paid_at (bulk = 1 timestamp identik), dry-run default, `--latest --apply` revert cluster terbaru, `--paid-at "<iso>" --apply` revert cluster spesifik; skip order yg punya payment_receipts; hapus jurnal payment. Jalankan: `docker exec arc-backend-1 python /app/scripts/revert_bulk_paid.py`.
  (b) Edit AWB (Recap.js) kini punya section Asuransi (Ya/Tidak + Nilai Polis + Nilai Asuransi) — mirror form input. Backend PATCH /orders/{id}/extended sudah menerima insurance_enabled/polis_amount/insurance_amount (dicek via curl: persist OK). Catatan: input-time insurance TIDAK menambah grand_total (konsisten dgn create); addons invoice tetap dari step Receive.
  (c) Downtime deploy: (1) frontend rsync JANGAN pakai --delete → chunk lama tetap ada, sesi user aktif tak error; (2) nginx `proxy_next_upstream error timeout http_502 http_503` utk retry saat backend restart ~detik; (3) deploy di jam sepi; zero-downtime penuh butuh 2 replica backend + rolling.
- Update 2026-06: **Fix layout Activity Log "Detail Perubahan"**. Nilai panjang/JSON (mis. awb_breakdown) sebelumnya render 1 karakter per baris karena `break-all` di dalam cell grid 3-kolom sempit. Fix (ActivityLog.js ~98-112): label di ATAS nilai, nilai object/panjang span penuh (md:col-span-2), pakai `<pre>` whitespace-pre-wrap + break-words + kotak border + max-h-48 overflow-auto, JSON di-pretty-print (indent 2). Verified testing_agent iteration_33 (frontend 100%).
- Update 2026-06: **Activity Log Detail → layout multi-kolom (ke kanan)**. Untuk aksi banyak field (mis. operation/HR UBAH 41 field), detail kini grid responsif (2/3/4 kolom) mengalir horizontal, label kecil abu-abu di atas nilai; nilai object/JSON/panjang (>40 char) span penuh + pretty-print. Label truncate diberi title (tooltip). Verified testing_agent iteration_34 (frontend 100%).
- Update 2026-06: **Activity Log detail → POPUP MODAL**. Sebelumnya expand inline sempit/berantakan (kejepit di kolom kiri). Kini klik baris membuka modal lebar (max-w-4xl): bagian atas meta (Waktu/User/Role/Aksi/Modul/Target) grid 3-kolom, lalu "Detail Perubahan" grid 1/2/3 kolom (nilai object/JSON/panjang span penuh + box scroll + pretty-print), method/path di bawah. Klik luar / tombol X untuk tutup. (Tanpa testing agent sesuai permintaan user; compile bersih.)
- Update 2026-06: **Settle Hutang Vendor: Bulk Paid + Filter Bulan** (AccrueSettlement.js). Kolom checkbox + select-all (hanya baris TERFILTER, mirror pola Payments), tombol "Bulk Paid (n)" + total; pilihan auto-reset saat filter (q/vendor/bulan) berubah; POST /api/costs/bulk-settle (loop settle_cost, skip non-Accrue). Dropdown "Bulan (Tgl Biaya)" berbasis created_at, label Indonesia. Verified testing_agent iteration_35 (frontend 100%; select-all pilih 2 bukan 643; bulk hanya settle terpilih; data direstore). Perlu deploy backend+frontend.
- Update 2026-06: **Edit Nomor Invoice di Invoice Tercetak** (InvoicesCreated.js). Beberapa nomor invoice diinput manual → perlu bisa diedit. Backend `PATCH /api/invoices/{iid}/invoice-number` {invoice_number} (require_role operation/finance/admin): validasi non-kosong, update dok invoice + `invoice_number_updated_at/by`, sinkron memo & description jurnal terkait (match `reference_id`, replace nomor lama→baru; jurnal tetap link via id, memo cosmetic). Permission baru `invoices_created.edit_invoice_number`. Frontend: ikon pensil di kolom No. Invoice (gated) → modal "Edit Nomor Invoice" (tampil AWB+customer, input + Simpan, Enter to save). Verified curl (edit OK, kosong→400, round-trip revert bersih di data live) + screenshot modal. Perlu deploy backend+frontend.
- Update 2026-06: **Koreksi Tarif AWB (super admin, auto-sync jurnal)**. Kebutuhan: edit tarif utk 66 AWB (sudah Invoiced) tanpa harus reject reconcile→ulang, dan tanpa edit DB langsung (takut neraca desync). Solusi: menu **Administrator → Koreksi Tarif AWB** (`/admin/koreksi-tarif`, admin only). Backend: helper `rewrite_journal_lines()` (tulis ulang lines+total jurnal IN PLACE, re-enrich akun, bypass period lock krn koreksi di periode asli) + `resync_awb_tariff_journals(awb)` (sinkronkan 4 jenis jurnal: PYMHD `awb_order_pymhd` DR1290/CR2390, Revenue `awb_revenue_recognition` DR2390/CR4101, Invoice/AR `invoice` DR1201/CR1290/CR2210 — recompute atas SEMUA AWB dalam invoice utk multi-AWB, Payment DR kas/CR1201 bila ada). Endpoints (require_role administrator): `GET /api/admin/tariff/search?q=` & `POST /api/admin/tariff/{oid}/correct` {new_total_tariff} → set total_tariff, PPN dihitung ulang otomatis dari tax_percentage tersimpan, grand_total=tarif+PPN+addons; tolak bila status Paid. Frontend `TariffCorrection.js`: search + tabel + modal preview SEBELUM/SESUDAH. Verified (data live): tarif 31.416.500→30jt, PPN 0→3,3jt, 3 jurnal tersync, **trial balance tetap balance**; data live di-RESTORE ke asli. Perlu deploy backend+frontend.
- Update 2026-06: **Default PPN di Master Customer**. `CustomerIn += default_ppn_percentage`. Form Customer (Customers.js) ada input "Default PPN (%)". OrderInput: saat pilih customer, `tax_percentage` auto-isi dari default customer (jika ada). Dipakai juga di Import Massal untuk mengisi PPN AWB yang kosong.
- Update 2026-06: **Import Massal AWB (super admin, rekonsiliasi dari Excel)**. Menu **Administrator → Import Massal AWB** (`/admin/import-massal`, admin only). File Excel kolom: No AWB, DPP, No Invoice, No PO. Alur 2 tahap: `POST /api/admin/bulk-import/preview` (multipart) → laporan pratinjau {not_found, dpp_changes, ppn_fills, invoice_fill/changes/create, po_fill/changes, groupings} + items; `POST /api/admin/bulk-import/apply` {items, apply_dpp, apply_invoice, apply_po} → eksekusi + laporan hasil. Aturan: AWB gk ada→skip+report; DPP beda→konfirmasi (per-kategori) & saat apply pakai `resync_awb_tariff_journals`; PPN AWB kosong→pakai default customer; No Invoice/PO beda→konfirmasi, kosong→auto-isi; AWB belum diinvoice→sistem BUAT invoice (status→Invoiced + recognize revenue, AR posting saat cetak); beberapa AWB dgn No Invoice sama→DIGABUNG jadi 1 invoice (pilih kanonik, hapus invoice duplikat + jurnal AR-nya, union awb_ids, rebuild 1 jurnal AR gabungan via `rebuild_invoice_ar_journal` bila sudah ar_recognized). Helper baru: `insert_journal_direct()` (post jurnal bypass period lock), `rebuild_invoice_ar_journal()`. Frontend `BulkImport.js`: download template + upload → laporan pratinjau (section collapsible per kategori) + checkbox konfirmasi per-kategori (DPP/Invoice/PO) → Terapkan → laporan hasil. Verified (data sintetis TESTIMP di-setup+teardown, data live tidak disentuh): preview akurat (not_found, dpp, ppn fill, grouping), apply gabung A+B+C→1 invoice INV-GRP, invoice lama terhapus, AR gabungan=4.440.000 (sum 3 gross), PPN blank C→11%, DPP A 1jt→1,5jt, **global trial balance tetap balance sebelum & sesudah**, cleanup balik ke nilai pre-test. Perlu deploy backend+frontend.
- Update 2026-06: **Invoice Print overhaul + filter bulan + fixes (7 item)**.
  1) Signer box dibuat kotak berbatas = ukuran box bank (invoice_docs.py). 2) Invoice No/PO/Date: nilai rata tepat setelah titik dua (tabel meta PDF). 3) Kop: logo 70→95px, nama perusahaan 21px + UPPERCASE (via .upper() krn xhtml2pdf tak dukung text-transform) + header 3-kolom biar center di halaman. 4) **Fix print individual blank**: cetak individual kini diarahkan ke PDF server-side yang SAMA dgn bulk (endpoint baru `GET /api/invoices/{id}/pdf`), tombol "Cetak Invoice + Lampiran (PDF)" di InvoicePrint.js buka blob PDF → tidak pernah blank & format identik dgn bulk. 5) **Filter Bulan (Tgl Invoice)** di InvoicesCreated.js (berbasis invoice_date||first_printed_at||created_at), ikut mode OR/AND → bisa digabung dgn filter customer. 6) Export FPK sudah berbasis filter (pakai `targetIds()` = selected|filtered). 7) Tanggal invoice auto-terisi di renderer PDF (fallback invoice_date→first_printed_at→created_at) utk individual & bulk. Verified: /pdf & bulk 200 + PDF /Count=2; month filter render 8 opsi; page compile OK. Catatan: preview web on-screen masih layout lama (Tailwind), output CETAK = PDF server. Perlu deploy backend+frontend.
- Update 2026-06: **Terapkan Default PPN ke AWB existing**. Masalah: set default PPN 1.1% di customer tapi invoice lama tetap 11% (AWB sudah punya %=11 + amount terisi, bukan blank → tidak ke-trigger fill). Solusi: `POST /api/customers/{cid}/apply-default-ppn` (admin, `?dry_run=true` utk preview count). Recompute tax_amount+grand_total semua AWB customer ke default_ppn + `resync_awb_tariff_journals`; override %lama; skip status Paid. Frontend Customers.js: tombol "Terapkan Default PPN ke Semua AWB Customer Ini" di edit modal → dry-run → confirm → apply. Verified sintetis: 11%(amt 1.182.500)→1.1%(amt 118.250), neraca balance. Caveat: hanya AWB dgn customer_id persis (customer per-lokasi terpisah). Perlu deploy ke VPS.
- Update 2026-06: **PPN blank fix + Invoice 2-halaman + Bulk Download ZIP + fix Bank/Sign**.
  1) PPN "blank" diperluas: `tax_percentage<=0 ATAU tax_amount==0` → pakai default customer (menangkap sisa import %=11/amt=0). PPN-fill otomatis (tak digate apply_dpp). `_bulk_gather` +`current_tax`. Verified: %=11/amt=0 + default 1.1% → 1.1%/amt 198rb, neraca balance.
  2) Fix Bank/Sign kosong di invoice: akar = `awb.company_name` kosong → lookup per-issuer gagal. Tambah setting GLOBAL `company_signer/company_bank_name/company_bank_holder/company_bank_account` sbg fallback di `build_invoice_full()` + seed + label Settings.js. Verified /full.
  3) Invoice print 2 halaman: renderer server-side baru `backend/invoice_docs.py` (xhtml2pdf) Hal.1 Cover + Hal.2 Lampiran (page-break-before). Verified /Count=2.
  4) Bulk Download ZIP: `build_invoice_full()` diekstrak reusable. `POST /api/invoices/bulk-download/validate` (found/missing) & `POST /api/invoices/bulk-download` (ZIP; 1 PDF/invoice, nama=nomor invoice disanitasi, READ-ONLY tak ubah akunting). Frontend InvoicesCreated.js: tombol "Bulk Download ZIP" → modal textarea (pemisah bebas) → Cek → "Download N Invoice". Verified curl (validate dedupe+mixed sep, ZIP PDF valid %PDF /Count=2) + screenshot.
  Catatan: data preview Emergent ≠ VPS user (arc.ar-cargo.com); default PPN & bank/sign harus diisi di VPS. Perlu deploy backend+frontend ke VPS.
- Update 2026-06: **Fix "PPN 11% palsu" + Attn di Invoice cetak**. Laporan user: banyak invoice hasil bulk/single print tampil "PPN 11%" default & Attn kosong. Investigasi DB: import massal meng-hardcode `tax_percentage=11.0` ke SEMUA AWB (server.py ~8256) padahal 860/867 AWB ber-PPN Rp 0 → PDF tampil "11% tapi Rp 0". Attn kosong krn 0/36 customer mengisi field `attn` (simpan via PUT /customers TERBUKTI jalan via curl; fallback consignee/pic_name sudah ada). Fixes (dikonfirmasi user, tanpa testing agent): (1) `invoice_docs.py _render_invoice_inner`: `ppn_pct` kini diturunkan dari nominal riil `round(ppn_amt/sub_total*100,2)` — pajak 0→"0%", ada pajak→persen benar. (2) Import (`_parse_excel`): hentikan hardcode 11.0, ambil `default_ppn_percentage` customer (kosong→0). Verified render HTML: invoice tax=0 → "0%" (dulu "11%"); invoice ber-pajak → "11%" benar; Attn muncul saat master customer diisi (data uji di-revert). Attn: tidak ada perubahan kode diperlukan — user isi manual per customer. Perlu deploy backend ke VPS.
- Update 2026-06 (lanjutan Attn/PPN): Klarifikasi user: (a) nominal PPN sudah benar 1.1% tapi LABEL salah tulis "11%" → sudah ter-fix oleh perhitungan label dari nominal riil (uji: DPP 1jt + pajak 11rb → label "1.1%"). (b) Attn hilang HANYA di file import terakhir. Akar: `get_or_create_customer` di `_parse_excel` mencocokkan nama customer SAMA PERSIS (case-sensitive) → nama Excel "PT. EKAMAS MORA REPUBLIK, TBk" vs master "PT. EKAMAS MORA REPUBLIK, Tbk" (beda huruf B/b) dianggap beda → dibuat customer duplikat KOSONG → AWB batch-2 nyambung ke situ → Attn hilang. Fix: helper `_cnorm` (lowercase + buang semua non-alfanumerik) + preload `existing_customers_by_norm` (bila nama kembar pilih record TERLENGKAP: punya attn/default_ppn/address/npwp). Matching import kini abaikan beda huruf besar-kecil/spasi/titik/koma. Verified: kedua ejaan Tbk/TBk → norm identik "ptekamasmorarepubliktbk". User pilih perbaiki data lama via IMPORT ULANG batch terakhir setelah deploy (bukan tool merge). Perlu deploy backend ke VPS lalu user import ulang batch 2.
- Update 2026-06: **Tool "Gabung Customer Duplikat"** (super admin). User tak mau import ulang → butuh cara memperbaiki data yang sudah terlanjur nyambung ke customer duplikat kosong. Backend (server.py): `GET /api/admin/customers/duplicates` (kelompokkan customer via `_cust_norm` = lowercase+buang non-alfanumerik; hanya grup >1; sarankan UTAMA = paling lengkap `_cust_richness`, tie→AWB terbanyak; sertakan awb/contract/sender count per member) & `POST /api/admin/customers/merge` {canonical_id, duplicate_ids} (pindahkan `awb_orders`/`contracts`/`sender_memory`.customer_id dari duplikat→utama; sender_memory unique(customer_id,name) ditangani: konflik→hapus, selain itu→pindah; lengkapi field kosong utama dari duplikat: attn/default_ppn/address/npwp/company_details; hapus duplikat; invoice ikut otomatis via AWB; log_activity "merge"). Frontend `pages/CustomerMerge.js` route `/admin/gabung-customer` (admin only) + menu "Gabung Customer Duplikat" (Layout.js, ikon GitMerge): daftar grup, radio pilih UTAMA (default=saran), badge UTAMA/akan dihapus, kolom Attn/Default PPN/Alamat/AWB/Kontrak/Sender, tombol "Gabung (n)" + confirm. Verified e2e (curl+screenshot, data sintetis setup→merge→verify→cleanup): AWB/kontrak/sender pindah ke utama, duplikat terhapus, halaman render benar. Perlu deploy backend+frontend ke VPS.
- Update 2026-06: **Rombak Pipeline Penerimaan Kas** (`/pipeline`, ReceivablePipeline.js + `GET /api/reports/receivable-pipeline`). Sesuai permintaan user jadi 3 kategori: (1) **Open/Sedang Berjalan** (status Open, aging dari created_at/tgl order), (2) **NY-PO Belum Invoice** = status Reconciled belum invoice DITAMBAH invoice yang sudah dibuat tapi BELUM diprint (first_printed_at kosong) — aging dari reconciled_at; baris diberi sub "Belum Invoice"/"Invoice belum diprint", (3) **Invoiced Belum Dibayar** = invoice SUDAH diprint tapi belum Paid — aging dari first_printed_at (tgl print). Filter bulan memfilter tiap kategori oleh tanggal acuannya masing-masing & semua summary ikut bulan terpilih. Fix bug aging None akibat campuran datetime tz-aware vs naive (normalisasi `_naive`). Invoice lookup dukung multi-AWB (awb_id + awb_ids). Frontend: 3 kartu ringkasan KLIK-ABLE (ring highlight), tabel detail HANYA muncul saat kartu diklik (toggle), export Excel 3 sheet. Verified curl (month 2026-04 open 28/aging 138hr; 2026-07 invoiced 501/aging 35-40hr; semua baris in-month; ny_po sub breakdown 106 belum-invoice + 4 belum-print) + screenshot (klik Invoiced → tabel Tgl Print+Umur tampil). Perlu deploy backend+frontend ke VPS.
- Update 2026-06: **Data produksi VPS di-restore ke preview** (arc_db → tms_db, mongorestore --drop, 13.236 dok: 1434 AWB / 1060 awb_costs / 511 invoice / 37 customer). Analisa file "SBE - DAUS.xlsx" (257 baris biaya vendor): 97 sudah masuk & cocok, 47 AWB ada tapi belum ada biaya vendor, 113 AWB belum ada di sistem (± Rp 938 jt belum masuk). Catatan: banyak No AWB tersimpan dengan NOL DEPAN (mis. 58851→0058851) → cocokkan numerik (lstrip '0'). Dibuatkan Excel ber-STATUS di /app/frontend/public/SBE-DAUS-STATUS.xlsx (kolom "STATUS HPP VENDOR" + "NILAI DI SISTEM", warna per baris). 
- Update 2026-06: **Prorata Vendor — search AWB lintas status**. Sebelumnya kandidat prorata hanya status Open/Reconciled. Sekarang `GET /api/cost-groups/candidate-awbs` menerima `q` (cari No AWB regex lintas SEMUA status termasuk Invoiced/Paid, abaikan periode) & `include_invoiced` (browse mode + Invoiced/Paid); nama customer diresolusi dari customer_id. Frontend Costs.js modal Prorata: kotak Search (data-testid pro-awb-search, debounce 300ms), toggle "Termasuk Invoiced/Paid" (pro-incl-invoiced), pilihan AWB disimpan di `proSelected` map (persist walau hasil search berubah) + chip AWB terpilih yang tidak tampil di list, badge warna status. Verified curl (q=201934 Invoiced & q=200765 Paid ketemu; browse default 529 Open/Reconciled; include_invoiced 1433 semua status) + screenshot (search Paid tampil, chip Invoiced persist, sales total terhitung). Perlu deploy backend+frontend ke VPS.
- Update 2026-06: **Redesign Halaman 2 Invoice (Lampiran)** sesuai template PDF user (AR CARGO). HANYA halaman 2 yang diubah (cover halaman 1 tetap). File: invoice_docs.py `_render_invoice_inner` blok page-2. Layout baru: header BILL TO (customer name/address/NPWP/UP:attn) kiri + logo AR CARGO + "INVOICE" + no invoice kanan; tabel 15 kolom: NO., PICK UP DATE(created_at), SERVICE(status_pengiriman), NO AWB("AR-"+awb_number), ORIGIN, DESTINATION, TRANSPORT(fleet_type/mode), QTY(qty_kg, integer bila bulat), KOLI(koli_count), HARGA PENGIRIMAN(total_tariff), BIAYA BONGKAR MUAT(spsi_amount+sewa_forklift_amount bila enabled), ASURANSI(received_asuransi_amount), POLIS(received_polis_amount), JUMLAH(harga+bongkar+asur+polis), KET(nopol); blok total kanan-bawah: TOTAL(sub_total), PPN {pct}%, SUB TOTAL, MATERAI(-), ASURANSI, POLIS, ADM. LAIN(-), LAIN-LAIN(bongkar muat), GRAND TOTAL(grand_total). Catatan teknis: xhtml2pdf TIDAK dukung ganti orientasi per-halaman (named @page landscape gagal) & TIDAK hormati <colgroup> → lebar kolom dipasang via atribut width per <td> (header+body), font 5.5-6px. Verified render 1-AWB & multi-AWB(11 baris) via PyMuPDF image + endpoint live /api/invoices/{id}/pdf (200, 2 halaman). SERVICE/KOLI/KET kosong utk AWB hasil import lama (field belum diisi); terisi utk order input manual. Preview: /LAMPIRAN-PREVIEW.pdf di public. Perlu deploy backend ke VPS.
- Update 2026-06: **Importer "Import Detail AWB (Report)"** (server.py + ImportExcel.js). Endpoint POST /api/import/awb-detail/preview & /apply. Baca file Report EMR (2-baris header). Cocokkan No AWB (exact + normalisasi nol depan). UPDATE (mode TIMPA): detail non-finansial (status_pengiriman[REGULER→Reguler/PROJECT→Project], created_at dari Tgl Pick Up, fleet_type dari Transport, origin[From], destination, nopol[No Mobil], qty_kg, koli_count, work_type) + finansial (received_polis_amount, received_asuransi_amount, spsi_enabled/amount, sewa_forklift_enabled/amount, total_tariff=Amount−addons, tax_amount=freight×pct, addons_total, grand_total). Deteksi grup layanan aktif Kirim/Dismantle/Relokasi (kolom 15-41) otomatis. Setelah update → resync_awb_tariff_journals() rebuild jurnal PYMHD/Revenue/Invoice-AR/Payment (nilai invoice dihitung live dari AWB). Data Report EMR April-Mei: 250 baris, 250 cocok, 0 not-found, 0 invoice berubah nilai (finansial sudah sama → praktis mengisi DETAIL saja). Verified: preview 250 (curl+screenshot); apply 1 AWB (205654) → detail terisi & trial balance tetap seimbang (D==C). CATATAN: INSERT AWB-baru untuk not-found BELUM dibangun (file ini 0 not-found; butuh mapping customer). Semua 250 AWB berstatus Invoiced. Perlu deploy backend+frontend ke VPS. (Saat uji, AWB 205654 di preview-DB ikut terupdate — nilai identik, aman.)
- Update 2026-06: **Importer "Import Detail AWB" jadi HEADER-AWARE** (server.py `_parse_report_detail`). Root cause: parser lama baca posisi kolom HARDCODE (khusus layout Report EMR April-Mei). File baru "REPORT AR - EMR PERIODE JULI 2026" ubah susunan kolom: +Vendor Name(6)/+Penerima(11)/+DG(18), +SURCHARGE & +UN NUMBER di tiap grup, Amount pindah (43→48) → parser lama salah baca (transport/origin/dest/qty/amount/addons geser). Fix: deteksi kolom via NAMA header (2-baris), forward-fill nama grup layanan (Kirim/Dismantle/Relokasi), map sub-header Polis/Insurance/SPSI/Sewa Froklift; kolom biaya lain (Kirim/Loading/Air/Konsul/Trucking/Packing + SURCHARGE + UN NUMBER) hanya dipakai deteksi grup aktif → ikut freight (SURCHARGE & UN NUMBER DIABAIKAN sbg add-on, per keputusan user). Vendor Name diabaikan (alias PT. Abirama); Penerima → simpan ke `received_by_name`. Backward-compatible: April-Mei tetap 250 baris terbaca benar. Verified: parse lokal kedua file (kolom benar) + PREVIEW live file Juli via /api/import/awb-detail/preview (HTTP 200, 335 baris, 123 cocok, 212 not-found, 52 invoice berubah nilai — not-found tinggi krn preview-DB snapshot Aug-11 belum berisi AWB Juli baru; di DB produksi akan lebih banyak cocok). READ-ONLY, data tidak diubah. Perlu deploy backend ke VPS.
- Update 2026-06: **Import Detail AWB — INSERT AWB baru (not-found) + auto-invoice** (server.py `import_awb_detail_apply/preview`, ImportExcel.js). Sebelumnya baris yang No AWB-nya belum ada di sistem hanya dilaporkan (skip). Sekarang bisa DI-INSERT. Keputusan user: customer = induk **PT. EKAMAS MORA REPUBLIK, Tbk** (di-resolve via regex nama, EMR=Ekamas Mora Republik), PPN ikut default customer (1.1%), FWA disimpan apa adanya, SURCHARGE & UN NUMBER diabaikan, Vendor Name diabaikan, Penerima→received_by_name. Helper baru: `_report_find_emr_customer`, `_report_calc_financials`, `_report_insert_order` (buat awb_orders + jurnal PYMHD DR1290/CR2390 via insert_journal_direct, bypass period lock; created_at dari Tgl Pick Up). Alur apply: (1) insert order tiap not-found (dedup by norm AWB), (2) recognize_revenue_for_awb (DR2390/CR4101) semua order baru; yang TANPA No Invoice → status Reconciled, (3) group by No Invoice: buat/gabung invoice (union awb_ids ke invoice existing bila nomor sama), set Invoiced + ar_recognized=True + invoice_date=pickup, rebuild_invoice_ar_journal (DR1201/CR1290/CR2210). Param `insert_missing` (Form, default True). Preview kembalikan to_insert/insert_with_invoice/insert_without_invoice/insert_customer(+found flag)/insert_sample. Parser `_parse_report_detail` ditambah ekstrak "No Invoice" & "Tanggal Terima"; status non-PROJ/REG (mis. FWA) disimpan apa adanya. Verified (data sintetis TESTINS-001 invoiced + TESTINS-002 no-invoice): order dibuat, jurnal PYMHD+Revenue+AR SEMUA balance (1201 D1.011.000/1290 net 0/2390 net 0/4101 C1jt/2210 C11rb), status Invoiced vs Reconciled benar, penerima tersimpan, **global trial balance tetap balance** sebelum & sesudah; data test dihapus bersih. PREVIEW live file Juli: 335 baris → 123 update + 210 insert (125 ada No Invoice, 85 tanpa), customer EMR Tbk PPN 1.1% ter-resolve. Perlu deploy backend+frontend ke VPS.
