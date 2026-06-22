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
from fastapi.responses import JSONResponse, FileResponse
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
        elif isinstance(v, list):
            doc[k] = [str(x) if isinstance(x, ObjectId) else (x.isoformat() if isinstance(x, datetime) else x) for x in v]
    return doc

# ----- PPh withholding helpers (sprint 1) ---------------------------------
# Maps the vendor master `pph_type` to the applicable withholding rate and COA.
PPH_RATES = {
    "PPh23": (0.02, "2223", "PPh 23"),       # Jasa, sewa, dll
    "PPh15": (0.02, "2223", "PPh 15"),       # Jasa pelayaran/penerbangan
    "PP23UMKM": (0.005, "2223", "PPh Final UMKM (PP 23)"),
}

def pph_info_for_vendor(vendor_doc: Optional[dict]):
    """Return (rate, account_code, label). Rate=0 means no deduction."""
    if not vendor_doc:
        return (0.0, "2223", "")
    pt = vendor_doc.get("pph_type")
    if not pt or pt not in PPH_RATES:
        return (0.0, "2223", "")
    return PPH_RATES[pt]

def fmt_idr(n: float) -> str:
    """Minimal IDR formatter used inside journal memo strings."""
    try:
        return f"Rp {int(round(n)):,}".replace(",", ".")
    except Exception:
        return f"Rp {n}"

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
    # ---- Optional modules (toggled globally via feature flags). Permission per-user is still required. ----
    {"key": "accounting", "label": "Akunting (PSAK)", "default_roles": ["finance"], "is_feature": True},
    {"key": "hr", "label": "HR & Payroll", "default_roles": [], "is_feature": True},
    {"key": "tax", "label": "Perpajakan (PPN/PPh)", "default_roles": [], "is_feature": True},
    {"key": "asset", "label": "Aset Tetap & Depresiasi", "default_roles": [], "is_feature": True},
    {"key": "bank_recon", "label": "Rekonsiliasi Bank", "default_roles": [], "is_feature": True},
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
    via: Optional[Literal["D", "L", "U"]] = None  # Darat / Laut / Udara
    minimum_kg: Optional[float] = None  # minimum berat untuk perhitungan tarif

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
    # --- New fields (manual input) ---
    awb_number: Optional[str] = None         # if not given, auto-generate
    reff_no: Optional[str] = None
    company_name: Optional[str] = None       # PT. Abirama Mitra Pradana / Pratama
    pickup_date: Optional[str] = None        # YYYY-MM-DD; if not given, today
    consignee: Optional[str] = None
    service: Optional[Literal["LCL", "FCL", "LTL", "FTL", "AIR", "Lumpsum"]] = None
    is_charter: Optional[bool] = False  # FTL/FCL/Lumpsum = charter (single price tanpa berat pengali)
    charter_amount: Optional[float] = None  # total rupiah jika is_charter
    sender_name: Optional[str] = None  # Pengirim (freetext with memory)
    via: Optional[Literal["D", "L", "U"]] = None
    status_pengiriman: Optional[Literal["Reguler", "Project", ""]] = None
    koli_count: Optional[int] = None
    koli_qty_per: Optional[str] = None
    armada: Optional[str] = None
    driver_name: Optional[str] = None
    nopol: Optional[str] = None
    insurance_enabled: Optional[bool] = False
    polis_amount: Optional[float] = None  # Nilai Polis (IDR) — penambah total invoice
    insurance_amount: Optional[float] = None  # Nilai Asuransi (IDR) — penambah total invoice

class CostIn(BaseModel):
    awb_id: str
    cost_category: Literal["Operational", "Lintas", "Vendor", "Marketing"]
    amount: float
    description: Optional[str] = None
    vendor_name: Optional[str] = None
    cash_account_code: Optional[str] = None  # for Cash payments (Operational/Lintas/Marketing) — defaults to 1101

class SettleIn(BaseModel):
    cash_account_code: Optional[str] = None  # which cash account paid the vendor; default 1101

class SettingIn(BaseModel):
    key_name: Optional[str] = None
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
    payment_invoice_number: Optional[str] = None  # nomor invoice yang dibayar (eksternal)
    paid_date: Optional[str] = None  # YYYY-MM-DD; if not given, today

class ReceiveAwbIn(BaseModel):
    """Tanggal Terima — Barang Diterima form."""
    received_date: Optional[str] = None  # YYYY-MM-DD; default today
    received_by_name: str
    polis_enabled: Optional[bool] = False  # checkbox; default OFF — UI auto-on if order has value
    polis_amount: Optional[float] = None
    asuransi_enabled: Optional[bool] = False  # checkbox; default OFF — UI auto-on if order has value
    asuransi_amount: Optional[float] = None
    spsi_enabled: Optional[bool] = False
    spsi_amount: Optional[float] = None
    sewa_forklift_enabled: Optional[bool] = False
    sewa_forklift_amount: Optional[float] = None
    work_type: Literal["Kirim Barang", "Dismantle Barang", "Relokasi Barang"]
    mode: Literal["Air", "Trucking", "Konsul"]

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
    {"code": "2221", "name": "Hutang PPh 21", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "2223", "name": "Hutang PPh 23", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "2230", "name": "Hutang PPN Kurang Bayar", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "2390", "name": "Pendapatan Belum Diakui (Unearned Revenue)", "type": "liability", "subtype": "current_liability", "normal": "credit", "is_system": True},
    {"code": "1290", "name": "Pendapatan Yang Masih Harus Diterima (PYMHD)", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_system": True},
    {"code": "1401", "name": "PPN Masukan", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_system": True},
    {"code": "1402", "name": "PPN Lebih Bayar / Kompensasi", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_system": True},
    # 3xxx - EKUITAS
    {"code": "3101", "name": "Modal Disetor", "type": "equity", "subtype": "equity", "normal": "credit", "is_system": True},
    {"code": "3201", "name": "Laba Ditahan", "type": "equity", "subtype": "equity", "normal": "credit", "is_system": True},
    # 4xxx - PENDAPATAN
    {"code": "4101", "name": "Pendapatan Jasa Pengangkutan", "type": "revenue", "subtype": "revenue", "normal": "credit", "is_system": True},
    # 5xxx - HPP (COGS)
    {"code": "5101", "name": "Beban Vendor Logistik", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5102", "name": "Beban Operasional Pengiriman", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5103", "name": "Beban Lintas", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5104", "name": "Beban Marketing (COGS)", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "5105", "name": "Beban Panjar Kerja", "type": "cogs", "subtype": "cogs", "normal": "debit", "is_system": True},
    {"code": "1108", "name": "Panjar Kerja", "type": "asset", "subtype": "current_asset", "normal": "debit", "is_system": True},
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
COST_CATEGORY_TO_COA = {"Vendor": "5101", "Operational": "5102", "Lintas": "5103", "Marketing": "5104"}

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
    extra_fields: Optional[dict] = None,
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
    if extra_fields:
        doc.update(extra_fields)
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
    await db.petty_cash.create_index("number")
    await db.purchase_orders.create_index("number")
    await db.sender_memory.create_index([("customer_id", 1), ("name", 1)], unique=True)

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

    # Tax settings (default 0/1/11). PPN 12 dipensiunkan per request user iter-10.
    await db.settings.delete_many({"key_name": "tax_ppn_12"})  # migrate: drop legacy if present
    for key, val in [("tax_ppn_0", "0"), ("tax_ppn_1", "1"), ("tax_ppn_11", "11")]:
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
    # Per-issuer-company settings (Pradana / Pratama) — signer & address & bank
    for k, v in [
        ("signer_PT. Abirama Mitra Pradana", ""),
        ("signer_PT. Abirama Mitra Pratama", ""),
        ("address_PT. Abirama Mitra Pradana", ""),
        ("address_PT. Abirama Mitra Pratama", ""),
        ("npwp_PT. Abirama Mitra Pradana", ""),
        ("npwp_PT. Abirama Mitra Pratama", ""),
        # Bank info per issuer (untuk invoice template)
        ("bank_name_PT. Abirama Mitra Pradana", "Mandiri"),
        ("bank_name_PT. Abirama Mitra Pratama", "Mandiri"),
        ("bank_holder_PT. Abirama Mitra Pradana", "Abirama Mitra Pradana"),
        ("bank_holder_PT. Abirama Mitra Pratama", "Abirama Mitra Pratama"),
        ("bank_account_PT. Abirama Mitra Pradana", ""),
        ("bank_account_PT. Abirama Mitra Pratama", ""),
        # Logo (base64 PNG/JPG)
        ("invoice_logo_b64", ""),
    ]:
        await db.settings.update_one(
            {"key_name": k},
            {"$setOnInsert": {"key_name": k, "key_value": v}},
            upsert=True,
        )

    # Sample/Demo data — STRICTLY opt-in.
    # Demo data is ONLY seeded when env var SEED_DEMO_DATA=true (default: false).
    # This prevents data overwrite on backend restart after feature updates.
    if os.environ.get("SEED_DEMO_DATA", "false").lower() not in ("true", "1", "yes"):
        return

    # Also respect the legacy skip_dummy_seed flag (set after wipe)
    skip_dummy = await db.settings.find_one({"key_name": "skip_dummy_seed"})
    if skip_dummy:
        return

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
        s["customer_id"] = str(d["customer_id"]) if d.get("customer_id") else None
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

async def recognize_revenue_for_awb(awb_id, user_id: str, trigger_date: Optional[datetime] = None) -> dict:
    """Idempotent revenue recognition for an AWB.

    Posts: DR 2390 Pendapatan Belum Diakui / CR 4101 Pendapatan Jasa Pengangkutan
    Sets order.revenue_recognized=True so subsequent triggers (cost add, reconcile,
    invoice create) won't double-post.
    """
    oid = awb_id if isinstance(awb_id, ObjectId) else _oid(awb_id)
    awb = await db.awb_orders.find_one({"_id": oid})
    if not awb:
        return {"ok": False, "reason": "AWB not found"}
    if awb.get("revenue_recognized"):
        return {"ok": True, "recognized": False, "reason": "already recognized"}
    dpp = float(awb.get("total_tariff") or 0)
    if dpp <= 0:
        await db.awb_orders.update_one({"_id": oid}, {"$set": {"revenue_recognized": True}})
        return {"ok": True, "recognized": False, "reason": "zero amount"}
    date = trigger_date or datetime.now(timezone.utc)
    try:
        await post_journal(
            date=date,
            description=f"Pengakuan revenue {awb['awb_number']} (jasa dilaksanakan)",
            lines=[
                {"account_code": "2390", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                {"account_code": "4101", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
            ],
            reference_type="awb_revenue_recognition",
            reference_id=str(oid),
            posted_by=user_id,
        )
    except HTTPException as e:
        # Period locked → retry with today's date so recognition still happens.
        if e.status_code in (400, 423) and "terkunci" in str(e.detail).lower():
            await post_journal(
                date=datetime.now(timezone.utc),
                description=f"Pengakuan revenue {awb['awb_number']} (period {date.strftime('%Y-%m')} locked)",
                lines=[
                    {"account_code": "2390", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                    {"account_code": "4101", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
                ],
                reference_type="awb_revenue_recognition",
                reference_id=str(oid),
                posted_by=user_id,
            )
        else:
            raise
    await db.awb_orders.update_one(
        {"_id": oid},
        {"$set": {"revenue_recognized": True, "revenue_recognized_at": date}},
    )
    return {"ok": True, "recognized": True, "amount": dpp}

@app.post("/api/orders")
async def create_order(data: OrderIn, user: dict = Depends(require_role("operation"))):
    # Koli mandatory
    if data.koli_count is None or int(data.koli_count) <= 0:
        raise HTTPException(400, "Koli wajib diisi (lebih dari 0)")
    # Charter handling: FTL/FCL/Lumpsum = single rupiah price tanpa berat pengali
    is_charter = bool(data.is_charter) or (data.service in ("FTL", "FCL", "Lumpsum"))
    if is_charter:
        charter_amt = float(data.charter_amount or 0)
        if charter_amt <= 0:
            # fallback: use tariff_per_kg directly (treat as total amount)
            charter_amt = float(data.tariff_per_kg or 0)
        total = round(charter_amt, 2)
        # qty_kg & tariff_per_kg meaning shifts: store 0/charter for clarity
        qty_kg_val = 0.0
        tariff_val = charter_amt
    else:
        total = round(data.tariff_per_kg * data.qty_kg, 2)
        qty_kg_val = data.qty_kg
        tariff_val = data.tariff_per_kg
    tax_amt = round(total * data.tax_percentage / 100, 2)
    # AWB number: manual takes precedence; check uniqueness
    awb_no = (data.awb_number or "").strip() or await next_awb_number()
    if data.awb_number:
        if await db.awb_orders.find_one({"awb_number": awb_no}):
            raise HTTPException(400, f"Nomor AWB '{awb_no}' sudah dipakai")
    # Pickup / created date — preserve millisecond ordering by appending current time
    if data.pickup_date:
        try:
            y, m, d = [int(x) for x in data.pickup_date.split("-")]
            now = datetime.now(timezone.utc)
            created_at = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "pickup_date harus YYYY-MM-DD")
    else:
        created_at = datetime.now(timezone.utc)
    status_p = (data.status_pengiriman or "").strip() or None
    sender = (data.sender_name or "").strip() or None
    doc = {
        "awb_number": awb_no,
        "reff_no": (data.reff_no or "").strip() or None,
        "company_name": data.company_name,
        "consignee": (data.consignee or "").strip() or None,
        "sender_name": sender,
        "customer_id": _oid(data.customer_id),
        "contract_id": _oid(data.contract_id) if data.contract_id else None,
        "item_description": data.item_description,
        "goods_content": data.goods_content,
        "origin": data.origin,
        "destination": data.destination,
        "service": data.service,
        "via": data.via,
        "status_pengiriman": status_p,
        "is_charter": is_charter,
        "charter_amount": float(data.charter_amount or 0) if is_charter else 0,
        "tariff_per_kg": tariff_val,
        "qty_kg": qty_kg_val,
        "total_tariff": total,
        "tax_percentage": data.tax_percentage,
        "tax_amount": tax_amt,
        "grand_total": round(total + tax_amt, 2),
        "koli_count": int(data.koli_count),
        "koli_qty_per": (data.koli_qty_per or "").strip() or None,
        "armada": (data.armada or "").strip() or None,
        "driver_name": (data.driver_name or "").strip() or None,
        "nopol": (data.nopol or "").strip() or None,
        "insurance_enabled": bool(data.insurance_enabled),
        "polis_amount": float(data.polis_amount or 0) if data.insurance_enabled else 0,
        "insurance_amount": float(data.insurance_amount or 0) if data.insurance_enabled else 0,
        "status": "Open",
        "revenue_recognized": False,
        "created_by": user["id"],
        "created_at": created_at,
    }
    r = await db.awb_orders.insert_one(doc)
    # Save sender to memory (pengirim suggestions)
    if sender and data.customer_id:
        try:
            await db.sender_memory.update_one(
                {"customer_id": _oid(data.customer_id), "name": sender},
                {"$set": {"customer_id": _oid(data.customer_id), "name": sender, "last_used": datetime.now(timezone.utc)},
                 "$inc": {"use_count": 1}},
                upsert=True,
            )
        except Exception:
            pass
    new = await db.awb_orders.find_one({"_id": r.inserted_id})
    # Auto-post journal (PYMHD model — PSAK 72): order belum diakui revenue.
    # DR  1290 PYMHD (Pendapatan Yang Masih Harus Diterima)  = DPP
    #     CR  2390 Pendapatan Belum Diakui (Unearned Revenue) = DPP
    # PPN belum di-post karena Faktur Pajak baru terbit saat invoice dibuat.
    try:
        await post_journal(
            date=doc["created_at"],
            description=f"PYMHD - Order {doc['awb_number']} (belum diakui revenue)",
            lines=[
                {"account_code": "1290", "debit": doc["total_tariff"], "credit": 0, "memo": doc["awb_number"]},
                {"account_code": "2390", "debit": 0, "credit": doc["total_tariff"], "memo": doc["awb_number"]},
            ],
            reference_type="awb_order_pymhd",
            reference_id=str(r.inserted_id),
            posted_by=user["id"],
        )
    except HTTPException as e:
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
    elif data.cost_category in ("Operational", "Lintas", "Marketing"):
        if not (is_admin or role == "finance"):
            raise HTTPException(403, "Hanya role Finance/Administrator yang dapat input biaya Operational/Lintas/Marketing")
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
    # PSAK 72 trigger: this is the first sign vendor delivered the service → recognize revenue.
    try:
        await recognize_revenue_for_awb(doc["awb_id"], user["id"], trigger_date=doc["created_at"])
    except Exception as e:
        new["revenue_recognition_warning"] = str(e)
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

    # ---- PPh 23 auto-deduction (sprint 1) ----
    # Look up the vendor master by name and apply withholding tax if pph_type is set.
    vendor_name = cost.get("vendor_name") or ""
    vendor_doc = None
    if vendor_name:
        vendor_doc = await db.vendors.find_one({"name": vendor_name})
    pph_rate, pph_account, pph_type_label = pph_info_for_vendor(vendor_doc)
    gross = float(cost["amount"])
    pph_amount = round(gross * pph_rate, 2) if pph_rate > 0 else 0.0
    net_paid = round(gross - pph_amount, 2)

    update = {
        "payment_type": "Cash",
        "is_settled": True,
        "settled_at": now,
        "settled_by": user["id"],
        "cash_account_code": cash_acc,
    }
    if pph_amount > 0:
        update.update({"pph_type": pph_type_label, "pph_rate": pph_rate, "pph_amount": pph_amount, "net_paid": net_paid})
    await db.awb_costs.update_one({"_id": _oid(cid)}, {"$set": update})

    # Auto-post journal: DR Hutang Usaha (gross) / CR Cash (net) / CR Hutang PPh (potongan)
    try:
        awb = await db.awb_orders.find_one({"_id": cost["awb_id"]})
        awb_no = awb["awb_number"] if awb else ""
        lines = [
            {"account_code": "2101", "debit": gross, "credit": 0, "memo": vendor_name},
            {"account_code": cash_acc, "debit": 0, "credit": net_paid, "memo": f"Settle {awb_no}"},
        ]
        desc = f"Pelunasan hutang vendor {vendor_name} ({awb_no})"
        if pph_amount > 0:
            lines.append({"account_code": pph_account, "debit": 0, "credit": pph_amount, "memo": f"{pph_type_label} {pph_rate*100:.1f}% dari {vendor_name}"})
            desc += f" — dipotong {pph_type_label} {fmt_idr(pph_amount)}"
            # Audit trail in db.pph_records for the Tax module
            await db.pph_records.insert_one({
                "period_month": now.strftime("%Y-%m"),
                "pph_type": pph_type_label,
                "rate": pph_rate,
                "description": f"Potongan dari {vendor_name} atas {awb_no} (cost {cid})",
                "vendor_name": vendor_name,
                "vendor_id": str(vendor_doc["_id"]) if vendor_doc else None,
                "awb_number": awb_no,
                "cost_id": cid,
                "gross": gross,
                "amount": pph_amount,
                "auto_generated": True,
                "created_by": user["id"],
                "created_at": now,
            })
        await post_journal(
            date=now,
            description=desc,
            lines=lines,
            reference_type="settlement", reference_id=cid, posted_by=user["id"],
        )
    except HTTPException as e:
        return {"ok": True, "journal_warning": e.detail, "pph_amount": pph_amount, "net_paid": net_paid}
    return {"ok": True, "pph_type": pph_type_label, "pph_rate": pph_rate, "pph_amount": pph_amount, "net_paid": net_paid, "gross": gross}

@app.delete("/api/costs/{cid}")
async def delete_cost(cid: str, confirm: bool = False, user: dict = Depends(get_current_user)):
    cost = await db.awb_costs.find_one({"_id": _oid(cid)})
    if not cost:
        raise HTTPException(404, "Biaya tidak ditemukan")
    # operation can only delete their own vendor (unsettled), finance can delete any cash, admin can delete any
    if user["role"] == "administrator":
        pass
    elif user["role"] == "operation" and cost["cost_category"] != "Vendor":
        raise HTTPException(403, "Tidak diizinkan")
    awb_id = cost["awb_id"]
    awb = await db.awb_orders.find_one({"_id": awb_id})
    # Is this the LAST cost of the AWB? If yes, deletion will reverse revenue recognition.
    other_costs = await db.awb_costs.count_documents({"_id": {"$ne": _oid(cid)}, "awb_id": awb_id})
    is_last = (other_costs == 0)

    # Warning gate: require explicit confirm=true when last cost AND revenue already recognized.
    if is_last and awb and awb.get("revenue_recognized") and not confirm:
        return {
            "ok": False,
            "needs_confirmation": True,
            "warning": (
                f"Cost ini adalah COST TERAKHIR pada AWB {awb['awb_number']}. "
                f"Menghapusnya akan MEMBALIK pengakuan pendapatan (revenue recognition) "
                f"sebesar Rp {int(awb.get('total_tariff') or 0):,} kembali ke status PYMHD. "
                f"Lanjutkan dengan mengirim ulang DELETE menambahkan parameter ?confirm=true."
            ).replace(",", "."),
            "awb_number": awb["awb_number"],
            "reversal_amount": float(awb.get("total_tariff") or 0),
        }

    # Delete the cost document
    await db.awb_costs.delete_one({"_id": _oid(cid)})
    # Delete cost's own journal entries (cascade)
    await db.journal_entries.delete_many({"reference_type": "cost", "reference_id": cid})

    reversal_info = None
    # If last cost AND AWB has been recognized AND NOT yet invoiced → reverse recognition.
    if is_last and awb and awb.get("revenue_recognized"):
        already_invoiced = await db.invoices.find_one({"awb_id": awb_id})
        if not already_invoiced:
            now = datetime.now(timezone.utc)
            dpp = float(awb.get("total_tariff") or 0)
            # Post REVERSAL journal with explicit is_reversal flag for audit trail.
            try:
                await post_journal(
                    date=now,
                    description=f"REVERSAL — Pembatalan pengakuan revenue {awb['awb_number']} (cost terakhir dihapus)",
                    lines=[
                        {"account_code": "4101", "debit": dpp, "credit": 0, "memo": f"Reversal {awb['awb_number']}"},
                        {"account_code": "2390", "debit": 0, "credit": dpp, "memo": f"Reversal {awb['awb_number']}"},
                    ],
                    reference_type="awb_revenue_reversal",
                    reference_id=str(awb_id),
                    posted_by=user["id"],
                    extra_fields={"is_reversal": True, "reversed_awb": awb["awb_number"]},
                )
                await db.awb_orders.update_one(
                    {"_id": awb_id},
                    {
                        "$set": {"revenue_recognized": False},
                        "$unset": {"revenue_recognized_at": ""},
                    },
                )
                reversal_info = {
                    "reversed": True,
                    "amount": dpp,
                    "awb_number": awb["awb_number"],
                    "message": f"Revenue recognition Rp {int(dpp):,} dibalik kembali ke PYMHD untuk {awb['awb_number']}.".replace(",", "."),
                }
            except HTTPException as e:
                reversal_info = {"reversed": False, "error": str(e.detail)}
    return {"ok": True, "reversal": reversal_info}

# ---------------------------------------------------------------------------
# Recap & Reconciliation (Module 3 & 4)
# ---------------------------------------------------------------------------
class ReconcileIn(BaseModel):
    awb_ids: List[str]

@app.post("/api/orders/reconcile")
async def reconcile_orders(data: ReconcileIn, user: dict = Depends(require_role("operation"))):
    ids = [_oid(i) for i in data.awb_ids]
    # Only AWBs that have at least 1 cost can be reconciled
    cost_doc = await db.awb_costs.aggregate([
        {"$match": {"awb_id": {"$in": ids}}},
        {"$group": {"_id": "$awb_id"}},
    ]).to_list(10000)
    awb_with_cost = {d["_id"] for d in cost_doc}
    # NEW: also enforce "barang sudah diterima" before reconcile
    awbs_all = await db.awb_orders.find({"_id": {"$in": ids}}).to_list(20000)
    not_received = [a["awb_number"] for a in awbs_all if not a.get("received_at")]
    if not_received:
        raise HTTPException(400, f"Barang belum diterima — tidak boleh direkonsiliasi: {', '.join(not_received[:5])}{'...' if len(not_received) > 5 else ''}")
    valid_ids = [i for i in ids if i in awb_with_cost]
    skipped = len(ids) - len(valid_ids)
    if not valid_ids:
        raise HTTPException(400, "Tidak ada AWB yang siap direkonsiliasi (semua belum punya biaya/cost)")

    # PSAK 72 + Excel-import flow: AWB yang sudah punya invoice doc (dari Excel)
    # langsung dipromote ke "Invoiced", BUKAN "Reconciled". Otomatis post invoice
    # clearance journal: DR 1201 / CR 1290 / CR 2210. User tidak perlu lagi klik
    # "Create Invoice" untuk AWB tsb.
    now = datetime.now(timezone.utc)
    awbs = await db.awb_orders.find({"_id": {"$in": valid_ids}, "status": "Open"}).to_list(20000)
    promoted_to_invoiced = 0
    promoted_to_reconciled = 0
    for awb in awbs:
        awb_id = awb["_id"]
        invoice_doc = await db.invoices.find_one({"awb_id": awb_id})
        # Defensive recognition first
        try:
            await recognize_revenue_for_awb(awb_id, user["id"])
        except Exception:
            pass
        if invoice_doc:
            # Already has invoice doc → fast-track to Invoiced + post invoice journal
            await db.awb_orders.update_one(
                {"_id": awb_id},
                {"$set": {"status": "Invoiced", "reconciled_at": now, "invoiced_at": now}},
            )
            # Post invoice clearance journal (DR 1201 / CR 1290 / CR 2210) — only if
            # not yet posted (idempotent via reference_type check).
            already_posted = await db.journal_entries.find_one({
                "reference_type": "invoice", "reference_id": str(invoice_doc["_id"])
            })
            if not already_posted:
                try:
                    dpp = float(awb.get("total_tariff") or 0)
                    tax = float(awb.get("tax_amount") or 0)
                    gross = round(dpp + tax, 2)
                    inv_lines = [
                        {"account_code": "1201", "debit": gross, "credit": 0, "memo": invoice_doc.get("invoice_number") or awb["awb_number"]},
                        {"account_code": "1290", "debit": 0, "credit": dpp, "memo": f"Clear PYMHD {awb['awb_number']}"},
                    ]
                    if tax > 0:
                        inv_lines.append({"account_code": "2210", "debit": 0, "credit": tax, "memo": f"PPN — {awb['awb_number']}"})
                    await post_journal(
                        date=now,
                        description=f"Invoice {invoice_doc.get('invoice_number') or awb['awb_number']} - {awb['awb_number']}",
                        lines=inv_lines,
                        reference_type="invoice",
                        reference_id=str(invoice_doc["_id"]),
                        posted_by=user["id"],
                    )
                except HTTPException:
                    pass
            promoted_to_invoiced += 1
        else:
            await db.awb_orders.update_one(
                {"_id": awb_id},
                {"$set": {"status": "Reconciled", "reconciled_at": now}},
            )
            promoted_to_reconciled += 1
    return {
        "updated": promoted_to_invoiced + promoted_to_reconciled,
        "skipped_no_cost": skipped,
        "promoted_to_invoiced": promoted_to_invoiced,
        "promoted_to_reconciled": promoted_to_reconciled,
    }

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

class BulkRevertIn(BaseModel):
    awb_ids: List[str]

@app.post("/api/orders/bulk-revert-to-open")
async def bulk_revert_to_open(data: BulkRevertIn, user: dict = Depends(require_role("operation"))):
    ids = [_oid(i) for i in data.awb_ids]
    res = await db.awb_orders.update_many(
        {"_id": {"$in": ids}, "status": "Reconciled"},
        {"$set": {"status": "Open"}, "$unset": {"reconciled_at": ""}},
    )
    return {"updated": res.modified_count}

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
    now = datetime.now(timezone.utc)
    doc = {
        "awb_id": o["_id"],
        "awb_ids": [o["_id"]],  # multi-AWB support
        "invoice_number": await next_invoice_number(),
        "created_at": now,           # tanggal create (nomor invoice diterbitkan)
        "invoice_date": None,        # tanggal cetak (diisi saat klik cetak pertama)
        "first_printed_at": None,
        "print_count": 0,
        "ar_recognized": False,      # piutang baru tercatat saat klik cetak
        "created_by": user["id"],
    }
    r = await db.invoices.insert_one(doc)
    await db.awb_orders.update_one(
        {"_id": o["_id"]},
        {"$set": {"status": "Invoiced", "invoiced_at": now}},
    )
    # Defensive: make sure revenue is recognized before invoice creation
    try:
        await recognize_revenue_for_awb(o["_id"], user["id"])
    except Exception:
        pass
    # NOTE: AR journal (DR 1201 / CR 1290 / CR 2210) DIPINDAH ke saat PRINT pertama.
    new = await db.invoices.find_one({"_id": r.inserted_id})
    return serialize(new)

class InvoiceBulkIn(BaseModel):
    awb_ids: List[str]
    grouped: Optional[List[List[str]]] = None  # optional: list of lists, each list = 1 invoice (multi-AWB)

@app.post("/api/invoices/bulk")
async def create_invoice_bulk(data: InvoiceBulkIn, user: dict = Depends(require_role("operation"))):
    created = []
    skipped = []
    now = datetime.now(timezone.utc)

    # If "grouped" provided: each group becomes 1 invoice (multi-AWB); rest individual.
    groups: List[List[str]] = []
    grouped_ids = set()
    if data.grouped:
        for g in data.grouped:
            if g and len(g) > 0:
                groups.append(g)
                grouped_ids.update(g)
    # Individual = AWBs not in any group
    individuals = [sid for sid in data.awb_ids if sid not in grouped_ids]
    for sid in individuals:
        groups.append([sid])

    for group_ids in groups:
        # Validate each AWB in this group
        valid_awbs = []
        group_skipped = False
        cust_id_check = None
        for sid in group_ids:
            try:
                oid = _oid(sid)
            except Exception:
                skipped.append({"awb_id": sid, "reason": "invalid id"})
                group_skipped = True
                break
            o = await db.awb_orders.find_one({"_id": oid})
            if not o:
                skipped.append({"awb_id": sid, "reason": "not found"})
                group_skipped = True
                break
            existing = await db.invoices.find_one({"$or": [{"awb_id": o["_id"]}, {"awb_ids": o["_id"]}]})
            if existing:
                skipped.append({"awb_id": sid, "reason": "already invoiced", "invoice_number": existing["invoice_number"]})
                group_skipped = True
                break
            if o["status"] != "Reconciled":
                skipped.append({"awb_id": sid, "reason": f"status={o['status']}"})
                group_skipped = True
                break
            # multi-AWB invoice → all AWBs must be same customer
            if cust_id_check is None:
                cust_id_check = o.get("customer_id")
            elif cust_id_check != o.get("customer_id"):
                skipped.append({"awb_id": sid, "reason": "customer berbeda — tidak bisa digabung dalam 1 invoice"})
                group_skipped = True
                break
            valid_awbs.append(o)
        if group_skipped or not valid_awbs:
            continue

        invoice_no = await next_invoice_number()
        doc = {
            "awb_id": valid_awbs[0]["_id"],  # primary (back-compat)
            "awb_ids": [a["_id"] for a in valid_awbs],
            "invoice_number": invoice_no,
            "created_at": now,
            "invoice_date": None,
            "first_printed_at": None,
            "print_count": 0,
            "ar_recognized": False,
            "created_by": user["id"],
        }
        r = await db.invoices.insert_one(doc)
        for a in valid_awbs:
            await db.awb_orders.update_one(
                {"_id": a["_id"]},
                {"$set": {"status": "Invoiced", "invoiced_at": now}},
            )
            try:
                await recognize_revenue_for_awb(a["_id"], user["id"])
            except Exception:
                pass
        # NOTE: AR journal moved to PRINT time
        created.append({
            "awb_ids": [str(a["_id"]) for a in valid_awbs],
            "awb_numbers": [a["awb_number"] for a in valid_awbs],
            "invoice_number": invoice_no,
            "id": str(r.inserted_id),
        })
    return {"created": created, "skipped": skipped, "created_count": len(created), "skipped_count": len(skipped)}

@app.get("/api/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    docs = await db.invoices.find().sort("created_at", -1).to_list(2000)
    # Gather all referenced awb_ids (multi-AWB safe)
    all_awb_ids = set()
    for d in docs:
        if d.get("awb_id"):
            all_awb_ids.add(d["awb_id"])
        for x in d.get("awb_ids") or []:
            all_awb_ids.add(x)
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": list(all_awb_ids)}}).to_list(5000)}
    cust_ids = list({a.get("customer_id") for a in amap.values()})
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(2000)}
    out = []
    for d in docs:
        s = serialize(d)
        # Multi-AWB aggregated
        awb_ids_list = d.get("awb_ids") or ([d["awb_id"]] if d.get("awb_id") else [])
        awbs_for_doc = [amap.get(x) for x in awb_ids_list if amap.get(x)]
        primary = awbs_for_doc[0] if awbs_for_doc else None
        s["awb_count"] = len(awbs_for_doc)
        s["awb_numbers"] = [a["awb_number"] for a in awbs_for_doc]
        s["awb_number"] = primary["awb_number"] if primary else None
        s["awb_status"] = primary["status"] if primary else None
        s["grand_total"] = sum(float(a.get("grand_total") or 0) for a in awbs_for_doc)
        s["total_tariff"] = sum(float(a.get("total_tariff") or 0) for a in awbs_for_doc)
        s["tax_amount"] = sum(float(a.get("tax_amount") or 0) for a in awbs_for_doc)
        s["company_name"] = primary.get("company_name") if primary else None
        s["customer_id"] = str(primary.get("customer_id")) if primary and primary.get("customer_id") else None
        c = cmap.get(primary.get("customer_id")) if primary else None
        s["customer_name"] = c["name"] if c else None
        out.append(s)
    return out

@app.get("/api/invoices/{iid}/full")
async def invoice_full(iid: str, user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"_id": _oid(iid)})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    # Support multi-AWB: gather all AWBs
    awb_ids_list = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
    awbs = await db.awb_orders.find({"_id": {"$in": awb_ids_list}}).to_list(100)
    # Primary AWB (back-compat)
    primary_awb = next((a for a in awbs if a["_id"] == inv.get("awb_id")), awbs[0] if awbs else None)
    cust = await db.customers.find_one({"_id": primary_awb["customer_id"]}) if primary_awb else None
    settings = {s["key_name"]: s["key_value"] for s in await db.settings.find().to_list(1000)}
    issuer = (primary_awb or {}).get("company_name") or ""
    return {
        "invoice": serialize(inv),
        "awb": serialize(primary_awb),
        "awbs": [serialize(a) for a in awbs],
        "customer": serialize(cust),
        "company": {
            "name": issuer or settings.get("company_name", ""),
            "npwp": settings.get(f"npwp_{issuer}") or settings.get("company_npwp", ""),
            "address": settings.get(f"address_{issuer}") or settings.get("company_address", ""),
            "signer": settings.get(f"signer_{issuer}", ""),
            "bank_name": settings.get(f"bank_name_{issuer}", "Mandiri"),
            "bank_holder": settings.get(f"bank_holder_{issuer}", issuer.replace("PT. ", "")),
            "bank_account": settings.get(f"bank_account_{issuer}", ""),
            "logo_b64": settings.get("invoice_logo_b64", ""),
        },
    }

class InvoicePrintIn(BaseModel):
    use_old_date: Optional[bool] = False  # if True (and previously printed) → reuse first_printed_at
    print_date: Optional[str] = None  # YYYY-MM-DD override

@app.post("/api/invoices/{iid}/mark-printed")
async def mark_invoice_printed(iid: str, data: InvoicePrintIn = InvoicePrintIn(), user: dict = Depends(get_current_user)):
    """Tandai invoice telah dicetak. PADA CETAK PERTAMA: post AR journal + set invoice_date.
    Pada cetak ulang: jika use_old_date=True → reuse tanggal lama. Jika False → update ke tanggal baru."""
    inv = await db.invoices.find_one({"_id": _oid(iid)})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    now = datetime.now(timezone.utc)
    if data.print_date:
        try:
            y, m, d = [int(x) for x in data.print_date.split("-")]
            print_dt = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "print_date harus YYYY-MM-DD")
    else:
        print_dt = now

    print_count = int(inv.get("print_count") or 0)
    first_printed_at = inv.get("first_printed_at")
    is_first = (print_count == 0 or not first_printed_at)

    new_invoice_date = inv.get("invoice_date") or print_dt
    if not is_first and data.use_old_date:
        # reuse old invoice_date — do nothing
        new_invoice_date = inv.get("invoice_date") or first_printed_at
    elif not is_first and not data.use_old_date:
        # update to new date
        new_invoice_date = print_dt

    upd = {
        "last_printed_at": print_dt,
        "print_count": print_count + 1,
        "invoice_date": new_invoice_date,
    }
    if is_first:
        upd["first_printed_at"] = print_dt

    # If first print → post AR journal (idempotent via reference_type)
    if is_first and not inv.get("ar_recognized"):
        awb_ids_list = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
        awbs = await db.awb_orders.find({"_id": {"$in": awb_ids_list}}).to_list(100)
        total_dpp = sum(float(a.get("total_tariff") or 0) for a in awbs)
        total_tax = sum(float(a.get("tax_amount") or 0) for a in awbs)
        gross = round(total_dpp + total_tax, 2)
        if gross > 0:
            lines = [
                {"account_code": "1201", "debit": gross, "credit": 0, "memo": inv["invoice_number"]},
                {"account_code": "1290", "debit": 0, "credit": total_dpp, "memo": f"Clear PYMHD {inv['invoice_number']}"},
            ]
            if total_tax > 0:
                lines.append({"account_code": "2210", "debit": 0, "credit": total_tax, "memo": f"PPN — {inv['invoice_number']}"})
            try:
                await post_journal(
                    date=print_dt,
                    description=f"Piutang & PPN — Invoice {inv['invoice_number']} dicetak",
                    lines=lines,
                    reference_type="invoice",
                    reference_id=str(inv["_id"]),
                    posted_by=user["id"],
                )
            except HTTPException:
                pass
        upd["ar_recognized"] = True

    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": upd})
    new = await db.invoices.find_one({"_id": inv["_id"]})
    return serialize(new)

@app.post("/api/invoices/{iid}/cancel")
async def cancel_invoice(iid: str, user: dict = Depends(require_role("operation"))):
    """Cancel invoice: kembalikan AWB ke Reconciled, hapus jurnal terkait, hapus invoice doc."""
    inv = await db.invoices.find_one({"_id": _oid(iid)})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    awb_ids_list = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
    # Refuse if any AWB is Paid
    paid_awbs = await db.awb_orders.find({"_id": {"$in": awb_ids_list}, "status": "Paid"}).to_list(100)
    if paid_awbs:
        raise HTTPException(400, f"Tidak bisa cancel — sudah ada AWB yang Paid: {', '.join(a['awb_number'] for a in paid_awbs)}")
    # Hapus invoice journal
    journal_count = (await db.journal_entries.delete_many({
        "reference_type": "invoice", "reference_id": str(inv["_id"])
    })).deleted_count
    # Kembalikan AWB ke Reconciled
    await db.awb_orders.update_many(
        {"_id": {"$in": awb_ids_list}},
        {"$set": {"status": "Reconciled"}, "$unset": {"invoiced_at": ""}}
    )
    # Hapus invoice doc
    await db.invoices.delete_one({"_id": inv["_id"]})
    return {
        "ok": True,
        "invoice_number": inv["invoice_number"],
        "awbs_reverted": [str(x) for x in awb_ids_list],
        "journals_deleted": journal_count,
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
    if data.paid_date:
        try:
            y, m, d = [int(x) for x in data.paid_date.split("-")]
            now = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "paid_date harus YYYY-MM-DD")
    else:
        now = datetime.now(timezone.utc)
    upd = {"status": "Paid", "paid_at": now, "paid_by": user["id"], "cash_account_code": cash_acc}
    if data.payment_invoice_number:
        upd["payment_invoice_number"] = data.payment_invoice_number.strip()
    await db.awb_orders.update_one({"_id": _oid(oid)}, {"$set": upd})
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

class BulkMarkPaidIn(BaseModel):
    awb_ids: List[str]
    cash_account_code: Optional[str] = None
    payment_invoice_number: Optional[str] = None
    paid_date: Optional[str] = None

@app.post("/api/orders/{oid}/receive")
async def receive_awb(oid: str, data: ReceiveAwbIn, user: dict = Depends(get_current_user)):
    """Mark AWB as Received (Barang Diterima) with checklist details."""
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if data.received_date:
        try:
            y, m, d = [int(x) for x in data.received_date.split("-")]
            rd = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "received_date harus YYYY-MM-DD")
    else:
        rd = datetime.now(timezone.utc)
    polis_eff = float(data.polis_amount or 0) if data.polis_enabled else 0
    asur_eff  = float(data.asuransi_amount or 0) if data.asuransi_enabled else 0
    upd = {
        "received_at": rd,
        "received_by_name": data.received_by_name.strip(),
        "received_polis_enabled": bool(data.polis_enabled),
        "received_polis_amount": polis_eff,
        "received_asuransi_enabled": bool(data.asuransi_enabled),
        "received_asuransi_amount": asur_eff,
        "spsi_enabled": bool(data.spsi_enabled),
        "spsi_amount": float(data.spsi_amount or 0) if data.spsi_enabled else 0,
        "sewa_forklift_enabled": bool(data.sewa_forklift_enabled),
        "sewa_forklift_amount": float(data.sewa_forklift_amount or 0) if data.sewa_forklift_enabled else 0,
        "work_type": data.work_type,
        "mode": data.mode,
        "received_by": user["id"],
    }
    await db.awb_orders.update_one({"_id": _oid(oid)}, {"$set": upd})
    # Auto-create awb_costs for SPSI / Sewa Forklift (Operational/Cash) so they show in cost plotting
    now = datetime.now(timezone.utc)
    for name, amt in [("SPSI", upd["spsi_amount"]), ("Sewa Forklift", upd["sewa_forklift_amount"])]:
        if amt > 0:
            # Avoid duplicates: delete any prior auto-created receive cost of same name
            await db.awb_costs.delete_many({"awb_id": _oid(oid), "source": "receive", "sub_label": name})
            cost_doc = {
                "awb_id": _oid(oid),
                "cost_category": "Operational",
                "amount": float(amt),
                "description": f"{name} (otomatis dari penerimaan)",
                "sub_label": name,
                "vendor_name": None,
                "payment_type": "Cash",
                "is_settled": True,
                "cash_account_code": "1101",
                "source": "receive",
                "created_by": user["id"],
                "created_at": now,
            }
            cr = await db.awb_costs.insert_one(cost_doc)
            try:
                await post_journal(
                    date=now,
                    description=f"{name} AWB {o['awb_number']} (penerimaan)",
                    lines=[
                        {"account_code": "5102", "debit": amt, "credit": 0, "memo": o["awb_number"]},
                        {"account_code": "1101", "debit": 0, "credit": amt, "memo": f"{name} {o['awb_number']}"},
                    ],
                    reference_type="awb_cost", reference_id=str(cr.inserted_id), posted_by=user["id"],
                )
            except HTTPException:
                pass
    return serialize(await db.awb_orders.find_one({"_id": _oid(oid)}))

@app.post("/api/payments/bulk-mark-paid")
async def bulk_mark_paid(data: BulkMarkPaidIn, user: dict = Depends(require_role("finance"))):
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    if data.paid_date:
        try:
            y, m, d = [int(x) for x in data.paid_date.split("-")]
            now = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "paid_date harus YYYY-MM-DD")
    else:
        now = datetime.now(timezone.utc)
    paid = []
    skipped = []
    pn = (data.payment_invoice_number or "").strip()
    for sid in data.awb_ids:
        try:
            oid = _oid(sid)
        except Exception:
            skipped.append({"awb_id": sid, "reason": "invalid id"})
            continue
        o = await db.awb_orders.find_one({"_id": oid})
        if not o:
            skipped.append({"awb_id": sid, "reason": "not found"})
            continue
        if o["status"] != "Invoiced":
            skipped.append({"awb_id": sid, "reason": f"status={o['status']}"})
            continue
        upd = {"status": "Paid", "paid_at": now, "paid_by": user["id"], "cash_account_code": cash_acc}
        if pn:
            upd["payment_invoice_number"] = pn
        await db.awb_orders.update_one({"_id": oid}, {"$set": upd})
        try:
            await post_journal(
                date=now,
                description=f"Penerimaan pelunasan invoice {o['awb_number']}" + (f" (Inv {pn})" if pn else ""),
                lines=[
                    {"account_code": cash_acc, "debit": o["grand_total"], "credit": 0, "memo": o["awb_number"]},
                    {"account_code": "1201", "debit": 0, "credit": o["grand_total"], "memo": o["awb_number"]},
                ],
                reference_type="payment", reference_id=sid, posted_by=user["id"],
            )
        except HTTPException:
            pass
        paid.append({"awb_id": sid, "awb_number": o["awb_number"], "amount": o["grand_total"]})
    return {"paid": paid, "skipped": skipped, "paid_count": len(paid), "skipped_count": len(skipped)}

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
@app.get("/api/tutorials/{role}")
async def download_tutorial(role: str, user: dict = Depends(get_current_user)):
    """Download tutorial PDF for a given role (operation/finance/administrator)
    or sales presentation (sales-pitch)."""
    role = role.lower()
    role_map = {
        "operation": ("tutorial_operation.pdf", "application/pdf"),
        "finance": ("tutorial_finance.pdf", "application/pdf"),
        "administrator": ("tutorial_administrator.pdf", "application/pdf"),
        "admin": ("tutorial_administrator.pdf", "application/pdf"),
        "sales-pitch": ("arc_sales_presentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    }
    if role not in role_map:
        raise HTTPException(404, f"Tutorial untuk '{role}' tidak tersedia.")
    fname, mime = role_map[role]
    # Try backend-bundled path first (production), fallback to root /app/static (preview/local)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "static", "tutorials", fname),
        f"/app/static/tutorials/{fname}",
    ]
    path = next((p for p in candidates if os.path.exists(p)), None)
    if not path:
        raise HTTPException(404, f"File '{fname}' belum tersedia. Hubungi administrator.")
    return FileResponse(path, media_type=mime, filename=fname)

@app.get("/api/dashboard/pymhd-pipeline")
async def pymhd_pipeline(user: dict = Depends(get_current_user)):
    """Return outstanding PYMHD balance: AWBs that have a PYMHD journal posted but
    have NOT been invoiced yet (i.e., still in pipeline). Grouped by customer and
    by status (Open / Reconciled).
    """
    # Get all AWBs that aren't invoiced and have total_tariff > 0
    awbs = await db.awb_orders.find({
        "status": {"$in": ["Open", "Reconciled"]},
    }).to_list(20000)

    cust_ids = list({a.get("customer_id") for a in awbs if a.get("customer_id")})
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(2000)}

    by_customer = {}
    by_status = {"Open": {"count": 0, "amount": 0.0}, "Reconciled": {"count": 0, "amount": 0.0}}
    total_amount = 0.0
    total_count = 0
    recognized_amount = 0.0   # already in revenue but waiting for invoice
    unrecognized_amount = 0.0 # still pure PYMHD (no cost yet)

    for a in awbs:
        amt = float(a.get("total_tariff") or 0)
        if amt <= 0:
            continue
        total_amount += amt
        total_count += 1
        status = a.get("status", "Open")
        if status in by_status:
            by_status[status]["count"] += 1
            by_status[status]["amount"] += amt
        if a.get("revenue_recognized"):
            recognized_amount += amt
        else:
            unrecognized_amount += amt
        c = cmap.get(a.get("customer_id"))
        cname = c["name"] if c else "(tanpa customer)"
        cust = by_customer.setdefault(cname, {"customer": cname, "count": 0, "amount": 0.0, "unrecognized": 0.0})
        cust["count"] += 1
        cust["amount"] += amt
        if not a.get("revenue_recognized"):
            cust["unrecognized"] += amt

    rows = sorted(by_customer.values(), key=lambda r: r["amount"], reverse=True)
    return {
        "total_count": total_count,
        "total_amount": round(total_amount, 2),
        "recognized_amount": round(recognized_amount, 2),       # has cost, waiting invoice
        "unrecognized_amount": round(unrecognized_amount, 2),   # no cost yet — pure PYMHD
        "by_status": by_status,
        "by_customer": rows,
    }

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
        # Per-user permission check (admin bypasses). Allows admin to grant module access selectively.
        if user.get("role") != "administrator":
            perms = user.get("permissions") or []
            if key not in perms:
                raise HTTPException(status_code=403, detail=f"Anda tidak memiliki izin untuk modul '{key}'. Hubungi administrator.")
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

class PpnMasukanIn(BaseModel):
    date: str                          # YYYY-MM-DD
    supplier_name: str
    no_faktur: Optional[str] = None
    dpp: float
    ppn_pct: float = 11.0
    expense_account_code: str = "6199"   # default: Beban Lainnya
    cash_account_code: str = "1101"      # default: Kas
    description: Optional[str] = None

@app.get("/api/tax/ppn-masukan")
async def list_ppn_masukan(period: Optional[str] = None, user: dict = Depends(require_feature("tax"))):
    q = {}
    if period:
        q["period_month"] = period
    docs = await db.ppn_masukan_entries.find(q).sort("date", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/tax/ppn-masukan")
async def create_ppn_masukan(data: PpnMasukanIn, user: dict = Depends(require_feature("tax"))):
    try:
        y, m, d = [int(x) for x in data.date.split("-")]
        dt = datetime(y, m, d, tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "Format tanggal harus YYYY-MM-DD")
    dpp = round(float(data.dpp), 2)
    if dpp <= 0:
        raise HTTPException(400, "DPP harus > 0")
    ppn_amount = round(dpp * float(data.ppn_pct) / 100.0, 2)
    total = round(dpp + ppn_amount, 2)
    # Validate accounts
    exp_acc = await get_account(data.expense_account_code)
    if not exp_acc:
        raise HTTPException(400, "Akun beban tidak valid")
    cash_acc = await get_account(data.cash_account_code)
    if not cash_acc or not cash_acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    # Auto-post journal: DR Beban + DR PPN Masukan / CR Kas/Bank
    desc = f"Pembelian {data.supplier_name}" + (f" - {data.description}" if data.description else "")
    lines = [
        {"account_code": data.expense_account_code, "debit": dpp, "credit": 0, "memo": data.supplier_name},
        {"account_code": "1401", "debit": ppn_amount, "credit": 0, "memo": f"PPN {data.ppn_pct}% {data.no_faktur or ''}".strip()},
        {"account_code": data.cash_account_code, "debit": 0, "credit": total, "memo": f"Bayar {data.supplier_name}"},
    ]
    je = await post_journal(
        date=dt, description=desc, lines=lines,
        reference_type="ppn_masukan", reference_id=None, posted_by=user["id"],
    )
    entry = {
        "date": dt,
        "period_month": dt.strftime("%Y-%m"),
        "supplier_name": data.supplier_name,
        "no_faktur": data.no_faktur,
        "dpp": dpp,
        "ppn_pct": float(data.ppn_pct),
        "ppn_amount": ppn_amount,
        "total": total,
        "expense_account_code": data.expense_account_code,
        "cash_account_code": data.cash_account_code,
        "description": data.description,
        "journal_entry_no": je.get("entry_no") if isinstance(je, dict) else None,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.ppn_masukan_entries.insert_one(entry)
    return serialize(await db.ppn_masukan_entries.find_one({"_id": r.inserted_id}))

@app.delete("/api/tax/ppn-masukan/{pid}")
async def delete_ppn_masukan(pid: str, user: dict = Depends(require_feature("tax"))):
    doc = await db.ppn_masukan_entries.find_one({"_id": _oid(pid)})
    if not doc:
        raise HTTPException(404, "Entry tidak ditemukan")
    # Also delete the linked journal entry (if not period-locked)
    if doc.get("journal_entry_no"):
        je = await db.journal_entries.find_one({"entry_no": doc["journal_entry_no"]})
        if je and je.get("is_locked"):
            raise HTTPException(400, "Jurnal terkait sudah terkunci (period closed)")
        if je:
            await db.journal_entries.delete_one({"_id": je["_id"]})
    await db.ppn_masukan_entries.delete_one({"_id": _oid(pid)})
    return {"ok": True}

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


@app.on_event("startup")
async def _startup_migrate_revenue_recognition():
    """One-time migration: all AWBs created before the PYMHD model is deployed used
    the old jurnal (DR 1201 / CR 4101 directly at order creation). Mark them as
    already-recognized so cost-add/reconcile/invoice triggers don't double-post.
    """
    r = await db.awb_orders.update_many(
        {"revenue_recognized": {"$exists": False}},
        {"$set": {"revenue_recognized": True}},
    )
    if r.modified_count:
        print(f"[migration] Marked {r.modified_count} existing AWBs as revenue_recognized=True")


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
    # --- New extended fields ---
    awb_number: Optional[str] = None
    reff_no: Optional[str] = None
    company_name: Optional[str] = None
    consignee: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    service: Optional[str] = None
    via: Optional[str] = None
    status_pengiriman: Optional[str] = None
    item_description: Optional[str] = None
    goods_content: Optional[str] = None
    tariff_per_kg: Optional[float] = None
    qty_kg: Optional[float] = None
    tax_percentage: Optional[float] = None
    koli_count: Optional[int] = None
    koli_qty_per: Optional[str] = None
    armada: Optional[str] = None
    driver_name: Optional[str] = None
    nopol: Optional[str] = None
    insurance_enabled: Optional[bool] = None
    polis_amount: Optional[float] = None
    insurance_amount: Optional[float] = None
    pickup_date: Optional[str] = None  # YYYY-MM-DD

@app.patch("/api/orders/{oid}/extended")
async def patch_awb_extended(oid: str, data: AwbExtendedUpdate, user: dict = Depends(get_current_user)):
    raw = data.model_dump()
    upd = {k: v for k, v in raw.items() if v is not None}
    # Only allow editing for Open AWBs unless admin
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if user["role"] != "administrator" and o.get("status") not in ("Open", None):
        raise HTTPException(403, f"Hanya AWB Open yang dapat di-edit (status saat ini: {o.get('status')})")
    # AWB number uniqueness if changed
    if "awb_number" in upd and upd["awb_number"] and upd["awb_number"] != o.get("awb_number"):
        if await db.awb_orders.find_one({"awb_number": upd["awb_number"], "_id": {"$ne": _oid(oid)}}):
            raise HTTPException(400, f"Nomor AWB '{upd['awb_number']}' sudah dipakai")
    # Pickup date → created_at
    if "pickup_date" in upd and upd["pickup_date"]:
        try:
            y, m, d = [int(x) for x in upd["pickup_date"].split("-")]
            upd["created_at"] = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "pickup_date harus YYYY-MM-DD")
        upd.pop("pickup_date", None)
    # Recalculate totals when tariff/qty/tax changes
    if any(k in upd for k in ("tariff_per_kg", "qty_kg", "tax_percentage")):
        tariff = float(upd.get("tariff_per_kg", o.get("tariff_per_kg") or 0))
        qty = float(upd.get("qty_kg", o.get("qty_kg") or 0))
        pct = float(upd.get("tax_percentage", o.get("tax_percentage") or 0))
        total = round(tariff * qty, 2)
        tax_amt = round(total * pct / 100, 2)
        upd["total_tariff"] = total
        upd["tax_amount"] = tax_amt
        upd["grand_total"] = round(total + tax_amt, 2)
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

        # Track AWBs created/touched in THIS import — used for post-import PYMHD migration.
        if "_imported_awb_ids" not in summary:
            summary["_imported_awb_ids"] = []

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
                        summary["_imported_awb_ids"].append(awb_id)
                    summary["awbs_created"] += 1
                    sheet_info["awbs"] += 1
                else:
                    awb_id = existing_awb["_id"]
                    if not dry_run and awb_id not in summary["_imported_awb_ids"]:
                        summary["_imported_awb_ids"].append(awb_id)

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

                # Sales journal will be POSTPONED to post-import sweep (PYMHD model).
                # See post-import block at the bottom of _parse_excel.

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

                # Payment journal also POSTPONED to post-import sweep.

            except Exception as e:
                summary["skipped_rows"] += 1
                summary["errors"].append(f"Sheet '{sheet_name}' row {row_idx}: {str(e)[:120]}")
                continue

        summary["sheets_processed"].append(sheet_info)

    # ─── POST-IMPORT PYMHD SWEEP (PSAK 72) ───────────────────────────────
    # All imported AWBs are processed here to:
    #   1. Post PYMHD jurnal:  DR 1290 / CR 2390  (sebesar total_tariff)
    #   2. If has cost OR status non-Open → recognize revenue: DR 2390 / CR 4101
    #   3. If status Invoiced/Paid OR external_invoice_number ada → post invoice
    #      clearance: DR 1201 / CR 1290 / CR 2210
    #   4. If status Paid → post payment: DR 1101 / CR 1201
    if not dry_run and summary.get("_imported_awb_ids"):
        pymhd_count = recog_count = inv_count = pay_count = 0
        for awb_id in summary["_imported_awb_ids"]:
            awb = await db.awb_orders.find_one({"_id": awb_id})
            if not awb:
                continue
            dpp = float(awb.get("total_tariff") or 0)
            tax = float(awb.get("tax_amount") or 0)
            gross = round(dpp + tax, 2)
            if dpp <= 0:
                await db.awb_orders.update_one({"_id": awb_id}, {"$set": {"revenue_recognized": True}})
                continue
            status = awb.get("status", "Open")
            has_cost = await db.awb_costs.count_documents({"awb_id": awb_id}) > 0
            invoice_doc = await db.invoices.find_one({"awb_id": awb_id})
            # ─── STRICT PSAK 72 + user rule ─────────────────────────────────
            # Revenue recognized ONLY if has_cost (performance obligation fulfilled).
            # Invoice journal posted ONLY if has_cost AND has_invoice doc.
            # AWB tanpa cost → status forced Open, NO recognition, NO invoice journal,
            # NO piutang. Hanya PYMHD `DR 1290 / CR 2390` saja.
            needs_recognition = has_cost
            should_post_invoice_journal = has_cost and bool(invoice_doc)
            # AWB tanpa cost → status WAJIB "Open", apapun mapping Excel-nya.
            if not has_cost:
                if status != "Open":
                    await db.awb_orders.update_one({"_id": awb_id}, {"$set": {"status": "Open"}})
                    status = "Open"
            try:
                # 1. PYMHD posting
                await post_journal(
                    date=awb["created_at"],
                    description=f"[Import PYMHD] {awb['awb_number']}",
                    lines=[
                        {"account_code": "1290", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                        {"account_code": "2390", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
                    ],
                    reference_type="awb_order_pymhd", reference_id=str(awb_id),
                    posted_by=posted_by, auto=True,
                )
                pymhd_count += 1
            except HTTPException as he:
                summary["errors"].append(f"PYMHD AWB {awb.get('awb_number')}: {str(he.detail)[:100]}")
                continue
            if needs_recognition:
                try:
                    await post_journal(
                        date=awb["created_at"],
                        description=f"[Import] Pengakuan revenue {awb['awb_number']}",
                        lines=[
                            {"account_code": "2390", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                            {"account_code": "4101", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
                        ],
                        reference_type="awb_revenue_recognition", reference_id=str(awb_id),
                        posted_by=posted_by, auto=True,
                    )
                    await db.awb_orders.update_one(
                        {"_id": awb_id},
                        {"$set": {"revenue_recognized": True, "revenue_recognized_at": awb["created_at"]}},
                    )
                    recog_count += 1
                except HTTPException:
                    pass
            else:
                await db.awb_orders.update_one({"_id": awb_id}, {"$set": {"revenue_recognized": False}})
            if should_post_invoice_journal:
                inv_lines = [
                    {"account_code": "1201", "debit": gross, "credit": 0, "memo": awb["awb_number"]},
                    {"account_code": "1290", "debit": 0, "credit": dpp, "memo": f"Clear PYMHD {awb['awb_number']}"},
                ]
                if tax > 0:
                    inv_lines.append({"account_code": "2210", "debit": 0, "credit": tax, "memo": f"PPN — {awb['awb_number']}"})
                try:
                    inv_doc = await db.invoices.find_one({"awb_id": awb_id})
                    await post_journal(
                        date=awb["created_at"],
                        description=f"[Import] Invoice {awb['awb_number']}",
                        lines=inv_lines,
                        reference_type="invoice",
                        reference_id=str(inv_doc["_id"]) if inv_doc else str(awb_id),
                        posted_by=posted_by, auto=True,
                    )
                    inv_count += 1
                except HTTPException:
                    pass
            if status == "Paid" and gross > 0:
                try:
                    await post_journal(
                        date=awb.get("paid_at") or awb["created_at"],
                        description=f"[Import] Pelunasan {awb['awb_number']}",
                        lines=[
                            {"account_code": "1101", "debit": gross, "credit": 0, "memo": awb["awb_number"]},
                            {"account_code": "1201", "debit": 0, "credit": gross, "memo": awb["awb_number"]},
                        ],
                        reference_type="payment", reference_id=str(awb_id),
                        posted_by=posted_by, auto=True,
                    )
                    pay_count += 1
                except HTTPException:
                    pass
        summary["pymhd_posted"] = pymhd_count
        summary["recognitions_posted"] = recog_count
        summary["invoice_journals_posted"] = inv_count
        summary["payment_journals_posted"] = pay_count
        summary["journals_posted"] += (pymhd_count + recog_count + inv_count + pay_count)
        # Don't leak internal tracking IDs to response
        summary.pop("_imported_awb_ids", None)

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


# ===========================================================================
# AWB Delete & Status Update (Drop)  + Excel Export Analytics
# ===========================================================================
from fastapi.responses import StreamingResponse

# ── DELETE AWB (Admin only) — cascade delete costs, invoices, journals ────
@app.post("/api/admin/cleanup-pymhd-orphans")
async def cleanup_pymhd_orphans(dry_run: bool = True, user: dict = Depends(require_role("administrator"))):
    """Cleanup AWBs that have revenue recognition / invoice journals posted but
    NO COST exists. Per the updated PSAK 72 rule (post-iter 15), recognition &
    invoice clearance require has_cost.

    Actions per orphan AWB:
      1. Delete `awb_revenue_recognition` journal entries
      2. Delete `invoice` journal entries (the clearance DR1201/CR1290/CR2210)
      3. Force `awb_orders.revenue_recognized = False`, status = "Open"
      4. Delete `awb_order` legacy journals (from pre-PYMHD era)
      5. Delete legacy `payment` journals when no piutang remains

    PYMHD journal (DR1290/CR2390) and the invoice doc itself are PRESERVED.
    """
    # Get AWBs where revenue_recognized=True but no cost
    awbs = await db.awb_orders.find({"revenue_recognized": True}).to_list(50000)
    plan = []
    affected_revenue = 0.0
    for awb in awbs:
        has_cost = await db.awb_costs.count_documents({"awb_id": awb["_id"]}) > 0
        if has_cost:
            continue
        # Count what we will delete
        recog_jes = await db.journal_entries.find({"reference_type": "awb_revenue_recognition", "reference_id": str(awb["_id"])}).to_list(20)
        # Invoice journal — look up via invoice doc
        inv_docs = await db.invoices.find({"awb_id": awb["_id"]}).to_list(10)
        inv_ids = [str(d["_id"]) for d in inv_docs]
        inv_jes = await db.journal_entries.find({"reference_type": "invoice", "reference_id": {"$in": inv_ids}}).to_list(20) if inv_ids else []
        # Legacy awb_order journal
        legacy_jes = await db.journal_entries.find({"reference_type": "awb_order", "reference_id": str(awb["_id"])}).to_list(20)
        # Legacy payment journal — only if no piutang remains (and no cost ever — they're orphans)
        pay_jes = await db.journal_entries.find({"reference_type": "payment", "reference_id": str(awb["_id"])}).to_list(20)
        rec_amount = sum(ln["credit"] for j in recog_jes for ln in j["lines"] if ln["account_code"] == "4101")
        legacy_amount = sum(ln["credit"] for j in legacy_jes for ln in j["lines"] if ln["account_code"] == "4101")
        amount = rec_amount + legacy_amount
        affected_revenue += amount
        item = {
            "awb": awb["awb_number"],
            "amount": amount,
            "recognition_journals": [j["entry_no"] for j in recog_jes],
            "invoice_journals": [j["entry_no"] for j in inv_jes],
            "legacy_journals": [j["entry_no"] for j in legacy_jes],
            "payment_journals": [j["entry_no"] for j in pay_jes],
        }
        plan.append(item)
        if dry_run:
            continue
        # Execute: delete all the orphan journals and reset flag
        await db.journal_entries.delete_many({"reference_type": "awb_revenue_recognition", "reference_id": str(awb["_id"])})
        if inv_ids:
            await db.journal_entries.delete_many({"reference_type": "invoice", "reference_id": {"$in": inv_ids}})
        await db.journal_entries.delete_many({"reference_type": "awb_order", "reference_id": str(awb["_id"])})
        await db.journal_entries.delete_many({"reference_type": "payment", "reference_id": str(awb["_id"])})
        await db.awb_orders.update_one(
            {"_id": awb["_id"]},
            {
                "$set": {"revenue_recognized": False, "status": "Open"},
                "$unset": {"revenue_recognized_at": "", "invoiced_at": "", "reconciled_at": "", "paid_at": ""},
            },
        )
    summary = {
        "dry_run": dry_run,
        "total_orphans": len(plan),
        "total_amount_reverted": round(affected_revenue, 2),
        "sample": plan[:10],
    }
    return summary

@app.post("/api/admin/migrate-pymhd")
async def migrate_pymhd(dry_run: bool = True, user: dict = Depends(require_role("administrator"))):
    """Migrate historical AWBs from old jurnal model (DR 1201 / CR 4101 at order
    creation) to new PYMHD model. Only AWBs that have NOT been invoiced yet are
    migrated — invoiced AWBs are left alone (their journals already represent the
    final Piutang state).

    Strategy (per AWB):
      1. Find all old `awb_order` journals for this AWB and delete them.
      2. Post new PYMHD journal:  DR 1290 / CR 2390
      3. If AWB already has cost AND status != Open without cost → post recognition
         journal:  DR 2390 / CR 4101
      4. Update awb_orders.revenue_recognized accordingly.

    Set `dry_run=false` to actually execute.
    """
    candidates = await db.awb_orders.find({}).to_list(20000)
    plan = []
    now = datetime.now(timezone.utc)
    for awb in candidates:
        # Skip if invoiced (its old journals are valid as final Piutang state)
        if await db.invoices.find_one({"awb_id": awb["_id"]}):
            continue
        old = await db.journal_entries.find({
            "reference_type": "awb_order", "reference_id": str(awb["_id"])
        }).to_list(20)
        # Skip already-migrated (no old jurnal found)
        if not old:
            continue
        # Skip if any old journal is in a locked period — admin must unlock first
        locked = any(j.get("is_locked") for j in old)
        if locked:
            plan.append({"awb": awb["awb_number"], "action": "skip", "reason": "old journal in locked period"})
            continue
        has_cost = bool(await db.awb_costs.find_one({"awb_id": awb["_id"]}))
        plan.append({
            "awb": awb["awb_number"],
            "action": "migrate",
            "has_cost": has_cost,
            "old_journals": [j["entry_no"] for j in old],
        })
        if dry_run:
            continue
        # Execute: delete old, post new
        await db.journal_entries.delete_many({
            "reference_type": "awb_order", "reference_id": str(awb["_id"])
        })
        dpp = float(awb.get("total_tariff") or 0)
        await post_journal(
            date=awb["created_at"],
            description=f"PYMHD - Order {awb['awb_number']} (migrated)",
            lines=[
                {"account_code": "1290", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                {"account_code": "2390", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
            ],
            reference_type="awb_order_pymhd",
            reference_id=str(awb["_id"]),
            posted_by=user["id"],
        )
        if has_cost:
            first_cost = await db.awb_costs.find({"awb_id": awb["_id"]}).sort("created_at", 1).limit(1).to_list(1)
            rec_date = first_cost[0]["created_at"] if first_cost else now
            await post_journal(
                date=rec_date,
                description=f"Pengakuan revenue {awb['awb_number']} (migrated)",
                lines=[
                    {"account_code": "2390", "debit": dpp, "credit": 0, "memo": awb["awb_number"]},
                    {"account_code": "4101", "debit": 0, "credit": dpp, "memo": awb["awb_number"]},
                ],
                reference_type="awb_revenue_recognition",
                reference_id=str(awb["_id"]),
                posted_by=user["id"],
            )
            await db.awb_orders.update_one({"_id": awb["_id"]}, {"$set": {"revenue_recognized": True, "revenue_recognized_at": rec_date}})
        else:
            await db.awb_orders.update_one({"_id": awb["_id"]}, {"$set": {"revenue_recognized": False}})
    summary = {
        "dry_run": dry_run,
        "total_candidates": len(plan),
        "migrate_count": sum(1 for p in plan if p["action"] == "migrate"),
        "skip_count": sum(1 for p in plan if p["action"] == "skip"),
        "plan": plan,
    }
    return summary

@app.delete("/api/orders/{oid}")
async def delete_awb(oid: str, user: dict = Depends(require_role("administrator"))):
    awb = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not awb:
        raise HTTPException(404, "AWB tidak ditemukan")
    # Cascade: hapus costs, invoices, journal entries terkait
    cost_count = (await db.awb_costs.delete_many({"awb_id": awb["_id"]})).deleted_count
    inv_count = (await db.invoices.delete_many({"awb_id": awb["_id"]})).deleted_count
    journal_count = (await db.journal_entries.delete_many({
        "$or": [
            {"reference_type": "awb_order", "reference_id": str(awb["_id"])},
            {"reference_type": "awb_order_pymhd", "reference_id": str(awb["_id"])},
            {"reference_type": "awb_revenue_recognition", "reference_id": str(awb["_id"])},
            {"reference_type": "payment", "reference_id": str(awb["_id"])},
            {"reference_type": "cost", "reference_id": {"$in": [str(awb["_id"])]}},
        ]
    })).deleted_count
    # Also delete journals where reference is a cost belonging to this AWB
    cost_ids = []
    async for c in db.awb_costs.find({"awb_id": awb["_id"]}, {"_id": 1}):
        cost_ids.append(str(c["_id"]))
    if cost_ids:
        journal_count += (await db.journal_entries.delete_many({
            "reference_type": "cost", "reference_id": {"$in": cost_ids}
        })).deleted_count
    await db.awb_orders.delete_one({"_id": awb["_id"]})
    return {
        "ok": True,
        "deleted": {"awb": awb["awb_number"], "costs": cost_count, "invoices": inv_count, "journals": journal_count},
    }

# ── PATCH status to "Drop" — any user can drop, admin can also reopen ────
class StatusUpdateIn(BaseModel):
    status: str  # only "Drop" or "Open" allowed via this endpoint

@app.patch("/api/orders/{oid}/status")
async def update_awb_status(oid: str, data: StatusUpdateIn, user: dict = Depends(get_current_user)):
    awb = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not awb:
        raise HTTPException(404, "AWB tidak ditemukan")
    new_status = data.status.strip()
    allowed_for_user = {"Drop"}
    allowed_for_admin = {"Drop", "Open", "Reconciled", "Invoiced", "Paid"}
    is_admin = user.get("role") == "administrator"
    allowed = allowed_for_admin if is_admin else allowed_for_user
    if new_status not in allowed:
        raise HTTPException(403, f"Anda tidak punya akses set status ke '{new_status}'. Hanya bisa: {', '.join(sorted(allowed))}")
    # Optional: reverse journals if dropping?
    # For now: just update status flag. Admins should manually reverse jurnal jika perlu.
    await db.awb_orders.update_one(
        {"_id": awb["_id"]},
        {"$set": {"status": new_status, "status_updated_at": datetime.now(timezone.utc), "status_updated_by": user["id"]}},
    )
    return {"ok": True, "awb_number": awb["awb_number"], "new_status": new_status}

# ── Excel Export — Dashboard Analytic detail table ──────────────────────────
@app.get("/api/analytics/awbs-detail/export")
async def export_awbs_excel(
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    customer_id: Optional[str] = None,
    region: Optional[str] = None,
    status: Optional[str] = None,
    fleet_type: Optional[str] = None,
    armada_type: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = await _build_awb_filter(period_from, period_to, customer_id, region, status, fleet_type, armada_type, search)
    awbs = await db.awb_orders.find(q).sort("created_at", -1).to_list(50000)
    awb_ids = [a["_id"] for a in awbs]
    # Costs aggregate + primary vendor
    cost_agg, primary_vendor = {}, {}
    if awb_ids:
        async for c in db.awb_costs.find({"awb_id": {"$in": awb_ids}}):
            cost_agg[c["awb_id"]] = cost_agg.get(c["awb_id"], 0) + float(c.get("amount", 0))
            if c["awb_id"] not in primary_vendor and c.get("vendor_name"):
                primary_vendor[c["awb_id"]] = c["vendor_name"]
    cust_map = {}
    cust_ids = list({a.get("customer_id") for a in awbs if a.get("customer_id")})
    if cust_ids:
        async for c in db.customers.find({"_id": {"$in": cust_ids}}):
            cust_map[c["_id"]] = c.get("name", "?")

    # Build Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "AWBs"
    headers = [
        "AWB", "WO Number", "Pickup Date", "Customer", "Region", "Destination", "Destination City",
        "Tipe Armada", "Jenis Armada", "Vendor Utama", "Item Lines", "Qty (Kg)",
        "Selling", "PPN", "Inv+PPN", "Cashback", "PPh 2%", "Total Biaya",
        "Margin (Rp)", "Margin (%)", "Status", "No Invoice Eksternal", "Tgl Bayar",
    ]
    # Header style
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill("solid", fgColor="2563EB")
    thin = Side(border_style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
    ws.row_dimensions[1].height = 28

    # Body
    for i, a in enumerate(awbs, 2):
        costs = cost_agg.get(a["_id"], 0)
        selling = float(a.get("total_tariff", 0))
        margin = selling - costs
        margin_pct = (margin / selling * 100) if selling > 0 else 0
        row = [
            a.get("awb_number"),
            a.get("wo_number"),
            a.get("created_at").strftime("%Y-%m-%d") if a.get("created_at") else "",
            cust_map.get(a.get("customer_id"), "-"),
            a.get("region"),
            a.get("destination"),
            a.get("destination_city"),
            a.get("armada_type"),
            a.get("fleet_type"),
            primary_vendor.get(a["_id"]),
            len(a.get("items", [])),
            float(a.get("qty_kg") or 0),
            selling,
            float(a.get("tax_amount", 0)),
            float(a.get("grand_total", 0)),
            float(a.get("cashback_amount") or 0),
            float(a.get("pph_final") or 0),
            round(costs, 2),
            round(margin, 2),
            round(margin_pct, 2),
            a.get("status"),
            a.get("external_invoice_number"),
            a.get("paid_at").strftime("%Y-%m-%d") if a.get("paid_at") else "",
        ]
        for col_idx, val in enumerate(row, 1):
            cell = ws.cell(row=i, column=col_idx, value=val)
            cell.border = border
            if col_idx in (12, 13, 14, 15, 16, 17, 18, 19):  # numeric columns
                cell.number_format = '#,##0'
                cell.alignment = Alignment(horizontal="right")
            elif col_idx == 20:  # margin %
                cell.number_format = '0.00"%"'
                cell.alignment = Alignment(horizontal="right")

    # Auto-width columns
    widths = [14, 12, 12, 30, 16, 18, 18, 12, 12, 22, 6, 8, 14, 12, 14, 12, 12, 14, 14, 10, 12, 24, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Summary sheet
    ws2 = wb.create_sheet("Summary")
    total_selling = sum(float(a.get("total_tariff", 0)) for a in awbs)
    total_costs = sum(cost_agg.get(a["_id"], 0) for a in awbs)
    total_margin = total_selling - total_costs
    margin_pct = (total_margin / total_selling * 100) if total_selling > 0 else 0
    summary_rows = [
        ("Total AWB", len(awbs)),
        ("Total Selling", total_selling),
        ("Total Inv + PPN", sum(float(a.get("grand_total", 0)) for a in awbs)),
        ("Total Biaya", total_costs),
        ("Gross Margin (Rp)", total_margin),
        ("Gross Margin (%)", round(margin_pct, 2)),
        ("Filter — Period", f"{period_from or '-'} → {period_to or '-'}"),
        ("Filter — Customer ID", customer_id or "(all)"),
        ("Filter — Region", region or "(all)"),
        ("Filter — Status", status or "(all)"),
        ("Filter — Search", search or "-"),
        ("Generated at", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")),
    ]
    for i, (k, v) in enumerate(summary_rows, 1):
        ws2.cell(row=i, column=1, value=k).font = Font(bold=True)
        c = ws2.cell(row=i, column=2, value=v)
        if isinstance(v, (int, float)) and i in (2, 3, 4, 5):
            c.number_format = '#,##0'
        elif i == 6:
            c.number_format = '0.00"%"'
    ws2.column_dimensions["A"].width = 28
    ws2.column_dimensions["B"].width = 28

    # Stream response
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"ARC_AWB_Export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===========================================================================
# Saved Views — kombinasi filter favorit untuk Dashboard Analitik
# ===========================================================================
class SavedViewIn(BaseModel):
    name: str
    filters: dict
    is_shared: bool = False

class SavedViewPatch(BaseModel):
    name: Optional[str] = None
    filters: Optional[dict] = None
    is_shared: Optional[bool] = None


def _serialize_view(v: dict, current_user_id: str) -> dict:
    return {
        "id": str(v["_id"]),
        "name": v.get("name", ""),
        "filters": v.get("filters", {}),
        "is_shared": bool(v.get("is_shared", False)),
        "owner_id": v.get("owner_id"),
        "owner_username": v.get("owner_username", ""),
        "is_mine": v.get("owner_id") == current_user_id,
        "created_at": v.get("created_at").isoformat() if v.get("created_at") else None,
    }


@app.get("/api/analytics/saved-views")
async def list_saved_views(user: dict = Depends(get_current_user)):
    """List user's own views + all shared views."""
    cursor = db.saved_views.find({
        "$or": [{"owner_id": user["id"]}, {"is_shared": True}]
    }).sort("created_at", -1)
    out = []
    async for v in cursor:
        out.append(_serialize_view(v, user["id"]))
    return out


@app.post("/api/analytics/saved-views")
async def create_saved_view(data: SavedViewIn, user: dict = Depends(get_current_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Nama view wajib diisi")
    if len(name) > 80:
        raise HTTPException(400, "Nama view max 80 karakter")
    doc = {
        "name": name,
        "filters": data.filters or {},
        "is_shared": bool(data.is_shared),
        "owner_id": user["id"],
        "owner_username": user.get("username", ""),
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.saved_views.insert_one(doc)
    doc["_id"] = r.inserted_id
    return _serialize_view(doc, user["id"])


@app.get("/api/analytics/saved-views/{vid}")
async def get_saved_view(vid: str, user: dict = Depends(get_current_user)):
    v = await db.saved_views.find_one({"_id": _oid(vid)})
    if not v:
        raise HTTPException(404, "View tidak ditemukan")
    if v.get("owner_id") != user["id"] and not v.get("is_shared"):
        raise HTTPException(403, "Anda tidak punya akses view ini")
    return _serialize_view(v, user["id"])


@app.patch("/api/analytics/saved-views/{vid}")
async def update_saved_view(vid: str, data: SavedViewPatch, user: dict = Depends(get_current_user)):
    v = await db.saved_views.find_one({"_id": _oid(vid)})
    if not v:
        raise HTTPException(404, "View tidak ditemukan")
    if v.get("owner_id") != user["id"]:
        raise HTTPException(403, "Hanya pemilik yang bisa edit view ini")
    update = {}
    if data.name is not None:
        n = data.name.strip()
        if not n:
            raise HTTPException(400, "Nama tidak boleh kosong")
        update["name"] = n[:80]
    if data.filters is not None:
        update["filters"] = data.filters
    if data.is_shared is not None:
        update["is_shared"] = bool(data.is_shared)
    if update:
        await db.saved_views.update_one({"_id": v["_id"]}, {"$set": update})
    v2 = await db.saved_views.find_one({"_id": v["_id"]})
    return _serialize_view(v2, user["id"])


@app.delete("/api/analytics/saved-views/{vid}")
async def delete_saved_view(vid: str, user: dict = Depends(get_current_user)):
    v = await db.saved_views.find_one({"_id": _oid(vid)})
    if not v:
        raise HTTPException(404, "View tidak ditemukan")
    is_admin = user.get("role") == "administrator"
    if v.get("owner_id") != user["id"] and not is_admin:
        raise HTTPException(403, "Hanya pemilik atau admin yang bisa hapus view ini")
    await db.saved_views.delete_one({"_id": v["_id"]})
    return {"ok": True, "deleted": vid}


# ===========================================================================
# Panjar Kerja (Cash Advance) — operational cash given to staff/driver/etc
# ===========================================================================
class CashAdvanceIn(BaseModel):
    recipient_name: str
    purpose: Optional[str] = None
    amount: float
    advance_date: Optional[str] = None  # YYYY-MM-DD; default today
    cash_account_code: Optional[str] = None  # default 1101
    notes: Optional[str] = None

class CashAdvanceBreakdownItem(BaseModel):
    awb_id: Optional[str] = None  # None / "OPERATION" → direct cost ke operation (no AWB)
    target: Optional[str] = None  # "awb" | "operation"
    amount: float
    description: Optional[str] = None

class CashAdvanceSettleIn(BaseModel):
    actual_amount: Optional[float] = None  # actual expense from the advance
    refund_amount: Optional[float] = None  # cash returned by recipient (if any)
    settle_date: Optional[str] = None      # YYYY-MM-DD; default today
    cash_account_code: Optional[str] = None  # for refund; default 1101
    notes: Optional[str] = None
    awb_breakdown: Optional[List[CashAdvanceBreakdownItem]] = None  # list AWB + nominal; nilai jadi cost di AWB ybs

async def next_cash_advance_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"PNJ-{yyyymm}-"
    last = await db.cash_advances.find_one(
        {"number": {"$regex": f"^{prefix}"}},
        sort=[("number", -1)],
    )
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["number"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

@app.get("/api/cash-advances")
async def list_cash_advances(
    status_v: Optional[str] = None,  # Open / Settled
    user: dict = Depends(get_current_user),
):
    q = {}
    if status_v:
        q["status"] = status_v
    docs = await db.cash_advances.find(q).sort("advance_date", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/cash-advances")
async def create_cash_advance(data: CashAdvanceIn, user: dict = Depends(require_role("finance", "operation"))):
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    if data.advance_date:
        try:
            y, m, d = [int(x) for x in data.advance_date.split("-")]
            adv_date = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "advance_date harus YYYY-MM-DD")
    else:
        adv_date = datetime.now(timezone.utc)
    doc = {
        "number": await next_cash_advance_number(),
        "recipient_name": data.recipient_name.strip(),
        "purpose": (data.purpose or "").strip() or None,
        "amount": float(data.amount),
        "advance_date": adv_date,
        "cash_account_code": cash_acc,
        "status": "Open",
        "actual_amount": None,
        "refund_amount": None,
        "settled_at": None,
        "notes": (data.notes or "").strip() or None,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.cash_advances.insert_one(doc)
    # Journal: DR 1108 Panjar Kerja / CR Cash
    try:
        await post_journal(
            date=adv_date,
            description=f"Panjar kerja {doc['number']} - {data.recipient_name}",
            lines=[
                {"account_code": "1108", "debit": doc["amount"], "credit": 0, "memo": doc["recipient_name"]},
                {"account_code": cash_acc, "debit": 0, "credit": doc["amount"], "memo": doc["number"]},
            ],
            reference_type="cash_advance", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException:
        pass
    return serialize(await db.cash_advances.find_one({"_id": r.inserted_id}))

@app.post("/api/cash-advances/{cid}/settle")
async def settle_cash_advance(cid: str, data: CashAdvanceSettleIn, user: dict = Depends(require_role("finance"))):
    ca = await db.cash_advances.find_one({"_id": _oid(cid)})
    if not ca:
        raise HTTPException(404, "Panjar tidak ditemukan")
    if ca.get("status") == "Settled":
        raise HTTPException(400, "Panjar sudah disettle")
    # Validate AWB breakdown if provided
    breakdown = []
    if data.awb_breakdown:
        # Each item: target="awb" (with awb_id) or target="operation" (direct cost, no AWB)
        for it in data.awb_breakdown:
            target = (it.target or ("operation" if not it.awb_id else "awb")).lower()
            if target == "operation":
                breakdown.append({
                    "target": "operation",
                    "awb_id": None,
                    "awb_number": None,
                    "amount": float(it.amount),
                    "description": (it.description or "").strip() or None,
                })
            else:
                if not it.awb_id:
                    raise HTTPException(400, "AWB id wajib jika target=awb")
                ao = await db.awb_orders.find_one({"_id": _oid(it.awb_id)})
                if not ao:
                    raise HTTPException(400, f"AWB id {it.awb_id} tidak ditemukan")
                breakdown.append({
                    "target": "awb",
                    "awb_id": _oid(it.awb_id),
                    "awb_number": ao["awb_number"],
                    "amount": float(it.amount),
                    "description": (it.description or "").strip() or None,
                })
        total_breakdown = sum(b["amount"] for b in breakdown)
        actual = float(data.actual_amount if data.actual_amount is not None else total_breakdown)
        if abs(total_breakdown - actual) > 0.01:
            raise HTTPException(400, f"Total breakdown ({total_breakdown}) tidak sama dengan actual_amount ({actual})")
    else:
        actual = float(data.actual_amount if data.actual_amount is not None else ca["amount"])
    refund = float(data.refund_amount or 0)
    if data.settle_date:
        try:
            y, m, d = [int(x) for x in data.settle_date.split("-")]
            sd = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "settle_date harus YYYY-MM-DD")
    else:
        sd = datetime.now(timezone.utc)
    cash_acc = data.cash_account_code or ca.get("cash_account_code") or "1101"
    await db.cash_advances.update_one(
        {"_id": _oid(cid)},
        {"$set": {
            "status": "Settled",
            "actual_amount": actual,
            "refund_amount": refund,
            "settled_at": sd,
            "settled_by": user["id"],
            "settle_notes": (data.notes or "").strip() or None,
            "awb_breakdown": [{**b, "awb_id": str(b["awb_id"]) if b.get("awb_id") else None} for b in breakdown] if breakdown else None,
        }},
    )
    # If breakdown given: create awb_costs for AWB targets / direct journals for Operation targets
    for b in breakdown:
        if b.get("target") == "operation":
            # Direct cost (Operation, no AWB) — post journal DR 5102 / CR 1101 already covered globally below
            # But to keep accounting simple, we don't create awb_costs row. We record a marker doc in petty_cash for visibility.
            await db.petty_cash.insert_one({
                "number": await next_petty_cash_number(),
                "category": "Operational",
                "amount": float(b["amount"]),
                "description": (b["description"] or f"Settle Panjar {ca['number']} - {ca['recipient_name']}"),
                "expense_date": sd,
                "cash_account_code": cash_acc,
                "source": "panjar_settle",
                "source_ref": cid,
                "created_by": user["id"],
                "created_at": sd,
            })
        else:
            cdoc = {
                "awb_id": b["awb_id"],
                "cost_category": "Operational",
                "amount": b["amount"],
                "description": (b["description"] or f"Panjar {ca['number']} - {ca['recipient_name']}"),
                "sub_label": "Panjar",
                "vendor_name": None,
                "payment_type": "Cash",
                "is_settled": True,
                "cash_account_code": cash_acc,
                "source": "cash_advance_settle",
                "source_ref": cid,
                "created_by": user["id"],
                "created_at": sd,
            }
            await db.awb_costs.insert_one(cdoc)
    # Journal: DR 5105 actual + DR cash refund / CR 1108
    # (When breakdown is used, the cost is logically 5102 per-AWB, but since panjar accrual sits on 1108,
    #  we still credit 1108. For simplicity always post to 5105 to balance 1108 release.)
    try:
        lines = [{"account_code": "5105", "debit": actual, "credit": 0, "memo": f"Panjar {ca['number']} - {ca['recipient_name']}"}]
        if refund > 0:
            lines.append({"account_code": cash_acc, "debit": refund, "credit": 0, "memo": f"Refund panjar {ca['number']}"})
        lines.append({"account_code": "1108", "debit": 0, "credit": actual + refund, "memo": ca["number"]})
        await post_journal(
            date=sd,
            description=f"Settle panjar kerja {ca['number']}",
            lines=lines,
            reference_type="cash_advance_settle", reference_id=cid, posted_by=user["id"],
        )
    except HTTPException:
        pass
    return serialize(await db.cash_advances.find_one({"_id": _oid(cid)}))

@app.delete("/api/cash-advances/{cid}")
async def delete_cash_advance(cid: str, user: dict = Depends(require_role("administrator"))):
    await db.cash_advances.delete_one({"_id": _oid(cid)})
    return {"ok": True}

# ===========================================================================
# Excel Exports — REPORT AR & Invoice (matching templates from user)
# ===========================================================================
from fastapi.responses import StreamingResponse
import io
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

REPORT_AR_HEADER_ROW1 = [
    # main cols (1-17)
    "Bulan", "Tgl Pick Up", "Tanggal Terima", "Status Pengiriman", "AWB",
    "Vendor Name", "Transport", "From", "Destination", "No Mobil",
    "Penerima", "Qty", "Koli", "KG", "Min Kg", "Final KG", "Harga /KG",
    # Group: Kirim Barang (R-Z = 9 sub-cols, col 18-26)
    "Kirim Barang", "", "", "", "", "", "", "", "",
    # Group: Dismantle Barang (AA-AI = 9 sub-cols, col 27-35)
    "Dismantle Barang", "", "", "", "", "", "", "", "",
    # Group: Relokasi Barang (AJ-AR = 9 sub-cols, col 36-44)
    "Relokasi Barang", "", "", "", "", "", "", "", "",
    # Trailing single cols (AS-AX, col 45-50)
    "Amount\n(Exc VAT)", "Keterangan", "Harga", "List Muatan", "Asuransi", "No Invoice",
]
# Row 2 sub-headers (only for the 3 groups)
REPORT_AR_HEADER_ROW2_GROUPS = {
    "kirim":     ["Polis", "Insurance", "SPSI", "Sewa Froklift", "Kirim Barang", "Loading/Unloading", "Air", "Konsul", "Trucking"],
    "dismantle": ["Polis", "Insurance", "SPSI", "Sewa Froklift", "Packing",      "Loading/Unloading", "Air", "Konsul", "Trucking"],
    "relokasi":  ["Polis", "Insurance", "SPSI", "Sewa Froklift", "Loading/Unloading", "Packing",       "Air", "Konsul", "Trucking"],
}

INDO_MONTHS = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"]

def _ar_group_start(group_key: str) -> int:
    # 1-indexed column where each group starts (Kirim=18, Dismantle=27, Relokasi=36)
    return {"kirim": 18, "dismantle": 27, "relokasi": 36}[group_key]

def _ar_subcol_offset(group_key: str, sub_name: str) -> Optional[int]:
    subs = REPORT_AR_HEADER_ROW2_GROUPS[group_key]
    try:
        return subs.index(sub_name)
    except ValueError:
        return None

@app.get("/api/exports/report-ar")
async def export_report_ar(
    month: Optional[str] = None,  # YYYY-MM
    customer_id: Optional[str] = None,
    status_v: Optional[str] = None,
    invoice_ids: Optional[str] = None,  # comma-separated invoice ids → only those AWBs
    user: dict = Depends(get_current_user),
):
    q = {}
    if status_v:
        q["status"] = status_v
    if customer_id:
        q["customer_id"] = _oid(customer_id)
    if invoice_ids:
        ids = [i.strip() for i in invoice_ids.split(",") if i.strip()]
        invs = await db.invoices.find({"_id": {"$in": [_oid(i) for i in ids]}}).to_list(5000)
        awb_ids = [i["awb_id"] for i in invs]
        q["_id"] = {"$in": awb_ids}
    if month:
        try:
            y, m = [int(x) for x in month.split("-")]
            start = datetime(y, m, 1, tzinfo=timezone.utc)
            end = datetime(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
            q["created_at"] = {"$gte": start, "$lt": end}
        except Exception:
            raise HTTPException(400, "month harus YYYY-MM")
    orders = await db.awb_orders.find(q).sort("created_at", 1).to_list(20000)
    # Pre-fetch customer names
    cust_ids = list({o.get("customer_id") for o in orders if o.get("customer_id")})
    cust_map = {}
    if cust_ids:
        async for c in db.customers.find({"_id": {"$in": cust_ids}}):
            cust_map[str(c["_id"])] = c
    # Pre-fetch invoice numbers
    awb_ids = [o["_id"] for o in orders]
    inv_map = {}
    if awb_ids:
        async for inv in db.invoices.find({"awb_id": {"$in": awb_ids}}):
            inv_map[str(inv["awb_id"])] = inv.get("invoice_number", "")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "REPORT AR"

    # Styles
    hdr_fill = PatternFill("solid", fgColor="FFD966")        # gold
    grp_fill = {
        "kirim":     PatternFill("solid", fgColor="C6E0B4"), # green
        "dismantle": PatternFill("solid", fgColor="F4B084"), # orange
        "relokasi":  PatternFill("solid", fgColor="B4C7E7"), # blue
    }
    sub_fill = {
        "kirim":     PatternFill("solid", fgColor="E2EFDA"),
        "dismantle": PatternFill("solid", fgColor="FCE4D6"),
        "relokasi":  PatternFill("solid", fgColor="D9E1F2"),
    }
    hdr_font = Font(bold=True, color="000000", size=10)
    thin = Side(border_style="thin", color="404040")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Row 1
    for i, h in enumerate(REPORT_AR_HEADER_ROW1, start=1):
        c = ws.cell(1, i, h)
        c.font = hdr_font
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border
        # Coloring
        if 18 <= i <= 26: c.fill = grp_fill["kirim"]
        elif 27 <= i <= 35: c.fill = grp_fill["dismantle"]
        elif 36 <= i <= 44: c.fill = grp_fill["relokasi"]
        else: c.fill = hdr_fill

    # Merge group headers in row 1
    ws.merge_cells(start_row=1, start_column=18, end_row=1, end_column=26)  # Kirim
    ws.merge_cells(start_row=1, start_column=27, end_row=1, end_column=35)  # Dismantle
    ws.merge_cells(start_row=1, start_column=36, end_row=1, end_column=44)  # Relokasi

    # Merge main cols vertically (rows 1-2)
    for col in list(range(1, 18)) + list(range(45, 51)):
        ws.merge_cells(start_row=1, start_column=col, end_row=2, end_column=col)

    # Row 2 sub-headers
    for offset, sub in enumerate(REPORT_AR_HEADER_ROW2_GROUPS["kirim"]):
        c = ws.cell(2, 18 + offset, sub); c.font = hdr_font; c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True); c.fill = sub_fill["kirim"]; c.border = border
    for offset, sub in enumerate(REPORT_AR_HEADER_ROW2_GROUPS["dismantle"]):
        c = ws.cell(2, 27 + offset, sub); c.font = hdr_font; c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True); c.fill = sub_fill["dismantle"]; c.border = border
    for offset, sub in enumerate(REPORT_AR_HEADER_ROW2_GROUPS["relokasi"]):
        c = ws.cell(2, 36 + offset, sub); c.font = hdr_font; c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True); c.fill = sub_fill["relokasi"]; c.border = border

    # Column widths
    widths = [8, 12, 12, 14, 12, 18, 22, 22, 22, 14, 18, 10, 8, 10, 10, 10, 12]
    for i, w in enumerate(widths, start=1): ws.column_dimensions[get_column_letter(i)].width = w
    for i in range(18, 45): ws.column_dimensions[get_column_letter(i)].width = 11
    for i, w in zip(range(45, 51), [14, 16, 12, 14, 14, 20]):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 22
    ws.row_dimensions[2].height = 28
    ws.freeze_panes = "F3"

    # Data rows
    row_idx = 3
    for o in orders:
        cust = cust_map.get(str(o.get("customer_id"))) if o.get("customer_id") else None
        pickup_dt = o.get("created_at")
        recv_dt = o.get("received_at")
        bulan = INDO_MONTHS[pickup_dt.month - 1] if pickup_dt else ""
        ws.cell(row_idx, 1, bulan)
        ws.cell(row_idx, 2, pickup_dt.replace(tzinfo=None) if pickup_dt else None).number_format = "yyyy-mm-dd"
        if recv_dt:
            ws.cell(row_idx, 3, recv_dt.replace(tzinfo=None)).number_format = "yyyy-mm-dd"
        ws.cell(row_idx, 4, (o.get("status_pengiriman") or "").upper())
        ws.cell(row_idx, 5, o.get("awb_number"))
        # Vendor Name: take from awb_costs (1st vendor cost), else blank
        vname = ""
        cost_doc = await db.awb_costs.find_one({"awb_id": o["_id"], "cost_category": "Vendor", "vendor_name": {"$ne": None}})
        if cost_doc: vname = cost_doc.get("vendor_name", "") or ""
        ws.cell(row_idx, 6, vname)
        # Transport: combine armada + service
        transport_parts = []
        if o.get("armada"): transport_parts.append(o["armada"])
        if o.get("service"): transport_parts.append(o["service"])
        ws.cell(row_idx, 7, " ".join(transport_parts))
        ws.cell(row_idx, 8, o.get("origin"))
        ws.cell(row_idx, 9, o.get("destination"))
        ws.cell(row_idx, 10, o.get("nopol"))
        ws.cell(row_idx, 11, o.get("received_by_name") or o.get("consignee") or "")
        ws.cell(row_idx, 12, o.get("qty_kg"))
        ws.cell(row_idx, 13, o.get("koli_count"))
        ws.cell(row_idx, 14, o.get("qty_kg"))  # KG
        # Min Kg / Final KG: leave blank unless we add a field; default to qty_kg
        ws.cell(row_idx, 16, o.get("qty_kg"))  # Final KG
        ws.cell(row_idx, 17, o.get("tariff_per_kg"))

        # Group placement based on work_type
        wt = (o.get("work_type") or "").lower()
        grp_key = None
        if "kirim" in wt: grp_key = "kirim"
        elif "dismantle" in wt: grp_key = "dismantle"
        elif "relokasi" in wt: grp_key = "relokasi"

        if grp_key:
            gstart = _ar_group_start(grp_key)
            # Polis (col offset 0), Insurance (1), SPSI (2), Sewa Froklift (3)
            if o.get("received_polis"): ws.cell(row_idx, gstart + 0, o["received_polis"])
            if o.get("received_asuransi_amount"): ws.cell(row_idx, gstart + 1, o["received_asuransi_amount"])
            if o.get("spsi_enabled") and o.get("spsi_amount"): ws.cell(row_idx, gstart + 2, o["spsi_amount"])
            if o.get("sewa_forklift_enabled") and o.get("sewa_forklift_amount"): ws.cell(row_idx, gstart + 3, o["sewa_forklift_amount"])
            # Mode column: Air / Trucking / Konsul → grand_total value
            mode = (o.get("mode") or "").strip()
            if mode in ("Air", "Trucking", "Konsul"):
                off = _ar_subcol_offset(grp_key, mode)
                if off is not None:
                    ws.cell(row_idx, gstart + off, o.get("grand_total"))

        ws.cell(row_idx, 45, o.get("grand_total"))  # Amount (Exc VAT) — using grand_total
        ws.cell(row_idx, 46, o.get("item_description"))  # Keterangan
        ws.cell(row_idx, 47, o.get("tariff_per_kg"))     # Harga
        ws.cell(row_idx, 48, o.get("goods_content"))     # List Muatan
        ws.cell(row_idx, 49, o.get("received_asuransi_amount") or o.get("insurance_amount") or "")
        ws.cell(row_idx, 50, inv_map.get(str(o["_id"]), ""))

        # Number formatting & borders for data cells
        for col in [12, 13, 14, 15, 16, 17, 45, 47, 49] + list(range(18, 45)):
            cc = ws.cell(row_idx, col)
            if cc.value is not None and isinstance(cc.value, (int, float)):
                cc.number_format = "#,##0"
        for col in range(1, 51):
            ws.cell(row_idx, col).border = border
        row_idx += 1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"REPORT_AR_{month or 'ALL'}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# --- Invoice Excel matching Master INV format -------------------------------
async def _build_invoice_sheet(ws, invoice: dict, awb: dict, customer: Optional[dict]):
    """Render invoice matching AR Cargo template (per user screenshot iter-10).

    Layout (Excel column letters):
      A=2  B=4  C..M body  N..P middle  Q..W right summary
    Rows:
      1-4 : Logo zone (image inserted, anchored at A1)
      5   : Grey banner "INVOICE" (B5:W5)
      7-9 : Left issuer block + right meta block (Invoice No / Date / Due Date)
      11  : Attn
      13  : Table header (dark grey bg, white text)
      14+ : Line items
      ~30 : Terbilang (B-L) + Summary table (O-W)
      ~40 : Bank box (B-L) + Signature block (P-W)
    """
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.drawing.image import Image as XLImage

    bold = Font(name="Calibri", bold=True, size=11)
    bold_white_big = Font(name="Calibri", bold=True, size=22, color="FFFFFF")
    bold_white_table = Font(name="Calibri", bold=True, size=11, color="FFFFFF")
    bold_big = Font(name="Calibri", bold=True, size=22)
    italic = Font(name="Calibri", italic=True, size=11)
    regular = Font(name="Calibri", size=11)
    small = Font(name="Calibri", size=10)
    grey_banner = PatternFill("solid", fgColor="7F7F7F")
    dark_band   = PatternFill("solid", fgColor="595959")
    light_grey  = PatternFill("solid", fgColor="F2F2F2")
    thin = Side(border_style="thin", color="404040")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    bottom_only = Border(bottom=thin)

    # --- Issuer info & settings ---
    issuer = awb.get("company_name") or ""
    settings = {s["key_name"]: s.get("key_value", "") async for s in db.settings.find(
        {"key_name": {"$regex": "^(signer_|address_|npwp_|company_|bank_|invoice_)"}}
    )}
    issuer_address = settings.get(f"address_{issuer}") or settings.get("company_address", "")
    issuer_npwp = settings.get(f"npwp_{issuer}") or settings.get("company_npwp", "")
    signer_name = settings.get(f"signer_{issuer}", "")
    bank_name = settings.get(f"bank_name_{issuer}", "Mandiri")
    bank_holder = settings.get(f"bank_holder_{issuer}", issuer.replace("PT. ", ""))
    bank_account = settings.get(f"bank_account_{issuer}", "")
    logo_b64 = settings.get("invoice_logo_b64", "")

    # --- Column widths to mimic template ---
    col_widths = {"A": 1.4, "B": 5, "C": 11, "D": 6, "E": 6, "F": 6, "G": 9, "H": 6,
                  "I": 6, "J": 6, "K": 6, "L": 6, "M": 5, "N": 4, "O": 11, "P": 4,
                  "Q": 4, "R": 5, "S": 5, "T": 5, "U": 4, "V": 6, "W": 11}
    for k, v in col_widths.items(): ws.column_dimensions[k].width = v

    # --- Logo (rows 1-4) ---
    if logo_b64:
        try:
            raw = logo_b64.split(",", 1)[1] if "," in logo_b64 and logo_b64.startswith("data:") else logo_b64
            img_bytes = base64.b64decode(raw)
            img = XLImage(io.BytesIO(img_bytes))
            # Resize to fit ~ 80 pt height
            img.height = 80
            img.width = int(img.height * (img.width / img.height) if img.height else 200)
            ws.add_image(img, "A1")
        except Exception:
            pass
    for r in range(1, 5): ws.row_dimensions[r].height = 22

    # --- Grey banner with INVOICE title (row 5) ---
    ws.merge_cells("B5:W5")
    c = ws["B5"]; c.value = "INVOICE"
    c.font = bold_white_big; c.fill = grey_banner
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[5].height = 38

    # --- Issuer block (rows 7-9) + Meta on right ---
    ws.merge_cells("B7:L7"); ws["B7"] = issuer or "PT. Abirama Mitra"; ws["B7"].font = bold
    ws.merge_cells("B8:L8"); ws["B8"] = issuer_address.split("\n")[0] if "\n" in issuer_address else issuer_address
    ws["B8"].font = regular
    ws.merge_cells("B9:L9"); ws["B9"] = issuer_address.split("\n", 1)[1] if "\n" in issuer_address else (issuer_npwp and f"NPWP: {issuer_npwp}" or "")
    ws["B9"].font = regular

    # Right meta block
    ws["P7"] = "Invoice No"; ws["P7"].font = bold
    ws["U7"] = ":"; ws["U7"].font = bold
    ws.merge_cells("V7:W7"); ws["V7"] = invoice.get("invoice_number", ""); ws["V7"].font = bold
    ws["P8"] = "Date"; ws["P8"].font = bold
    ws["U8"] = ":"; ws["U8"].font = bold
    inv_date = (invoice.get("created_at") or datetime.now(timezone.utc)).replace(tzinfo=None)
    ws.merge_cells("V8:W8"); ws["V8"] = _fmt_id_date(inv_date)
    due = inv_date + timedelta(days=30)
    ws["P9"] = "Due Date"; ws["P9"].font = bold
    ws["U9"] = ":"; ws["U9"].font = bold
    ws.merge_cells("V9:W9"); ws["V9"] = _fmt_id_date(due)

    # --- Attn ---
    ws["B11"] = "Attn :"; ws["B11"].font = regular
    attn = awb.get("consignee") or (customer.get("name") if customer else "")
    ws["C11"] = attn; ws["C11"].font = regular

    # --- Table header (row 13) — dark band white text ---
    header_row = 13
    ws.row_dimensions[header_row].height = 26
    ws.merge_cells(start_row=header_row, start_column=2, end_row=header_row, end_column=3)
    ws.cell(header_row, 2, "No"); ws.cell(header_row, 2).font = bold_white_table; ws.cell(header_row, 2).fill = dark_band; ws.cell(header_row, 2).alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells(start_row=header_row, start_column=4, end_row=header_row, end_column=19)
    ws.cell(header_row, 4, "DESCRIPTION"); ws.cell(header_row, 4).font = bold_white_table; ws.cell(header_row, 4).fill = dark_band; ws.cell(header_row, 4).alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells(start_row=header_row, start_column=20, end_row=header_row, end_column=23)
    ws.cell(header_row, 20, "AMOUNT"); ws.cell(header_row, 20).font = bold_white_table; ws.cell(header_row, 20).fill = dark_band; ws.cell(header_row, 20).alignment = Alignment(horizontal="center", vertical="center")

    # Outer border around content area
    for col in range(2, 24):
        ws.cell(header_row, col).border = box

    # --- Line items ---
    rows_items = []
    main_desc_parts = ["Biaya Pengiriman Barang"]
    suffix = []
    if awb.get("service"): suffix.append(awb["service"])
    if awb.get("armada"): suffix.append(awb["armada"])
    if suffix: main_desc_parts.append(" ".join(suffix))
    rows_items.append({"desc": " - ".join(main_desc_parts), "amount": awb.get("total_tariff") or 0, "with_detail": True})

    asuransi_val = float(awb.get("received_asuransi_amount") or awb.get("insurance_amount") or 0)
    polis_val = float(awb.get("received_polis_amount") or awb.get("polis_amount") or 0)
    spsi_val = float((awb.get("spsi_amount") or 0)) if awb.get("spsi_enabled") else 0
    forklift_val = float((awb.get("sewa_forklift_amount") or 0)) if awb.get("sewa_forklift_enabled") else 0

    if asuransi_val: rows_items.append({"desc": "Asuransi", "amount": asuransi_val})
    if polis_val:    rows_items.append({"desc": "Polis", "amount": polis_val})
    if spsi_val:     rows_items.append({"desc": "SPSI", "amount": spsi_val})
    if forklift_val: rows_items.append({"desc": "Sewa Forklift", "amount": forklift_val})

    row = header_row + 1
    for idx, it in enumerate(rows_items, 1):
        ws.cell(row, 2, f"{idx}.").font = regular
        ws.merge_cells(start_row=row, start_column=4, end_row=row, end_column=19)
        ws.cell(row, 4, it["desc"]).font = regular
        ws.merge_cells(start_row=row, start_column=20, end_row=row, end_column=23)
        amt_cell = ws.cell(row, 20, it["amount"])
        amt_cell.number_format = "#,##0"; amt_cell.alignment = Alignment(horizontal="right"); amt_cell.font = regular
        # Side borders only on outer columns
        ws.cell(row, 2).border = Border(left=thin)
        ws.cell(row, 23).border = Border(right=thin)
        if it.get("with_detail"):
            for label, val in [("Tanggal", _fmt_id_date(awb.get("created_at"))), ("Origin", awb.get("origin", "")), ("Tujuan", awb.get("destination", ""))]:
                row += 1
                ws.cell(row, 4, label).font = regular
                ws.cell(row, 7, ":").font = regular
                ws.merge_cells(start_row=row, start_column=8, end_row=row, end_column=14)
                ws.cell(row, 8, val).font = regular
                ws.cell(row, 2).border = Border(left=thin)
                ws.cell(row, 23).border = Border(right=thin)
        row += 2

    # Close the items area with a bottom line
    last_items_row = row - 1
    for col in range(2, 24):
        ws.cell(last_items_row, col).border = Border(bottom=thin, left=thin if col == 2 else None, right=thin if col == 23 else None)

    # --- Terbilang (left side) ---
    terb_row = last_items_row + 2
    ws.cell(terb_row, 2, "Terbilang").font = bold
    ws.merge_cells(start_row=terb_row + 2, start_column=2, end_row=terb_row + 5, end_column=13)
    grand_total = (awb.get("total_tariff") or 0) + (awb.get("tax_amount") or 0) + asuransi_val + polis_val + spsi_val + forklift_val
    terb_cell = ws.cell(terb_row + 2, 2, _terbilang_id(int(round(grand_total))) + " Rupiah")
    terb_cell.font = italic
    terb_cell.alignment = Alignment(wrap_text=True, vertical="top")

    # --- Summary block (right side, cols O..W) ---
    sub_total = awb.get("total_tariff") or 0
    ppn_pct = awb.get("tax_percentage") or 0
    ppn_amt = awb.get("tax_amount") or 0
    sub_after_tax = sub_total + ppn_amt
    s_row = terb_row
    def _sum(rr, label, val, bold_row=False, fill=None):
        ws.cell(rr, 15, label).font = (bold if bold_row else regular)
        ws.cell(rr, 20, "Rp.").font = (bold if bold_row else regular)
        ws.cell(rr, 20).alignment = Alignment(horizontal="left")
        ws.merge_cells(start_row=rr, start_column=21, end_row=rr, end_column=23)
        c2 = ws.cell(rr, 21, val if val else None)
        if val:
            c2.number_format = "#,##0"
        else:
            c2.value = "-"
            c2.alignment = Alignment(horizontal="right")
        c2.font = bold if bold_row else regular
        c2.alignment = Alignment(horizontal="right")
        if fill is not None:
            for c in range(15, 24): ws.cell(rr, c).fill = fill
        # bottom border for separation
        for c in range(15, 24): ws.cell(rr, c).border = Border(bottom=thin)
    _sum(s_row + 0, "Jumlah", sub_total)
    pct_label = f"{ppn_pct:.1f}".rstrip("0").rstrip(".") if ppn_pct else "0"
    _sum(s_row + 1, f"   >> PPN {pct_label}%", ppn_amt)
    _sum(s_row + 2, "Sub Total", sub_after_tax)
    _sum(s_row + 3, "   >> Asuransi", asuransi_val)
    _sum(s_row + 4, "   >> Polis", polis_val)
    _sum(s_row + 5, "   >> Adm", 0)
    _sum(s_row + 6, "   >> Materai", 0)
    extra_idx = 7
    if spsi_val: _sum(s_row + extra_idx, "   >> SPSI", spsi_val); extra_idx += 1
    if forklift_val: _sum(s_row + extra_idx, "   >> Sewa Forklift", forklift_val); extra_idx += 1
    last_sum = s_row + extra_idx
    _sum(last_sum, "TOTAL", grand_total, bold_row=True, fill=light_grey)

    # --- Bank box (bottom left) ---
    bank_row = max(terb_row + 9, last_sum + 3)
    ws.merge_cells(start_row=bank_row, start_column=3, end_row=bank_row, end_column=8)
    ws.cell(bank_row, 3, "BANK ADDRESS").font = bold
    ws.cell(bank_row, 3).alignment = Alignment(horizontal="center")
    ws.merge_cells(start_row=bank_row + 1, start_column=3, end_row=bank_row + 1, end_column=8)
    ws.cell(bank_row + 1, 3, "Account Rupiah ( IDR )").font = small
    ws.cell(bank_row + 1, 3).alignment = Alignment(horizontal="center")
    # Dark band w/ bank name
    ws.merge_cells(start_row=bank_row + 3, start_column=3, end_row=bank_row + 4, end_column=8)
    bk = ws.cell(bank_row + 3, 3, bank_name)
    bk.font = Font(name="Calibri", bold=True, size=22, color="FFFFFF")
    bk.fill = dark_band; bk.alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells(start_row=bank_row + 5, start_column=3, end_row=bank_row + 5, end_column=8)
    sub = ws.cell(bank_row + 5, 3, f"PT. Bank {bank_name} (Persero)")
    sub.font = small; sub.alignment = Alignment(horizontal="center")
    # A/N + A/C
    ws.cell(bank_row + 7, 3, "A/N").font = regular
    ws.cell(bank_row + 7, 4, f": {bank_holder}").font = regular
    ws.cell(bank_row + 8, 3, "A/C").font = regular
    ws.cell(bank_row + 8, 4, f": {bank_account}").font = regular
    # Border around bank box
    for r in range(bank_row, bank_row + 10):
        ws.cell(r, 2).border = Border(left=thin)
        ws.cell(r, 9).border = Border(right=thin)
    for c in range(2, 10):
        ws.cell(bank_row, c).border = Border(top=thin, left=thin if c == 2 else None, right=thin if c == 9 else None)
        ws.cell(bank_row + 9, c).border = Border(bottom=thin, left=thin if c == 2 else None, right=thin if c == 9 else None)

    # --- Signature block (bottom right) ---
    sig_row = bank_row
    ws.merge_cells(start_row=sig_row, start_column=17, end_row=sig_row, end_column=23)
    ws.cell(sig_row, 17, f"Jakarta,  {_fmt_id_date(inv_date)}").font = regular
    ws.merge_cells(start_row=sig_row + 6, start_column=17, end_row=sig_row + 6, end_column=23)
    sgn = ws.cell(sig_row + 6, 17, f"(  {signer_name or '...........................'}  )")
    sgn.font = bold; sgn.alignment = Alignment(horizontal="center")


def _fmt_id_date(d):
    if not d: return ""
    if hasattr(d, "tzinfo") and d.tzinfo: d = d.replace(tzinfo=None)
    months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    try: return f"{d.day} {months[d.month - 1]} {d.year}"
    except Exception: return str(d)



def _terbilang_id(n: int) -> str:
    """Simple Indonesian number-to-words."""
    if n < 0: return "Minus " + _terbilang_id(-n)
    angka = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan",
             "Sepuluh", "Sebelas"]
    if n < 12:
        return angka[n] if n > 0 else "Nol"
    if n < 20: return _terbilang_id(n - 10) + " Belas"
    if n < 100: return _terbilang_id(n // 10) + " Puluh" + ("" if n % 10 == 0 else " " + _terbilang_id(n % 10))
    if n < 200: return "Seratus" + ("" if n == 100 else " " + _terbilang_id(n - 100))
    if n < 1000: return _terbilang_id(n // 100) + " Ratus" + ("" if n % 100 == 0 else " " + _terbilang_id(n % 100))
    if n < 2000: return "Seribu" + ("" if n == 1000 else " " + _terbilang_id(n - 1000))
    if n < 1_000_000: return _terbilang_id(n // 1000) + " Ribu" + ("" if n % 1000 == 0 else " " + _terbilang_id(n % 1000))
    if n < 1_000_000_000: return _terbilang_id(n // 1_000_000) + " Juta" + ("" if n % 1_000_000 == 0 else " " + _terbilang_id(n % 1_000_000))
    return _terbilang_id(n // 1_000_000_000) + " Miliar" + ("" if n % 1_000_000_000 == 0 else " " + _terbilang_id(n % 1_000_000_000))


async def _fetch_invoice_bundle(invoice_id: str):
    inv = await db.invoices.find_one({"_id": _oid(invoice_id)})
    if not inv: raise HTTPException(404, "Invoice tidak ditemukan")
    awb = await db.awb_orders.find_one({"_id": inv["awb_id"]})
    customer = await db.customers.find_one({"_id": awb["customer_id"]}) if awb else None
    return inv, awb, customer


@app.get("/api/exports/invoice/{invoice_id}")
async def export_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
    inv, awb, customer = await _fetch_invoice_bundle(invoice_id)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = (inv.get("invoice_number") or "Invoice")[-31:]
    await _build_invoice_sheet(ws, inv, awb, customer)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    fname = f"Invoice_{inv.get('invoice_number', invoice_id)}.xlsx"
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})


class BulkExportIn(BaseModel):
    invoice_ids: List[str]

@app.post("/api/exports/invoices/bulk")
async def export_invoices_bulk(data: BulkExportIn, user: dict = Depends(get_current_user)):
    if not data.invoice_ids: raise HTTPException(400, "invoice_ids kosong")
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)
    count = 0
    for iid in data.invoice_ids:
        try:
            inv, awb, customer = await _fetch_invoice_bundle(iid)
            sname = (inv.get("invoice_number") or iid)[-31:].replace("/", "-")
            ws = wb.create_sheet(title=sname)
            await _build_invoice_sheet(ws, inv, awb, customer)
            count += 1
        except Exception:
            continue
    if count == 0: raise HTTPException(400, "Tidak ada invoice valid")
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    fname = f"Invoice_Bulk_{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})

# --- Invoice logo upload (stored as base64 in settings) ---------------------
import base64

class LogoUploadIn(BaseModel):
    image_b64: str  # data URL or raw base64

@app.post("/api/settings/invoice-logo")
async def upload_invoice_logo(data: LogoUploadIn, user: dict = Depends(require_role("administrator"))):
    raw = data.image_b64
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    # Validate is decodable
    try:
        decoded = base64.b64decode(raw)
        if len(decoded) > 2 * 1024 * 1024:
            raise HTTPException(400, "Logo terlalu besar (max 2MB)")
    except HTTPException: raise
    except Exception:
        raise HTTPException(400, "Logo tidak valid base64")
    await db.settings.update_one(
        {"key_name": "invoice_logo_b64"},
        {"$set": {"key_name": "invoice_logo_b64", "key_value": raw}},
        upsert=True,
    )
    return {"ok": True, "size_bytes": len(decoded)}

# --- Reclass Paid vendor cost back to Accrue (revisi salah post) -----------
@app.post("/api/costs/{cid}/reclass-to-accrue")
async def reclass_cost_to_accrue(cid: str, user: dict = Depends(require_role("finance"))):
    cost = await db.awb_costs.find_one({"_id": _oid(cid)})
    if not cost:
        raise HTTPException(404, "Biaya tidak ditemukan")
    if cost.get("payment_type") != "Cash":
        raise HTTPException(400, "Hanya biaya yang berstatus Paid yang bisa di-reclass")
    if cost.get("cost_category") != "Vendor":
        raise HTTPException(400, "Hanya biaya kategori Vendor yang bisa di-reclass ke Hutang")
    prev_cash_acc = cost.get("cash_account_code") or "1101"
    now = datetime.now(timezone.utc)
    await db.awb_costs.update_one(
        {"_id": _oid(cid)},
        {"$set": {
            "payment_type": "Accrue",
            "is_settled": False,
            "reclassed_at": now,
            "reclassed_by": user["id"],
        }, "$unset": {"settled_at": "", "cash_account_code": ""}},
    )
    # Reverse journal: DR Cash / CR Hutang Usaha
    try:
        awb = await db.awb_orders.find_one({"_id": cost["awb_id"]})
        awb_no = awb["awb_number"] if awb else ""
        await post_journal(
            date=now,
            description=f"Reclass paid vendor {cost.get('vendor_name') or ''} ({awb_no}) → Hutang",
            lines=[
                {"account_code": prev_cash_acc, "debit": cost["amount"], "credit": 0, "memo": f"Reclass {awb_no}"},
                {"account_code": "2101", "debit": 0, "credit": cost["amount"], "memo": cost.get("vendor_name") or ""},
            ],
            reference_type="cost_reclass", reference_id=cid, posted_by=user["id"],
        )
    except HTTPException:
        pass
    return {"ok": True}

# ===========================================================================
# Petty Cash / Panjar Non-AWB (Operational expenses without AWB) — direct cost
# Lintas, Operational, Umum, Kantor, dll. Semua masuk sebagai HPP (5102).
# ===========================================================================
PETTY_CASH_CATEGORIES = ["Operational", "Lintas", "Umum", "Kantor", "Lainnya"]

class PettyCashIn(BaseModel):
    category: str  # one of PETTY_CASH_CATEGORIES
    amount: float
    description: Optional[str] = None
    expense_date: Optional[str] = None  # YYYY-MM-DD; default today
    cash_account_code: Optional[str] = None  # default 1101

async def next_petty_cash_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"PC-{yyyymm}-"
    last = await db.petty_cash.find_one({"number": {"$regex": f"^{prefix}"}}, sort=[("number", -1)])
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["number"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

@app.get("/api/petty-cash")
async def list_petty_cash(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if month:
        try:
            year, mon = month.split("-")
            year, mon = int(year), int(mon)
            start = datetime(year, mon, 1, tzinfo=timezone.utc)
            end = datetime(year + (1 if mon == 12 else 0), 1 if mon == 12 else mon + 1, 1, tzinfo=timezone.utc)
            q["expense_date"] = {"$gte": start, "$lt": end}
        except Exception:
            pass
    docs = await db.petty_cash.find(q).sort("expense_date", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/petty-cash")
async def create_petty_cash(data: PettyCashIn, user: dict = Depends(require_role("finance", "operation"))):
    if data.category not in PETTY_CASH_CATEGORIES:
        raise HTTPException(400, f"Kategori harus salah satu: {', '.join(PETTY_CASH_CATEGORIES)}")
    if data.amount <= 0:
        raise HTTPException(400, "Nominal harus > 0")
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    if data.expense_date:
        try:
            y, m, d = [int(x) for x in data.expense_date.split("-")]
            now = datetime.now(timezone.utc)
            exp_date = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "expense_date harus YYYY-MM-DD")
    else:
        exp_date = datetime.now(timezone.utc)
    doc = {
        "number": await next_petty_cash_number(),
        "category": data.category,
        "amount": float(data.amount),
        "description": (data.description or "").strip() or None,
        "expense_date": exp_date,
        "cash_account_code": cash_acc,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.petty_cash.insert_one(doc)
    # Journal: DR 5102 (Operational/direct cost as HPP) / CR Kas/Bank
    try:
        await post_journal(
            date=exp_date,
            description=f"Petty Cash {doc['number']} — {data.category}: {data.description or ''}",
            lines=[
                {"account_code": "5102", "debit": doc["amount"], "credit": 0, "memo": f"{data.category} - {doc['number']}"},
                {"account_code": cash_acc, "debit": 0, "credit": doc["amount"], "memo": doc["number"]},
            ],
            reference_type="petty_cash", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException:
        pass
    return serialize(await db.petty_cash.find_one({"_id": r.inserted_id}))

@app.delete("/api/petty-cash/{pid}")
async def delete_petty_cash(pid: str, user: dict = Depends(require_role("administrator", "finance"))):
    pc = await db.petty_cash.find_one({"_id": _oid(pid)})
    if not pc:
        raise HTTPException(404, "Petty cash tidak ditemukan")
    await db.petty_cash.delete_one({"_id": _oid(pid)})
    await db.journal_entries.delete_many({"reference_type": "petty_cash", "reference_id": pid})
    return {"ok": True, "deleted": pc.get("number")}

# ===========================================================================
# PO / Surat Perintah Vendor (Manifest) — bisa dengan/tanpa AWB
# ===========================================================================
class POIn(BaseModel):
    vendor_name: str
    description: str
    amount: float
    awb_id: Optional[str] = None  # optional — jika ada → otomatis cost ke AWB tersebut
    po_date: Optional[str] = None
    notes: Optional[str] = None

async def next_po_number() -> str:
    yyyymm = datetime.now(timezone.utc).strftime("%Y%m")
    prefix = f"PO-{yyyymm}-"
    last = await db.purchase_orders.find_one({"number": {"$regex": f"^{prefix}"}}, sort=[("number", -1)])
    seq = 1
    if last:
        m = re.search(r"-(\d+)$", last["number"])
        if m:
            seq = int(m.group(1)) + 1
    return f"{prefix}{seq:04d}"

@app.get("/api/purchase-orders")
async def list_purchase_orders(user: dict = Depends(get_current_user)):
    docs = await db.purchase_orders.find().sort("po_date", -1).to_list(2000)
    out = []
    for d in docs:
        s = serialize(d)
        if d.get("awb_id"):
            awb = await db.awb_orders.find_one({"_id": d["awb_id"]})
            s["awb_number"] = awb["awb_number"] if awb else None
        out.append(s)
    return out

@app.post("/api/purchase-orders")
async def create_purchase_order(data: POIn, user: dict = Depends(require_role("operation", "finance"))):
    if data.amount <= 0:
        raise HTTPException(400, "Nominal PO harus > 0")
    if data.po_date:
        try:
            y, m, d = [int(x) for x in data.po_date.split("-")]
            now = datetime.now(timezone.utc)
            po_dt = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "po_date harus YYYY-MM-DD")
    else:
        po_dt = datetime.now(timezone.utc)
    doc = {
        "number": await next_po_number(),
        "vendor_name": data.vendor_name.strip(),
        "description": data.description.strip(),
        "amount": float(data.amount),
        "awb_id": _oid(data.awb_id) if data.awb_id else None,
        "po_date": po_dt,
        "notes": (data.notes or "").strip() or None,
        "status": "Open",  # Open / Received POD / Cancelled
        "linked_cost_id": None,  # if AWB given, auto-create cost
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.purchase_orders.insert_one(doc)
    # If AWB given → auto-create vendor cost (accrue) on that AWB
    if data.awb_id:
        awb = await db.awb_orders.find_one({"_id": _oid(data.awb_id)})
        if not awb:
            raise HTTPException(400, "AWB id tidak ditemukan")
        cost_doc = {
            "awb_id": _oid(data.awb_id),
            "cost_category": "Vendor",
            "amount": float(data.amount),
            "description": f"PO {doc['number']} - {data.description}",
            "sub_label": "PO Vendor",
            "vendor_name": data.vendor_name.strip(),
            "payment_type": "Accrue",
            "is_settled": False,
            "source": "purchase_order",
            "source_ref": str(r.inserted_id),
            "created_by": user["id"],
            "created_at": po_dt,
        }
        cr = await db.awb_costs.insert_one(cost_doc)
        await db.purchase_orders.update_one({"_id": r.inserted_id}, {"$set": {"linked_cost_id": str(cr.inserted_id)}})
        # Journal: DR 5101 Vendor / CR 2101 Hutang Usaha
        try:
            await post_journal(
                date=po_dt,
                description=f"PO {doc['number']} → cost {awb['awb_number']}",
                lines=[
                    {"account_code": "5101", "debit": doc["amount"], "credit": 0, "memo": f"PO {doc['number']} - {data.vendor_name}"},
                    {"account_code": "2101", "debit": 0, "credit": doc["amount"], "memo": data.vendor_name},
                ],
                reference_type="cost", reference_id=str(cr.inserted_id), posted_by=user["id"],
            )
        except HTTPException:
            pass
        try:
            await recognize_revenue_for_awb(_oid(data.awb_id), user["id"], trigger_date=po_dt)
        except Exception:
            pass
    return serialize(await db.purchase_orders.find_one({"_id": r.inserted_id}))

class POReceiveIn(BaseModel):
    pod_date: Optional[str] = None
    pod_notes: Optional[str] = None

@app.post("/api/purchase-orders/{pid}/receive-pod")
async def receive_pod(pid: str, data: POReceiveIn = POReceiveIn(), user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"_id": _oid(pid)})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan")
    if data.pod_date:
        try:
            y, m, d = [int(x) for x in data.pod_date.split("-")]
            now = datetime.now(timezone.utc)
            pod_dt = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "pod_date harus YYYY-MM-DD")
    else:
        pod_dt = datetime.now(timezone.utc)
    await db.purchase_orders.update_one(
        {"_id": _oid(pid)},
        {"$set": {"status": "Received POD", "pod_date": pod_dt, "pod_notes": (data.pod_notes or "").strip() or None, "pod_received_by": user["id"]}}
    )
    return serialize(await db.purchase_orders.find_one({"_id": _oid(pid)}))

@app.delete("/api/purchase-orders/{pid}")
async def delete_purchase_order(pid: str, user: dict = Depends(require_role("administrator", "operation"))):
    po = await db.purchase_orders.find_one({"_id": _oid(pid)})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan")
    # Cascade: hapus linked cost & journal-nya
    if po.get("linked_cost_id"):
        try:
            cid = po["linked_cost_id"]
            cost = await db.awb_costs.find_one({"_id": _oid(cid)})
            if cost:
                if cost.get("is_settled"):
                    raise HTTPException(400, "Cost terkait sudah disettle — tidak bisa hapus PO. Reverse pembayaran dulu.")
                await db.awb_costs.delete_one({"_id": _oid(cid)})
                await db.journal_entries.delete_many({"reference_type": "cost", "reference_id": cid})
        except HTTPException:
            raise
        except Exception:
            pass
    await db.purchase_orders.delete_one({"_id": _oid(pid)})
    return {"ok": True, "deleted": po.get("number")}

# ===========================================================================
# Sender memory (autocomplete pengirim) — per customer
# ===========================================================================
@app.get("/api/sender-suggestions")
async def sender_suggestions(customer_id: str, user: dict = Depends(get_current_user)):
    docs = await db.sender_memory.find({"customer_id": _oid(customer_id)}).sort("last_used", -1).to_list(200)
    return [{"id": str(d["_id"]), "name": d.get("name"), "use_count": d.get("use_count", 0)} for d in docs]

@app.delete("/api/sender-suggestions/{sid}")
async def delete_sender_suggestion(sid: str, user: dict = Depends(get_current_user)):
    await db.sender_memory.delete_one({"_id": _oid(sid)})
    return {"ok": True}

# ===========================================================================
# Vendor Aging — hutang vendor (akrual) bucket by umur
# ===========================================================================
@app.get("/api/reports/vendor-aging")
async def vendor_aging(as_of: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Aging hutang vendor (accrue & belum settled) per vendor + bucket umur."""
    if as_of:
        try:
            y, m, d = [int(x) for x in as_of.split("-")]
            ref_date = datetime(y, m, d, 23, 59, 59, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "as_of harus YYYY-MM-DD")
    else:
        ref_date = datetime.now(timezone.utc)
    # Outstanding = accrued vendor costs (is_settled=false)
    costs = await db.awb_costs.find({
        "cost_category": "Vendor",
        "payment_type": "Accrue",
        "is_settled": {"$ne": True},
    }).to_list(20000)
    awb_ids = list({c["awb_id"] for c in costs if c.get("awb_id")})
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": awb_ids}}).to_list(20000)}
    buckets = ["0-30", "31-60", "61-90", "90+"]
    by_vendor: dict = {}
    for c in costs:
        vendor = (c.get("vendor_name") or "(Tanpa nama vendor)").strip() or "(Tanpa nama vendor)"
        cdate = c.get("created_at") or ref_date
        days = max(0, (ref_date - cdate).days) if isinstance(cdate, datetime) else 0
        if days <= 30:
            bucket = "0-30"
        elif days <= 60:
            bucket = "31-60"
        elif days <= 90:
            bucket = "61-90"
        else:
            bucket = "90+"
        amt = float(c.get("amount") or 0)
        if vendor not in by_vendor:
            by_vendor[vendor] = {"vendor": vendor, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, "total": 0, "items": []}
        by_vendor[vendor][bucket] += amt
        by_vendor[vendor]["total"] += amt
        awb_doc = amap.get(c.get("awb_id"))
        by_vendor[vendor]["items"].append({
            "cost_id": str(c["_id"]),
            "awb_number": awb_doc["awb_number"] if awb_doc else "",
            "amount": amt,
            "created_at": cdate.isoformat() if isinstance(cdate, datetime) else None,
            "days": days,
            "bucket": bucket,
            "description": c.get("description") or "",
        })
    rows = list(by_vendor.values())
    rows.sort(key=lambda r: r["total"], reverse=True)
    totals = {b: sum(r[b] for r in rows) for b in buckets}
    totals["total"] = sum(r["total"] for r in rows)
    return {
        "as_of": ref_date.isoformat(),
        "buckets": buckets,
        "rows": rows,
        "totals": totals,
        "count_vendors": len(rows),
    }
