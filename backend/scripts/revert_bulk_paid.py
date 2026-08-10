#!/usr/bin/env python3
"""
Revert a wrongly-executed "Bulk Mark Paid" batch.

Setiap operasi Bulk Mark Paid menandai semua order dengan SATU nilai paid_at yang
identik. Skrip ini mengelompokkan order berstatus Paid berdasarkan paid_at, lalu
mengembalikan (revert) cluster yang salah ke status Invoiced + menghapus jurnal
penerimaan pembayarannya. Order yang sudah Paid SEBELUM bulk (paid_at berbeda /
lebih lama) TIDAK tersentuh.

Aman:
- Default DRY-RUN (hanya menampilkan, tidak mengubah apa pun).
- Order yang punya pembayaran parsial (payment_receipts / multi-bayar) otomatis
  di-SKIP agar tidak merusak data pembayaran cicilan.

Cara pakai (di dalam container backend VPS — /app = isi folder backend/):
  # 1) Lihat daftar cluster dulu (tidak mengubah apa pun):
  docker exec arc-backend-1 python /app/scripts/revert_bulk_paid.py

  # 2) Revert cluster PALING BARU (biasanya = batch yang barusan salah):
  docker exec arc-backend-1 python /app/scripts/revert_bulk_paid.py --latest --apply

  # 3) Atau revert cluster dengan paid_at tertentu (salin dari output langkah 1):
  docker exec arc-backend-1 python /app/scripts/revert_bulk_paid.py --paid-at "2026-07-16T03:33:12.345000+00:00" --apply
"""
import asyncio
import os
import sys
import argparse
from collections import defaultdict
from motor.motor_asyncio import AsyncIOMotorClient

try:
    from dotenv import load_dotenv
    load_dotenv()
    for _p in ("/app/.env", "/app/backend/.env",
               os.path.join(os.path.dirname(__file__), "..", ".env")):
        if not os.environ.get("MONGO_URL") and os.path.exists(_p):
            load_dotenv(_p)
except Exception:
    pass


def _key(pa):
    """String kunci stabil untuk paid_at (bisa datetime atau string)."""
    if pa is None:
        return "None"
    if hasattr(pa, "isoformat"):
        return pa.isoformat()
    return str(pa)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Benar-benar melakukan revert (tanpa ini = dry-run).")
    ap.add_argument("--latest", action="store_true", help="Target cluster paid_at paling baru.")
    ap.add_argument("--paid-at", dest="paid_at", default=None, help="paid_at persis yang akan di-revert (ISO string dari output dry-run).")
    args = ap.parse_args()

    mongo = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME")
    if not mongo or not dbname:
        print("ERROR: MONGO_URL / DB_NAME tidak ditemukan di environment.")
        sys.exit(1)

    db = AsyncIOMotorClient(mongo)[dbname]

    paid = await db.awb_orders.find({"status": "Paid"}).to_list(1000000)
    if not paid:
        print("Tidak ada order berstatus Paid. Tidak ada yang perlu di-revert.")
        return

    clusters = defaultdict(list)
    for o in paid:
        clusters[_key(o.get("paid_at"))].append(o)

    ordered = sorted(clusters.items(), key=lambda kv: kv[0], reverse=True)

    print(f"\n=== {len(paid)} order Paid dalam {len(ordered)} cluster paid_at ===\n")
    for k, items in ordered:
        pn = items[0].get("payment_invoice_number")
        with_receipts = 0
        for it in items:
            if await db.payment_receipts.count_documents({"awb_id": it["_id"]}) > 0:
                with_receipts += 1
        sample = ", ".join((it.get("awb_number") or "?") for it in items[:5])
        print(f"paid_at = {k}")
        print(f"    jumlah      : {len(items)}")
        print(f"    no_invoice  : {pn!r}")
        print(f"    multi-bayar : {with_receipts} (akan di-SKIP saat revert)")
        print(f"    contoh AWB  : {sample}{' ...' if len(items) > 5 else ''}\n")

    target_key = None
    if args.paid_at:
        target_key = args.paid_at
    elif args.latest:
        target_key = ordered[0][0]

    if not target_key:
        print(">> DRY-RUN. Tidak ada yang diubah.")
        print(">> Jalankan ulang dengan '--latest --apply' (cluster terbaru) atau '--paid-at \"<iso>\" --apply'.")
        return

    if target_key not in clusters:
        print(f"ERROR: paid_at '{target_key}' tidak ditemukan di daftar cluster di atas.")
        sys.exit(1)

    target = clusters[target_key]
    print(f">> TARGET revert: paid_at = {target_key} ({len(target)} order)")

    if not args.apply:
        print(">> DRY-RUN (tanpa --apply). Tidak ada yang diubah. Tambahkan --apply untuk eksekusi.")
        return

    reverted, skipped = 0, []
    for o in target:
        oid = o["_id"]
        if await db.payment_receipts.count_documents({"awb_id": oid}) > 0:
            skipped.append((o.get("awb_number"), "punya multi-bayar"))
            continue
        await db.journal_entries.delete_many({"reference_type": "payment", "reference_id": str(oid)})
        await db.awb_orders.update_one(
            {"_id": oid},
            {"$set": {"status": "Invoiced"},
             "$unset": {"paid_at": "", "paid_by": "", "payment_invoice_number": "", "cash_account_code": ""}},
        )
        reverted += 1

    print(f"\n>> SELESAI. Reverted: {reverted}, Skipped: {len(skipped)}")
    for awb, why in skipped[:20]:
        print(f"    SKIP {awb}: {why}")
    total_paid_now = await db.awb_orders.count_documents({"status": "Paid"})
    total_inv_now = await db.awb_orders.count_documents({"status": "Invoiced"})
    print(f">> Sekarang: Paid={total_paid_now}, Invoiced={total_inv_now}")


if __name__ == "__main__":
    asyncio.run(main())
