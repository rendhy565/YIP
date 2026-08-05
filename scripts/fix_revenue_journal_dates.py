#!/usr/bin/env python3
"""
Koreksi tanggal jurnal terkait AWB agar mengikuti TANGGAL ORDER (bulan jasa),
bukan tanggal input. Ini menjaga MATCHING PRINCIPLE: revenue & COGS suatu AWB
diakui di bulan yang sama.

Menyentuh:
  - awb_revenue_recognition / awb_revenue_reversal  (DR 2390 / CR 4101)  -> ref = order._id
  - cost                                            (DR 5xxx / CR 2101)  -> ref = awb_costs._id -> awb_id
Set: journal.date = order.created_at ; period_month = YYYY-MM(order.created_at)

Pakai:
  python3 fix_revenue_journal_dates.py            # DRY-RUN (hanya laporan)
  python3 fix_revenue_journal_dates.py --apply    # eksekusi update
"""
import os, sys
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "tms_db")
APPLY = "--apply" in sys.argv

db = MongoClient(MONGO_URL)[DB_NAME]

REV_TYPES = ["awb_revenue_recognition", "awb_revenue_reversal"]

def month_totals():
    """Net per bulan untuk revenue (4101) & COGS (account_type cogs)."""
    pipe = [
        {"$unwind": "$lines"},
        {"$group": {"_id": {"m": {"$dateToString": {"format": "%Y-%m", "date": "$date"}}},
                    "rev": {"$sum": {"$cond": [{"$eq": ["$lines.account_code", "4101"]},
                                               {"$subtract": ["$lines.credit", "$lines.debit"]}, 0]}},
                    "cogs": {"$sum": {"$cond": [{"$eq": ["$lines.account_type", "cogs"]},
                                                {"$subtract": ["$lines.debit", "$lines.credit"]}, 0]}}}},
        {"$sort": {"_id.m": 1}},
    ]
    out = {}
    for r in db.journal_entries.aggregate(pipe):
        out[r["_id"]["m"]] = {"rev": r["rev"], "cogs": r["cogs"]}
    return out

# cache: order_id(str) -> created_at
orders = {str(o["_id"]): o.get("created_at") for o in db.awb_orders.find({}, {"created_at": 1})}
# cache: cost_id(str) -> awb_id(str)
costs = {str(c["_id"]): str(c.get("awb_id")) for c in db.awb_costs.find({}, {"awb_id": 1})}

def resolve_order_date(j):
    rt = j.get("reference_type")
    rid = j.get("reference_id")
    if rt in REV_TYPES:
        return orders.get(rid)
    if rt == "cost":
        awb_id = costs.get(rid)
        return orders.get(awb_id) if awb_id else None
    return None

before = month_totals()

target_q = {"reference_type": {"$in": REV_TYPES + ["cost"]}}
total = db.journal_entries.count_documents(target_q)
updates, unchanged, skipped = [], 0, 0
by_type = {"revenue": 0, "cost": 0}
for j in db.journal_entries.find(target_q):
    created = resolve_order_date(j)
    if not created:
        skipped += 1
        continue
    new_month = created.strftime("%Y-%m")
    old_month = j["date"].strftime("%Y-%m") if j.get("date") else None
    if old_month == new_month:
        unchanged += 1
        continue
    updates.append((j["_id"], created, new_month))
    by_type["cost" if j.get("reference_type") == "cost" else "revenue"] += 1

print(f"Total jurnal target        : {total}")
print(f"Akan dipindah bulannya      : {len(updates)}  (revenue: {by_type['revenue']}, cost/COGS: {by_type['cost']})")
print(f"Sudah benar (tak berubah)   : {unchanged}")
print(f"Order tak ditemukan (skip)  : {skipped}")

if APPLY and updates:
    for _id, created, new_month in updates:
        db.journal_entries.update_one({"_id": _id},
            {"$set": {"date": created, "period_month": new_month}})
    print(f"\n✅ APPLIED: {len(updates)} jurnal di-update.")
elif not APPLY:
    print("\n(DRY-RUN — belum ada yang diubah. Tambahkan --apply untuk eksekusi.)")

after = month_totals()
print("\n=== Per bulan: Revenue(4101) | COGS | Laba Kotor — SEBELUM -> SESUDAH ===")
for m in sorted(set(before) | set(after)):
    b = before.get(m, {"rev": 0, "cogs": 0}); a = after.get(m, {"rev": 0, "cogs": 0})
    bg = b["rev"] - b["cogs"]; ag = a["rev"] - a["cogs"]
    flag = "  <-- berubah" if (round(b["rev"]) != round(a["rev"]) or round(b["cogs"]) != round(a["cogs"])) else ""
    print(f"  {m}:  Rev {b['rev']:>15,.0f}->{a['rev']:>15,.0f} | COGS {b['cogs']:>14,.0f}->{a['cogs']:>14,.0f} | GP {bg:>15,.0f}->{ag:>15,.0f}{flag}")
