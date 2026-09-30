# Test Credentials — ARC (TMS)

App: ARC / TMS (FastAPI + React + MongoDB `arc_db`)
Login via username (bukan email).

| Role          | Username   | Password     |
|---------------|------------|--------------|
| Administrator | admin      | admin123     |
| Operation     | operation  | operation123 |
| Finance       | finance    | finance123   |

Catatan:
- Data di preview di-restore dari backup `luxoptic-shared-Kacrut-Digital-2026-09-30.gz` (koleksi `arc_db`).
- Password admin di-sync ke `admin123` oleh seed saat startup (idempoten).
- Data asli produksi juga punya user lain dari backup; kredensial di atas adalah akun seed default yang selalu tersedia.
