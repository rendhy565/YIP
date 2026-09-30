# PRD — ARC (TMS) / Kacrut Digital

## Problem Statement (asli)
"Tolong deploy reponya dengan informasi dari doc.md dan database dari file .gz yg saya lampirkan. Terus cek fitur payroll ya."
Follow-up: "Kok saya udah jalanin payroll september, tp bebannya gk masuk ke expense ya" → "Benahi dan pastikan saat saya deploy di VPS saya terterapkan juga".

## Konteks
- Aplikasi: **ARC** = ERP/TMS logistik (Order Mgmt, Accounting PSAK, HR & Payroll, Tax, Asset, Bank Recon).
- Stack: FastAPI + Motor (Python) · React + craco · MongoDB `arc_db`.
- Preview Emergent: backend :8001, frontend :3000, Mongo lokal. VPS produksi user: `arc.ar-cargo.com` (lihat doc.md).
- Backup di-restore: `luxoptic-shared-Kacrut-Digital-2026-09-30.gz` (mongodump --archive --gzip; berisi `arc_db`, `luxoptic_db`, `ocs_production`). 44.256 dokumen ter-restore, `arc_db` ditimpa (--drop).

## Setup notes (preview)
- Fix dependency Python venv preview: pydantic-core==2.23.4 (match pydantic 2.9.2), lxml, et_xmlfile, + deps xhtml2pdf (reportlab/svglib/pyHanko). VPS user build dari requirements sendiri, tidak terpengaruh.

## Root Cause — beban payroll tidak masuk Expense
- `run_payroll` HANYA posting jurnal `Dr 6101 Beban Gaji` (benar; muncul di Income Statement PSAK).
- Halaman **Expense** & **Laporan Laba Rugi** (`/api/reports/profit-loss`) baca koleksi `fixed_costs`, BUKAN jurnal.
- Jan–Agu: user input manual baris Expense "Gaji Karyawan & Lembur" (akun 6207) tiap bulan → muncul di Laba Rugi.
- September: baris manual belum diinput → beban gaji Sep tidak muncul di Expense/Laba Rugi.

## Fix (implemented 2026-09-30) — server.py
- `ensure_payroll_expense(pdoc)`: cerminkan beban gaji payroll ke `fixed_costs` (category "Gaji", akun 6101, `no_journal=True`, `source_type="payroll"`, `source_ref`=payroll id). TIDAK posting jurnal baru (hindari dobel dengan 6101). Idempoten + skip bila sudah ada input Expense gaji manual >=50% net di bulan sama (cegah dobel bulan lama).
- `run_payroll`: panggil `ensure_payroll_expense` setelah post jurnal.
- `delete_payroll`: hapus juga `fixed_costs` source_type=payroll milik payroll tsb.
- `update_fixed_cost`: skip re-post jurnal untuk record `no_journal` (auto payroll).
- `backfill_payroll_expense()` dipanggil di `seed_data()` (selalu jalan tiap startup, sebelum gate SEED_DEMO_DATA) -> memperbaiki payroll yang sudah terlanjur jalan (Sep) otomatis saat backend start / **redeploy di VPS**.

### Verifikasi
- Sep: auto expense Gaji Rp 104.049.866 dibuat. P&L Sep total_expense 126.8M -> 230.9M, net profit -> -36.4M. PSAK 6101 Sep tetap single (104M).
- Agu: TIDAK digandakan (manual 107.9M sudah ada). Idempoten setelah restart (tetap 1 entry Sep).

## Known issue (pre-existing, belum ditangani)
- Di **Income Statement PSAK** (basis jurnal), bulan Jan–Agu gaji **dobel**: 6101 (jurnal payroll) + 6207 (jurnal dari input Expense manual). Ini data lama sebelum fix. Sep sudah bersih (single). Perlu keputusan user untuk pembersihan retro (reversal 6207 lama) — RISIKO tinggi, belum dilakukan.

## Backlog / Next
- P1: Bersihkan dobel 6101 vs 6207 historis (Jan–Agu) di ledger PSAK (butuh konfirmasi & reversal terkontrol).
- P2: Tandai baris Expense auto-payroll sebagai read-only di UI (cegah user edit/hapus tak sengaja).
- P2: Satukan kategori "Gaji" (6101) vs "Gaji Karyawan & Lembur" (6207) agar konsisten.
