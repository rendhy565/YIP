from dotenv import load_dotenv
load_dotenv()

import os
import re
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = os.environ.get("JWT_ALG", "HS256")
JWT_EXP_MIN = int(os.environ.get("JWT_EXP_MIN", "720"))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXP_MIN),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except Exception:
        raise HTTPException(status_code=400, detail="ID tidak valid")

def serialize(doc: dict) -> dict:
    if doc is None:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for k, v in list(doc.items()):
        if isinstance(v, ObjectId):
            doc[k] = str(v)
        elif isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc

async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token kedaluwarsa")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"_id": _oid(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    user = serialize(user)
    user.pop("password_hash", None)
    return user

def require_role(*roles: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        # Administrator selalu diizinkan untuk semua route role
        if user.get("role") == "administrator":
            return user
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Akses ditolak untuk role ini")
        return user
    return dep

# Master katalog modul + default permissions per role
MODULES = [
    {"key": "orders_input", "label": "Input Order", "default_roles": ["operation"]},
    {"key": "orders_list", "label": "Daftar AWB", "default_roles": ["operation", "finance"]},
    {"key": "recap", "label": "Rekap & Rekonsiliasi", "default_roles": ["operation"]},
    {"key": "invoices", "label": "Invoice", "default_roles": ["operation", "finance"]},
    {"key": "payments", "label": "Pembayaran", "default_roles": ["finance"]},
    {"key": "costs", "label": "Plotting Biaya", "default_roles": ["operation", "finance"]},
    {"key": "accrue", "label": "Settle Hutang Vendor", "default_roles": ["finance"]},
    {"key": "fixed_costs", "label": "Biaya Tetap (Overhead)", "default_roles": ["finance"]},
    {"key": "customers", "label": "Master Customer", "default_roles": ["operation", "finance"]},
    {"key": "contracts", "label": "Master Kontrak", "default_roles": ["operation", "finance"]},
    {"key": "pnl", "label": "Laporan Laba Rugi", "default_roles": ["operation", "finance"]},
    {"key": "settings", "label": "Pengaturan", "default_roles": ["operation", "finance"]},
    {"key": "user_management", "label": "User Management", "default_roles": []},
]
MODULE_KEYS = [m["key"] for m in MODULES]

def default_permissions(role: str) -> List[str]:
    if role == "administrator":
        return list(MODULE_KEYS)
    return [m["key"] for m in MODULES if role in m["default_roles"]]

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str
    password: str

class UserOut(BaseModel):
    id: str
    username: str
    role: str
    full_name: Optional[str] = None
    permissions: List[str] = []
    active: bool = True

class UserCreateIn(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    role: str  # administrator | operation | finance
    permissions: Optional[List[str]] = None  # if None → use default_permissions(role)

class UserUpdateIn(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    active: Optional[bool] = None

class PasswordResetIn(BaseModel):
    password: str

class CustomerIn(BaseModel):
    name: str
    company_details: Optional[str] = None
    address: Optional[str] = None
    npwp: Optional[str] = None

class ContractIn(BaseModel):
    customer_id: str
    origin: str
    destination: str
    price_per_kg: float

class OrderIn(BaseModel):
    customer_id: str
    contract_id: Optional[str] = None
    item_description: str
    goods_content: str
    origin: str
    destination: str
    tariff_per_kg: float
    qty_kg: float
    tax_percentage: float

class CostIn(BaseModel):
    awb_id: str
    cost_category: Literal["Operational", "Lintas", "Vendor"]
    amount: float
    description: Optional[str] = None
    vendor_name: Optional[str] = None
    cash_account_code: Optional[str] = None  # for Cash payments (Operational/Lintas) — defaults to 1101

class SettleIn(BaseModel):
    cash_account_code: Optional[str] = None  # which cash account paid the vendor; default 1101

class SettingIn(BaseModel):
    key_name: str
    key_value: str

class PaymentMarkIn(BaseModel):
    awb_id: str

class FixedCostIn(BaseModel):
    category: str  # Gaji, Sewa, Utilities, Marketing, Lainnya
    description: Optional[str] = None
    amount: float
    period_month: str  # format YYYY-MM
    cash_account_code: Optional[str] = None  # default 1101

class MarkPaidIn(BaseModel):
    cash_account_code: Optional[str] = None  # which cash account received payment; default 1101

# ---------------------------------------------------------------------------
# AWB number generator
# ---------------------------------------------------------------------------
async def next_awb_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"AWB-{yyyymm}-"
    last = await db.awb_orders.find_one(
        {"awb_number": {"$regex": f"^{prefix}"}},
        sort=[("awb_number", -1)],
    )
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["awb_number"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

async def next_invoice_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"INV-{yyyymm}-"
    last = await db.invoices.find_one(
        {"invoice_number": {"$regex": f"^{prefix}"}},
        sort=[("invoice_number", -1)],
    )
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["invoice_number"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

async def next_journal_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"JE-{yyyymm}-"
    last = await db.journal_entries.find_one(
        {"entry_no": {"$regex": f"^{prefix}"}},
        sort=[("entry_no", -1)],
    )
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["entry_no"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

# ---------------------------------------------------------------------------
# ACCOUNTING (PSAK) — Chart of Accounts, Journal Engine, Reports
# ---------------------------------------------------------------------------
# Chart of Accounts (Bagan Akun Standar)
DEFAULT_COA = [
    # 1xxx - ASET
    {"code": "1101", "name": "Kas", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_cash": True, "is_system": True},
    {"code": "1102", "name": "Bank BCA", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_cash": True, "is_system": True},
    {"code": "1103", "name": "Bank Mandiri", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_cash": True, "is_system": True},
    {"code": "1201", "name": "Piutang Usaha", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_system": True},
    {"code": "1301", "name": "Persediaan", "type": "asset", "subtype": "current_asset", "normal": "debit"},
    {"code": "1501", "name": "Peralatan & Kendaraan", "type": "asset", "subtype": "fixed_asset", "normal": "debit"},
    {"code": "1502", "name": "Akumulasi Penyusutan", "type": "asset", "subtype": "fixed_asset", "normal": "credit"},
    # 2xxx - LIABILITAS
    {"code": "2101", "name": "Hutang Usaha", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "2210", "name": "PPN Keluaran", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "2220", "name": "Hutang PPh", "type": "liability", "subtype": "current_liability", "normal": "credit"},
    # 3xxx - EKUITAS
    {"code": "3101", "name": "Modal Disetor", "type": "equity", "subtype": "equity", "normal": "credit", "is_system": True},
    {"code": "3201", "name": "Laba Ditahan", "type": "equity", "subtype": "equity", "normal": "credit", "is_system": True},
    # 4xxx - PENDAPATAN
    {"code": "4101", "name": "Pendapatan Jasa Pengangkutan", "type": "revenue", "subtype": "revenue", "normal": "credit", "is_system": True},
    # 5xxx - HPP (COGS)
    {"code": "5101", "name": "Beban Vendor Logistik", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5102", "name": "Beban Operasional Pengiriman", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5103", "name": "Beban Lintas", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    # 6xxx - BEBAN OPERASIONAL / FIXED COST
    {"code": "6101", "name": "Beban Gaji", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
    {"code": "6102", "name": "Beban Sewa", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
    {"code": "6103", "name": "Beban Utilities", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
    {"code": "6104", "name": "Beban Marketing", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
    {"code": "6105", "name": "Beban Administrasi", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
    {"code": "6199", "name": "Beban Lainnya", "type": "expense", "subtype": "operating_expense", "normal": "debit", "is_system": True},
]
FIXED_COST_TO_COA = {
    "Gaji": "6101", "Sewa": "6102", "Utilities": "6103",
    "Marketing": "6104", "Administrasi": "6105", "Lainnya": "6199",
}
COST_CATEGORY_TO_COA = {"Vendor": "5101", "Operational": "5102", "Lintas": "5103"}

async def get_account(code: str) -> Optional[dict]:
    return await db.chart_of_accounts.find_one({"code": code})

async def is_period_locked(period_month: str) -> bool:
    return bool(await db.period_closings.find_one({"period": period_month}))

async def post_journal(
    *,
    date: datetime,
    description: str,
    lines: List[dict],
    reference_type: str,
    reference_id: Optional[str] = None,
    posted_by: Optional[str] = None,
    auto: bool = True,
) -> dict:
    """Post a balanced journal entry. lines = [{account_code, debit, credit, memo?}, ...]"""
    period = date.strftime("%Y-%m")
    if await is_period_locked(period):
        raise HTTPException(400, f"Periode {period} sudah ditutup, jurnal tidak dapat diposting")
    # Validate accounts + enrich with name
    enriched = []
    total_dr = 0.0
    total_cr = 0.0
    for ln in lines:
        acc = await get_account(ln["account_code"])
        if not acc:
            raise HTTPException(400, f"Akun {ln['account_code']} tidak ditemukan di CoA")
        dr = float(ln.get("debit") or 0)
        cr = float(ln.get("credit") or 0)
        if dr < 0 or cr < 0:
            raise HTTPException(400, "Nilai debit/kredit tidak boleh negatif")
        if dr > 0 and cr > 0:
            raise HTTPException(400, f"Baris {acc['code']} tidak boleh mengisi debit & kredit sekaligus")
        if dr == 0 and cr == 0:
            continue
        enriched.append({
            "account_code": acc["code"],
            "account_name": acc["name"],
            "account_type": acc["type"],
            "debit": round(dr, 2),
            "credit": round(cr, 2),
            "memo": ln.get("memo", ""),
        })
        total_dr += dr
        total_cr += cr
    if not enriched:
        raise HTTPException(400, "Jurnal harus memiliki minimal 1 baris berisi nilai")
    if round(total_dr, 2) != round(total_cr, 2):
        raise HTTPException(400, f"Jurnal tidak balance: DR {total_dr:.2f} != CR {total_cr:.2f}")
    doc = {
        "entry_no": await next_journal_number(),
        "date": date,
        "period_month": period,
        "description": description,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "lines": enriched,
        "total_debit": round(total_dr, 2),
        "total_credit": round(total_cr, 2),
        "posted_by": posted_by,
        "auto": auto,
        "is_locked": False,
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.journal_entries.insert_one(doc)
    new = await db.journal_entries.find_one({"_id": r.inserted_id})
    return serialize(new)

async def journal_exists_for(reference_type: str, reference_id: str) -> bool:
    return bool(await db.journal_entries.find_one({"reference_type": reference_type, "reference_id": reference_id}))

# ---------------------------------------------------------------------------
# Lifespan / Seeding
# ---------------------------------------------------------------------------
async def seed_data():
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.awb_orders.create_index("awb_number", unique=True)
    await db.invoices.create_index("invoice_number", unique=True)
    await db.settings.create_index("key_name", unique=True)
    await db.fixed_costs.create_index("period_month")
    await db.chart_of_accounts.create_index("code", unique=True)
    await db.journal_entries.create_index("entry_no", unique=True)
    await db.journal_entries.create_index("period_month")
    await db.journal_entries.create_index("date")
    await db.period_closings.create_index("period", unique=True)

    # Seed Chart of Accounts
    for a in DEFAULT_COA:
        await db.chart_of_accounts.update_one(
            {"code": a["code"]},
            {"$setOnInsert": {**a, "active": True, "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )

    # Users
    seeds = [
        {
            "username": os.environ.get("SEED_ADMIN_USERNAME", "admin"),
            "password": os.environ.get("SEED_ADMIN_PASSWORD", "admin123"),
            "role": "administrator",
            "full_name": "Administrator",
        },
        {
            "username": os.environ.get("SEED_OPERATION_USERNAME", "operation"),
            "password": os.environ.get("SEED_OPERATION_PASSWORD", "operation123"),
            "role": "operation",
            "full_name": "Operasional User",
        },
        {
            "username": os.environ.get("SEED_FINANCE_USERNAME", "finance"),
            "password": os.environ.get("SEED_FINANCE_PASSWORD", "finance123"),
            "role": "finance",
            "full_name": "Finance User",
        },
    ]
    for s in seeds:
        existing = await db.users.find_one({"username": s["username"]})
        doc = {
            "username": s["username"],
            "password_hash": hash_password(s["password"]),
            "role": s["role"],
            "full_name": s["full_name"],
            "permissions": default_permissions(s["role"]),
            "active": True,
            "created_at": datetime.now(timezone.utc),
        }
        if not existing:
            await db.users.insert_one(doc)
        else:
            # keep password & role in sync with .env; ensure permissions field exists
            updates = {"role": s["role"]}
            if not verify_password(s["password"], existing.get("password_hash", "")):
                updates["password_hash"] = doc["password_hash"]
            if "permissions" not in existing or not existing.get("permissions"):
                updates["permissions"] = doc["permissions"]
            if "active" not in existing:
                updates["active"] = True
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": updates},
            )

    # Tax settings
    for key, val in [("tax_ppn_0", "0"), ("tax_ppn_11", "11"), ("tax_ppn_12", "12")]:
        await db.settings.update_one(
            {"key_name": key},
            {"$setOnInsert": {"key_name": key, "key_value": val}},
            upsert=True,
        )
    await db.settings.update_one(
        {"key_name": "company_name"},
        {"$setOnInsert": {"key_name": "company_name", "key_value": "PT. Logistik Nusantara"}},
        upsert=True,
    )
    await db.settings.update_one(
        {"key_name": "company_npwp"},
        {"$setOnInsert": {"key_name": "company_npwp", "key_value": "01.234.567.8-901.000"}},
        upsert=True,
    )
    await db.settings.update_one(
        {"key_name": "company_address"},
        {"$setOnInsert": {"key_name": "company_address", "key_value": "Jl. Soekarno Hatta No. 1, Jakarta"}},
        upsert=True,
    )

    # Sample customers + contracts (skip if user has disabled dummy seeding)
    skip_dummy = await db.settings.find_one({"key_name": "skip_dummy_seed"})
    if skip_dummy:
        return  # do not seed any sample/dummy data

    if await db.customers.count_documents({}) == 0:
        cust_ids = []
        for c in [
            {"name": "PT. Sinar Mandiri", "company_details": "Importir Elektronik", "address": "Jakarta Barat", "npwp": "02.111.222.3-456.000"},
            {"name": "PT. Cahaya Logistik", "company_details": "Distributor Farmasi", "address": "Surabaya", "npwp": "02.333.444.5-678.000"},
            {"name": "CV. Mitra Sejahtera", "company_details": "Retail Garmen", "address": "Bandung", "npwp": "02.555.666.7-890.000"},
        ]:
            c["created_at"] = datetime.now(timezone.utc)
            r = await db.customers.insert_one(c)
            cust_ids.append(r.inserted_id)

        contracts = [
            {"customer_id": cust_ids[0], "origin": "CGK", "destination": "DPS", "price_per_kg": 18500},
            {"customer_id": cust_ids[0], "origin": "CGK", "destination": "UPG", "price_per_kg": 22000},
            {"customer_id": cust_ids[1], "origin": "SUB", "destination": "BPN", "price_per_kg": 25000},
            {"customer_id": cust_ids[2], "origin": "BDO", "destination": "MES", "price_per_kg": 30000},
        ]
        for ct in contracts:
            ct["created_at"] = datetime.now(timezone.utc)
            await db.contracts.insert_one(ct)

    # Sample AWB orders (1 of each status for demo)
    if await db.awb_orders.count_documents({}) == 0:
        any_customer = await db.customers.find_one({})
        if any_customer:
            for i, status_v in enumerate(["Open", "Open", "Reconciled", "Invoiced", "Paid"]):
                qty = 100 + i * 25
                tariff = 20000
                total = qty * tariff
                tax_pct = 11.0
                tax_amt = total * tax_pct / 100
                awb = {
                    "awb_number": await next_awb_number(),
                    "customer_id": any_customer["_id"],
                    "contract_id": None,
                    "item_description": f"Sample Order #{i+1}",
                    "goods_content": "General Cargo",
                    "origin": "CGK",
                    "destination": "DPS",
                    "tariff_per_kg": tariff,
                    "qty_kg": qty,
                    "total_tariff": total,
                    "tax_percentage": tax_pct,
                    "tax_amount": tax_amt,
                    "grand_total": total + tax_amt,
                    "status": status_v,
                    "created_at": datetime.now(timezone.utc),
                }
                r = await db.awb_orders.insert_one(awb)
                # Sample costs
                await db.awb_costs.insert_one({
                    "awb_id": r.inserted_id, "cost_category": "Vendor",
                    "payment_type": "Accrue", "amount": 500000, "description": "Trucking",
                    "vendor_name": "PT. Truk Cepat", "is_settled": False,
                    "created_by_role": "operation", "created_at": datetime.now(timezone.utc),
                })
                await db.awb_costs.insert_one({
                    "awb_id": r.inserted_id, "cost_category": "Operational",
                    "payment_type": "Cash", "amount": 250000, "description": "Handling fee",
                    "vendor_name": None, "is_settled": True,
                    "created_by_role": "finance", "created_at": datetime.now(timezone.utc),
                })
                if status_v in ("Invoiced", "Paid"):
                    await db.invoices.insert_one({
                        "awb_id": r.inserted_id,
                        "invoice_number": await next_invoice_number(),
                        "created_at": datetime.now(timezone.utc),
                    })

    # Sample fixed costs (current month)
    if await db.fixed_costs.count_documents({}) == 0:
        cur_month = datetime.now(timezone.utc).strftime("%Y-%m")
        for f in [
            {"category": "Gaji", "description": "Gaji bulanan tim operasional & finance", "amount": 25000000},
            {"category": "Sewa", "description": "Sewa kantor & gudang", "amount": 8000000},
            {"category": "Utilities", "description": "Listrik, air, internet", "amount": 1500000},
            {"category": "Marketing", "description": "Iklan & promosi B2B", "amount": 2500000},
        ]:
            f["period_month"] = cur_month
            f["cash_account_code"] = "1101"
            f["created_at"] = datetime.now(timezone.utc)
            await db.fixed_costs.insert_one(f)

    # Sample opening balance journal (idempotent: only if no journal entries exist at all)
    if await db.journal_entries.count_documents({}) == 0:
        first_admin = await db.users.find_one({"role": "administrator"})
        admin_id = str(first_admin["_id"]) if first_admin else None
        opening_date = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        try:
            await post_journal(
                date=opening_date,
                description="Saldo Awal — modal disetor (seed)",
                lines=[
                    {"account_code": "1101", "debit": 50000000, "credit": 0, "memo": "Saldo awal Kas"},
                    {"account_code": "1102", "debit": 100000000, "credit": 0, "memo": "Saldo awal Bank BCA"},
                    {"account_code": "1103", "debit": 50000000, "credit": 0, "memo": "Saldo awal Bank Mandiri"},
                    {"account_code": "3101", "debit": 0, "credit": 200000000, "memo": "Modal disetor"},
                ],
                reference_type="opening_balance",
                reference_id=None,
                posted_by=admin_id,
            )
        except HTTPException:
            pass

    # Retroactive journal backfill for existing transactions
    await backfill_journals()

async def backfill_journals():
    """Generate journal entries for existing AWB orders, costs, and fixed costs that
    do not yet have one. Idempotent — safe to run on every startup."""
    # AWB orders → DR Piutang / CR Pendapatan + PPN
    awbs = await db.awb_orders.find().to_list(5000)
    for o in awbs:
        if await journal_exists_for("awb_order", str(o["_id"])):
            continue
        try:
            lines = [
                {"account_code": "1201", "debit": o.get("grand_total", 0), "credit": 0, "memo": o["awb_number"]},
                {"account_code": "4101", "debit": 0, "credit": o.get("total_tariff", 0), "memo": o["awb_number"]},
            ]
            if o.get("tax_amount", 0) > 0:
                lines.append({"account_code": "2210", "debit": 0, "credit": o["tax_amount"], "memo": "PPN"})
            await post_journal(
                date=o.get("created_at", datetime.now(timezone.utc)),
                description=f"[Backfill] Penjualan {o['awb_number']}",
                lines=lines, reference_type="awb_order", reference_id=str(o["_id"]), auto=True,
            )
        except HTTPException:
            continue
        # If status==Paid, also post the payment journal
        if o.get("status") == "Paid" and not await journal_exists_for("payment", str(o["_id"])):
            try:
                await post_journal(
                    date=o.get("paid_at") or o.get("created_at"),
                    description=f"[Backfill] Pelunasan {o['awb_number']}",
                    lines=[
                        {"account_code": o.get("cash_account_code", "1101"), "debit": o["grand_total"], "credit": 0},
                        {"account_code": "1201", "debit": 0, "credit": o["grand_total"]},
                    ],
                    reference_type="payment", reference_id=str(o["_id"]), auto=True,
                )
            except HTTPException:
                pass

    # AWB Costs → DR Beban / CR Hutang or Kas
    costs = await db.awb_costs.find().to_list(5000)
    for c in costs:
        if await journal_exists_for("cost", str(c["_id"])):
            continue
        try:
            awb = await db.awb_orders.find_one({"_id": c["awb_id"]})
            awb_no = awb["awb_number"] if awb else ""
            expense_code = COST_CATEGORY_TO_COA.get(c["cost_category"], "5102")
            if c.get("payment_type") == "Accrue":
                lines = [
                    {"account_code": expense_code, "debit": c["amount"], "credit": 0, "memo": awb_no},
                    {"account_code": "2101", "debit": 0, "credit": c["amount"], "memo": c.get("vendor_name") or ""},
                ]
            else:
                cash_acc = c.get("cash_account_code") or "1101"
                lines = [
                    {"account_code": expense_code, "debit": c["amount"], "credit": 0, "memo": awb_no},
                    {"account_code": cash_acc, "debit": 0, "credit": c["amount"]},
                ]
            await post_journal(
                date=c.get("created_at"), description=f"[Backfill] Biaya {c['cost_category']} {awb_no}",
                lines=lines, reference_type="cost", reference_id=str(c["_id"]), auto=True,
            )
        except HTTPException:
            continue

    # Fixed costs
    fixed = await db.fixed_costs.find().to_list(5000)
    for f in fixed:
        if await journal_exists_for("fixed_cost", str(f["_id"])):
            continue
        try:
            expense_code = FIXED_COST_TO_COA.get(f["category"], "6199")
            cash_acc = f.get("cash_account_code") or "1101"
            await post_journal(
                date=f.get("created_at"),
                description=f"[Backfill] Beban Tetap {f['category']} {f['period_month']}",
                lines=[
                    {"account_code": expense_code, "debit": f["amount"], "credit": 0},
                    {"account_code": cash_acc, "debit": 0, "credit": f["amount"]},
                ],
                reference_type="fixed_cost", reference_id=str(f["_id"]), auto=True,
            )
        except HTTPException:
            continue

@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_data()
    yield
    client.close()

app = FastAPI(title="TMS API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
async def login(data: LoginIn):
    user = await db.users.find_one({"username": data.username.strip().lower()})
    if not user:
        user = await db.users.find_one({"username": data.username})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="User dinonaktifkan oleh administrator")
    token = create_access_token(str(user["_id"]), user["username"], user["role"])
    perms = user.get("permissions") or default_permissions(user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "role": user["role"],
            "full_name": user.get("full_name"),
            "permissions": perms,
            "active": user.get("active", True),
        },
    }

@app.get("/api/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    perms = user.get("permissions") or default_permissions(user["role"])
    return UserOut(
        id=user["id"],
        username=user["username"],
        role=user["role"],
        full_name=user.get("full_name"),
        permissions=perms,
        active=user.get("active", True),
    )

# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
@app.get("/api/customers")
async def list_customers(user: dict = Depends(get_current_user)):
    docs = await db.customers.find().sort("name", 1).to_list(1000)
    return [serialize(d) for d in docs]

@app.post("/api/customers")
async def create_customer(data: CustomerIn, user: dict = Depends(require_role("operation", "finance"))):
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.customers.insert_one(doc)
    new = await db.customers.find_one({"_id": r.inserted_id})
    return serialize(new)

@app.put("/api/customers/{cid}")
async def update_customer(cid: str, data: CustomerIn, user: dict = Depends(require_role("operation", "finance"))):
    await db.customers.update_one({"_id": _oid(cid)}, {"$set": data.model_dump()})
    new = await db.customers.find_one({"_id": _oid(cid)})
    return serialize(new)

@app.delete("/api/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_role("operation", "finance"))):
    await db.customers.delete_one({"_id": _oid(cid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------
@app.get("/api/contracts")
async def list_contracts(customer_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if customer_id:
        q["customer_id"] = _oid(customer_id)
    docs = await db.contracts.find(q).to_list(1000)
    return [serialize(d) for d in docs]

@app.post("/api/contracts")
async def create_contract(data: ContractIn, user: dict = Depends(require_role("operation", "finance"))):
    doc = data.model_dump()
    doc["customer_id"] = _oid(doc["customer_id"])
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.contracts.insert_one(doc)
    new = await db.contracts.find_one({"_id": r.inserted_id})
    return serialize(new)

@app.delete("/api/contracts/{cid}")
async def delete_contract(cid: str, user: dict = Depends(require_role("operation", "finance"))):
    await db.contracts.delete_one({"_id": _oid(cid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@app.get("/api/settings")
async def list_settings(user: dict = Depends(get_current_user)):
    docs = await db.settings.find().to_list(1000)
    return [serialize(d) for d in docs]

@app.get("/api/settings/tax-options")
async def tax_options(user: dict = Depends(get_current_user)):
    docs = await db.settings.find({"key_name": {"$regex": "^tax_ppn"}}).to_list(100)
    out = []
    for d in docs:
        try:
            out.append({"key": d["key_name"], "label": f"PPN {d['key_value']}%", "value": float(d["key_value"])})
        except Exception:
            continue
    out.sort(key=lambda x: x["value"])
    return out

@app.put("/api/settings/{key_name}")
async def update_setting(key_name: str, data: SettingIn, user: dict = Depends(require_role("operation", "finance"))):
    await db.settings.update_one(
        {"key_name": key_name},
        {"$set": {"key_name": key_name, "key_value": data.key_value}},
        upsert=True,
    )
    return {"ok": True}

# ---------------------------------------------------------------------------
# AWB Orders (Module 1)
# ---------------------------------------------------------------------------
@app.get("/api/orders")
async def list_orders(
    status_v: Optional[str] = None,
    customer_id: Optional[str] = None,
    month: Optional[str] = None,  # YYYY-MM
    user: dict = Depends(get_current_user),
):
    q = {}
    if status_v:
        q["status"] = status_v
    if customer_id:
        q["customer_id"] = _oid(customer_id)
    if month:
        try:
            year, mon = month.split("-")
            year, mon = int(year), int(mon)
            start = datetime(year, mon, 1, tzinfo=timezone.utc)
            if mon == 12:
                end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                end = datetime(year, mon + 1, 1, tzinfo=timezone.utc)
            q["created_at"] = {"$gte": start, "$lt": end}
        except Exception:
            pass
    docs = await db.awb_orders.find(q).sort("created_at", -1).to_list(2000)
    # join customer name
    cust_ids = list({d["customer_id"] for d in docs if d.get("customer_id")})
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(1000)}
    out = []
    for d in docs:
        s = serialize(d)
        c = cmap.get(d.get("customer_id"))
        s["customer_name"] = c["name"] if c else None
        out.append(s)
    return out

@app.get("/api/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    d = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not d:
        raise HTTPException(404, "Order tidak ditemukan")
    s = serialize(d)
    c = await db.customers.find_one({"_id": d["customer_id"]})
    s["customer_name"] = c["name"] if c else None
    s["customer"] = serialize(c) if c else None
    inv = await db.invoices.find_one({"awb_id": d["_id"]})
    s["invoice"] = serialize(inv) if inv else None
    return s

@app.post("/api/orders")
async def create_order(data: OrderIn, user: dict = Depends(require_role("operation"))):
    total = round(data.tariff_per_kg * data.qty_kg, 2)
    tax_amt = round(total * data.tax_percentage / 100, 2)
    doc = {
        "awb_number": await next_awb_number(),
        "customer_id": _oid(data.customer_id),
        "contract_id": _oid(data.contract_id) if data.contract_id else None,
        "item_description": data.item_description,
        "goods_content": data.goods_content,
        "origin": data.origin,
        "destination": data.destination,
        "tariff_per_kg": data.tariff_per_kg,
        "qty_kg": data.qty_kg,
        "total_tariff": total,
        "tax_percentage": data.tax_percentage,
        "tax_amount": tax_amt,
        "grand_total": round(total + tax_amt, 2),
        "status": "Open",
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.awb_orders.insert_one(doc)
    new = await db.awb_orders.find_one({"_id": r.inserted_id})
    # Auto-post journal: DR Piutang / CR Pendapatan + PPN Keluaran
    try:
        lines = [
            {"account_code": "1201", "debit": doc["grand_total"], "credit": 0, "memo": doc["awb_number"]},
            {"account_code": "4101", "debit": 0, "credit": doc["total_tariff"], "memo": doc["awb_number"]},
        ]
        if doc["tax_amount"] > 0:
            lines.append({"account_code": "2210", "debit": 0, "credit": doc["tax_amount"], "memo": f"PPN {doc['tax_percentage']}%"})
        await post_journal(
            date=doc["created_at"],
            description=f"Penjualan jasa pengangkutan {doc['awb_number']}",
            lines=lines,
            reference_type="awb_order",
            reference_id=str(r.inserted_id),
            posted_by=user["id"],
        )
    except HTTPException as e:
        # Don't block AWB creation if period is locked; log only
        new["journal_warning"] = e.detail
    return serialize(new)

# ---------------------------------------------------------------------------
# AWB Costs (Module 2)
# ---------------------------------------------------------------------------
@app.get("/api/costs")
async def list_costs(
    awb_id: Optional[str] = None,
    payment_type: Optional[str] = None,
    is_settled: Optional[bool] = None,
    user: dict = Depends(get_current_user),
):
    q = {}
    if awb_id:
        q["awb_id"] = _oid(awb_id)
    if payment_type:
        q["payment_type"] = payment_type
    if is_settled is not None:
        q["is_settled"] = is_settled
    docs = await db.awb_costs.find(q).sort("created_at", -1).to_list(2000)
    # join awb_number
    awb_ids = list({d["awb_id"] for d in docs})
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": awb_ids}}).to_list(2000)}
    out = []
    for d in docs:
        s = serialize(d)
        a = amap.get(d["awb_id"])
        s["awb_number"] = a["awb_number"] if a else None
        out.append(s)
    return out

@app.post("/api/costs")
async def create_cost(data: CostIn, user: dict = Depends(get_current_user)):
    role = user["role"]
    is_admin = role == "administrator"
    # Business rule enforcement
    if data.cost_category == "Vendor":
        if not (is_admin or role == "operation"):
            raise HTTPException(403, "Hanya role Operation/Administrator yang dapat input biaya Vendor")
        payment_type = "Accrue"
        is_settled = False
    elif data.cost_category in ("Operational", "Lintas"):
        if not (is_admin or role == "finance"):
            raise HTTPException(403, "Hanya role Finance/Administrator yang dapat input biaya Operational/Lintas")
        payment_type = "Cash"
        is_settled = True
    else:
        raise HTTPException(400, "Kategori biaya tidak valid")

    cash_acc = data.cash_account_code or "1101"
    doc = {
        "awb_id": _oid(data.awb_id),
        "cost_category": data.cost_category,
        "payment_type": payment_type,
        "amount": data.amount,
        "description": data.description,
        "vendor_name": data.vendor_name,
        "is_settled": is_settled,
        "created_by_role": role,
        "created_by": user["id"],
        "cash_account_code": cash_acc if payment_type == "Cash" else None,
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.awb_costs.insert_one(doc)
    new = await db.awb_costs.find_one({"_id": r.inserted_id})
    # Auto-post journal
    try:
        awb = await db.awb_orders.find_one({"_id": doc["awb_id"]})
        awb_no = awb["awb_number"] if awb else ""
        expense_code = COST_CATEGORY_TO_COA[data.cost_category]
        if payment_type == "Accrue":
            # DR Beban Vendor / CR Hutang Usaha
            lines = [
                {"account_code": expense_code, "debit": data.amount, "credit": 0, "memo": f"{awb_no} - {data.vendor_name or ''}"},
                {"account_code": "2101", "debit": 0, "credit": data.amount, "memo": data.vendor_name or "Hutang vendor"},
            ]
            desc = f"Akrual biaya vendor {awb_no}"
        else:
            # Cash: DR Beban / CR Kas/Bank
            acc = await get_account(cash_acc)
            if not acc or not acc.get("is_cash"):
                raise HTTPException(400, "Akun kas/bank tidak valid")
            lines = [
                {"account_code": expense_code, "debit": data.amount, "credit": 0, "memo": awb_no},
                {"account_code": cash_acc, "debit": 0, "credit": data.amount, "memo": data.description or ""},
            ]
            desc = f"Pembayaran biaya {data.cost_category} {awb_no}"
        await post_journal(
            date=doc["created_at"], description=desc, lines=lines,
            reference_type="cost", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException as e:
        new["journal_warning"] = e.detail
    return serialize(new)

@app.post("/api/costs/{cid}/settle")
async def settle_cost(cid: str, data: SettleIn = SettleIn(), user: dict = Depends(require_role("finance"))):
    cost = await db.awb_costs.find_one({"_id": _oid(cid)})
    if not cost:
        raise HTTPException(404, "Biaya tidak ditemukan")
    if cost["payment_type"] != "Accrue":
        raise HTTPException(400, "Hanya biaya Accrue yang dapat di-settle ke Cash")
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    now = datetime.now(timezone.utc)
    await db.awb_costs.update_one(
        {"_id": _oid(cid)},
        {"$set": {
            "payment_type": "Cash",
            "is_settled": True,
            "settled_at": now,
            "settled_by": user["id"],
            "cash_account_code": cash_acc,
        }},
    )
    # Auto-post journal: DR Hutang Usaha / CR Cash
    try:
        awb = await db.awb_orders.find_one({"_id": cost["awb_id"]})
        awb_no = awb["awb_number"] if awb else ""
        await post_journal(
            date=now,
            description=f"Pelunasan hutang vendor {cost.get('vendor_name') or ''} ({awb_no})",
            lines=[
                {"account_code": "2101", "debit": cost["amount"], "credit": 0, "memo": cost.get("vendor_name") or ""},
                {"account_code": cash_acc, "debit": 0, "credit": cost["amount"], "memo": f"Settle {awb_no}"},
            ],
            reference_type="settlement", reference_id=cid, posted_by=user["id"],
        )
    except HTTPException as e:
        return {"ok": True, "journal_warning": e.detail}
    return {"ok": True}

@app.delete("/api/costs/{cid}")
async def delete_cost(cid: str, user: dict = Depends(get_current_user)):
    cost = await db.awb_costs.find_one({"_id": _oid(cid)})
    if not cost:
        raise HTTPException(404, "Biaya tidak ditemukan")
    # operation can only delete their own vendor (unsettled), finance can delete any cash, admin can delete any
    if user["role"] == "administrator":
        pass
    elif user["role"] == "operation" and cost["cost_category"] != "Vendor":
        raise HTTPException(403, "Tidak diizinkan")
    await db.awb_costs.delete_one({"_id": _oid(cid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Recap & Reconciliation (Module 3 & 4)
# ---------------------------------------------------------------------------
class ReconcileIn(BaseModel):
    awb_ids: List[str]

@app.post("/api/orders/reconcile")
async def reconcile_orders(data: ReconcileIn, user: dict = Depends(require_role("operation"))):
    ids = [_oid(i) for i in data.awb_ids]
    res = await db.awb_orders.update_many(
        {"_id": {"$in": ids}, "status": "Open"},
        {"$set": {"status": "Reconciled", "reconciled_at": datetime.now(timezone.utc)}},
    )
    return {"updated": res.modified_count}

@app.post("/api/orders/{oid}/revert-to-open")
async def revert_to_open(oid: str, user: dict = Depends(require_role("operation"))):
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if o["status"] != "Reconciled":
        raise HTTPException(400, "Hanya status Reconciled yang dapat dikembalikan ke Open")
    await db.awb_orders.update_one(
        {"_id": _oid(oid)},
        {"$set": {"status": "Open"}, "$unset": {"reconciled_at": ""}},
    )
    return {"ok": True}

# ---------------------------------------------------------------------------
# Invoices (Module 5)
# ---------------------------------------------------------------------------
class InvoiceCreateIn(BaseModel):
    awb_id: str

@app.post("/api/invoices")
async def create_invoice(data: InvoiceCreateIn, user: dict = Depends(require_role("operation"))):
    o = await db.awb_orders.find_one({"_id": _oid(data.awb_id)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    # Idempotent: if invoice already exists for this AWB, return it
    existing = await db.invoices.find_one({"awb_id": o["_id"]})
    if existing:
        return serialize(existing)
    if o["status"] != "Reconciled":
        raise HTTPException(400, "Hanya order dengan status Reconciled yang bisa dibuat invoice")
    doc = {
        "awb_id": o["_id"],
        "invoice_number": await next_invoice_number(),
        "created_at": datetime.now(timezone.utc),
        "created_by": user["id"],
    }
    r = await db.invoices.insert_one(doc)
    await db.awb_orders.update_one(
        {"_id": o["_id"]},
        {"$set": {"status": "Invoiced", "invoiced_at": datetime.now(timezone.utc)}},
    )
    new = await db.invoices.find_one({"_id": r.inserted_id})
    return serialize(new)

@app.get("/api/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    docs = await db.invoices.find().sort("created_at", -1).to_list(2000)
    awb_ids = [d["awb_id"] for d in docs]
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": awb_ids}}).to_list(2000)}
    cust_ids = list({a.get("customer_id") for a in amap.values()})
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(2000)}
    out = []
    for d in docs:
        s = serialize(d)
        a = amap.get(d["awb_id"])
        if a:
            s["awb_number"] = a["awb_number"]
            s["awb_status"] = a["status"]
            s["grand_total"] = a["grand_total"]
            s["total_tariff"] = a["total_tariff"]
            s["tax_amount"] = a["tax_amount"]
            c = cmap.get(a.get("customer_id"))
            s["customer_name"] = c["name"] if c else None
        out.append(s)
    return out

@app.get("/api/invoices/{iid}/full")
async def invoice_full(iid: str, user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"_id": _oid(iid)})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    awb = await db.awb_orders.find_one({"_id": inv["awb_id"]})
    cust = await db.customers.find_one({"_id": awb["customer_id"]}) if awb else None
    settings = {s["key_name"]: s["key_value"] for s in await db.settings.find().to_list(1000)}
    return {
        "invoice": serialize(inv),
        "awb": serialize(awb),
        "customer": serialize(cust),
        "company": {
            "name": settings.get("company_name", ""),
            "npwp": settings.get("company_npwp", ""),
            "address": settings.get("company_address", ""),
        },
    }

# ---------------------------------------------------------------------------
# Payments (Module 6)
# ---------------------------------------------------------------------------
@app.post("/api/orders/{oid}/mark-paid")
async def mark_paid(oid: str, data: MarkPaidIn = MarkPaidIn(), user: dict = Depends(require_role("finance"))):
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if o["status"] != "Invoiced":
        raise HTTPException(400, "Hanya order Invoiced yang dapat ditandai Paid")
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    now = datetime.now(timezone.utc)
    await db.awb_orders.update_one(
        {"_id": _oid(oid)},
        {"$set": {"status": "Paid", "paid_at": now, "paid_by": user["id"], "cash_account_code": cash_acc}},
    )
    # Auto-post journal: DR Cash / CR Piutang Usaha
    try:
        await post_journal(
            date=now,
            description=f"Penerimaan pelunasan invoice {o['awb_number']}",
            lines=[
                {"account_code": cash_acc, "debit": o["grand_total"], "credit": 0, "memo": o["awb_number"]},
                {"account_code": "1201", "debit": 0, "credit": o["grand_total"], "memo": o["awb_number"]},
            ],
            reference_type="payment", reference_id=oid, posted_by=user["id"],
        )
    except HTTPException as e:
        return {"ok": True, "journal_warning": e.detail}
    return {"ok": True}

# ---------------------------------------------------------------------------
# Fixed Costs (Overhead — Finance only)
# ---------------------------------------------------------------------------
FIXED_COST_CATEGORIES = ["Gaji", "Sewa", "Utilities", "Marketing", "Administrasi", "Lainnya"]

@app.get("/api/fixed-costs/categories")
async def fixed_cost_categories(user: dict = Depends(get_current_user)):
    return FIXED_COST_CATEGORIES

@app.get("/api/fixed-costs")
async def list_fixed_costs(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if month:
        q["period_month"] = month
    docs = await db.fixed_costs.find(q).sort("created_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/fixed-costs")
async def create_fixed_cost(data: FixedCostIn, user: dict = Depends(require_role("finance"))):
    if data.category not in FIXED_COST_CATEGORIES:
        raise HTTPException(400, f"Kategori tidak valid. Pilih: {', '.join(FIXED_COST_CATEGORIES)}")
    # validate period_month
    try:
        y, m = data.period_month.split("-")
        int(y)
        int(m)
    except Exception:
        raise HTTPException(400, "Format periode harus YYYY-MM")
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    now = datetime.now(timezone.utc)
    doc = {
        "category": data.category,
        "description": data.description,
        "amount": data.amount,
        "period_month": data.period_month,
        "cash_account_code": cash_acc,
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.fixed_costs.insert_one(doc)
    new = await db.fixed_costs.find_one({"_id": r.inserted_id})
    # Auto-post journal
    try:
        expense_code = FIXED_COST_TO_COA.get(data.category, "6199")
        await post_journal(
            date=now,
            description=f"Beban Tetap {data.category} - {data.period_month}",
            lines=[
                {"account_code": expense_code, "debit": data.amount, "credit": 0, "memo": data.description or data.category},
                {"account_code": cash_acc, "debit": 0, "credit": data.amount, "memo": data.category},
            ],
            reference_type="fixed_cost", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException as e:
        new["journal_warning"] = e.detail
    return serialize(new)

@app.delete("/api/fixed-costs/{fid}")
async def delete_fixed_cost(fid: str, user: dict = Depends(require_role("finance"))):
    await db.fixed_costs.delete_one({"_id": _oid(fid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Profit & Loss (Module 7)
# ---------------------------------------------------------------------------
@app.get("/api/reports/profit-loss")
async def profit_loss(
    month: Optional[str] = None,
    customer_id: Optional[str] = None,
    user: dict = Depends(require_role("finance", "operation")),
):
    q = {}
    if customer_id:
        q["customer_id"] = _oid(customer_id)
    if month:
        try:
            y, m = month.split("-")
            y, m = int(y), int(m)
            start = datetime(y, m, 1, tzinfo=timezone.utc)
            end = datetime(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
            q["created_at"] = {"$gte": start, "$lt": end}
        except Exception:
            pass
    orders = await db.awb_orders.find(q).sort("created_at", -1).to_list(5000)
    awb_ids = [o["_id"] for o in orders]
    cust_ids = list({o.get("customer_id") for o in orders})

    # Aggregate COGS per AWB
    cost_pipeline = [
        {"$match": {"awb_id": {"$in": awb_ids}}},
        {"$group": {"_id": "$awb_id", "total_cost": {"$sum": "$amount"}}},
    ]
    cost_agg = {c["_id"]: c["total_cost"] for c in await db.awb_costs.aggregate(cost_pipeline).to_list(5000)}
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(1000)}

    rows = []
    total_revenue = 0.0  # only AWBs with cost contribute
    total_cogs = 0.0
    revenue_excluded = 0.0  # AWBs without cost (informational)
    excluded_count = 0
    for o in orders:
        rev = o.get("total_tariff", 0) or 0
        cst = cost_agg.get(o["_id"], 0) or 0
        has_cost = cst > 0
        gross = rev - cst
        if has_cost:
            total_revenue += rev
            total_cogs += cst
        else:
            revenue_excluded += rev
            excluded_count += 1
        c = cmap.get(o.get("customer_id"))
        rows.append({
            "awb_id": str(o["_id"]),
            "awb_number": o["awb_number"],
            "customer_name": c["name"] if c else None,
            "created_at": o["created_at"].isoformat() if o.get("created_at") else None,
            "status": o["status"],
            "revenue": rev,
            "total_cost": cst,
            "has_cost": has_cost,
            "gross_profit": gross if has_cost else 0,
            "margin_pct": (gross / rev * 100) if (has_cost and rev) else 0,
        })

    # Fixed costs for the period (month-scoped only; ignored if no month filter is given because
    # they are not customer-specific)
    fixed_q = {}
    if month:
        fixed_q["period_month"] = month
    fixed_rows = await db.fixed_costs.find(fixed_q).sort("created_at", -1).to_list(2000)
    fixed_breakdown = {}
    total_fixed = 0.0
    for f in fixed_rows:
        amt = f.get("amount", 0) or 0
        total_fixed += amt
        fixed_breakdown[f["category"]] = fixed_breakdown.get(f["category"], 0) + amt

    gross_margin = total_revenue - total_cogs
    net_profit = gross_margin - total_fixed

    return {
        "rows": rows,
        "fixed_costs": [serialize(f) for f in fixed_rows],
        "fixed_breakdown": fixed_breakdown,
        "summary": {
            "total_revenue": total_revenue,
            "total_cogs": total_cogs,
            "gross_margin": gross_margin,
            "gross_margin_pct": (gross_margin / total_revenue * 100) if total_revenue else 0,
            "total_fixed_cost": total_fixed,
            "net_profit": net_profit,
            "net_profit_pct": (net_profit / total_revenue * 100) if total_revenue else 0,
            "count": len(rows),
            "count_with_cost": len(rows) - excluded_count,
            "excluded_count": excluded_count,
            "excluded_revenue": revenue_excluded,
            # backwards compat keys
            "total_cost": total_cogs,
        },
    }

# ---------------------------------------------------------------------------
# Dashboard KPIs
# ---------------------------------------------------------------------------
@app.get("/api/dashboard/kpis")
async def kpis(user: dict = Depends(get_current_user)):
    statuses = ["Open", "Reconciled", "Invoiced", "Paid"]
    counts = {}
    for s in statuses:
        counts[s] = await db.awb_orders.count_documents({"status": s})
    revenue_agg = await db.awb_orders.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$total_tariff"}}},
    ]).to_list(1)
    cost_agg = await db.awb_costs.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    accrue_agg = await db.awb_costs.aggregate([
        {"$match": {"payment_type": "Accrue", "is_settled": False}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]).to_list(1)
    return {
        "status_counts": counts,
        "total_revenue": (revenue_agg[0]["total"] if revenue_agg else 0),
        "total_cost": (cost_agg[0]["total"] if cost_agg else 0),
        "outstanding_accrue": (accrue_agg[0]["total"] if accrue_agg else 0),
    }

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# ===========================================================================
# ACCOUNTING ENDPOINTS
# ===========================================================================

class AccountIn(BaseModel):
    code: str
    name: str
    type: Literal["asset", "liability", "equity", "revenue", "cogs", "expense"]
    subtype: Optional[str] = None
    normal: Literal["debit", "credit"]
    is_cash: bool = False

class JournalLineIn(BaseModel):
    account_code: str
    debit: float = 0
    credit: float = 0
    memo: Optional[str] = None

class JournalEntryIn(BaseModel):
    date: Optional[datetime] = None
    description: str
    lines: List[JournalLineIn]

class OpeningBalanceIn(BaseModel):
    date: datetime
    lines: List[JournalLineIn]

class PeriodClosingIn(BaseModel):
    period: str  # YYYY-MM

# ---- Chart of Accounts ----
@app.get("/api/accounts")
async def list_accounts(
    is_cash: Optional[bool] = None,
    type_: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {"active": {"$ne": False}}
    if is_cash is not None:
        q["is_cash"] = is_cash
    if type_:
        q["type"] = type_
    docs = await db.chart_of_accounts.find(q).sort("code", 1).to_list(500)
    return [serialize(d) for d in docs]

@app.post("/api/accounts")
async def create_account(data: AccountIn, user: dict = Depends(require_role("administrator"))):
    if await db.chart_of_accounts.find_one({"code": data.code}):
        raise HTTPException(400, "Kode akun sudah ada")
    doc = data.model_dump()
    doc["is_system"] = False
    doc["active"] = True
    doc["created_at"] = datetime.now(timezone.utc)
    await db.chart_of_accounts.insert_one(doc)
    new = await db.chart_of_accounts.find_one({"code": data.code})
    return serialize(new)

@app.put("/api/accounts/{code}")
async def update_account(code: str, data: AccountIn, user: dict = Depends(require_role("administrator"))):
    target = await db.chart_of_accounts.find_one({"code": code})
    if not target:
        raise HTTPException(404, "Akun tidak ditemukan")
    if target.get("is_system") and data.code != code:
        raise HTTPException(400, "Tidak dapat mengubah kode akun sistem")
    await db.chart_of_accounts.update_one({"code": code}, {"$set": data.model_dump()})
    new = await db.chart_of_accounts.find_one({"code": data.code})
    return serialize(new)

@app.delete("/api/accounts/{code}")
async def delete_account(code: str, user: dict = Depends(require_role("administrator"))):
    target = await db.chart_of_accounts.find_one({"code": code})
    if not target:
        raise HTTPException(404, "Akun tidak ditemukan")
    if target.get("is_system"):
        raise HTTPException(400, "Akun sistem tidak dapat dihapus")
    if await db.journal_entries.find_one({"lines.account_code": code}):
        raise HTTPException(400, "Akun memiliki jurnal, hanya bisa dinonaktifkan")
    await db.chart_of_accounts.delete_one({"code": code})
    return {"ok": True}

# ---- Journal Entries ----
@app.get("/api/journal")
async def list_journal(
    period: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    reference_type: Optional[str] = None,
    account_code: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {}
    if period:
        q["period_month"] = period
    if reference_type:
        q["reference_type"] = reference_type
    if account_code:
        q["lines.account_code"] = account_code
    date_q = {}
    try:
        if start_date:
            date_q["$gte"] = datetime.fromisoformat(start_date)
        if end_date:
            date_q["$lte"] = datetime.fromisoformat(end_date)
    except Exception:
        pass
    if date_q:
        q["date"] = date_q
    docs = await db.journal_entries.find(q).sort("date", -1).to_list(5000)
    return [serialize(d) for d in docs]

@app.post("/api/journal")
async def post_manual_journal(data: JournalEntryIn, user: dict = Depends(require_role("finance", "administrator"))):
    d = data.date or datetime.now(timezone.utc)
    return await post_journal(
        date=d, description=data.description,
        lines=[ln.model_dump() for ln in data.lines],
        reference_type="manual", reference_id=None, posted_by=user["id"], auto=False,
    )

@app.delete("/api/journal/{jid}")
async def delete_journal(jid: str, user: dict = Depends(require_role("administrator"))):
    j = await db.journal_entries.find_one({"_id": _oid(jid)})
    if not j:
        raise HTTPException(404, "Jurnal tidak ditemukan")
    if j.get("reference_type") != "manual":
        raise HTTPException(400, "Hanya jurnal manual yang dapat dihapus")
    if await is_period_locked(j["period_month"]):
        raise HTTPException(400, "Periode sudah ditutup")
    await db.journal_entries.delete_one({"_id": _oid(jid)})
    return {"ok": True}

# ---- Reports ----
async def _balance_until(end_date: datetime) -> dict:
    """Return per-account totals (debit - credit) up to end_date inclusive."""
    pipeline = [
        {"$match": {"date": {"$lte": end_date}}},
        {"$unwind": "$lines"},
        {"$group": {
            "_id": "$lines.account_code",
            "debit": {"$sum": "$lines.debit"},
            "credit": {"$sum": "$lines.credit"},
        }},
    ]
    out = {}
    async for row in db.journal_entries.aggregate(pipeline):
        out[row["_id"]] = {"debit": row["debit"], "credit": row["credit"]}
    return out

def _period_bounds(period: str) -> (datetime, datetime):
    y, m = period.split("-")
    y, m = int(y), int(m)
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc) - timedelta(microseconds=1)
    return start, end

@app.get("/api/reports/trial-balance")
async def trial_balance(period: Optional[str] = None, user: dict = Depends(get_current_user)):
    if period:
        _, end = _period_bounds(period)
    else:
        end = datetime.now(timezone.utc)
    sums = await _balance_until(end)
    accounts = await db.chart_of_accounts.find({"active": {"$ne": False}}).sort("code", 1).to_list(500)
    rows = []
    total_dr = 0.0
    total_cr = 0.0
    for a in accounts:
        s = sums.get(a["code"], {"debit": 0, "credit": 0})
        bal = s["debit"] - s["credit"]
        if a["normal"] == "credit":
            bal = -bal
        if abs(bal) < 0.001 and s["debit"] == 0 and s["credit"] == 0:
            continue
        debit_col = bal if (a["normal"] == "debit" and bal > 0) else 0
        credit_col = bal if (a["normal"] == "credit" and bal > 0) else (-bal if (a["normal"] == "debit" and bal < 0) else 0)
        # simpler: show balance under its natural column
        if a["normal"] == "debit":
            debit_col = max(bal, 0)
            credit_col = max(-bal, 0)
        else:
            credit_col = max(bal, 0)
            debit_col = max(-bal, 0)
        rows.append({
            "code": a["code"], "name": a["name"], "type": a["type"],
            "debit": round(debit_col, 2), "credit": round(credit_col, 2),
            "balance": round(bal, 2),
        })
        total_dr += debit_col
        total_cr += credit_col
    return {"rows": rows, "total_debit": round(total_dr, 2), "total_credit": round(total_cr, 2),
            "balanced": round(total_dr, 2) == round(total_cr, 2)}

@app.get("/api/reports/balance-sheet")
async def balance_sheet(as_of: Optional[str] = None, user: dict = Depends(get_current_user)):
    end = datetime.fromisoformat(as_of) if as_of else datetime.now(timezone.utc)
    sums = await _balance_until(end)
    accounts = await db.chart_of_accounts.find({"active": {"$ne": False}}).sort("code", 1).to_list(500)
    sections = {"asset": [], "liability": [], "equity": []}
    totals = {"asset": 0.0, "liability": 0.0, "equity": 0.0, "revenue": 0.0, "cogs": 0.0, "expense": 0.0}
    for a in accounts:
        s = sums.get(a["code"], {"debit": 0, "credit": 0})
        # For asset accounts: bal = debit - credit (raw). Contra-asset (e.g. Akum Penyusutan, normal=credit)
        # naturally shows as a negative number under assets and correctly reduces total.
        # For liability/equity/revenue: bal = credit - debit (positive normal).
        # For cogs/expense: bal = debit - credit (positive normal).
        if a["type"] == "asset":
            bal = s["debit"] - s["credit"]
        elif a["normal"] == "credit":
            bal = s["credit"] - s["debit"]
        else:
            bal = s["debit"] - s["credit"]
        totals[a["type"]] = totals.get(a["type"], 0) + bal
        if a["type"] in ("asset", "liability", "equity"):
            sections[a["type"]].append({"code": a["code"], "name": a["name"], "subtype": a.get("subtype"), "balance": round(bal, 2)})
    # Compute current-period earnings → goes to equity as Laba Tahun Berjalan
    current_earnings = totals["revenue"] - totals["cogs"] - totals["expense"]
    sections["equity"].append({"code": "3301", "name": "Laba Tahun Berjalan", "subtype": "equity", "balance": round(current_earnings, 2)})
    totals["equity"] += current_earnings
    return {
        "as_of": end.isoformat(),
        "assets": sections["asset"],
        "liabilities": sections["liability"],
        "equity": sections["equity"],
        "total_assets": round(totals["asset"], 2),
        "total_liabilities": round(totals["liability"], 2),
        "total_equity": round(totals["equity"], 2),
        "balanced": abs(round(totals["asset"], 2) - round(totals["liability"] + totals["equity"], 2)) < 0.5,
    }

@app.get("/api/reports/income-statement")
async def income_statement(period: Optional[str] = None, user: dict = Depends(get_current_user)):
    if period:
        start, end = _period_bounds(period)
        date_q = {"$gte": start, "$lte": end}
    else:
        date_q = None
    pipeline = []
    if date_q:
        pipeline.append({"$match": {"date": date_q}})
    pipeline += [
        {"$unwind": "$lines"},
        {"$group": {
            "_id": "$lines.account_code",
            "debit": {"$sum": "$lines.debit"},
            "credit": {"$sum": "$lines.credit"},
        }},
    ]
    sums = {}
    async for row in db.journal_entries.aggregate(pipeline):
        sums[row["_id"]] = {"debit": row["debit"], "credit": row["credit"]}
    accounts = await db.chart_of_accounts.find({"type": {"$in": ["revenue", "cogs", "expense"]}}).sort("code", 1).to_list(200)
    revenue_lines, cogs_lines, expense_lines = [], [], []
    total_rev = total_cogs = total_exp = 0.0
    for a in accounts:
        s = sums.get(a["code"], {"debit": 0, "credit": 0})
        bal = s["credit"] - s["debit"] if a["normal"] == "credit" else s["debit"] - s["credit"]
        if abs(bal) < 0.001:
            continue
        entry = {"code": a["code"], "name": a["name"], "balance": round(bal, 2)}
        if a["type"] == "revenue":
            revenue_lines.append(entry); total_rev += bal
        elif a["type"] == "cogs":
            cogs_lines.append(entry); total_cogs += bal
        else:
            expense_lines.append(entry); total_exp += bal
    gross = total_rev - total_cogs
    net = gross - total_exp
    return {
        "period": period or "all",
        "revenue": revenue_lines, "total_revenue": round(total_rev, 2),
        "cogs": cogs_lines, "total_cogs": round(total_cogs, 2),
        "gross_profit": round(gross, 2),
        "expenses": expense_lines, "total_expenses": round(total_exp, 2),
        "net_income": round(net, 2),
        "gross_margin_pct": (gross / total_rev * 100) if total_rev else 0,
        "net_margin_pct": (net / total_rev * 100) if total_rev else 0,
    }

@app.get("/api/reports/cash-flow")
async def cash_flow(period: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Direct cash flow: sum of cash account movements grouped by counter-account type."""
    cash_accounts = await db.chart_of_accounts.find({"is_cash": True}).to_list(50)
    cash_codes = [a["code"] for a in cash_accounts]
    if period:
        start, end = _period_bounds(period)
        date_q = {"$gte": start, "$lte": end}
    else:
        date_q = None

    # Beginning balance of all cash accounts before the period
    if period:
        before_end = start - timedelta(microseconds=1)
        before_sums = await _balance_until(before_end)
    else:
        before_sums = {}
    beginning_cash = 0.0
    for c in cash_codes:
        s = before_sums.get(c, {"debit": 0, "credit": 0})
        beginning_cash += s["debit"] - s["credit"]

    # Iterate through journal entries that have at least 1 cash line in period
    match = {"lines.account_code": {"$in": cash_codes}}
    if date_q:
        match["date"] = date_q
    entries = await db.journal_entries.find(match).to_list(10000)

    operating_in = 0.0
    operating_out = 0.0
    financing_in = 0.0
    financing_out = 0.0
    investing_in = 0.0
    investing_out = 0.0
    detail = {"operating_in": [], "operating_out": [], "financing": [], "investing": []}

    for je in entries:
        # Net cash effect for this entry
        cash_dr = sum(ln["debit"] for ln in je["lines"] if ln["account_code"] in cash_codes)
        cash_cr = sum(ln["credit"] for ln in je["lines"] if ln["account_code"] in cash_codes)
        net = cash_dr - cash_cr  # positive = inflow
        if abs(net) < 0.001:
            continue
        # Classify by non-cash counter accounts
        non_cash_types = set()
        for ln in je["lines"]:
            if ln["account_code"] not in cash_codes and (ln["debit"] > 0 or ln["credit"] > 0):
                non_cash_types.add(ln.get("account_type", ""))
        # Heuristic: equity → financing, fixed_asset (1501/1502) → investing, else operating
        is_financing = "equity" in non_cash_types or je.get("reference_type") == "opening_balance"
        is_investing = False
        for ln in je["lines"]:
            if ln["account_code"].startswith("15") and ln["account_code"] not in cash_codes:
                is_investing = True
        bucket = "financing" if is_financing else ("investing" if is_investing else "operating")
        item = {
            "entry_no": je["entry_no"], "date": je["date"].isoformat() if hasattr(je["date"], 'isoformat') else je["date"],
            "description": je["description"], "amount": round(net, 2),
        }
        if bucket == "operating":
            if net > 0:
                operating_in += net; detail["operating_in"].append(item)
            else:
                operating_out += -net; detail["operating_out"].append(item)
        elif bucket == "financing":
            if net > 0: financing_in += net
            else: financing_out += -net
            detail["financing"].append(item)
        else:
            if net > 0: investing_in += net
            else: investing_out += -net
            detail["investing"].append(item)

    net_operating = operating_in - operating_out
    net_financing = financing_in - financing_out
    net_investing = investing_in - investing_out
    ending_cash = beginning_cash + net_operating + net_financing + net_investing

    return {
        "period": period or "all",
        "beginning_cash": round(beginning_cash, 2),
        "operating": {"inflow": round(operating_in, 2), "outflow": round(operating_out, 2), "net": round(net_operating, 2)},
        "investing": {"inflow": round(investing_in, 2), "outflow": round(investing_out, 2), "net": round(net_investing, 2)},
        "financing": {"inflow": round(financing_in, 2), "outflow": round(financing_out, 2), "net": round(net_financing, 2)},
        "net_change": round(net_operating + net_financing + net_investing, 2),
        "ending_cash": round(ending_cash, 2),
        "detail": detail,
    }

@app.get("/api/ledger")
async def general_ledger(account_code: str, period: Optional[str] = None, user: dict = Depends(get_current_user)):
    acc = await get_account(account_code)
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")
    q = {"lines.account_code": account_code}
    if period:
        q["period_month"] = period
        start, _ = _period_bounds(period)
        before_sums = await _balance_until(start - timedelta(microseconds=1))
        s = before_sums.get(account_code, {"debit": 0, "credit": 0})
        beginning = s["debit"] - s["credit"]
        if acc["normal"] == "credit":
            beginning = -beginning
    else:
        beginning = 0.0
    entries = await db.journal_entries.find(q).sort("date", 1).to_list(10000)
    rows = []
    running = beginning
    for je in entries:
        for ln in je["lines"]:
            if ln["account_code"] != account_code:
                continue
            delta = (ln["debit"] - ln["credit"]) if acc["normal"] == "debit" else (ln["credit"] - ln["debit"])
            running += delta
            rows.append({
                "entry_no": je["entry_no"],
                "date": je["date"].isoformat() if hasattr(je["date"], "isoformat") else je["date"],
                "description": je["description"],
                "debit": ln["debit"], "credit": ln["credit"],
                "memo": ln.get("memo", ""),
                "balance": round(running, 2),
                "reference_type": je.get("reference_type"),
            })
    return {
        "account": serialize(acc),
        "beginning_balance": round(beginning, 2),
        "rows": rows,
        "ending_balance": round(running, 2),
    }

# ---- Opening Balance ----
@app.post("/api/opening-balance")
async def post_opening_balance(data: OpeningBalanceIn, user: dict = Depends(require_role("administrator"))):
    return await post_journal(
        date=data.date,
        description="Saldo Awal (Opening Balance)",
        lines=[ln.model_dump() for ln in data.lines],
        reference_type="opening_balance", reference_id=None, posted_by=user["id"], auto=False,
    )

# ---- Period Closing ----
@app.get("/api/period-closing")
async def list_closings(user: dict = Depends(get_current_user)):
    docs = await db.period_closings.find().sort("period", -1).to_list(200)
    return [serialize(d) for d in docs]

@app.post("/api/period-closing")
async def close_period(data: PeriodClosingIn, user: dict = Depends(require_role("administrator"))):
    try:
        y, m = data.period.split("-")
        int(y); int(m)
    except Exception:
        raise HTTPException(400, "Format periode harus YYYY-MM")
    if await db.period_closings.find_one({"period": data.period}):
        raise HTTPException(400, "Periode sudah ditutup")
    # snapshot summary
    inc = await income_statement(period=data.period, user=user)
    bs = await balance_sheet(as_of=_period_bounds(data.period)[1].isoformat(), user=user)
    doc = {
        "period": data.period,
        "closed_at": datetime.now(timezone.utc),
        "closed_by": user["id"],
        "summary": {"income_statement": inc, "balance_sheet_totals": {
            "assets": bs["total_assets"], "liabilities": bs["total_liabilities"], "equity": bs["total_equity"],
        }},
    }
    await db.period_closings.insert_one(doc)
    # also mark all entries in this period as is_locked=True
    await db.journal_entries.update_many({"period_month": data.period}, {"$set": {"is_locked": True}})
    new = await db.period_closings.find_one({"period": data.period})
    return serialize(new)

@app.delete("/api/period-closing/{period}")
async def reopen_period(period: str, user: dict = Depends(require_role("administrator"))):
    if not await db.period_closings.find_one({"period": period}):
        raise HTTPException(404, "Periode tidak ditemukan")
    await db.period_closings.delete_one({"period": period})
    await db.journal_entries.update_many({"period_month": period}, {"$set": {"is_locked": False}})
    return {"ok": True}

# ---------------------------------------------------------------------------
# User Management (Administrator only)
# ---------------------------------------------------------------------------
VALID_ROLES = ["administrator", "operation", "finance"]

@app.get("/api/modules")
async def list_modules(user: dict = Depends(get_current_user)):
    return MODULES

@app.get("/api/users")
async def list_users(user: dict = Depends(require_role("administrator"))):
    docs = await db.users.find().sort("created_at", -1).to_list(2000)
    out = []
    for d in docs:
        s = serialize(d)
        s.pop("password_hash", None)
        if not s.get("permissions"):
            s["permissions"] = default_permissions(s.get("role", ""))
        if "active" not in s:
            s["active"] = True
        out.append(s)
    return out

@app.post("/api/users")
async def create_user(data: UserCreateIn, user: dict = Depends(require_role("administrator"))):
    if data.role not in VALID_ROLES:
        raise HTTPException(400, f"Role tidak valid. Pilih: {', '.join(VALID_ROLES)}")
    uname = data.username.strip().lower()
    if not uname or len(uname) < 3:
        raise HTTPException(400, "Username minimal 3 karakter")
    if len(data.password) < 6:
        raise HTTPException(400, "Password minimal 6 karakter")
    existing = await db.users.find_one({"username": uname})
    if existing:
        raise HTTPException(400, "Username sudah dipakai")
    perms = data.permissions if data.permissions is not None else default_permissions(data.role)
    # validate permission keys
    invalid = [p for p in perms if p not in MODULE_KEYS]
    if invalid:
        raise HTTPException(400, f"Permission tidak valid: {', '.join(invalid)}")
    doc = {
        "username": uname,
        "password_hash": hash_password(data.password),
        "role": data.role,
        "full_name": data.full_name or uname,
        "permissions": perms,
        "active": True,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["id"],
    }
    r = await db.users.insert_one(doc)
    new = await db.users.find_one({"_id": r.inserted_id})
    s = serialize(new)
    s.pop("password_hash", None)
    return s

@app.put("/api/users/{uid}")
async def update_user(uid: str, data: UserUpdateIn, user: dict = Depends(require_role("administrator"))):
    target = await db.users.find_one({"_id": _oid(uid)})
    if not target:
        raise HTTPException(404, "User tidak ditemukan")
    updates = {}
    if data.full_name is not None:
        updates["full_name"] = data.full_name
    if data.role is not None:
        if data.role not in VALID_ROLES:
            raise HTTPException(400, "Role tidak valid")
        # prevent demoting the last administrator
        if target.get("role") == "administrator" and data.role != "administrator":
            admin_count = await db.users.count_documents({"role": "administrator", "active": {"$ne": False}})
            if admin_count <= 1:
                raise HTTPException(400, "Tidak dapat menonaktifkan administrator terakhir")
        updates["role"] = data.role
    if data.permissions is not None:
        invalid = [p for p in data.permissions if p not in MODULE_KEYS]
        if invalid:
            raise HTTPException(400, f"Permission tidak valid: {', '.join(invalid)}")
        updates["permissions"] = data.permissions
    if data.active is not None:
        if target.get("role") == "administrator" and data.active is False:
            admin_count = await db.users.count_documents({"role": "administrator", "active": {"$ne": False}})
            if admin_count <= 1:
                raise HTTPException(400, "Tidak dapat menonaktifkan administrator terakhir")
        updates["active"] = data.active
    if updates:
        await db.users.update_one({"_id": _oid(uid)}, {"$set": updates})
    new = await db.users.find_one({"_id": _oid(uid)})
    s = serialize(new)
    s.pop("password_hash", None)
    return s

@app.put("/api/users/{uid}/password")
async def reset_password(uid: str, data: PasswordResetIn, user: dict = Depends(require_role("administrator"))):
    if len(data.password) < 6:
        raise HTTPException(400, "Password minimal 6 karakter")
    target = await db.users.find_one({"_id": _oid(uid)})
    if not target:
        raise HTTPException(404, "User tidak ditemukan")
    await db.users.update_one(
        {"_id": _oid(uid)},
        {"$set": {"password_hash": hash_password(data.password)}},
    )
    return {"ok": True}

@app.delete("/api/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_role("administrator"))):
    if uid == user["id"]:
        raise HTTPException(400, "Tidak dapat menghapus diri sendiri")
    target = await db.users.find_one({"_id": _oid(uid)})
    if not target:
        raise HTTPException(404, "User tidak ditemukan")
    if target.get("role") == "administrator":
        admin_count = await db.users.count_documents({"role": "administrator"})
        if admin_count <= 1:
            raise HTTPException(400, "Tidak dapat menghapus administrator terakhir")
    await db.users.delete_one({"_id": _oid(uid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Copy Fixed Costs to next/target month
# ---------------------------------------------------------------------------
class CopyFixedCostIn(BaseModel):
    source_month: str
    target_month: str
    overwrite: bool = False  # if True, delete target month items before copying

@app.post("/api/fixed-costs/copy")
async def copy_fixed_costs(data: CopyFixedCostIn, user: dict = Depends(require_role("finance"))):
    for m in (data.source_month, data.target_month):
        try:
            y, mm = m.split("-")
            int(y)
            int(mm)
        except Exception:
            raise HTTPException(400, "Format periode harus YYYY-MM")
    if data.source_month == data.target_month:
        raise HTTPException(400, "Bulan sumber dan target tidak boleh sama")
    src = await db.fixed_costs.find({"period_month": data.source_month}).to_list(2000)
    if not src:
        raise HTTPException(400, f"Tidak ada biaya tetap di periode {data.source_month}")
    if data.overwrite:
        # Also delete journal entries for those costs (best-effort)
        old = await db.fixed_costs.find({"period_month": data.target_month}).to_list(2000)
        for f in old:
            await db.journal_entries.delete_many({"reference_type": "fixed_cost", "reference_id": str(f["_id"])})
        await db.fixed_costs.delete_many({"period_month": data.target_month})
    new_docs = []
    for f in src:
        new_docs.append({
            "category": f["category"],
            "description": f.get("description"),
            "amount": f.get("amount", 0),
            "period_month": data.target_month,
            "cash_account_code": f.get("cash_account_code", "1101"),
            "created_by": user["id"],
            "copied_from_month": data.source_month,
            "created_at": datetime.now(timezone.utc),
        })
    if new_docs:
        result = await db.fixed_costs.insert_many(new_docs)
        # Post journal for each
        for inserted_id, doc in zip(result.inserted_ids, new_docs):
            try:
                expense_code = FIXED_COST_TO_COA.get(doc["category"], "6199")
                await post_journal(
                    date=doc["created_at"],
                    description=f"Beban Tetap {doc['category']} - {doc['period_month']} (copy)",
                    lines=[
                        {"account_code": expense_code, "debit": doc["amount"], "credit": 0},
                        {"account_code": doc["cash_account_code"], "debit": 0, "credit": doc["amount"]},
                    ],
                    reference_type="fixed_cost", reference_id=str(inserted_id), posted_by=user["id"],
                )
            except HTTPException:
                pass  # skip if period locked
    return {"copied": len(new_docs), "target_month": data.target_month, "overwrite": data.overwrite}

# ===========================================================================
# FEATURE FLAGS (Module On/Off) — Administrator-only toggle
# ===========================================================================
FEATURE_MODULES = [
    {"key": "accounting",  "label": "Akunting (PSAK)",        "default": True,  "description": "Chart of Accounts, Jurnal, Buku Besar, Laporan Keuangan"},
    {"key": "hr",          "label": "HR & Payroll",            "default": False, "description": "Karyawan, gaji, slip gaji, auto-jurnal beban gaji"},
    {"key": "tax",         "label": "Perpajakan (PPN/PPh)",    "default": False, "description": "Ringkasan PPN Masukan/Keluaran, PPh ringkas"},
    {"key": "asset",       "label": "Aset Tetap & Depresiasi", "default": False, "description": "Aset, penyusutan otomatis bulanan (PSAK 16)"},
    {"key": "bank_recon",  "label": "Rekonsiliasi Bank",       "default": False, "description": "Impor mutasi bank & matching ke jurnal"},
]
FEATURE_KEYS = [m["key"] for m in FEATURE_MODULES]

async def ensure_feature_flags():
    for m in FEATURE_MODULES:
        existing = await db.feature_flags.find_one({"key": m["key"]})
        if not existing:
            await db.feature_flags.insert_one({
                "key": m["key"], "label": m["label"], "enabled": m["default"],
                "description": m["description"],
                "updated_at": datetime.now(timezone.utc),
            })

async def is_feature_enabled(key: str) -> bool:
    f = await db.feature_flags.find_one({"key": key})
    if not f:
        # not seeded yet, fall back to default
        for m in FEATURE_MODULES:
            if m["key"] == key:
                return m["default"]
        return False
    return bool(f.get("enabled", False))

def require_feature(key: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if not await is_feature_enabled(key):
            raise HTTPException(status_code=503, detail=f"Modul '{key}' sedang dinonaktifkan oleh administrator")
        return user
    return dep

@app.get("/api/feature-flags")
async def list_feature_flags(user: dict = Depends(get_current_user)):
    await ensure_feature_flags()
    docs = await db.feature_flags.find().to_list(50)
    return [serialize(d) for d in docs]

class FeatureFlagUpdate(BaseModel):
    enabled: bool

@app.put("/api/feature-flags/{key}")
async def update_feature_flag(key: str, data: FeatureFlagUpdate, user: dict = Depends(require_role("administrator"))):
    if key not in FEATURE_KEYS:
        raise HTTPException(400, "Module key tidak valid")
    await db.feature_flags.update_one(
        {"key": key},
        {"$set": {"enabled": data.enabled, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True, "key": key, "enabled": data.enabled}

# ===========================================================================
# HR & PAYROLL MODULE  (toggle: hr)
# ===========================================================================
class EmployeeIn(BaseModel):
    full_name: str
    position: Optional[str] = None
    nik: Optional[str] = None  # KTP
    npwp: Optional[str] = None
    bpjs_no: Optional[str] = None
    bank_account: Optional[str] = None
    base_salary: float = 0
    allowance: float = 0
    join_date: Optional[str] = None  # YYYY-MM-DD
    active: bool = True

@app.get("/api/hr/employees")
async def list_employees(user: dict = Depends(require_feature("hr"))):
    docs = await db.employees.find().sort("created_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/hr/employees")
async def create_employee(data: EmployeeIn, user: dict = Depends(require_feature("hr"))):
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.employees.insert_one(doc)
    return serialize(await db.employees.find_one({"_id": r.inserted_id}))

@app.put("/api/hr/employees/{eid}")
async def update_employee(eid: str, data: EmployeeIn, user: dict = Depends(require_feature("hr"))):
    await db.employees.update_one({"_id": _oid(eid)}, {"$set": data.model_dump()})
    return serialize(await db.employees.find_one({"_id": _oid(eid)}))

@app.delete("/api/hr/employees/{eid}")
async def delete_employee(eid: str, user: dict = Depends(require_feature("hr"))):
    await db.employees.delete_one({"_id": _oid(eid)})
    return {"ok": True}

class PayrollRunIn(BaseModel):
    period_month: str  # YYYY-MM
    cash_account_code: Optional[str] = "1101"

@app.get("/api/hr/payroll")
async def list_payroll(period: Optional[str] = None, user: dict = Depends(require_feature("hr"))):
    q = {}
    if period:
        q["period_month"] = period
    docs = await db.payroll.find(q).sort("created_at", -1).to_list(2000)
    out = []
    for d in docs:
        s = serialize(d)
        # Convert nested ObjectIds in slips (legacy data may have raw ObjectId)
        if isinstance(s.get("slips"), list):
            s["slips"] = [
                {k: (str(v) if isinstance(v, ObjectId) else v) for k, v in slip.items()}
                for slip in s["slips"]
            ]
        out.append(s)
    return out

@app.post("/api/hr/payroll/run")
async def run_payroll(data: PayrollRunIn, user: dict = Depends(require_feature("hr"))):
    if user.get("role") not in ("administrator", "finance"):
        raise HTTPException(403, "Hanya finance/admin yang dapat menjalankan payroll")
    if await db.payroll.find_one({"period_month": data.period_month}):
        raise HTTPException(400, f"Payroll periode {data.period_month} sudah dijalankan")
    employees = await db.employees.find({"active": True}).to_list(1000)
    if not employees:
        raise HTTPException(400, "Tidak ada karyawan aktif")
    slips = []
    total = 0.0
    for e in employees:
        base = float(e.get("base_salary", 0))
        allowance = float(e.get("allowance", 0))
        gross = base + allowance
        # Sederhana: PPh21 final 5% jika gross >= 5jt
        pph21 = round(gross * 0.05, 2) if gross >= 5000000 else 0.0
        net = gross - pph21
        slips.append({
            "employee_id": str(e["_id"]), "employee_name": e["full_name"],
            "position": e.get("position"), "base_salary": base, "allowance": allowance,
            "gross": gross, "pph21": pph21, "net": net,
        })
        total += gross
    cash_acc = data.cash_account_code or "1101"
    payroll_doc = {
        "period_month": data.period_month,
        "slips": slips,
        "total_gross": round(total, 2),
        "cash_account_code": cash_acc,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.payroll.insert_one(payroll_doc)
    # Post journal: Dr 6101 Beban Gaji / Cr Kas / Cr 2220 Hutang PPh
    total_pph = sum(s["pph21"] for s in slips)
    total_net = sum(s["net"] for s in slips)
    lines = [
        {"account_code": "6101", "debit": total, "credit": 0, "memo": f"Payroll {data.period_month}"},
    ]
    if total_pph > 0:
        lines.append({"account_code": "2220", "debit": 0, "credit": total_pph, "memo": "PPh21 dipotong"})
    lines.append({"account_code": cash_acc, "debit": 0, "credit": total_net, "memo": "Bayar gaji"})
    try:
        await post_journal(
            date=datetime.now(timezone.utc),
            description=f"Payroll {data.period_month}",
            lines=lines,
            reference_type="payroll", reference_id=str(r.inserted_id),
            posted_by=user["id"], auto=True,
        )
    except HTTPException:
        pass
    return serialize(await db.payroll.find_one({"_id": r.inserted_id}))

@app.delete("/api/hr/payroll/{pid}")
async def delete_payroll(pid: str, user: dict = Depends(require_feature("hr"))):
    if user.get("role") != "administrator":
        raise HTTPException(403, "Hanya administrator")
    pdoc = await db.payroll.find_one({"_id": _oid(pid)})
    if not pdoc:
        raise HTTPException(404, "Payroll tidak ditemukan")
    await db.journal_entries.delete_many({"reference_type": "payroll", "reference_id": pid})
    await db.payroll.delete_one({"_id": _oid(pid)})
    return {"ok": True}

# ===========================================================================
# TAX MODULE  (toggle: tax)
# ===========================================================================
@app.get("/api/tax/ppn-summary")
async def ppn_summary(period: Optional[str] = None, user: dict = Depends(require_feature("tax"))):
    """Sum PPN Keluaran (2210) and PPN Masukan (1401 if exists, else 0) for period."""
    if period:
        start, end = _period_bounds(period)
        date_q = {"$gte": start, "$lte": end}
    else:
        date_q = None
    match = {"lines.account_code": {"$in": ["2210", "1401"]}}
    if date_q:
        match["date"] = date_q
    entries = await db.journal_entries.find(match).to_list(10000)
    keluaran = 0.0
    masukan = 0.0
    detail_kel = []
    detail_mas = []
    for je in entries:
        for ln in je["lines"]:
            if ln["account_code"] == "2210":
                amt = ln["credit"] - ln["debit"]
                keluaran += amt
                if amt > 0:
                    detail_kel.append({
                        "entry_no": je["entry_no"],
                        "date": je["date"].isoformat() if hasattr(je["date"], "isoformat") else je["date"],
                        "description": je["description"],
                        "amount": round(amt, 2),
                    })
            elif ln["account_code"] == "1401":
                amt = ln["debit"] - ln["credit"]
                masukan += amt
                if amt > 0:
                    detail_mas.append({
                        "entry_no": je["entry_no"],
                        "date": je["date"].isoformat() if hasattr(je["date"], "isoformat") else je["date"],
                        "description": je["description"],
                        "amount": round(amt, 2),
                    })
    return {
        "period": period or "all",
        "ppn_keluaran": round(keluaran, 2),
        "ppn_masukan": round(masukan, 2),
        "ppn_kurang_bayar": round(keluaran - masukan, 2),
        "detail_keluaran": detail_kel,
        "detail_masukan": detail_mas,
    }

class PphRecordIn(BaseModel):
    period_month: str
    pph_type: str  # PPh21, PPh23, PPh25
    description: Optional[str] = None
    amount: float

@app.get("/api/tax/pph")
async def list_pph(period: Optional[str] = None, user: dict = Depends(require_feature("tax"))):
    q = {}
    if period:
        q["period_month"] = period
    docs = await db.pph_records.find(q).sort("created_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/tax/pph")
async def create_pph(data: PphRecordIn, user: dict = Depends(require_feature("tax"))):
    doc = data.model_dump()
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.pph_records.insert_one(doc)
    return serialize(await db.pph_records.find_one({"_id": r.inserted_id}))

@app.delete("/api/tax/pph/{pid}")
async def delete_pph(pid: str, user: dict = Depends(require_feature("tax"))):
    await db.pph_records.delete_one({"_id": _oid(pid)})
    return {"ok": True}

# ===========================================================================
# ASSET MODULE  (toggle: asset)
# ===========================================================================
class AssetIn(BaseModel):
    name: str
    category: Optional[str] = None
    acquisition_date: str  # YYYY-MM-DD
    cost: float
    salvage_value: float = 0
    useful_life_months: int = 60
    notes: Optional[str] = None

@app.get("/api/assets")
async def list_assets(user: dict = Depends(require_feature("asset"))):
    docs = await db.assets.find().sort("created_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/assets")
async def create_asset(data: AssetIn, user: dict = Depends(require_feature("asset"))):
    doc = data.model_dump()
    doc["accumulated_depreciation"] = 0.0
    doc["depreciated_months"] = 0
    doc["status"] = "active"
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.assets.insert_one(doc)
    return serialize(await db.assets.find_one({"_id": r.inserted_id}))

@app.delete("/api/assets/{aid}")
async def delete_asset(aid: str, user: dict = Depends(require_feature("asset"))):
    if user.get("role") != "administrator":
        raise HTTPException(403, "Hanya administrator")
    await db.assets.delete_one({"_id": _oid(aid)})
    return {"ok": True}

class DepreciateRunIn(BaseModel):
    period_month: str  # YYYY-MM — run depreciation for this month

@app.post("/api/assets/depreciate")
async def run_depreciation(data: DepreciateRunIn, user: dict = Depends(require_feature("asset"))):
    if user.get("role") not in ("administrator", "finance"):
        raise HTTPException(403, "Hanya finance/admin")
    # idempotent per period
    if await db.depreciation_runs.find_one({"period_month": data.period_month}):
        raise HTTPException(400, f"Depresiasi {data.period_month} sudah dijalankan")
    assets = await db.assets.find({"status": "active"}).to_list(1000)
    if not assets:
        raise HTTPException(400, "Tidak ada aset aktif")
    total = 0.0
    details = []
    for a in assets:
        life = int(a.get("useful_life_months", 60))
        if life <= 0:
            continue
        depreciated = int(a.get("depreciated_months", 0))
        if depreciated >= life:
            continue
        depreciable = float(a.get("cost", 0)) - float(a.get("salvage_value", 0))
        monthly = round(depreciable / life, 2)
        if monthly <= 0:
            continue
        await db.assets.update_one(
            {"_id": a["_id"]},
            {"$inc": {"accumulated_depreciation": monthly, "depreciated_months": 1}},
        )
        details.append({"asset_id": str(a["_id"]), "name": a["name"], "amount": monthly})
        total += monthly
    run_doc = {
        "period_month": data.period_month,
        "total_amount": round(total, 2),
        "details": details,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.depreciation_runs.insert_one(run_doc)
    # Post journal: Dr 6105 (or 6106) Beban Penyusutan / Cr 1502 Akumulasi Penyusutan
    if total > 0:
        # Ensure 6105 exists; create if missing
        if not await db.chart_of_accounts.find_one({"code": "6105"}):
            await db.chart_of_accounts.insert_one({
                "code": "6105", "name": "Beban Penyusutan", "type": "expense",
                "subtype": "operating_expense", "normal": "debit",
                "is_system": True, "active": True,
                "created_at": datetime.now(timezone.utc),
            })
        try:
            await post_journal(
                date=datetime.now(timezone.utc),
                description=f"Depresiasi periode {data.period_month}",
                lines=[
                    {"account_code": "6105", "debit": total, "credit": 0, "memo": "Penyusutan bulanan"},
                    {"account_code": "1502", "debit": 0, "credit": total, "memo": "Akumulasi penyusutan"},
                ],
                reference_type="depreciation", reference_id=str(r.inserted_id),
                posted_by=user["id"], auto=True,
            )
        except HTTPException:
            pass
    return serialize(await db.depreciation_runs.find_one({"_id": r.inserted_id}))

@app.get("/api/assets/depreciation-runs")
async def list_depreciation_runs(user: dict = Depends(require_feature("asset"))):
    docs = await db.depreciation_runs.find().sort("period_month", -1).to_list(200)
    return [serialize(d) for d in docs]

# ===========================================================================
# BANK RECONCILIATION MODULE  (toggle: bank_recon)
# ===========================================================================
class BankStatementLineIn(BaseModel):
    bank_account_code: str  # 1102 / 1103
    date: str  # YYYY-MM-DD
    description: str
    amount: float  # positive = inflow, negative = outflow

@app.get("/api/bank-recon")
async def list_bank_lines(
    bank_account_code: Optional[str] = None,
    period: Optional[str] = None,
    matched: Optional[bool] = None,
    user: dict = Depends(require_feature("bank_recon")),
):
    q = {}
    if bank_account_code:
        q["bank_account_code"] = bank_account_code
    if period:
        q["period_month"] = period
    if matched is not None:
        q["matched"] = matched
    docs = await db.bank_statements.find(q).sort("date", -1).to_list(5000)
    return [serialize(d) for d in docs]

@app.post("/api/bank-recon")
async def create_bank_line(data: BankStatementLineIn, user: dict = Depends(require_feature("bank_recon"))):
    period = data.date[:7]  # YYYY-MM
    doc = {
        "bank_account_code": data.bank_account_code,
        "date": data.date,
        "description": data.description,
        "amount": data.amount,
        "matched": False,
        "matched_journal_id": None,
        "period_month": period,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.bank_statements.insert_one(doc)
    return serialize(await db.bank_statements.find_one({"_id": r.inserted_id}))

class BankMatchIn(BaseModel):
    journal_id: str

@app.post("/api/bank-recon/{bid}/match")
async def match_bank_line(bid: str, data: BankMatchIn, user: dict = Depends(require_feature("bank_recon"))):
    line = await db.bank_statements.find_one({"_id": _oid(bid)})
    if not line:
        raise HTTPException(404, "Line bank tidak ditemukan")
    j = await db.journal_entries.find_one({"_id": _oid(data.journal_id)})
    if not j:
        raise HTTPException(404, "Jurnal tidak ditemukan")
    await db.bank_statements.update_one(
        {"_id": _oid(bid)},
        {"$set": {"matched": True, "matched_journal_id": data.journal_id, "matched_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}

@app.post("/api/bank-recon/{bid}/unmatch")
async def unmatch_bank_line(bid: str, user: dict = Depends(require_feature("bank_recon"))):
    await db.bank_statements.update_one(
        {"_id": _oid(bid)},
        {"$set": {"matched": False, "matched_journal_id": None}},
    )
    return {"ok": True}

@app.delete("/api/bank-recon/{bid}")
async def delete_bank_line(bid: str, user: dict = Depends(require_feature("bank_recon"))):
    await db.bank_statements.delete_one({"_id": _oid(bid)})
    return {"ok": True}

@app.get("/api/bank-recon/candidates/{bid}")
async def match_candidates(bid: str, user: dict = Depends(require_feature("bank_recon"))):
    """Find candidate journal entries that touch the bank account with matching amount ±tolerance."""
    line = await db.bank_statements.find_one({"_id": _oid(bid)})
    if not line:
        raise HTTPException(404, "Line bank tidak ditemukan")
    target = abs(line["amount"])
    inflow = line["amount"] > 0
    bank_code = line["bank_account_code"]
    # Find journal entries with bank line of matching amount within 7 days
    try:
        line_date = datetime.fromisoformat(line["date"])
    except Exception:
        line_date = datetime.now(timezone.utc)
    start = line_date - timedelta(days=7)
    end = line_date + timedelta(days=7)
    entries = await db.journal_entries.find({
        "date": {"$gte": start, "$lte": end},
        "lines.account_code": bank_code,
    }).to_list(500)
    candidates = []
    for je in entries:
        for ln in je["lines"]:
            if ln["account_code"] != bank_code:
                continue
            amt = ln["debit"] if inflow else ln["credit"]
            if amt > 0 and abs(amt - target) < 1.0:
                candidates.append({
                    "id": str(je["_id"]),
                    "entry_no": je["entry_no"],
                    "date": je["date"].isoformat() if hasattr(je["date"], "isoformat") else je["date"],
                    "description": je["description"],
                    "amount": amt,
                })
                break
    return {"line": serialize(line), "candidates": candidates}

# Ensure feature flags seeded on startup
@app.on_event("startup")
async def _startup_feature_flags():
    await ensure_feature_flags()


# ===========================================================================
# IMPORT EXCEL & MASTER VENDORS  (extension v2)
# ===========================================================================
import io
import openpyxl

# ---- Master Vendor ----
class VendorIn(BaseModel):
    name: str
    code: Optional[str] = None
    armada_type: Optional[str] = None     # FREELANCE / AR / VENDOR / KONSUL
    npwp: Optional[str] = None
    address: Optional[str] = None
    bank_account: Optional[str] = None
    pph_type: Optional[str] = None        # PPh23 / PPh15 / PP23UMKM / None
    notes: Optional[str] = None
    active: bool = True

@app.get("/api/vendors")
async def list_vendors(user: dict = Depends(get_current_user)):
    docs = await db.vendors.find().sort("name", 1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/vendors")
async def create_vendor(data: VendorIn, user: dict = Depends(get_current_user)):
    if await db.vendors.find_one({"name": data.name}):
        raise HTTPException(400, "Vendor dengan nama tersebut sudah ada")
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    r = await db.vendors.insert_one(doc)
    return serialize(await db.vendors.find_one({"_id": r.inserted_id}))

@app.put("/api/vendors/{vid}")
async def update_vendor(vid: str, data: VendorIn, user: dict = Depends(get_current_user)):
    await db.vendors.update_one({"_id": _oid(vid)}, {"$set": data.model_dump()})
    return serialize(await db.vendors.find_one({"_id": _oid(vid)}))

@app.delete("/api/vendors/{vid}")
async def delete_vendor(vid: str, user: dict = Depends(require_role("administrator"))):
    await db.vendors.delete_one({"_id": _oid(vid)})
    return {"ok": True}

# ---- Master Region & Fleet Type (constants) ----
REGIONS = [
    "JABODETABEK", "JAWA BARAT", "JAWA TENGAH", "JAWA TIMUR", "DI YOGYAKARTA", "BALI",
    "SUMATRA", "ACEH", "KALIMANTAN BARAT", "KALIMANTAN TENGAH", "KALIMANTAN SELATAN",
    "KALIMANTAN TIMUR", "SULAWESI", "PAPUA", "NUSA TENGGARA", "MALUKU",
]
FLEET_TYPES = ["CDE", "CDD", "TRONTON", "BV", "PICKUP", "WINGBOX", "FUSO", "CONTAINER"]
ARMADA_TYPES = ["AR", "FREELANCE", "VENDOR", "KONSUL"]

@app.get("/api/masters/regions")
async def list_regions(user: dict = Depends(get_current_user)):
    return REGIONS

@app.get("/api/masters/fleet-types")
async def list_fleet_types(user: dict = Depends(get_current_user)):
    return FLEET_TYPES

@app.get("/api/masters/armada-types")
async def list_armada_types(user: dict = Depends(get_current_user)):
    return ARMADA_TYPES

# ---- WIPE Transactional Data (Admin only, with explicit confirm) ----
class WipeIn(BaseModel):
    confirm: str  # must equal "HAPUS SEMUA DATA"

@app.post("/api/admin/wipe-transactions")
async def wipe_transactions(data: WipeIn, user: dict = Depends(require_role("administrator"))):
    if data.confirm != "HAPUS SEMUA DATA":
        raise HTTPException(400, "Konfirmasi tidak valid. Ketik tepat 'HAPUS SEMUA DATA'")
    collections_to_clear = [
        "awb_orders", "awb_costs", "invoices",
        "customers", "contracts", "vendors",
        "fixed_costs", "journal_entries", "period_closings",
        "payroll", "employees", "assets", "depreciation_runs",
        "bank_statements", "pph_records",
    ]
    summary = {}
    for c in collections_to_clear:
        res = await db[c].delete_many({})
        summary[c] = res.deleted_count
    # Prevent dummy seeding from re-creating sample data after restart
    await db.settings.update_one(
        {"key_name": "skip_dummy_seed"},
        {"$set": {"key_name": "skip_dummy_seed", "key_value": "1"}},
        upsert=True,
    )
    return {"ok": True, "deleted": summary, "by": user["username"]}

# ---- AWB extended fields update helper ----
class AwbExtendedUpdate(BaseModel):
    """Patch endpoint to update extra fields on an existing AWB."""
    wo_number: Optional[str] = None
    destination_city: Optional[str] = None
    region: Optional[str] = None
    intracity: Optional[bool] = None
    cashback_amount: Optional[float] = None
    pph_final: Optional[float] = None
    notes: Optional[str] = None
    fleet_type: Optional[str] = None
    armada_type: Optional[str] = None
    external_invoice_number: Optional[str] = None

@app.patch("/api/orders/{oid}/extended")
async def patch_awb_extended(oid: str, data: AwbExtendedUpdate, user: dict = Depends(get_current_user)):
    upd = {k: v for k, v in data.model_dump().items() if v is not None}
    if upd:
        await db.awb_orders.update_one({"_id": _oid(oid)}, {"$set": upd})
    return serialize(await db.awb_orders.find_one({"_id": _oid(oid)}))

# ---------------------------------------------------------------------------
# EXCEL IMPORT
# ---------------------------------------------------------------------------
# Recognized header aliases (Excel column name -> normalized key)
_HEADER_ALIAS = {
    "no.": "no", "nomor": "no",
    "no. wo": "wo_number", "no wo": "wo_number",
    "bulan": "month",
    "tgl. pick up": "pickup_date", "tgl pick up": "pickup_date",
    "no awb": "awb_number", "no. awb": "awb_number",
    "customer": "customer_short",
    "customer name": "customer_name",
    "tujuan": "destination",
    "city": "destination_city", "kota": "destination_city",
    "wilayah": "region",
    "item": "item_description",
    "tarif/kg": "pricing_desc", "tarif / kg": "pricing_desc",
    "kg": "qty_kg",
    "selling": "selling",
    "ppn": "ppn",
    "inv+ppn": "inv_ppn", "inv +ppn": "inv_ppn",
    "vendor 1": "vendor1_name", "vendor": "vendor1_name",
    "vendor 2": "vendor2_name",
    "tipe armada": "armada_type",
    "jenis armada": "fleet_type",
    "biaya ops": "biaya_ops",
    "uang jalan\n(lintas)": "uang_jalan", "uang jalan (lintas)": "uang_jalan", "uang jalan": "uang_jalan",
    "t. biaya ops": "total_biaya_ops",
    "inv vendor": "vendor1_invoice",
    "ppn2": "vendor1_ppn",
    "pph ps 23\npph ps 15/ pp 23 umkm": "vendor1_pph", "pph ps 23": "vendor1_pph",
    "t. tagihan": "vendor1_total",
    "status bayar\n(v1)": "vendor1_status", "status bayar (v1)": "vendor1_status",
    "inv vendor2": "vendor2_invoice",
    "ppn4": "vendor2_ppn",
    "pph ps 23\npph ps 15/ pp 23 umkm5": "vendor2_pph",
    "t. tagihan6": "vendor2_total",
    "status bayar\n(v2)": "vendor2_status", "status bayar (v2)": "vendor2_status",
    "j. biaya vendor": "total_vendor_cost",
    "status bayar vendor": "vendor_pay_status",
    "kategori cust": "customer_category",
    "dalam/luar kota": "intracity_flag",
    "cashback": "cashback_amount",
    "total tagihan": "total_tagihan",
    "pph 2%": "pph_final",
    "selling net": "selling_net",
    "no. inv": "external_invoice_number", "no inv": "external_invoice_number",
    "tgl. inv": "invoice_date", "tgl inv": "invoice_date",
    "status penagihan": "billing_status",
    "status pembayaran": "payment_status",
    "tgl. bayar": "paid_at",
    "ket.": "notes", "keterangan": "notes",
}

# Excel status -> ARC status (awb_orders.status)
def _map_status(billing: Optional[str], payment: Optional[str]) -> str:
    b = (billing or "").strip().upper()
    p = (payment or "").strip().upper()
    if p == "SUDAH BAYAR" or p == "LUNAS" or "BAYAR" in p and "BELUM" not in p:
        return "Paid"
    if "SUDAH INV" in b or "INVOICED" in b:
        return "Invoiced"
    if "BELUM" in b or b == "" or "PO BELUM" in b:
        return "Reconciled"
    return "Open"

def _norm(s):
    if s is None:
        return ""
    return str(s).strip().lower()

def _to_float(v):
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except Exception:
        return 0.0

def _to_str(v):
    if v is None:
        return None
    return str(v).strip() if str(v).strip() else None

def _to_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v
    try:
        return datetime.fromisoformat(str(v)).replace(tzinfo=timezone.utc)
    except Exception:
        return None

def _find_header_row(ws, max_search=10):
    """Find the row that contains the most known header aliases. Returns (row_idx, header_map)."""
    best = (1, {})
    best_count = 0
    for r in range(1, min(max_search, ws.max_row) + 1):
        row_vals = [c.value for c in ws[r]]
        header_map = {}
        count = 0
        for col_idx, v in enumerate(row_vals, 1):
            key = _norm(v)
            if key in _HEADER_ALIAS:
                header_map[_HEADER_ALIAS[key]] = col_idx
                count += 1
        if count > best_count:
            best = (r, header_map)
            best_count = count
    return best

class ImportPreviewIn(BaseModel):
    sheet_names: Optional[List[str]] = None  # if None → all data sheets

@app.post("/api/import/excel/preview")
async def import_excel_preview(
    file_b64: str = None,
    user: dict = Depends(require_role("administrator")),
):
    """Stub kept for compatibility; main entry is /api/import/excel which accepts multipart."""
    raise HTTPException(501, "Gunakan endpoint /api/import/excel (multipart upload)")

from fastapi import UploadFile, File, Form

async def _parse_excel(content: bytes, dry_run: bool, posted_by: str, sheet_names: Optional[List[str]] = None) -> dict:
    """Parse Excel content and (optionally) import. Returns summary."""
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    SKIP_SHEETS = {"REPORT", "DASHBOARD", "PIVOT TABLE", "SUMMARY", "Sheet4"}
    # Default smart selection: prefer "DATA ALL BASE (2)" → "DATA ALL BASE" → month sheets,
    # to avoid double-importing overlapping data.
    if sheet_names:
        candidate_sheets = [s for s in wb.sheetnames if s in sheet_names]
    else:
        if "DATA ALL BASE (2)" in wb.sheetnames:
            candidate_sheets = ["DATA ALL BASE (2)"]
        elif "DATA ALL BASE" in wb.sheetnames:
            candidate_sheets = ["DATA ALL BASE"]
        else:
            candidate_sheets = [s for s in wb.sheetnames if s.upper() not in {x.upper() for x in SKIP_SHEETS}]

    # Aggregate caches to avoid duplicate inserts within the same run
    customer_cache: dict = {}   # name -> ObjectId
    vendor_cache: dict = {}      # name -> ObjectId
    awb_cache: dict = {}          # awb_number -> ObjectId
    
    summary = {
        "sheets_processed": [],
        "customers_created": 0,
        "vendors_created": 0,
        "awbs_created": 0,
        "awb_items_added": 0,
        "costs_created": 0,
        "invoices_created": 0,
        "journals_posted": 0,
        "skipped_rows": 0,
        "auto_corrected": [],  # list of {sheet, row, awb, field, original, corrected, diff}
        "skipped_details": [],  # list of {sheet, row, awb, reason}
        "errors": [],
    }

    async def get_or_create_customer(name: str, short: Optional[str], category: Optional[str], region: Optional[str]) -> Optional[ObjectId]:
        if not name:
            return None
        if name in customer_cache:
            return customer_cache[name]
        existing = await db.customers.find_one({"name": name})
        if existing:
            customer_cache[name] = existing["_id"]
            return existing["_id"]
        if dry_run:
            customer_cache[name] = None
            summary["customers_created"] += 1
            return None
        doc = {
            "name": name,
            "short_name": short,
            "category": category,
            "region": region,
            "company_details": None,
            "address": None,
            "npwp": None,
            "created_at": datetime.now(timezone.utc),
        }
        r = await db.customers.insert_one(doc)
        customer_cache[name] = r.inserted_id
        summary["customers_created"] += 1
        return r.inserted_id

    async def get_or_create_vendor(name: str, armada_type: Optional[str]) -> Optional[ObjectId]:
        if not name:
            return None
        if name in vendor_cache:
            return vendor_cache[name]
        existing = await db.vendors.find_one({"name": name})
        if existing:
            vendor_cache[name] = existing["_id"]
            return existing["_id"]
        if dry_run:
            vendor_cache[name] = None
            summary["vendors_created"] += 1
            return None
        doc = {
            "name": name,
            "armada_type": armada_type,
            "active": True,
            "created_at": datetime.now(timezone.utc),
        }
        r = await db.vendors.insert_one(doc)
        vendor_cache[name] = r.inserted_id
        summary["vendors_created"] += 1
        return r.inserted_id

    for sheet_name in candidate_sheets:
        ws = wb[sheet_name]
        if ws.max_row < 3:
            continue
        header_row, header_map = _find_header_row(ws)
        if not header_map or "awb_number" not in header_map:
            continue  # not a data sheet
        sheet_info = {"sheet": sheet_name, "rows_read": 0, "awbs": 0, "items": 0, "costs": 0}

        for row_idx in range(header_row + 1, ws.max_row + 1):
            row = [c.value for c in ws[row_idx]]
            def col(key):
                idx = header_map.get(key)
                if idx is None or idx > len(row):
                    return None
                return row[idx - 1]

            awb_no_raw = col("awb_number")
            if awb_no_raw is None or _norm(awb_no_raw) in ("", "-"):
                continue
            awb_no = str(awb_no_raw).strip()
            sheet_info["rows_read"] += 1

            try:
                customer_name = _to_str(col("customer_name"))
                customer_short = _to_str(col("customer_short"))
                customer_cat = _to_str(col("customer_category"))
                region = _to_str(col("region"))

                customer_id = await get_or_create_customer(customer_name, customer_short, customer_cat, region)

                pickup_date = _to_date(col("pickup_date")) or datetime.now(timezone.utc)
                wo_number = _to_str(col("wo_number"))
                destination = _to_str(col("destination"))
                destination_city = _to_str(col("destination_city"))
                fleet_type = _to_str(col("fleet_type"))
                armada_type = _to_str(col("armada_type"))
                cashback = _to_float(col("cashback_amount"))
                pph_final = _to_float(col("pph_final"))
                ext_inv = _to_str(col("external_invoice_number"))
                inv_date = _to_date(col("invoice_date"))
                paid_at = _to_date(col("paid_at"))
                notes = _to_str(col("notes"))
                intracity = _norm(col("intracity_flag")) == "dalam kota"
                billing_status = _to_str(col("billing_status"))
                payment_status = _to_str(col("payment_status"))

                # Item line for this row
                item_desc = _to_str(col("item_description")) or "ITEM"
                pricing_desc = _to_str(col("pricing_desc"))
                qty_kg = _to_float(col("qty_kg"))
                selling = _to_float(col("selling"))
                ppn = _to_float(col("ppn"))
                excel_inv_ppn = _to_float(col("inv_ppn"))

                # ── DATA QUALITY GUARDS ────────────────────────────────────
                # Skip rows that can't be salvaged
                if selling <= 0:
                    summary["skipped_rows"] += 1
                    summary["skipped_details"].append({
                        "sheet": sheet_name, "row": row_idx, "awb": awb_no,
                        "reason": f"SELLING tidak valid (Rp {selling:,.0f}) — baris dilewati",
                    })
                    continue
                # Skip malformed AWB number (comma or multiple numbers joined)
                if "," in awb_no or (";" in awb_no) or len(awb_no) > 25:
                    summary["skipped_rows"] += 1
                    summary["skipped_details"].append({
                        "sheet": sheet_name, "row": row_idx, "awb": awb_no,
                        "reason": "Nomor AWB tidak valid (mengandung koma / titik koma / terlalu panjang — kemungkinan gabungan beberapa AWB)",
                    })
                    continue

                # ── AUTO-FIX INV+PPN ──────────────────────────────────────
                # Always recompute from selling + ppn (single source of truth)
                inv_ppn = round(selling + ppn, 2)
                if excel_inv_ppn > 0 and abs(excel_inv_ppn - inv_ppn) > 0.5:
                    summary["auto_corrected"].append({
                        "sheet": sheet_name, "row": row_idx, "awb": awb_no,
                        "field": "INV+PPN",
                        "original": round(excel_inv_ppn, 2),
                        "corrected": inv_ppn,
                        "diff": round(excel_inv_ppn - inv_ppn, 2),
                    })

                # Find existing AWB or create new
                existing_awb = await db.awb_orders.find_one({"awb_number": awb_no})

                if existing_awb is None:
                    awb_doc = {
                        "awb_number": awb_no,
                        "customer_id": customer_id,
                        "contract_id": None,
                        "wo_number": wo_number,
                        "destination": destination,
                        "destination_city": destination_city,
                        "region": region,
                        "fleet_type": fleet_type,
                        "armada_type": armada_type,
                        "intracity": intracity,
                        "cashback_amount": cashback,
                        "pph_final": pph_final,
                        "external_invoice_number": ext_inv,
                        "notes": notes,
                        "status": _map_status(billing_status, payment_status),
                        "created_at": pickup_date,
                        "paid_at": paid_at,
                        # legacy fields (single-line compat): we will compute from items later
                        "items": [],
                        "total_tariff": 0.0,
                        "tax_amount": 0.0,
                        "grand_total": 0.0,
                        "tax_percentage": 11.0,
                        "item_description": item_desc,
                        "goods_content": item_desc,
                        "origin": "JKT",
                        "tariff_per_kg": 0,
                        "qty_kg": qty_kg,
                    }
                    if dry_run:
                        awb_id = None
                    else:
                        r = await db.awb_orders.insert_one(awb_doc)
                        awb_id = r.inserted_id
                    summary["awbs_created"] += 1
                    sheet_info["awbs"] += 1
                else:
                    awb_id = existing_awb["_id"]

                # Item / line append
                item_line = {
                    "item_description": item_desc,
                    "pricing_desc": pricing_desc,
                    "qty_kg": qty_kg,
                    "selling": selling,
                    "ppn": ppn,
                    "inv_ppn": inv_ppn,
                    "notes": notes,
                }
                if not dry_run and awb_id is not None:
                    await db.awb_orders.update_one(
                        {"_id": awb_id},
                        {
                            "$push": {"items": item_line},
                            "$inc": {"total_tariff": selling, "tax_amount": ppn, "grand_total": inv_ppn},
                        },
                    )
                summary["awb_items_added"] += 1
                sheet_info["items"] += 1

                # Costs (vendor 1 / vendor 2 / biaya ops / lintas)
                v1_name = _to_str(col("vendor1_name"))
                v1_amount = _to_float(col("vendor1_total")) or _to_float(col("vendor1_invoice"))
                v1_status = _to_str(col("vendor1_status"))
                v2_name = _to_str(col("vendor2_name"))
                v2_amount = _to_float(col("vendor2_total")) or _to_float(col("vendor2_invoice"))
                v2_status = _to_str(col("vendor2_status"))
                biaya_ops = _to_float(col("biaya_ops"))
                uang_jalan = _to_float(col("uang_jalan"))

                async def add_cost(category: str, amount: float, vendor_name: Optional[str], status: Optional[str]):
                    if amount <= 0:
                        return
                    is_settled = (_norm(status) == "sudah bayar")
                    payment_type = "Cash" if is_settled else "Accrue"
                    vendor_id = await get_or_create_vendor(vendor_name, armada_type) if vendor_name else None
                    if dry_run:
                        summary["costs_created"] += 1
                        sheet_info["costs"] += 1
                        return
                    cost_doc = {
                        "awb_id": awb_id,
                        "cost_category": category,
                        "amount": amount,
                        "payment_type": payment_type,
                        "vendor_name": vendor_name,
                        "vendor_id": vendor_id,
                        "armada_type": armada_type,
                        "fleet_type": fleet_type,
                        "is_settled": is_settled,
                        "description": f"Imported from Excel — AWB {awb_no}",
                        "created_by_role": "imported",
                        "created_at": pickup_date,
                    }
                    if is_settled:
                        cost_doc["cash_account_code"] = "1101"
                    cr = await db.awb_costs.insert_one(cost_doc)
                    summary["costs_created"] += 1
                    sheet_info["costs"] += 1
                    # auto-journal for cost
                    expense_code = COST_CATEGORY_TO_COA.get(category, "5102")
                    try:
                        if is_settled:
                            lines = [
                                {"account_code": expense_code, "debit": amount, "credit": 0, "memo": awb_no},
                                {"account_code": "1101", "debit": 0, "credit": amount, "memo": vendor_name or ""},
                            ]
                        else:
                            lines = [
                                {"account_code": expense_code, "debit": amount, "credit": 0, "memo": awb_no},
                                {"account_code": "2101", "debit": 0, "credit": amount, "memo": vendor_name or ""},
                            ]
                        await post_journal(
                            date=pickup_date, description=f"[Import] Biaya {category} {awb_no}",
                            lines=lines, reference_type="cost", reference_id=str(cr.inserted_id),
                            posted_by=posted_by, auto=True,
                        )
                        summary["journals_posted"] += 1
                    except HTTPException:
                        pass

                # Map categories: Vendor invoice = "Vendor", Biaya Ops = "Operational", Uang Jalan = "Lintas"
                await add_cost("Vendor", v1_amount, v1_name, v1_status)
                await add_cost("Vendor", v2_amount, v2_name, v2_status)
                await add_cost("Operational", biaya_ops, None, None)
                await add_cost("Lintas", uang_jalan, None, None)

                # Sales journal (Dr Piutang/Cr Pendapatan + PPN) — once per AWB line
                if not dry_run and awb_id is not None:
                    try:
                        lines = [
                            {"account_code": "1201", "debit": inv_ppn, "credit": 0, "memo": awb_no},
                            {"account_code": "4101", "debit": 0, "credit": selling, "memo": awb_no},
                        ]
                        if ppn > 0:
                            lines.append({"account_code": "2210", "debit": 0, "credit": ppn, "memo": "PPN"})
                        await post_journal(
                            date=pickup_date, description=f"[Import] Penjualan {awb_no} - {item_desc}",
                            lines=lines, reference_type="awb_order", reference_id=str(awb_id),
                            posted_by=posted_by, auto=True,
                        )
                        summary["journals_posted"] += 1
                    except HTTPException as he:
                        summary["errors"].append(f"Sheet '{sheet_name}' row {row_idx} AWB {awb_no}: jurnal sales gagal — {he.detail[:100]}")

                # Invoice record (only once per AWB)
                if ext_inv and existing_awb is None and not dry_run and awb_id is not None:
                    if not await db.invoices.find_one({"awb_id": awb_id}):
                        await db.invoices.insert_one({
                            "awb_id": awb_id,
                            "invoice_number": await next_invoice_number(),
                            "external_invoice_number": ext_inv,
                            "created_at": inv_date or pickup_date,
                        })
                        summary["invoices_created"] += 1

                # Payment journal if status=Paid
                if not dry_run and awb_id is not None and _map_status(billing_status, payment_status) == "Paid" and inv_ppn > 0:
                    try:
                        await post_journal(
                            date=paid_at or pickup_date,
                            description=f"[Import] Pelunasan {awb_no}",
                            lines=[
                                {"account_code": "1101", "debit": inv_ppn, "credit": 0, "memo": awb_no},
                                {"account_code": "1201", "debit": 0, "credit": inv_ppn, "memo": awb_no},
                            ],
                            reference_type="payment", reference_id=str(awb_id),
                            posted_by=posted_by, auto=True,
                        )
                        summary["journals_posted"] += 1
                    except HTTPException:
                        pass

            except Exception as e:
                summary["skipped_rows"] += 1
                summary["errors"].append(f"Sheet '{sheet_name}' row {row_idx}: {str(e)[:120]}")
                continue

        summary["sheets_processed"].append(sheet_info)

    return summary

@app.post("/api/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    dry_run: str = Form("true"),
    sheet_names: str = Form(""),
    user: dict = Depends(require_role("administrator")),
):
    """Import Excel REPORT PENJUALAN. dry_run=true returns preview without writing.
    sheet_names: comma-separated sheet names (e.g. "JAN,FEB"). Empty = auto smart pick."""
    is_dry = str(dry_run).lower() in ("true", "1", "yes")
    sheets = [s.strip() for s in sheet_names.split(",") if s.strip()] if sheet_names else None
    content = await file.read()
    if not content:
        raise HTTPException(400, "File kosong")
    try:
        summary = await _parse_excel(content, dry_run=is_dry, posted_by=user["id"], sheet_names=sheets)
    except Exception as e:
        raise HTTPException(400, f"Gagal parse Excel: {str(e)[:200]}")
    summary["dry_run"] = is_dry
    summary["filename"] = file.filename
    summary["sheets_selected"] = sheets or "auto"
    return summary

@app.post("/api/import/excel/list-sheets")
async def list_sheets(
    file: UploadFile = File(...),
    user: dict = Depends(require_role("administrator")),
):
    """Return all sheets in the uploaded file with row counts so user can choose."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "File kosong")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"File bukan Excel valid: {str(e)[:100]}")
    SKIP_SHEETS = {"REPORT", "DASHBOARD", "PIVOT TABLE", "SUMMARY", "Sheet4"}
    out = []
    for s in wb.sheetnames:
        ws = wb[s]
        # Try to find header row to estimate data rows
        hdr_row, hdr_map = _find_header_row(ws)
        data_rows = max(0, ws.max_row - hdr_row) if hdr_map else 0
        out.append({
            "name": s,
            "max_row": ws.max_row,
            "max_col": ws.max_column,
            "estimated_data_rows": data_rows,
            "is_data_sheet": bool(hdr_map and "awb_number" in hdr_map),
            "skipped_by_default": s in SKIP_SHEETS,
        })
    return {"sheets": out, "recommended": (
        ["DATA ALL BASE (2)"] if "DATA ALL BASE (2)" in wb.sheetnames
        else (["DATA ALL BASE"] if "DATA ALL BASE" in wb.sheetnames else [s for s in wb.sheetnames if s not in SKIP_SHEETS])
    )}


# ===========================================================================
# ANALYTICS DASHBOARD (filtered KPIs + breakdowns + paginated detail)
# ===========================================================================

def _parse_iso_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc) if "T" not in s else datetime.fromisoformat(s)
    except Exception:
        return None

async def _build_awb_filter(
    period_from: Optional[str],
    period_to: Optional[str],
    customer_id: Optional[str],
    region: Optional[str],
    status: Optional[str],
    fleet_type: Optional[str],
    armada_type: Optional[str],
    search: Optional[str],
) -> dict:
    q: dict = {}
    df = _parse_iso_date(period_from)
    dt = _parse_iso_date(period_to)
    if df or dt:
        date_q = {}
        if df: date_q["$gte"] = df
        if dt: date_q["$lte"] = dt
        q["created_at"] = date_q
    if customer_id:
        try: q["customer_id"] = _oid(customer_id)
        except: pass
    if region: q["region"] = region
    if status: q["status"] = status
    if fleet_type: q["fleet_type"] = fleet_type
    if armada_type: q["armada_type"] = armada_type
    if search:
        # search by awb_number or wo_number or external_invoice_number
        q["$or"] = [
            {"awb_number": {"$regex": search, "$options": "i"}},
            {"wo_number": {"$regex": search, "$options": "i"}},
            {"external_invoice_number": {"$regex": search, "$options": "i"}},
            {"destination": {"$regex": search, "$options": "i"}},
            {"destination_city": {"$regex": search, "$options": "i"}},
        ]
    return q

@app.get("/api/analytics/dashboard")
async def analytics_dashboard(
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    customer_id: Optional[str] = None,
    region: Optional[str] = None,
    status: Optional[str] = None,
    fleet_type: Optional[str] = None,
    armada_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = await _build_awb_filter(period_from, period_to, customer_id, region, status, fleet_type, armada_type, None)
    awbs = await db.awb_orders.find(q).to_list(20000)
    # Aggregate costs per AWB
    awb_ids = [a["_id"] for a in awbs]
    cost_map: dict = {}
    if awb_ids:
        async for c in db.awb_costs.find({"awb_id": {"$in": awb_ids}}):
            cost_map[c["awb_id"]] = cost_map.get(c["awb_id"], 0) + float(c.get("amount", 0))

    # Customer lookup
    cust_ids = list({a.get("customer_id") for a in awbs if a.get("customer_id")})
    cust_map: dict = {}
    if cust_ids:
        async for c in db.customers.find({"_id": {"$in": cust_ids}}):
            cust_map[c["_id"]] = c.get("name", "?")

    # KPIs
    total_awbs = len(awbs)
    total_selling = sum(float(a.get("total_tariff", 0)) for a in awbs)
    total_inv = sum(float(a.get("grand_total", 0)) for a in awbs)
    total_ppn = sum(float(a.get("tax_amount", 0)) for a in awbs)
    total_costs = sum(cost_map.get(a["_id"], 0) for a in awbs)
    gross_margin = total_selling - total_costs
    margin_pct = (gross_margin / total_selling * 100) if total_selling > 0 else 0.0

    paid_count = sum(1 for a in awbs if a.get("status") == "Paid")
    paid_amount = sum(float(a.get("grand_total", 0)) for a in awbs if a.get("status") == "Paid")
    unpaid_amount = total_inv - paid_amount

    # Breakdowns
    def bucket(key, label_fn=None):
        m: dict = {}
        for a in awbs:
            k = a.get(key) or "(N/A)"
            label = label_fn(a) if label_fn else k
            row = m.setdefault(label, {"label": label, "awbs": 0, "selling": 0, "costs": 0, "margin": 0})
            row["awbs"] += 1
            row["selling"] += float(a.get("total_tariff", 0))
            row["costs"] += cost_map.get(a["_id"], 0)
        for r in m.values():
            r["margin"] = r["selling"] - r["costs"]
            r["margin_pct"] = (r["margin"] / r["selling"] * 100) if r["selling"] > 0 else 0
        return sorted(m.values(), key=lambda x: x["selling"], reverse=True)

    # Monthly series
    monthly: dict = {}
    for a in awbs:
        dt = a.get("created_at")
        if not dt:
            continue
        key = dt.strftime("%Y-%m") if hasattr(dt, "strftime") else str(dt)[:7]
        row = monthly.setdefault(key, {"month": key, "awbs": 0, "selling": 0, "costs": 0})
        row["awbs"] += 1
        row["selling"] += float(a.get("total_tariff", 0))
        row["costs"] += cost_map.get(a["_id"], 0)
    for r in monthly.values():
        r["margin"] = r["selling"] - r["costs"]
        r["margin_pct"] = (r["margin"] / r["selling"] * 100) if r["selling"] > 0 else 0
    monthly_series = sorted(monthly.values(), key=lambda x: x["month"])

    region_breakdown = bucket("region")
    fleet_breakdown = bucket("fleet_type")
    armada_breakdown = bucket("armada_type")
    status_breakdown = bucket("status")
    customer_breakdown = bucket(
        "customer_id",
        label_fn=lambda a: cust_map.get(a.get("customer_id"), "(N/A)"),
    )

    return {
        "filters": {
            "period_from": period_from, "period_to": period_to,
            "customer_id": customer_id, "region": region, "status": status,
            "fleet_type": fleet_type, "armada_type": armada_type,
        },
        "kpis": {
            "total_awbs": total_awbs,
            "total_selling": round(total_selling, 2),
            "total_inv": round(total_inv, 2),
            "total_ppn": round(total_ppn, 2),
            "total_costs": round(total_costs, 2),
            "gross_margin": round(gross_margin, 2),
            "margin_pct": round(margin_pct, 2),
            "paid_count": paid_count,
            "paid_amount": round(paid_amount, 2),
            "unpaid_amount": round(unpaid_amount, 2),
        },
        "monthly_series": monthly_series,
        "region_breakdown": region_breakdown[:20],
        "fleet_breakdown": fleet_breakdown[:20],
        "armada_breakdown": armada_breakdown[:20],
        "status_breakdown": status_breakdown,
        "customer_breakdown": customer_breakdown[:15],
    }

@app.get("/api/analytics/awbs-detail")
async def analytics_awbs_detail(
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    customer_id: Optional[str] = None,
    region: Optional[str] = None,
    status: Optional[str] = None,
    fleet_type: Optional[str] = None,
    armada_type: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    user: dict = Depends(get_current_user),
):
    q = await _build_awb_filter(period_from, period_to, customer_id, region, status, fleet_type, armada_type, search)
    total = await db.awb_orders.count_documents(q)
    sort_field = sort_by if sort_by in {"created_at", "awb_number", "grand_total", "total_tariff", "status"} else "created_at"
    sort_d = -1 if str(sort_dir).lower() == "desc" else 1
    skip = max(0, (page - 1) * page_size)
    cursor = db.awb_orders.find(q).sort(sort_field, sort_d).skip(skip).limit(min(page_size, 200))
    awbs = await cursor.to_list(page_size)
    # Get costs aggregate per AWB & primary vendor
    awb_ids = [a["_id"] for a in awbs]
    cost_agg: dict = {}
    primary_vendor: dict = {}
    if awb_ids:
        async for c in db.awb_costs.find({"awb_id": {"$in": awb_ids}}):
            cost_agg[c["awb_id"]] = cost_agg.get(c["awb_id"], 0) + float(c.get("amount", 0))
            if c["awb_id"] not in primary_vendor and c.get("vendor_name"):
                primary_vendor[c["awb_id"]] = c["vendor_name"]
    # Customer names
    cust_ids = list({a.get("customer_id") for a in awbs if a.get("customer_id")})
    cust_map = {}
    if cust_ids:
        async for c in db.customers.find({"_id": {"$in": cust_ids}}):
            cust_map[c["_id"]] = c.get("name", "?")
    rows = []
    for a in awbs:
        costs = cost_agg.get(a["_id"], 0)
        selling = float(a.get("total_tariff", 0))
        margin = selling - costs
        rows.append({
            "id": str(a["_id"]),
            "awb_number": a.get("awb_number"),
            "wo_number": a.get("wo_number"),
            "pickup_date": a.get("created_at"),
            "customer_name": cust_map.get(a.get("customer_id"), "-"),
            "destination": a.get("destination"),
            "destination_city": a.get("destination_city"),
            "region": a.get("region"),
            "fleet_type": a.get("fleet_type"),
            "armada_type": a.get("armada_type"),
            "intracity": a.get("intracity"),
            "vendor_name": primary_vendor.get(a["_id"]),
            "items_count": len(a.get("items", [])),
            "qty_kg": a.get("qty_kg") or 0,
            "selling": selling,
            "ppn": float(a.get("tax_amount", 0)),
            "inv_ppn": float(a.get("grand_total", 0)),
            "cashback": float(a.get("cashback_amount") or 0),
            "pph_final": float(a.get("pph_final") or 0),
            "total_costs": round(costs, 2),
            "margin": round(margin, 2),
            "margin_pct": round((margin / selling * 100) if selling > 0 else 0, 2),
            "status": a.get("status"),
            "external_invoice": a.get("external_invoice_number"),
            "paid_at": a.get("paid_at"),
        })
    return {"page": page, "page_size": page_size, "total": total, "rows": rows}

