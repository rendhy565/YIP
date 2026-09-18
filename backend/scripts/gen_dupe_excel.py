import os, re
from datetime import timezone
from pymongo import MongoClient
from dotenv import load_dotenv
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from collections import defaultdict

load_dotenv()
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

def norm(a):
    a = (a or "").strip()
    return re.sub(r"^0+", "", a) or a

def m(o):
    ca = o.get("created_at")
    return ca.strftime("%Y-%m-%d") if ca else "?"

def cust_name(o):
    c = db.customers.find_one({"_id": o.get("customer_id")}) if o.get("customer_id") else None
    return (c or {}).get("name", "")

wb = Workbook()
HDR = Font(bold=True, color="FFFFFF")
HFILL = PatternFill("solid", fgColor="1F2937")
RED = PatternFill("solid", fgColor="FDE2E1")
YEL = PatternFill("solid", fgColor="FEF3C7")
GRN = PatternFill("solid", fgColor="DCFCE7")

def style_header(ws, ncol):
    for c in range(1, ncol + 1):
        cell = ws.cell(1, c)
        cell.font = HDR; cell.fill = HFILL; cell.alignment = Alignment(horizontal="center")

# ---------- Sheet 1: Leading-zero duplicates (high confidence) ----------
ws1 = wb.active; ws1.title = "Duplikat Nol-Depan (Pasti)"
cols1 = ["Grup", "AWB Asli (SIMPAN)", "AWB Duplikat (HAPUS)", "Tarif", "Consignee", "Tujuan", "Status Duplikat", "Tgl Dibuat Duplikat", "Customer"]
ws1.append(cols1); style_header(ws1, len(cols1))

groups = defaultdict(list)
for o in db.awb_orders.find({}):
    groups[norm(o.get("awb_number"))].append(o)
lz = {k: v for k, v in groups.items() if len(v) > 1}
g = 0; tot1 = 0
for k, v in sorted(lz.items()):
    v2 = sorted(v, key=lambda o: ((o.get("awb_number") or "").startswith("0"), o.get("status") != "Invoiced"))
    keep = v2[0]
    g += 1
    for e in v2[1:]:
        tot1 += float(e.get("total_tariff") or 0)
        row = [g, keep.get("awb_number"), e.get("awb_number"), float(e.get("total_tariff") or 0),
               keep.get("consignee") or "", keep.get("destination") or "", e.get("status"), m(e), cust_name(keep)]
        ws1.append(row)
        for c in range(1, len(cols1) + 1):
            ws1.cell(ws1.max_row, c).fill = RED
ws1.append([]); ws1.append(["", "", "TOTAL TARIF DUPLIKAT", tot1])
ws1.cell(ws1.max_row, 3).font = Font(bold=True); ws1.cell(ws1.max_row, 4).font = Font(bold=True)
widths1 = [6, 20, 22, 16, 30, 24, 14, 18, 28]
for i, w in enumerate(widths1, 1): ws1.column_dimensions[chr(64 + i)].width = w
ws1.cell(1, 4).number_format = "#,##0"
for r in range(2, ws1.max_row + 1): ws1.cell(r, 4).number_format = "#,##0"

# ---------- Sheet 2: Content-signature duplicates (needs review) ----------
ws2 = wb.create_sheet("Duplikat Isi Sama (Cek)")
cols2 = ["Grup", "Jml", "No. AWB", "Tarif", "Consignee", "Tujuan", "Status", "Tgl Dibuat", "Bulan", "Customer"]
ws2.append(cols2); style_header(ws2, len(cols2))
sig = defaultdict(list)
for o in db.awb_orders.find({}):
    key = (str(o.get("customer_id")), (o.get("consignee") or "").strip().lower(),
           (o.get("destination") or "").strip().lower(), round(float(o.get("total_tariff") or 0), 2))
    sig[key].append(o)
dup_groups = [v for v in sig.values() if len(v) > 1]
dup_groups.sort(key=lambda v: -float(v[0].get("total_tariff") or 0))
gid = 0; tot2 = 0
for v in dup_groups:
    gid += 1
    v = sorted(v, key=lambda o: (o.get("created_at") or 0))
    for i, o in enumerate(v):
        ca = o.get("created_at")
        row = [gid, len(v), o.get("awb_number"), float(o.get("total_tariff") or 0),
               o.get("consignee") or "", o.get("destination") or "", o.get("status"),
               m(o), (ca.strftime("%Y-%m") if ca else "?"), cust_name(o)]
        ws2.append(row)
        fill = GRN if i == 0 else YEL  # first = keep candidate, rest = potential dup
        for c in range(1, len(cols2) + 1):
            ws2.cell(ws2.max_row, c).fill = fill
        if i > 0:
            tot2 += float(o.get("total_tariff") or 0)
ws2.append([]); ws2.append(["", "", "", tot2, "TOTAL tarif kandidat duplikat (baris kuning)"])
widths2 = [6, 6, 16, 16, 30, 24, 12, 14, 10, 28]
for i, w in enumerate(widths2, 1): ws2.column_dimensions[chr(64 + i)].width = w
for r in range(2, ws2.max_row + 1): ws2.cell(r, 4).number_format = "#,##0"

# ---------- Sheet 3: Duplicate journals (accounting) ----------
ws3 = wb.create_sheet("Jurnal Ganda (Akunting)")
cols3 = ["Jenis Jurnal", "No. AWB", "Tarif Sekarang", "Nilai Jurnal", "Tanggal Jurnal", "Period", "Keterangan"]
ws3.append(cols3); style_header(ws3, len(cols3))
from bson import ObjectId
for rtype, acct, label in [("awb_revenue_recognition", "4101", "Revenue"), ("awb_order_pymhd", "1290", "PYMHD")]:
    jg = defaultdict(list)
    for j in db.journal_entries.find({"reference_type": rtype}):
        jg[j["reference_id"]].append(j)
    for rid, js in jg.items():
        if len(js) <= 1: continue
        try: o = db.awb_orders.find_one({"_id": ObjectId(rid)})
        except Exception: o = None
        awb = o.get("awb_number") if o else rid
        cur = float(o.get("total_tariff") or 0) if o else 0
        for j in sorted(js, key=lambda x: (x.get("date") or x.get("created_at"))):
            amt = sum((l.get("credit", 0) if acct == "4101" else l.get("debit", 0)) for l in j.get("lines", []) if l.get("account_code") == acct)
            dt = j.get("date").strftime("%Y-%m-%d") if j.get("date") else "?"
            note = "COCOK (simpan)" if round(amt, 2) == round(cur, 2) else "TIDAK COCOK (nilai lama?)"
            ws3.append([label, awb, cur, amt, dt, j.get("period_month"), note])
widths3 = [16, 16, 16, 16, 14, 10, 24]
for i, w in enumerate(widths3, 1): ws3.column_dimensions[chr(64 + i)].width = w
for r in range(2, ws3.max_row + 1):
    ws3.cell(r, 3).number_format = "#,##0"; ws3.cell(r, 4).number_format = "#,##0"

out = "/app/frontend/public/potensi_double_input.xlsx"
wb.save(out)
print("saved:", out)
print("Sheet1 leading-zero dup rows:", g, "total tariff:", f"{tot1:,.0f}")
print("Sheet2 content-dup groups:", gid, "extra tariff:", f"{tot2:,.0f}")
