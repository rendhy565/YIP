"""
Migrasi retroaktif akuntansi Panjar:
1) Semua jurnal panjar (cash_advance / cash_advance_settle): akun 1108 Panjar Kerja -> 1104 Biaya Dibayar di Muka (BDD).
   => Panjar Open tampil sebagai BDD di Neraca.
2) Porsi beban default (5102) saat settle direklas per role penerima:
   - Penerima cocok ke user role 'operation' -> tetap 5102 (Beban Operasional Pengiriman)
   - Selain itu -> 6201 (Beban Rumah Tangga)
   (Baris kategori eksplisit 62xx lain TIDAK diubah.)

Idempoten: aman dijalankan ulang.
"""
import os, re
from pymongo import MongoClient
from bson import ObjectId

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
db = MongoClient(MONGO_URL)[DB_NAME]

# Meta akun target dari COA
coa = {a["code"]: a for a in db.chart_of_accounts.find({"code": {"$in": ["1104", "1108", "5102", "6201"]}})}
BDD = coa["1104"]; RT = coa["6201"]

_role_cache = {}

def recipient_is_operation(ca):
    if not ca:
        return False
    key = (str(ca.get("recipient_id") or ""), (ca.get("recipient_name") or "").strip().lower())
    if key in _role_cache:
        return _role_cache[key]
    role = None
    rid = ca.get("recipient_id")
    if rid:
        try:
            u = db.users.find_one({"_id": ObjectId(rid)})
            if u:
                role = u.get("role")
        except Exception:
            role = None
    if role is None:
        name = (ca.get("recipient_name") or "").strip()
        if name:
            u = db.users.find_one({"$or": [
                {"full_name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
                {"username": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
            ]})
            if u:
                role = u.get("role")
    res = (role == "operation")
    _role_cache[key] = res
    return res

def ca_of(ref_id):
    if not ref_id:
        return None
    try:
        return db.cash_advances.find_one({"_id": ObjectId(ref_id)})
    except Exception:
        return None

stats = {"create_1108_to_1104": 0, "settle_1108_to_1104": 0, "settle_5102_to_6201": 0, "entries_touched": 0}

cur = db.journal_entries.find({"reference_type": {"$in": ["cash_advance", "cash_advance_settle"]}})
for je in cur:
    changed = False
    is_settle = je.get("reference_type") == "cash_advance_settle"
    ca = ca_of(je.get("reference_id")) if is_settle else None
    to_rt = is_settle and (not recipient_is_operation(ca))  # non-operation -> 5102 jadi 6201
    for ln in je.get("lines", []):
        code = ln.get("account_code")
        if code == "1108":
            ln["account_code"] = "1104"
            ln["account_name"] = BDD["name"]
            ln["account_type"] = BDD["type"]
            changed = True
            stats["settle_1108_to_1104" if is_settle else "create_1108_to_1104"] += 1
        elif code == "5102" and to_rt:
            ln["account_code"] = "6201"
            ln["account_name"] = RT["name"]
            ln["account_type"] = RT["type"]
            changed = True
            stats["settle_5102_to_6201"] += 1
    if changed:
        db.journal_entries.update_one({"_id": je["_id"]}, {"$set": {"lines": je["lines"]}})
        stats["entries_touched"] += 1

print("Migration done:", stats)

# Verifikasi saldo akun terdampak
def bal(code):
    r = list(db.journal_entries.aggregate([
        {"$unwind": "$lines"}, {"$match": {"lines.account_code": code}},
        {"$group": {"_id": None, "d": {"$sum": "$lines.debit"}, "c": {"$sum": "$lines.credit"}}},
    ]))
    if not r:
        return 0
    return r[0]["d"] - r[0]["c"]

for c in ["1108", "1104", "5102", "6201"]:
    print(f"  Saldo {c} (DR-CR) = {bal(c):,.0f}")
