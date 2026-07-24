# ARCWEB Integration Spec — Public Tracking API

**Purpose:** Public-facing tracking page di website AR Cargo (ARCWEB) — customer memasukkan Tracking Code lalu melihat daftar AWB beserta status.

**Repo:** https://github.com/rendhy565/ARCWEB.git
**ARC Backend:** https://jni-project-test.preview.emergentagent.com  *(preview; produksi akan disesuaikan)*

---

## 1. Endpoint

```
GET https://jni-project-test.preview.emergentagent.com/api/public/tracking/{code}
```

- **Auth:** ❌ **TIDAK PERLU** JWT. Public endpoint.
- **Rate limit:** 30 request per 60 detik per IP (in-memory sliding window). Kalau kena limit → HTTP 429.
- **Case-insensitive:** input `arc-budi-2024` = `ARC-BUDI-2024`.

## 2. Response — Sukses (HTTP 200)

```json
{
  "customer": {
    "name": "PT Budi Sejahtera",
    "company_details": "Distribusi elektronik",
    "tracking_code": "ARC-BUDI-2024"
  },
  "awb_count": 1,
  "awbs": [
    {
      "awb_number": "AWB-202607-0001",
      "created_at": "2026-07-17T18:30:01.742000",
      "pickup_date": null,
      "closing_date": null,
      "etd": null,
      "eta": null,
      "plan_eta_customer": null,
      "origin": "JKT",
      "destination": "SBY",
      "item_description": "Elektronik",
      "goods_content": "TV LED 55 inch",
      "qty_kg": 100.0,
      "koli_count": 5,
      "service": "FCL",
      "armada": "Truk Fuso",
      "grand_total": 111000.0,
      "status_label": "Order Diterima",
      "status_step": "order_received",
      "invoice_number": "INV-2026-07-0123",
      "po_number": "PO-BUDI-4567",
      "tracking_history": [
        { "date": "2026-07-17T10:00:00Z", "location": "Warehouse JKT", "note": "Barang diterima gudang", "status": "picked_up" },
        { "date": "2026-07-18T06:00:00Z", "location": "Terminal Cargo JKT", "note": "Muat kontainer", "status": "loading" }
      ],
      "notes": "Fragile, hanya bongkar pagi hari"
    }
  ],
  "generated_at": "2026-07-17T18:30:01.833268+00:00"
}
```

## 3. Field-level status mapping (`status_step`)

Value dari `status_step` untuk render progress bar / timeline di ARCWEB:

| `status_step` | Label default | Warna sugesti |
|---|---|---|
| `order_received` | Order Diterima | 🔵 Blue |
| `in_transit` | Dalam Perjalanan | 🟡 Amber |
| `delivered` | Sudah Sampai Tujuan | 🟢 Emerald |
| `invoiced` | Invoice Terbit | 🟣 Purple |
| `paid` | Lunas / Selesai | 🟢 Deep Green |

**Note:** field `status_label` sudah berisi label Indonesia siap-pakai. Kalau mau custom, gunakan `status_step` sebagai key.

## 4. Response — Error

| HTTP | Body | Arti |
|---|---|---|
| 400 | `{"detail":"Tracking code kosong"}` | Path param kosong |
| 404 | `{"detail":"Tracking code tidak ditemukan. Silakan cek kembali atau hubungi AR Cargo."}` | Kode tidak match customer manapun |
| 429 | `{"detail":"Rate limit tercapai — max 30 request per 60 detik"}` | Kena rate limit |

## 5. Contoh implementasi client (React/Next.js)

```jsx
const [data, setData] = useState(null);
const [error, setError] = useState(null);
const [loading, setLoading] = useState(false);

const track = async (code) => {
  setLoading(true); setError(null);
  try {
    const r = await fetch(
      `https://jni-project-test.preview.emergentagent.com/api/public/tracking/${encodeURIComponent(code)}`
    );
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || `HTTP ${r.status}`);
    }
    setData(await r.json());
  } catch (e) {
    setError(e.message);
  } finally { setLoading(false); }
};
```

Tampilkan progress bar dari `awb.status_step`:

```jsx
const STEPS = ["order_received", "in_transit", "delivered", "invoiced", "paid"];
const currentIdx = STEPS.indexOf(awb.status_step);
STEPS.map((s, i) => (
  <StepDot key={s} active={i <= currentIdx} label={STEP_LABEL[s]} />
))
```

## 6. Field yang sengaja TIDAK di-expose (privacy/internal)

Untuk keamanan data & privasi customer, field berikut TIDAK dikirim ke public tracking:
- Internal status flags: `reconciled`, `pod_photo_url`, `received_by`
- Cost breakdown per AWB (vendor cost, expense allocation, margin)
- Journal entries / accounting references
- Nomor kartu identitas driver / plat nomor kendaraan
- Internal contract price per kg / tariff base
- Employee assignment info
- Internal notes yang bertanda `[INTERNAL]` prefix (future feature)

## 7. Contoh test manual

```bash
# Valid code
curl https://jni-project-test.preview.emergentagent.com/api/public/tracking/ARC-BUDI-2024

# Invalid → 404
curl https://jni-project-test.preview.emergentagent.com/api/public/tracking/INVALID-CODE

# Rate limit test (kirim 31 req cepat)
for i in {1..31}; do curl -s -o /dev/null -w "%{http_code}\n" \
  https://jni-project-test.preview.emergentagent.com/api/public/tracking/ARC-BUDI-2024; done
```

## 8. CORS

Semua origin diizinkan (`*`) untuk endpoint public — sudah dikonfigurasi di FastAPI. ARCWEB bisa langsung fetch dari client-side JavaScript tanpa perlu proxy.

## 9. Tracking Code generation & rules (di ARC TMS)

- Format: `^[A-Z0-9-]{6,20}$` (uppercase, alphanumeric, dash)
- **Unique** di seluruh customer
- **Editable** oleh admin ARC (tersedia di halaman Master Customer)
- Auto-generate pattern: `ARC-{4char_nama}-{4digit_random}` (mis. `ARC-BUDI-2024`)
- Backfill otomatis untuk customer existing saat startup backend

## 10. Data yang UPDATE otomatis (real-time)

ARCWEB **selalu fetch fresh data** dari ARC. Tidak ada cache. Perubahan di ARC (mis. status berubah karena invoice dibuat, PO ditambahkan, atau tracking history di-input) akan **langsung terlihat** di ARCWEB pada request berikutnya.

## 11. Roadmap (opsional untuk ARCWEB nanti)

- [ ] QR code generator untuk share tracking link
- [ ] Push notification / email saat status berubah (perlu registrasi email di customer)
- [ ] Multi-language (EN/ID)
- [ ] Estimasi rute + map view (kalau ada koordinat)
- [ ] Rating & feedback post-delivery
