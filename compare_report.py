import openpyxl, re
from pymongo import MongoClient

wb = openpyxl.load_workbook('/tmp/report.xlsx', data_only=True, read_only=True)
ws = wb['Sheet2']
rows = list(ws.iter_rows(values_only=True))

C_STATUS, C_AWB, C_FROM, C_DEST, C_PENERIMA = 3,4,7,8,10
C_AMOUNT, C_INV = 47, 52

def norm_awb(v):
    if v is None: return None
    if isinstance(v,float): v=int(v)
    s=str(v).strip()
    return s if re.match(r'^\d+$', s) else None

xl={}; dup=0
last_inv=None
for r in rows[2:]:
    awb=norm_awb(r[C_AWB]) if len(r)>C_AWB else None
    inv=(str(r[C_INV]).strip() if len(r)>C_INV and r[C_INV] and str(r[C_INV]).startswith("INV") else None)
    if inv: last_inv=inv
    if not awb: continue
    amt=r[C_AMOUNT] if len(r)>C_AMOUNT and isinstance(r[C_AMOUNT],(int,float)) else None
    if awb in xl: dup+=1
    xl[awb]={"awb":awb,"amount":amt,"inv":inv or last_inv,"inv_own":inv,
             "status":r[C_STATUS],"frm":r[C_FROM],"dest":r[C_DEST]}

xl_total=sum(v['amount'] for v in xl.values() if v['amount'])
print(f"Excel: {len(xl)} unique AWB (dupes {dup}), total Amount(Exc VAT)={xl_total:,.0f}")
print(f"Excel distinct invoice numbers: {len(set(v['inv'] for v in xl.values() if v['inv']))}")

cli=MongoClient("mongodb://localhost:27017"); db=cli["arc_db"]
alldocs=list(db.awb_orders.find({},{"awb_number":1,"external_invoice_number":1,"grand_total":1,
    "total_tariff":1,"status":1,"origin":1,"destination":1,"_id":0}))
dbmap={str(d.get("awb_number")):d for d in alldocs}
print(f"DB awb_orders total: {len(alldocs)}")

xl_awbs=set(xl); db_awbs=set(dbmap)
only_xl=sorted(xl_awbs-db_awbs, key=int)
matched=sorted(xl_awbs & db_awbs, key=int)
print(f"\n[A] Excel AWB NOT found in DB: {len(only_xl)}")
print(f"[D] Excel AWB matched in DB: {len(matched)}")

# distribution of DB invoice period for matched
from collections import Counter
per=Counter()
for a in matched:
    inv=dbmap[a].get("external_invoice_number") or ""
    m=re.search(r'/(\d{4})/',inv)
    per[m.group(1) if m else ("NO_INV" if not inv else "OTHER")]+=1
print("   Matched AWB by DB invoice period code:", dict(per))

# amount mismatches on matched
amt_mis=[]; inv_mis=[]
for a in matched:
    x=xl[a]; d=dbmap[a]
    dg=d.get("grand_total"); dg=dg if dg is not None else d.get("total_tariff")
    if x['amount'] is not None and dg is not None and abs(x['amount']-dg)>0.5:
        amt_mis.append((a,x['amount'],dg,x['inv'],d.get("external_invoice_number")))
    if x['inv'] and d.get("external_invoice_number") and x['inv']!=d.get("external_invoice_number"):
        inv_mis.append((a,x['inv'],d.get("external_invoice_number")))

print(f"\n[E] AMOUNT mismatches (matched AWB): {len(amt_mis)}")
tot_x=tot_d=0
for a,xg,dg,xi,di in amt_mis:
    tot_x+=xg or 0; tot_d+=dg or 0
for a,xg,dg,xi,di in amt_mis[:40]:
    print(f"   AWB {a}: excel {xg:,.0f} vs DB {dg:,.0f} (diff {(xg-dg):,.0f}) | xl_inv {xi} db_inv {di}")
if amt_mis: print(f"   ...sum excel {tot_x:,.0f} vs DB {tot_d:,.0f} on mismatched rows")

print(f"\n[F] INVOICE-number mismatches (matched AWB): {len(inv_mis)}")
for a,xi,di in inv_mis[:40]:
    print(f"   AWB {a}: excel {xi} vs DB {di}")

print(f"\n[A-detail] first 25 Excel AWB missing in DB:")
for a in only_xl[:25]:
    print(f"   AWB {a} | inv {xl[a]['inv']} | amt {xl[a]['amount']} | {xl[a]['frm']}->{xl[a]['dest']}")
