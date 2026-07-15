# PRD — AR Cargo TMS (Order → Cash)

## Original problem statement (latest thread)
User meminta:
1. **Bug filter tanggal analitik** — filter s.d tanggal 6 harus inklusif (fixed ✅).
2. **Perbaikan TMS**: PPN 1.1%, dropdown armada standar, cek duplikat AWB, format ribuan, jadwal keberangkatan, tracking history.
3. **Invoice header** — logo kiri, alamat AR Cargo center (HTML & Excel).
4. **HR Master Karyawan** — form lengkap.
5. **PKS Word document** — generate via python-docx.
6. **Import Invoice Number** — grouping multi-AWB, cap error responses.
7. **Notifikasi Recurring Expense di Dashboard**:
   - H-1 (besok) → card pink, tanpa tombol
   - Hari H (belum dibayar) → card merah + tombol "Laksanakan Pembayaran"
   - Hari H (sudah auto-executed) → card hijau + tombol disabled "Sudah Dieksekusi"
   - Tombol laksanakan → buka modal Expense (halaman FixedCosts), auto/manual keduanya post ke expense collection.

## Architecture
- Frontend: React + TailwindCSS, halaman di `/app/frontend/src/pages`, komponen di `/app/frontend/src/components`
- Backend: FastAPI monolith `server.py` (~9k lines) + PyMongo
- MongoDB collections: `awb_orders`, `invoices`, `fixed_costs` (=expense), `recurring_expenses`, `employees`, `settings`
- Auth: JWT + granular permission via `permission_actions[module][feature]`

## Completed features (as of Feb 2026)
- ✅ Analytics date inclusive filter (end_of_day)
- ✅ PPN 1.1%
- ✅ Armada dropdown (21 opsi standar) + FCL container variants
- ✅ AWB inline duplicate check (blur) — **blocking modal masih belum**
- ✅ Live thousand separator IDR input
- ✅ Order Departure Schedule (closing, ETD, ETA, plan ETA)
- ✅ Tracking History modal (read + append)
- ✅ Invoice header revamp (HTML & Excel)
- ✅ HR Master Karyawan form
- ✅ PKS Word document generator (`/app/docs/generate_pks.py`)
- ✅ Import Invoice Number (multi-AWB grouping + cap errors 50)
- ✅ Payments module: kolom Invoice No + retain Paid AWBs
- ✅ **Recurring Expense Dashboard Widget (3 varian: pink H-1 / merah H / hijau executed)**
- ✅ Deep-link `?recurring=id` → auto-open modal Laksanakan Pembayaran di halaman Expense

## Pending / Backlog
### P1
- [ ] Blocking modal duplicate AWB (saat submit) — inline sudah ada, modal blocking belum
- [ ] FTL Multidrop mechanics — perlu klarifikasi arsitektur (1 parent AWB multi-destinasi atau multi-AWB group ID)

### P2
- [ ] Schedule fields khusus Air (flight no, MAWB, HAWB) dan Land (truck plate, driver)
- [ ] Refactor `server.py` monolith → modules di `/app/backend/routes/`
- [ ] Widget notifikasi juga ditampilkan di dashboard untuk H-2, H-3 (butuh konfirmasi user)

## Key files of reference
- Backend: `/app/backend/server.py` (endpoint `/api/recurring-expenses/upcoming`, `/execute-once`, `/run-due`)
- Frontend widget: `/app/frontend/src/components/RecurringNotifications.js`
- Dashboard host: `/app/frontend/src/pages/Dashboard.js`
- Expense/FixedCosts (modal target): `/app/frontend/src/pages/FixedCosts.js` (baris 169-201: deep-link handler)

## API Endpoints
- `GET /api/recurring-expenses/upcoming` — returns pending H-1/H/overdue + already-executed-today items
- `POST /api/recurring-expenses/{id}/execute-once` — manual execute, insert to `fixed_costs` + journal
- `POST /api/recurring-expenses/run-due` — cron auto-execute
- `GET /api/orders/check-awb` — duplicate check
- `POST /api/invoices/import-numbers` — bulk invoice create with grouping

## Test credentials
See `/app/memory/test_credentials.md`
