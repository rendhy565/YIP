#!/usr/bin/env python3
"""
Koreksi tanggal jurnal pengakuan revenue agar mengikuti TANGGAL ORDER (jasa),
bukan tanggal input. Menyentuh reference_type:
  - awb_revenue_recognition  (DR 2390 / CR 4101)
  - awb_revenue_reversal
Set: journal.date = order.created_at ; period_month = YYYY-MM(order.created_at)

Pakai:
  python3 fix_revenue_journal_dates.py            # DRY-RUN (hanya laporan)
  python3 fix_revenue_journal_dates.py --apply    # eksekusi update
"""
import os, sys
from datetime import timezone
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "tms_db")
APPLY = "--apply" in sys.argv

db = MongoClient(MONGO_URL)[DB_NAME]

REF_TYPES = ["awb_revenue_recognition", "awb_revenue_reversal"]

def month_totals_4101():
    pipe = [
        {"$unwind": "$lines"},
        {"$match": {"lines.account_code": "4101"}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m", "date": "$date"}},
                    "net": {"$sum": {"$subtract": ["$lines.credit", "$lines.debit"]}}}},
        {"$sort": {"_id": 1}},
    ]
    return {r["_id"]: r["net"] for r in db.journal_entries.aggregate(pipe)}

# cache order created_at
orders = {str(o["_id"]): o.get("created_at") for o in
          db.awb_orders.find({}, {"created_at": 1})}

before = month_totals_4101()

changed = 0
skipped_no_order = 0
unchanged_same_month = 0
updates = []
for j in db.journal_entries.find({"reference_type": {"$in": REF_TYPES}}):
    oid = j.get("reference_id")
    created = orders.get(oid)
    if not created:
        skipped_no_order += 1
        continue
    new_month = created.strftime("%Y-%m")
    old_month = j["date"].strftime("%Y-%m") if j.get("date") else None
    if old_month == new_month:
        unchanged_same_month += 1
        continue
    changed += 1
    updates.append((j["_id"], created, new_month, old_month))

print(f"Total jurnal target       : {db.journal_entries.count_documents({'reference_type': {'$in': REF_TYPES}})}")
print(f"Akan dipindah bulannya     : {changed}")
print(f"Sudah benar (tak berubah)  : {unchanged_same_month}")
print(f"Order tak ditemukan (skip) : {skipped_no_order}")

if APPLY and updates:
    for _id, created, new_month, _ in updates:
        db.journal_entries.update_one({"_id": _id},
            {"$set": {"date": created, "period_month": new_month}})
    print(f"\n✅ APPLIED: {len(updates)} jurnal di-update.")
elif not APPLY:
    print("\n(DRY-RUN — belum ada yang diubah. Tambahkan --apply untuk eksekusi.)")

after = month_totals_4101()
print("\n=== Net Revenue (4101) per bulan — SEBELUM vs SESUDAH ===")
months = sorted(set(before) | set(after))
for m in months:
    b = before.get(m, 0); a = after.get(m, 0)
    flag = "  <-- berubah" if round(b) != round(a) else ""
    print(f"  {m}: {b:>18,.0f}  ->  {a:>18,.0f}{flag}")
