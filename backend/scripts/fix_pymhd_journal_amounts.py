#!/usr/bin/env python3
"""
Perbaiki saldo PYMHD (akun 1290) yang menggelembung.

Penyebab: jurnal PYMHD `awb_order_pymhd` (DR 1290 / CR 2390) dibuat saat order
dibuat memakai total_tariff saat itu. Bila tarif kemudian DIEDIT (mis. salah input
rate x qty lalu dikoreksi), jurnalnya dulu TIDAK ikut disesuaikan sehingga saldo
1290 jadi salah (contoh: 1 AWB bisa 40+ miliar).

Skrip ini menyamakan nominal jurnal `awb_order_pymhd` setiap order dengan
total_tariff order TERKINI (memperbaiki baris 1290 debit & 2390 credit). Idempotent.

Cara pakai (di dalam container backend VPS — /app = isi folder backend/):
  # 1) LIHAT dulu selisihnya (dry-run, tidak mengubah apa pun):
  docker exec -w /app arc-backend-1 python /app/scripts/fix_pymhd_journal_amounts.py

  # 2) Terapkan perbaikan:
  docker exec -w /app arc-backend-1 python /app/scripts/fix_pymhd_journal_amounts.py --apply
"""
import asyncio
import os
import sys

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


async def main():
    apply = "--apply" in sys.argv
    mongo = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME")
    if not mongo or not dbname:
        print("ERROR: MONGO_URL / DB_NAME tidak ditemukan di environment.")
        sys.exit(1)
    db = AsyncIOMotorClient(mongo)[dbname]

    # map order_id -> total_tariff terkini
    tariff = {}
    async for o in db.awb_orders.find({}, {"total_tariff": 1, "awb_number": 1}):
        tariff[str(o["_id"])] = (float(o.get("total_tariff") or 0), o.get("awb_number"))

    fixed, total_before, total_after, mismatches = 0, 0.0, 0.0, []
    async for j in db.journal_entries.find({"reference_type": "awb_order_pymhd"}):
        rid = str(j.get("reference_id"))
        if rid not in tariff:
            continue  # order sudah dihapus — lewati
        want, awb = tariff[rid]
        lines = j.get("lines", [])
        cur = 0.0
        for ln in lines:
            if ln.get("account_code") == "1290":
                cur += float(ln.get("debit", 0) or 0)
        total_before += cur
        if abs(cur - want) < 0.01:
            total_after += cur
            continue
        mismatches.append((awb, cur, want))
        total_after += want
        if apply:
            new_lines = []
            for ln in lines:
                code = ln.get("account_code")
                if code == "1290":
                    ln = {**ln, "debit": round(want, 2), "credit": 0}
                elif code == "2390":
                    ln = {**ln, "debit": 0, "credit": round(want, 2)}
                new_lines.append(ln)
            await db.journal_entries.update_one(
                {"_id": j["_id"]},
                {"$set": {"lines": new_lines,
                          "total_debit": round(want, 2),
                          "total_credit": round(want, 2)}},
            )
            fixed += 1

    print(f"Total 1290 (PYMHD) SEBELUM : {total_before:,.0f}")
    print(f"Total 1290 (PYMHD) SESUDAH : {total_after:,.0f}")
    print(f"Jurnal tidak sinkron       : {len(mismatches)}")
    for awb, cur, want in sorted(mismatches, key=lambda x: -abs(x[1] - x[2]))[:20]:
        print(f"  AWB {awb}: {cur:,.0f}  ->  {want:,.0f}")
    if apply:
        print(f"\n>> DITERAPKAN. {fixed} jurnal diperbaiki.")
    else:
        print("\n>> DRY-RUN. Tidak ada yang diubah. Tambahkan --apply untuk menerapkan.")


if __name__ == "__main__":
    asyncio.run(main())
