import openpyxl, re
from pymongo import MongoClient

wb = openpyxl.load_workbook('/tmp/report2.xlsx', data_only=True, read_only=True)
ws = wb['Sheet2']
rows = list(ws.iter_rows(values_only=True))
C_STATUS,C_AWB,C_FROM,C_DEST,C_AMOUNT,C_INV = 3,4,7,8,47,52

def core(v):
    if v is None: return None
    if isinstance(v,float): v=int(v)
    s=str(v).strip()
    if not re.match(r'^\d+$', s): return None
    return s.lstrip('0') or '0'

xl={}; dup=0; last=None
for r in rows[2:]:
    c=core(r[C_AWB]) if len(r)>C_AWB else None
    inv=(str(r[C_INV]).strip() if len(r)>C_INV and r[C_INV] and str(r[C_INV]).startswith('INV') else None)
    if inv: last=inv
    if not c: continue
    amt=r[C_AMOUNT] if len(r)>C_AMOUNT and isinstance(r[C_AMOUNT],(int,float)) else None
    if c in xl: dup+=1
    xl[c]={'core':c,'amount':amt,'inv':inv or last,'raw':str(r[C_AWB]).strip(),'frm':r[C_FROM],'dest':r[C_DEST]}

xl_total=sum(v['amount'] or 0 for v in xl.values())
print(f"Excel: {len(xl)} AWB unik (dupe {dup}), total Amount(Exc VAT) = Rp {xl_total:,.0f}")

cli=MongoClient('mongodb://localhost:27017'); db=cli['arc_db']
alldocs=list(db.awb_orders.find({},{'awb_number':1,'external_invoice_number':1,'grand_total':1,'total_tariff':1,'tax_amount':1,'_id':0}))
dbmap={}
for d in alldocs:
    c=str(d.get('awb_number') or '').strip().lstrip('0') or '0'
    dbmap.setdefault(c, d)   # first wins
print(f"DB awb_orders: {len(alldocs)} (unik by core: {len(dbmap)})")

xa=set(xl); da=set(dbmap)
only_xl=sorted(xa-da, key=lambda x:int(x))
matched=sorted(xa & da, key=lambda x:int(x))
print(f"\n[A] Excel AWB TIDAK ada di DB (setelah abaikan 0 depan): {len(only_xl)}")
for c in only_xl[:40]:
    print(f"   AWB {xl[c]['raw']} | inv {xl[c]['inv']} | amt {xl[c]['amount']} | {xl[c]['frm']}->{xl[c]['dest']}")

print(f"\n[D] Cocok di keduanya: {len(matched)}")
def dbsell(d):
    gt=float(d.get('grand_total') or 0); tax=float(d.get('tax_amount') or 0)
    return (gt-tax) if gt>0 else float(d.get('total_tariff') or 0)

mis_dpp=[]; mis_sell=[]; noamt=0
for c in matched:
    x=xl[c]; d=dbmap[c]
    if x['amount'] is None: noamt+=1; continue
    dpp=float(d.get('total_tariff') or 0)
    sell=dbsell(d)
    if abs(x['amount']-dpp)>0.5: mis_dpp.append((c,x['amount'],dpp,d))
    if abs(x['amount']-sell)>0.5: mis_sell.append((c,x['amount'],sell,d))

print(f"   Excel amount == DB total_tariff (DPP)? beda: {len(mis_dpp)} dari {len(matched)}")
print(f"   Excel amount == DB (grand_total - PPN)?   beda: {len(mis_sell)} dari {len(matched)}")

print(f"\n[E] Selisih vs DPP (total_tariff) — {len(mis_dpp)} AWB (tampil 40, urut selisih terbesar):")
for c,xg,dg,d in sorted(mis_dpp,key=lambda t:-abs(t[1]-t[2]))[:40]:
    print(f"   AWB {xl[c]['raw']}: excel {xg:,.0f} vs DPP {dg:,.0f} (selisih {xg-dg:,.0f}) | gt {d.get('grand_total'):,.0f} tax {d.get('tax_amount') or 0:,.0f} | inv {xl[c]['inv']}")

# totals
sum_x=sum(xl[c]['amount'] or 0 for c in matched)
sum_dpp=sum(float(dbmap[c].get('total_tariff') or 0) for c in matched)
sum_sell=sum(dbsell(dbmap[c]) for c in matched)
print(f"\n[TOTAL utk {len(matched)} AWB cocok]")
print(f"   Excel Amount(Exc VAT) : Rp {sum_x:,.0f}")
print(f"   DB DPP (total_tariff) : Rp {sum_dpp:,.0f}  (selisih {sum_x-sum_dpp:,.0f})")
print(f"   DB grand_total - PPN  : Rp {sum_sell:,.0f}  (selisih {sum_x-sum_sell:,.0f})")

# DB August-EMR not in excel
emr_aug=[c for c in da if '/0826/' in (dbmap[c].get('external_invoice_number') or '')]
only_db=sorted(set(emr_aug)-xa, key=lambda x:int(x))
print(f"\n[C] DB EMR invoice /0826/ tapi TIDAK ada di Excel: {len(only_db)}")
for c in only_db[:20]:
    print(f"   AWB {dbmap[c]['awb_number']} | inv {dbmap[c].get('external_invoice_number')}")
