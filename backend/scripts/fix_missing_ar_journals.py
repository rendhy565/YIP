#!/usr/bin/env python3
"""
Perbaiki jurnal AR (Piutang) yang HILANG untuk invoice hasil Import Nomor Invoice.

Latar belakang:
  Endpoint Import Nomor Invoice dulu menandai AWB jadi Invoiced/Paid + membuat
  dokumen invoice, TAPI tidak pernah memposting jurnal clearance:
      DR 1201 (Piutang, gross) / CR 1290 (PYMHD, dpp) / CR 2210 (PPN)
  Akibatnya saldo 1290 (Pendapatan Belum Ditagih) menggelembung dan 1201
  (PYMHD/Piutang Usaha) nyaris kosong.

Skrip ini (idempotent, aman diulang):
  1. Untuk tiap invoice yang belum ar_recognized & belum punya jurnal 'invoice':
     posting DR 1201 / CR 1290 (+CR 2210 bila ada PPN) sebesar total AWB-nya,
     lalu set ar_recognized=True.
  2. Untuk tiap AWB berstatus Paid yang belum punya jurnal 'payment':
     posting pembayaran DR 1101 (Kas) / CR 1201 sebesar grand_total.

Cara pakai (di dalam container backend VPS — /app = isi folder backend/):
  # 1) LIHAT dulu (dry-run, tidak mengubah apa pun):
  docker exec -w /app arc-backend-1 python /app/scripts/fix_missing_ar_journals.py

  # 2) Terapkan:
  docker exec -w /app arc-backend-1 python /app/scripts/fix_missing_ar_journals.py --apply
"""
import asyncio
import os
import re
import sys
from datetime import datetime, timezone

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

CASH_CODE = "1101"


async def next_journal_number(db):
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"JE-{yyyymm}-"
    last = await db.journal_entries.find_one(
        {"entry_no": {"$regex": f"^{prefix}"}}, sort=[("entry_no", -1)])
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["entry_no"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"


async def post_journal(db, coa, *, date, description, lines, reference_type, reference_id):
    period = date.strftime("%Y-%m")
    locked = await db.period_closings.find_one({"period": period, "is_locked": True})
    if locked:
        raise RuntimeError(f"Periode {period} terkunci")
    enriched, tdr, tcr = [], 0.0, 0.0
    for ln in lines:
        acc = coa.get(ln["account_code"])
        if not acc:
            raise RuntimeError(f"Akun {ln['account_code']} tidak ada di CoA")
        dr = round(float(ln.get("debit") or 0), 2)
        cr = round(float(ln.get("credit") or 0), 2)
        if dr == 0 and cr == 0:
            continue
        enriched.append({
            "account_code": acc["code"], "account_name": acc["name"],
            "account_type": acc["type"], "debit": dr, "credit": cr,
            "memo": ln.get("memo", ""),
        })
        tdr += dr; tcr += cr
    if round(tdr, 2) != round(tcr, 2):
        raise RuntimeError(f"Tidak balance DR {tdr} != CR {tcr}")
    await db.journal_entries.insert_one({
        "entry_no": await next_journal_number(db),
        "date": date, "period_month": period, "description": description,
        "reference_type": reference_type, "reference_id": reference_id,
        "lines": enriched, "total_debit": round(tdr, 2), "total_credit": round(tcr, 2),
        "posted_by": None, "auto": True, "is_locked": False,
        "created_at": datetime.now(timezone.utc),
    })


async def acct_net(db, code):
    dr = cr = 0.0
    async for e in db.journal_entries.find({"lines.account_code": code}):
        for ln in e.get("lines", []):
            if ln.get("account_code") == code:
                dr += float(ln.get("debit") or 0); cr += float(ln.get("credit") or 0)
    return dr - cr


async def main():
    apply = "--apply" in sys.argv
    mongo = os.environ.get("MONGO_URL"); dbname = os.environ.get("DB_NAME")
    if not mongo or not dbname:
        print("ERROR: MONGO_URL / DB_NAME tidak ditemukan di environment."); sys.exit(1)
    db = AsyncIOMotorClient(mongo)[dbname]

    coa = {a["code"]: a async for a in db.chart_of_accounts.find({})}

    before_1290 = await acct_net(db, "1290")
    before_1201 = await acct_net(db, "1201")

    ar_posted = ar_amount = 0
    ar_amount = 0.0
    pay_posted = 0
    pay_amount = 0.0

    # 1) Clearance AR untuk invoice yang belum ar_recognized
    async for inv in db.invoices.find({"ar_recognized": {"$ne": True}}):
        if await db.journal_entries.find_one({"reference_type": "invoice", "reference_id": str(inv["_id"])}):
            if apply:
                await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"ar_recognized": True}})
            continue
        awb_ids = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
        awbs = await db.awb_orders.find({"_id": {"$in": awb_ids}}).to_list(1000)
        dpp = sum(float(a.get("total_tariff") or 0) for a in awbs)
        tax = sum(float(a.get("tax_amount") or 0) for a in awbs)
        gross = round(dpp + tax, 2)
        if gross <= 0:
            continue
        inv_date = inv.get("invoice_date") or inv.get("first_printed_at") or datetime.now(timezone.utc)
        lines = [
            {"account_code": "1201", "debit": gross, "credit": 0, "memo": inv.get("invoice_number")},
            {"account_code": "1290", "debit": 0, "credit": round(dpp, 2), "memo": f"Clear PYMHD {inv.get('invoice_number')}"},
        ]
        if tax > 0:
            lines.append({"account_code": "2210", "debit": 0, "credit": round(tax, 2), "memo": f"PPN — {inv.get('invoice_number')}"})
        ar_posted += 1; ar_amount += dpp
        if apply:
            try:
                await post_journal(db, coa, date=inv_date,
                                   description=f"Piutang & PPN — Invoice {inv.get('invoice_number')} (koreksi)",
                                   lines=lines, reference_type="invoice", reference_id=str(inv["_id"]))
                await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"ar_recognized": True}})
            except Exception as ex:
                print(f"  ! gagal clearance {inv.get('invoice_number')}: {ex}")
                ar_posted -= 1; ar_amount -= dpp

    # 2) Pembayaran untuk AWB berstatus Paid yang belum punya jurnal 'payment'
    async for awb in db.awb_orders.find({"status": "Paid"}):
        if await db.journal_entries.find_one({"reference_type": "payment", "reference_id": str(awb["_id"])}):
            continue
        amount = round(float(awb.get("grand_total") or 0), 2)
        if amount <= 0:
            continue
        pay_dt = awb.get("paid_at") or datetime.now(timezone.utc)
        pay_posted += 1; pay_amount += amount
        if apply:
            try:
                await post_journal(db, coa, date=pay_dt,
                                   description=f"Pembayaran (koreksi) - AWB {awb.get('awb_number')}",
                                   lines=[
                                       {"account_code": CASH_CODE, "debit": amount, "credit": 0, "memo": awb.get("awb_number")},
                                       {"account_code": "1201", "debit": 0, "credit": amount, "memo": awb.get("awb_number")},
                                   ], reference_type="payment", reference_id=str(awb["_id"]))
            except Exception as ex:
                print(f"  ! gagal payment {awb.get('awb_number')}: {ex}")
                pay_posted -= 1; pay_amount -= amount

    after_1290 = await acct_net(db, "1290") if apply else before_1290 - ar_amount
    after_1201 = await acct_net(db, "1201") if apply else before_1201 + ar_amount - pay_amount

    print("=" * 60)
    print(f"Jurnal AR clearance {'diposting' if apply else 'AKAN diposting'} : {ar_posted}  (dpp {ar_amount:,.0f})")
    print(f"Jurnal pembayaran   {'diposting' if apply else 'AKAN diposting'} : {pay_posted}  (Rp {pay_amount:,.0f})")
    print("-" * 60)
    print(f"1290 (Pendapatan Belum Ditagih)  {before_1290:,.0f}  ->  {after_1290:,.0f}")
    print(f"1201 (PYMHD / Piutang Usaha)     {before_1201:,.0f}  ->  {after_1201:,.0f}")
    print("=" * 60)
    if not apply:
        print(">> DRY-RUN. Tidak ada yang diubah. Tambahkan --apply untuk menerapkan.")
    else:
        print(">> DITERAPKAN.")


if __name__ == "__main__":
    asyncio.run(main())
