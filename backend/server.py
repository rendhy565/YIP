from dotenv import load_dotenv
load_dotenv()

import os
import re
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, status, UploadFile, File, Form
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

def _serialize_value(v):
    """Recursive helper for serialize() — handles ObjectId, datetime, nested dicts/lists."""
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, list):
        return [_serialize_value(x) for x in v]
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            out[k] = _serialize_value(val)
        return out
    return v

def serialize(doc: dict) -> dict:
    if doc is None:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for k, v in list(doc.items()):
        doc[k] = _serialize_value(v)
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
    {"key": "invoices_created", "label": "Invoice Tercetak", "default_roles": ["finance"]},
    {"key": "payments", "label": "Pembayaran", "default_roles": ["finance"]},
    {"key": "costs", "label": "Plotting Biaya", "default_roles": ["operation", "finance"]},
    {"key": "accrue", "label": "Settle Hutang Vendor", "default_roles": ["finance"]},
    {"key": "fixed_costs", "label": "Expense (Biaya Operasional)", "default_roles": ["finance"]},
    {"key": "expense_categories", "label": "Master Kategori Expense", "default_roles": ["finance"]},
    {"key": "customers", "label": "Master Customer", "default_roles": ["operation", "finance"]},
    {"key": "contracts", "label": "Master Kontrak", "default_roles": ["operation", "finance"]},
    {"key": "pnl", "label": "Laporan Laba Rugi", "default_roles": ["operation", "finance"]},
    {"key": "settings", "label": "Pengaturan", "default_roles": ["operation", "finance"]},
    {"key": "purchase_orders", "label": "PO / Surat Perintah Vendor", "default_roles": ["operation", "finance"]},
    {"key": "user_management", "label": "User Management", "default_roles": []},
    {"key": "dashboard", "label": "Dashboard", "default_roles": ["operation", "finance"]},
    # ---- Optional modules (toggled globally via feature flags). Permission per-user is still required. ----
    {"key": "accounting", "label": "Akunting (PSAK)", "default_roles": ["finance"], "is_feature": True},
    {"key": "hr", "label": "HR & Payroll", "default_roles": [], "is_feature": True},
    {"key": "tax", "label": "Perpajakan (PPN/PPh)", "default_roles": [], "is_feature": True},
    {"key": "asset", "label": "Aset Tetap & Depresiasi", "default_roles": [], "is_feature": True},
    {"key": "bank_recon", "label": "Rekonsiliasi Bank", "default_roles": [], "is_feature": True},
]
MODULE_KEYS = [m["key"] for m in MODULES]

# ---------------------------------------------------------------------------
# MODULE_FEATURES: granular per-button permissions (per modul, per fitur spesifik)
# Structure: {module_key: [(feature_key, label), ...]}
# Used by Users.js permission matrix + useCan() hook in frontend
# ---------------------------------------------------------------------------
MODULE_FEATURES: dict = {
    "dashboard": [
        ("view_status_counts", "Kartu Status AWB (Open/Rekonsiliasi/Invoiced/Lunas)"),
        ("view_revenue_kpi", "Kartu Total Pendapatan"),
        ("view_cost_kpi", "Kartu Total Biaya"),
        ("view_hutang_kpi", "Kartu Hutang Vendor"),
        ("view_pymhd_panel", "Panel Pipeline PYMHD (PSAK 72)"),
        ("view_recurring_widget", "Widget Notifikasi Recurring Expense"),
    ],
    "orders_input": [
        ("create", "Tambah AWB Baru"),
    ],
    "orders_list": [
        ("receive", "Tombol Terima Barang"),
        ("pod", "Tombol POD"),
        ("edit_receive", "Edit Data Terima"),
        ("edit_pod", "Edit Data POD"),
        ("view_cost", "Lihat & Tambah Cost"),
        ("drop", "Drop AWB"),
        ("delete", "Hapus AWB"),
        ("export_open", "Export Open AWB"),
    ],
    "recap": [
        ("edit_selling", "Edit Selling / Data AWB"),
        ("reconcile", "Reconcile AWB"),
        ("delete", "Hapus AWB"),
        ("export", "Export Recap"),
    ],
    "invoices": [
        ("create", "Buat Invoice"),
        ("delete_draft", "Hapus Draft Invoice"),
    ],
    "invoices_created": [
        ("cancel", "Cancel Invoice Tercetak"),
        ("import_numbers", "Import Invoice No (Mark Status)"),
        ("export_fpk", "Export FPK (Faktur Pajak)"),
        ("export_ar", "Export Report AR"),
        ("bulk_print", "Bulk Print / Save PDF"),
        ("save_po_number", "Simpan PO Number"),
    ],
    "payments": [
        ("mark_paid", "Mark Paid (Single)"),
        ("mark_paid_bulk", "Mark Paid (Bulk)"),
        ("multi_payment", "Multi-Bayar (Partial)"),
        ("delete_receipt", "Hapus Receipt Pembayaran"),
    ],
    "costs": [
        ("add", "Tambah Cost Item"),
        ("edit", "Edit Cost Item"),
        ("delete", "Hapus Cost Item"),
    ],
    "accrue": [
        ("settle", "Settle Hutang Vendor"),
        ("delete_settlement", "Hapus Settlement"),
    ],
    "fixed_costs": [
        ("create", "Tambah Expense"),
        ("edit", "Edit Expense"),
        ("delete", "Hapus Expense"),
        ("import_bkk", "Import BKK Excel"),
        ("petty_cash_create", "Tambah Panjar Kerja"),
        ("petty_cash_settle", "Settlement Panjar"),
        ("petty_cash_delete", "Hapus Panjar"),
    ],
    "expense_categories": [
        ("create", "Tambah Kategori"),
        ("edit", "Edit Kategori"),
        ("delete", "Hapus Kategori"),
    ],
    "purchase_orders": [
        ("create", "Buat PO"),
        ("edit_item", "Edit Item PO"),
        ("delete", "Hapus PO"),
        ("send_wa", "Kirim WA ke Vendor"),
        ("print", "Cetak / Print PO"),
    ],
    "customers": [
        ("create", "Tambah Customer"),
        ("edit", "Edit Customer"),
        ("delete", "Hapus Customer"),
    ],
    "contracts": [
        ("create", "Buat Kontrak"),
        ("edit", "Edit Kontrak"),
        ("delete", "Hapus Kontrak"),
    ],
    "pnl": [
        ("export", "Export Laporan P&L"),
    ],
    "settings": [
        ("edit", "Edit Settings"),
    ],
    "user_management": [
        ("create", "Tambah User"),
        ("edit", "Edit User"),
        ("delete", "Hapus User"),
        ("change_password", "Ubah Password User"),
        ("edit_permissions", "Edit Permission User"),
    ],
    "accounting": [
        ("view_journal", "Lihat Jurnal"),
        ("post_journal", "Post Jurnal Manual"),
        ("delete_journal", "Hapus Jurnal"),
    ],
    "tax": [
        ("file_ppn", "File SPT PPN"),
        ("export_efaktur", "Export e-Faktur"),
    ],
}
# Modules without granular features get a single "access" feature so admin can still toggle
for _m in MODULES:
    if _m["key"] not in MODULE_FEATURES:
        MODULE_FEATURES[_m["key"]] = [("access", "Akses Modul")]

# Sanity: catch drift between MODULES list and MODULE_FEATURES catalog at startup
_orphan_features = set(MODULE_FEATURES.keys()) - set(MODULE_KEYS)
if _orphan_features:
    raise RuntimeError(f"MODULE_FEATURES contains modules not in MODULES list: {_orphan_features}. Add them to MODULES or remove from MODULE_FEATURES.")

def all_features_dict() -> dict:
    """Return {module_key: {feature_key: True}} for ALL modules & features. Used for admin defaults."""
    return {mk: {fk: True for (fk, _) in flist} for mk, flist in MODULE_FEATURES.items()}


def derive_permissions_from_actions(pa: dict) -> List[str]:
    """Derive `permissions` (module-level access list) from `permission_actions`.
    A module is included only if ≥1 feature in it is True. This makes permissions a
    derived/computed value driven by the granular feature toggles."""
    if not pa or not isinstance(pa, dict):
        return []
    out = []
    for mk, feats in pa.items():
        if isinstance(feats, dict) and any(bool(v) for v in feats.values()):
            out.append(mk)
    return out


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
    permission_actions: Optional[dict] = None
    active: bool = True

class UserCreateIn(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    role: str  # administrator | operation | finance
    permissions: Optional[List[str]] = None  # if None → use default_permissions(role)
    permission_actions: Optional[dict] = None  # {module_key: {view,create,edit,delete,import,export: bool}}

class UserUpdateIn(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[List[str]] = None
    permission_actions: Optional[dict] = None
    active: Optional[bool] = None

class PasswordResetIn(BaseModel):
    password: str

class CustomerIn(BaseModel):
    name: str
    company_details: Optional[str] = None
    address: Optional[str] = None
    npwp: Optional[str] = None
    tracking_code: Optional[str] = None  # short human-friendly public tracking code (unique, editable)

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
    armada_requested: Optional[str] = None  # armada yang di-request customer (untuk tagihan invoice)
    armada_internal: Optional[str] = None   # armada yang benar-benar dipakai pickup (internal)
    container_type: Optional[str] = None    # untuk service FCL: 20FT / 20FT HQ / 40FT / 40FT HQ / OPEN TOP
    driver_name: Optional[str] = None
    nopol: Optional[str] = None
    insurance_enabled: Optional[bool] = False
    polis_amount: Optional[float] = None  # Nilai Polis (IDR) — penambah total invoice
    insurance_amount: Optional[float] = None  # Nilai Asuransi (IDR) — penambah total invoice
    # --- Jadwal & Lead Time ---
    closing_date: Optional[str] = None       # YYYY-MM-DD (khusus Laut)
    etd: Optional[str] = None                # YYYY-MM-DD Estimated Time Departure dari asal/pelabuhan
    eta: Optional[str] = None                # YYYY-MM-DD Estimated Time Arrival di tujuan/pelabuhan
    plan_eta_customer: Optional[str] = None  # YYYY-MM-DD rencana ETA di gudang customer
    # --- Notes / Keterangan bebas untuk internal reference ---
    notes: Optional[str] = None

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
    category: str  # name from db.expense_categories
    description: Optional[str] = None
    amount: float
    expense_date: Optional[str] = None  # YYYY-MM-DD; preferred (datepicker). If absent, derived from period_month.
    period_month: Optional[str] = None  # YYYY-MM (legacy); if absent, derived from expense_date
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
    received_notes: Optional[str] = None  # Catatan — optional

class AwbPodIn(BaseModel):
    """Terima POD pada AWB (Proof of Delivery — penerimaan barang oleh consignee)."""
    pod_date: Optional[str] = None
    pod_notes: Optional[str] = None
    pod_signed_by: Optional[str] = None

class TrackingIn(BaseModel):
    position: str  # teks bebas — posisi/status barang terakhir (mis. "Sudah loading di Cikarang")

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

# Default Expense Categories (seeded into db.expense_categories)
# posting_type: 'cogs' → posts to COGS (5xxx) — reduces Gross Margin
# posting_type: 'expense' → posts to Operating Expense (6xxx) — reduces Net Profit (below GM)
DEFAULT_EXPENSE_CATEGORIES = [
    {"name": "Operation",     "posting_type": "cogs",    "account_code": "5102", "is_system": True},
    {"name": "Marketing",     "posting_type": "cogs",    "account_code": "5104", "is_system": True},
    {"name": "Gaji",          "posting_type": "expense", "account_code": "6101", "is_system": True},
    {"name": "Sewa",          "posting_type": "expense", "account_code": "6102", "is_system": True},
    {"name": "Utilities",     "posting_type": "expense", "account_code": "6103", "is_system": True},
    {"name": "Administrasi",  "posting_type": "expense", "account_code": "6105", "is_system": True},
    {"name": "Lainnya",       "posting_type": "expense", "account_code": "6199", "is_system": True},
]

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
# Activity Log helpers + Notifications (in-app)
# ---------------------------------------------------------------------------
async def log_activity(user: Optional[dict], action: str, target_type: str, target_id: Optional[str] = None, summary: str = "", details: Optional[dict] = None):
    """Insert one activity log row. Non-blocking semantically (errors are swallowed)."""
    try:
        await db.activity_logs.insert_one({
            "user_id": (user or {}).get("id"),
            "user_name": (user or {}).get("username") or (user or {}).get("name"),
            "user_role": (user or {}).get("role"),
            "action": action,             # e.g. "create", "update", "delete", "import", "export"
            "target_type": target_type,   # e.g. "awb_order", "invoice", "cost", "expense", "payment_receipt"
            "target_id": target_id,
            "summary": summary,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc),
        })
    except Exception:
        pass

async def push_notification(user_id: Optional[str], title: str, message: str, level: str = "info", link: Optional[str] = None, broadcast: bool = False):
    """Create an in-app notification. If broadcast=True, sends to all users."""
    now = datetime.now(timezone.utc)
    base = {
        "title": title, "message": message, "level": level,
        "link": link, "read": False, "created_at": now,
    }
    try:
        if broadcast:
            users = await db.users.find({}).to_list(500)
            for u in users:
                await db.notifications.insert_one({**base, "user_id": str(u["_id"])})
        else:
            await db.notifications.insert_one({**base, "user_id": user_id})
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Expense Categories helpers
# ---------------------------------------------------------------------------
async def get_expense_category(name: str) -> Optional[dict]:
    """Lookup expense category by name (case-insensitive)."""
    if not name:
        return None
    return await db.expense_categories.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}, "active": {"$ne": False}})

async def _next_expense_account_code() -> str:
    """Find next available expense account code in 62XX range."""
    existing = await db.chart_of_accounts.find(
        {"code": {"$regex": "^62[0-9]{2}$"}}
    ).sort("code", -1).limit(1).to_list(1)
    if existing:
        last = int(existing[0]["code"])
        return str(last + 1)
    return "6201"

async def create_expense_category(name: str, posting_type: str = "expense", user_id: Optional[str] = None) -> dict:
    """Create new expense category. If posting_type='expense' (default), auto-create a new COA (62XX).
    If posting_type='cogs', reuses 5102 (Beban Operasional Pengiriman).
    """
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "Nama kategori tidak boleh kosong")
    existing = await get_expense_category(name)
    if existing:
        raise HTTPException(400, f"Kategori '{name}' sudah ada")
    posting_type = (posting_type or "expense").lower()
    if posting_type not in ("cogs", "expense"):
        raise HTTPException(400, "posting_type harus 'cogs' atau 'expense'")
    now = datetime.now(timezone.utc)
    if posting_type == "cogs":
        account_code = "5102"  # reuse Beban Operasional Pengiriman
    else:
        # Auto-create new COA in 62XX range
        account_code = await _next_expense_account_code()
        await db.chart_of_accounts.insert_one({
            "code": account_code,
            "name": f"Beban {name}",
            "type": "expense",
            "subtype": "operating_expense",
            "normal": "debit",
            "is_system": False,
            "active": True,
            "created_at": now,
        })
    doc = {
        "name": name,
        "posting_type": posting_type,
        "account_code": account_code,
        "is_system": False,
        "active": True,
        "created_at": now,
        "created_by": user_id,
    }
    r = await db.expense_categories.insert_one(doc)
    return await db.expense_categories.find_one({"_id": r.inserted_id})

# ---------------------------------------------------------------------------
# Lifespan / Seeding
# ---------------------------------------------------------------------------
async def seed_data():
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.awb_orders.create_index("awb_number", unique=True)
    # Invoice_number TIDAK unique — 1 nomor invoice bisa dipakai untuk multi-AWB (grouping).
    # Bila index unique legacy masih ada, drop-nya.
    try:
        idx_info = await db.invoices.index_information()
        if "invoice_number_1" in idx_info and idx_info["invoice_number_1"].get("unique"):
            await db.invoices.drop_index("invoice_number_1")
    except Exception:
        pass
    await db.invoices.create_index("invoice_number")  # non-unique, untuk lookup
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

    # Seed Expense Categories (replaces old hardcoded FIXED_COST_CATEGORIES list)
    # For SYSTEM categories: keep posting_type/account_code in sync with DEFAULT_EXPENSE_CATEGORIES
    # (so changing a default in code propagates to existing DBs)
    await db.expense_categories.create_index("name", unique=True)
    for ec in DEFAULT_EXPENSE_CATEGORIES:
        await db.expense_categories.update_one(
            {"name": ec["name"]},
            {
                "$set": {
                    "posting_type": ec["posting_type"],
                    "account_code": ec["account_code"],
                    "is_system": ec["is_system"],
                    "active": True,
                },
                "$setOnInsert": {"name": ec["name"], "created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
    # Migrate any legacy fixed_cost records whose category posting changed (e.g. Marketing → cogs).
    # We update the cached posting_type/account_code on existing rows so P&L picks them up correctly,
    # but only for records that match a system category name.
    async for cat in db.expense_categories.find({"is_system": True}):
        await db.fixed_costs.update_many(
            {"category": cat["name"]},
            {"$set": {"posting_type": cat["posting_type"], "account_code": cat["account_code"]}},
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

    # Tax settings (default 0/1.1/11). PPN 1% dinaikkan ke 1.1% per request user.
    await db.settings.delete_many({"key_name": "tax_ppn_12"})  # migrate: drop legacy if present
    # Migrasi: jika tax_ppn_1 masih bernilai "1", ubah ke "1.1"
    await db.settings.update_one(
        {"key_name": "tax_ppn_1", "key_value": "1"},
        {"$set": {"key_value": "1.1"}},
    )
    for key, val in [("tax_ppn_0", "0"), ("tax_ppn_1", "1.1"), ("tax_ppn_11", "11")]:
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
        # === Kop Surat Global (dipakai di header semua invoice) ===
        ("kop_address", "Grand Galaxy City RSK 6 No. 73 Jakasetia, Bekasi Selatan, Kota Bekasi, Jawa Barat 17147"),
        ("kop_phone", ""),
        ("kop_email", ""),
        ("kop_website", "http://ar-cargo.com"),
        ("kop_tagline", "Solusi Pengiriman Tercepat, Terpercaya dan Profesional via Darat, Laut, Udara"),
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

    # Fixed costs / Expenses
    fixed = await db.fixed_costs.find().to_list(5000)
    cat_map_bf = {c["name"]: c for c in await db.expense_categories.find({}).to_list(500)}
    for f in fixed:
        if await journal_exists_for("fixed_cost", str(f["_id"])):
            continue
        try:
            cat = cat_map_bf.get(f.get("category"))
            expense_code = f.get("account_code") or (cat or {}).get("account_code") or FIXED_COST_TO_COA.get(f["category"], "6199")
            cash_acc = f.get("cash_account_code") or "1101"
            ptype = f.get("posting_type") or (cat or {}).get("posting_type", "expense")
            label = "Beban Operasional" if ptype == "cogs" else "Beban"
            await post_journal(
                date=f.get("created_at"),
                description=f"[Backfill] {label} {f['category']} {f['period_month']}",
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

# Activity Log middleware — auto-log all successful mutating requests
@app.middleware("http")
async def activity_log_middleware(request, call_next):
    response = await call_next(request)
    try:
        method = request.method
        if method in ("POST", "PUT", "PATCH", "DELETE") and 200 <= response.status_code < 300:
            path = request.url.path
            # Skip noisy/internal endpoints
            skip_prefixes = ("/api/auth/", "/api/notifications/", "/api/activity-logs")
            if not any(path.startswith(p) for p in skip_prefixes):
                # Extract user from auth header
                auth = request.headers.get("authorization", "")
                user_info = {"id": None, "username": "anonymous", "role": ""}
                if auth.startswith("Bearer "):
                    try:
                        from jose import jwt as _jwt
                        payload = _jwt.decode(auth[7:], JWT_SECRET, algorithms=[JWT_ALG])
                        uid = payload.get("sub")
                        if uid:
                            u = await db.users.find_one({"_id": _oid(uid)})
                            if u:
                                user_info = {"id": str(u["_id"]), "username": u.get("username"), "role": u.get("role")}
                    except Exception:
                        pass
                # Derive target_type from path segments (after /api/)
                parts = [p for p in path.split("/") if p and p != "api"]
                target_type = parts[0] if parts else "unknown"
                # Derive target_id when present (e.g. /api/orders/<id>/... → id)
                target_id = None
                if len(parts) >= 2 and len(parts[1]) == 24:
                    target_id = parts[1]
                action_map = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}
                action = action_map.get(method, method.lower())
                # Refine for known sub-paths
                if "import" in path:
                    action = "import"
                elif "export" in path:
                    action = "export"
                await db.activity_logs.insert_one({
                    "user_id": user_info["id"],
                    "user_name": user_info["username"],
                    "user_role": user_info["role"],
                    "action": action,
                    "target_type": target_type,
                    "target_id": target_id,
                    "summary": f"{method} {path}",
                    "method": method,
                    "path": path,
                    "status_code": response.status_code,
                    "timestamp": datetime.now(timezone.utc),
                })
    except Exception:
        pass
    return response

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
    pa = user.get("permission_actions") or {}
    if user["role"] == "administrator":
        all_feats = all_features_dict()
        drift = False
        for mk, feats in all_feats.items():
            if mk not in pa:
                pa[mk] = feats
                drift = True
            else:
                for fk in feats:
                    if fk not in pa[mk]:
                        pa[mk][fk] = True
                        drift = True
        if drift:
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"permission_actions": pa}})
    # ALWAYS derive permissions array from permission_actions (granular truth)
    perms = derive_permissions_from_actions(pa)
    # Only fall back to default_permissions for legacy users that have NO permission_actions at all
    if not pa and not user.get("permission_actions"):
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
            "permission_actions": pa,
            "active": user.get("active", True),
        },
    }

@app.get("/api/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    pa = user.get("permission_actions") or {}
    if user["role"] == "administrator":
        all_feats = all_features_dict()
        drift = False
        for mk, feats in all_feats.items():
            if mk not in pa:
                pa[mk] = feats
                drift = True
            else:
                for fk in feats:
                    if fk not in pa[mk]:
                        pa[mk][fk] = True
                        drift = True
        if drift:
            await db.users.update_one({"_id": _oid(user["id"])}, {"$set": {"permission_actions": pa}})
    perms = derive_permissions_from_actions(pa)
    if not pa and not user.get("permission_actions"):
        perms = user.get("permissions") or default_permissions(user["role"])
    return UserOut(
        id=user["id"],
        username=user["username"],
        role=user["role"],
        full_name=user.get("full_name"),
        permissions=perms,
        permission_actions=pa or None,
        active=user.get("active", True),
    )

# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
import re as _re
import secrets as _secrets

_TRK_ALLOWED = _re.compile(r"^[A-Z0-9\-]{6,20}$")

def _slugify_name(name: str) -> str:
    """Turn 'PT Anugerah Rejeki Cargo' → 'ANUG' (max 4 alnum-uppercase)."""
    if not name:
        return "CUST"
    cleaned = _re.sub(r"[^A-Za-z0-9]", "", name).upper()
    return (cleaned[:4] or "CUST").ljust(4, "X")[:4]

async def _generate_unique_tracking_code(name: str, exclude_id=None) -> str:
    """Generate 'ARC-XXXX-1234' where XXXX from name and 1234 random. Retry until unique."""
    for _ in range(20):
        code = f"ARC-{_slugify_name(name)}-{_secrets.randbelow(9000) + 1000}"
        q: dict = {"tracking_code": code}
        if exclude_id is not None:
            q["_id"] = {"$ne": exclude_id}
        exists = await db.customers.find_one(q)
        if not exists:
            return code
    raise HTTPException(500, "Gagal generate unique tracking_code, coba lagi")

async def _normalize_tracking_code(raw: Optional[str], name: str, exclude_id) -> str:
    """Normalize user input tracking_code (uppercase, validate format, ensure unique).
    If empty → auto-generate."""
    if raw and raw.strip():
        code = raw.strip().upper().replace(" ", "-")
        if not _TRK_ALLOWED.match(code):
            raise HTTPException(400, "Tracking code harus 6-20 karakter, hanya A-Z, 0-9, dan tanda hubung '-'")
        q: dict = {"tracking_code": code}
        if exclude_id is not None:
            q["_id"] = {"$ne": exclude_id}
        exists = await db.customers.find_one(q)
        if exists:
            raise HTTPException(400, f"Tracking code '{code}' sudah dipakai customer lain")
        return code
    return await _generate_unique_tracking_code(name, exclude_id)

@app.get("/api/customers")
async def list_customers(user: dict = Depends(get_current_user)):
    docs = await db.customers.find().sort("name", 1).to_list(1000)
    return [serialize(d) for d in docs]

@app.post("/api/customers")
async def create_customer(data: CustomerIn, user: dict = Depends(require_role("operation", "finance"))):
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    doc["tracking_code"] = await _normalize_tracking_code(data.tracking_code, name=data.name, exclude_id=None)
    r = await db.customers.insert_one(doc)
    new = await db.customers.find_one({"_id": r.inserted_id})
    return serialize(new)

@app.put("/api/customers/{cid}")
async def update_customer(cid: str, data: CustomerIn, user: dict = Depends(require_role("operation", "finance"))):
    payload = data.model_dump()
    payload["tracking_code"] = await _normalize_tracking_code(data.tracking_code, name=data.name, exclude_id=_oid(cid))
    await db.customers.update_one({"_id": _oid(cid)}, {"$set": payload})
    new = await db.customers.find_one({"_id": _oid(cid)})
    return serialize(new)

@app.delete("/api/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_role("operation", "finance"))):
    await db.customers.delete_one({"_id": _oid(cid)})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Public Tracking API — dipakai oleh ARCWEB (customer-facing website).
# TIDAK butuh JWT auth; validasi hanya via tracking_code milik customer.
# Rate-limited via simple in-memory sliding window (30 req/menit per IP).
# ---------------------------------------------------------------------------
from collections import defaultdict as _dd, deque as _dq
_rate_bucket: dict = _dd(_dq)

def _rate_limit(ip: str, limit: int = 30, window_sec: int = 60):
    now = datetime.now(timezone.utc).timestamp()
    q = _rate_bucket[ip]
    while q and now - q[0] > window_sec:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, f"Rate limit tercapai — max {limit} request per {window_sec} detik")
    q.append(now)

def _public_awb_status(o: dict) -> tuple[str, str]:
    """Map internal status → customer-friendly label + step key.
    Steps: order_received | in_transit | delivered | invoiced | paid."""
    status = (o.get("status") or "Open").lower()
    delivered = bool(o.get("pod_received_at") or o.get("received_at") or o.get("delivered_at") or status in ("reconciled", "invoiced", "paid"))
    if status == "paid":
        return ("Lunas / Selesai", "paid")
    if status == "invoiced":
        return ("Invoice Terbit", "invoiced")
    if delivered:
        return ("Sudah Sampai Tujuan", "delivered")
    if o.get("etd") or o.get("closing_date"):
        return ("Dalam Perjalanan", "in_transit")
    return ("Order Diterima", "order_received")

def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v

@app.get("/api/public/tracking/{code}")
async def public_tracking(code: str, request: Request):
    """Public endpoint (NO AUTH) — dipakai website AR Cargo untuk tracking customer.
    Returns customer info + list AWB dengan customer-facing fields saja.
    Rate limited 30 req/menit per IP."""
    ip = request.client.host if request.client else "unknown"
    _rate_limit(ip, limit=30, window_sec=60)

    code_norm = (code or "").strip().upper()
    if not code_norm:
        raise HTTPException(400, "Tracking code kosong")
    cust = await db.customers.find_one({"tracking_code": code_norm})
    if not cust:
        raise HTTPException(404, "Tracking code tidak ditemukan. Silakan cek kembali atau hubungi AR Cargo.")

    awbs = await db.awb_orders.find({"customer_id": cust["_id"]}).sort("created_at", -1).to_list(500)

    out_awbs = []
    for o in awbs:
        label, step = _public_awb_status(o)
        history = []
        for h in (o.get("tracking_history") or []):
            history.append({
                "date": _iso(h.get("date")),
                "location": h.get("location"),
                "note": h.get("note"),
                "status": h.get("status"),
            })
        out_awbs.append({
            "awb_number": o.get("awb_number"),
            "created_at": _iso(o.get("created_at")),
            "pickup_date": _iso(o.get("pickup_date")),
            "closing_date": _iso(o.get("closing_date")),
            "etd": _iso(o.get("etd")),
            "eta": _iso(o.get("eta")),
            "plan_eta_customer": _iso(o.get("plan_eta_customer")),
            "origin": o.get("origin"),
            "destination": o.get("destination"),
            "item_description": o.get("item_description"),
            "goods_content": o.get("goods_content"),
            "qty_kg": o.get("qty_kg"),
            "koli_count": o.get("koli_count"),
            "service": o.get("service"),
            "armada": o.get("armada"),
            "grand_total": o.get("grand_total"),
            "status_label": label,
            "status_step": step,
            "invoice_number": o.get("invoice_number") or None,
            "po_number": o.get("po_number") or None,
            "payment_status": o.get("status") or ("Invoiced" if o.get("invoice_number") else "Open"),
            "paid_at": _iso(o.get("paid_at")),
            "tracking_history": history,
            "notes": o.get("notes"),
        })

    return {
        "customer": {
            "name": cust.get("name"),
            "company_details": cust.get("company_details"),
            "tracking_code": cust.get("tracking_code"),
        },
        "awb_count": len(out_awbs),
        "awbs": out_awbs,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

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

@app.get("/api/orders/check-awb")
async def check_awb_available(
    awb_number: str,
    exclude_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Cek apakah nomor AWB sudah dipakai. Digunakan untuk validasi inline pada form Input Order.
    - `exclude_id`: kalau edit AWB, kirim id AWB saat ini agar tidak terdeteksi bentrok dgn diri sendiri."""
    awb_no = (awb_number or "").strip()
    if not awb_no:
        return {"available": True, "exists": False, "awb_number": awb_no}
    q: dict = {"awb_number": awb_no}
    if exclude_id:
        try: q["_id"] = {"$ne": _oid(exclude_id)}
        except Exception: pass
    doc = await db.awb_orders.find_one(q, {"_id": 1, "awb_number": 1, "created_at": 1})
    if doc:
        return {
            "available": False, "exists": True,
            "awb_number": awb_no,
            "existing_id": str(doc["_id"]),
            "existing_date": doc.get("created_at"),
        }
    return {"available": True, "exists": False, "awb_number": awb_no}

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
        # Support multi-status filter dgn comma-separated (mis. "Invoiced,Paid")
        if "," in status_v:
            q["status"] = {"$in": [s.strip() for s in status_v.split(",") if s.strip()]}
        else:
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
    # Vendor list per AWB (untuk kolom Vendor #1/#2/#3 di UI) — urutan sesuai created_at cost.
    awb_ids = [d["_id"] for d in docs]
    vendor_map: dict = {}  # awb_id -> list vendor unik (max 3)
    if awb_ids:
        cursor = db.awb_costs.find({"awb_id": {"$in": awb_ids}}).sort("created_at", 1)
        async for c in cursor:
            vn = (c.get("vendor_name") or "").strip()
            if not vn:
                continue
            lst = vendor_map.setdefault(c["awb_id"], [])
            if vn not in lst and len(lst) < 3:
                lst.append(vn)
    # Latest tracking per AWB (posisi terakhir)
    tracking_map: dict = {}  # awb_id -> {position, created_at}
    if awb_ids:
        # Ambil entry paling recent per awb — pakai aggregate
        pipeline = [
            {"$match": {"awb_id": {"$in": awb_ids}}},
            {"$sort": {"created_at": -1}},
            {"$group": {"_id": "$awb_id", "position": {"$first": "$position"}, "created_at": {"$first": "$created_at"}}},
        ]
        async for t in db.awb_tracking.aggregate(pipeline):
            tracking_map[t["_id"]] = {"position": t["position"], "created_at": t["created_at"]}
    # Invoice number per AWB (dari collection invoices) — untuk kolom di Pembayaran/Closing
    invoice_map: dict = {}  # awb_id -> {invoice_number, external_invoice_number, invoice_id}
    if awb_ids:
        async for inv in db.invoices.find({"$or": [
            {"awb_id": {"$in": awb_ids}},
            {"awb_ids": {"$in": awb_ids}},
        ]}):
            ids = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
            for a in ids:
                if a not in invoice_map:  # jaga-jaga kalau multi-awb — ambil yg terbaru
                    invoice_map[a] = {
                        "invoice_number": inv.get("invoice_number"),
                        "external_invoice_number": inv.get("external_invoice_number"),
                        "invoice_id": str(inv["_id"]),
                    }
    out = []
    for d in docs:
        s = serialize(d)
        c = cmap.get(d.get("customer_id"))
        s["customer_name"] = c["name"] if c else None
        s["customer_id"] = str(d["customer_id"]) if d.get("customer_id") else None
        vlist = vendor_map.get(d["_id"], [])
        s["vendor_1"] = vlist[0] if len(vlist) > 0 else None
        s["vendor_2"] = vlist[1] if len(vlist) > 1 else None
        s["vendor_3"] = vlist[2] if len(vlist) > 2 else None
        tr = tracking_map.get(d["_id"])
        s["latest_tracking"] = tr["position"] if tr else None
        s["latest_tracking_at"] = tr["created_at"] if tr else None
        inv_info = invoice_map.get(d["_id"])
        s["invoice_number"] = inv_info["invoice_number"] if inv_info else None
        s["external_invoice_number"] = inv_info["external_invoice_number"] if inv_info else None
        s["invoice_id"] = inv_info["invoice_id"] if inv_info else None
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
    # NOTE: PPN dihitung HANYA dari total_tariff (selling). Addons receive (polis/asuransi/spsi/forklift)
    # ditambahkan ke grand_total tapi TIDAK kena PPN. Lihat /api/orders/{oid}/receive untuk addons logic.
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
        "armada": (data.armada_requested or data.armada or "").strip() or None,
        "armada_requested": (data.armada_requested or data.armada or "").strip() or None,
        "armada_internal": (data.armada_internal or "").strip() or None,
        "container_type": (data.container_type or "").strip() or None,
        "driver_name": (data.driver_name or "").strip() or None,
        "nopol": (data.nopol or "").strip() or None,
        "insurance_enabled": bool(data.insurance_enabled),
        "polis_amount": float(data.polis_amount or 0) if data.insurance_enabled else 0,
        "insurance_amount": float(data.insurance_amount or 0) if data.insurance_enabled else 0,
        "closing_date": (data.closing_date or "").strip() or None,
        "etd": (data.etd or "").strip() or None,
        "eta": (data.eta or "").strip() or None,
        "plan_eta_customer": (data.plan_eta_customer or "").strip() or None,
        "notes": (data.notes or "").strip() or None,
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
async def settle_cost(cid: str, data: SettleIn = SettleIn(), user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
# Cost Groups — Prorata Vendor Cost across multiple AWBs
# 1 tagihan vendor Rp X untuk N AWB → sistem split proporsional berdasarkan
# grand_total (sales) tiap AWB. Setiap AWB dapat 1 baris cost (child) di
# awb_costs dengan is_prorata=True + cost_group_id ref. Journal per-child
# (DR 5101 / CR 2101). Settle per-child (existing flow).
# Refresh: kalau grand_total AWB berubah, klik Refresh → recalculate porsi
# (blocked jika ada child yg sudah settled).
# ---------------------------------------------------------------------------
class CostGroupIn(BaseModel):
    vendor_name: str
    period_month: str          # YYYY-MM
    total_amount: float
    awb_ids: List[str]         # must be at least 2 AWBs to prorate
    description: Optional[str] = None

async def _generate_prorata_children(group_id: ObjectId, group: dict, user_id: str):
    """Fetch AWBs by ids, compute proportional amounts by grand_total,
    insert child awb_costs (Vendor / Accrue) and post per-child journal."""
    awb_oids = [_oid(x) for x in group["awb_ids"]]
    awbs = await db.awb_orders.find({"_id": {"$in": awb_oids}}).to_list(1000)
    if len(awbs) < 2:
        raise HTTPException(400, "Prorata minimal 2 AWB")
    # Sum grand_total (sales)
    def _sales(a): return float(a.get("grand_total") or a.get("total_tariff") or 0)
    total_sales = sum(_sales(a) for a in awbs)
    if total_sales <= 0:
        raise HTTPException(400, "Total sales AWB = 0, tidak bisa prorata (grand_total kosong semua)")
    total_amount = float(group["total_amount"])
    vendor_name = group["vendor_name"]
    now = datetime.now(timezone.utc)
    header = f"[Prorata Vendor: {vendor_name} — Total Rp {int(total_amount):,}]".replace(",", ".")
    user_desc = group.get("description") or ""

    # Compute amounts with rounding — last row absorbs residual for exact sum
    portions = []
    running = 0.0
    for i, awb in enumerate(awbs):
        share = _sales(awb) / total_sales
        if i == len(awbs) - 1:
            amt = round(total_amount - running, 2)
        else:
            amt = round(total_amount * share, 2)
            running += amt
        portions.append((awb, amt, share))

    created_ids = []
    for awb, amt, share in portions:
        share_pct = round(share * 100, 2)
        desc = f"{header} {share_pct}% dari sales {int(_sales(awb)):,}".replace(",", ".")
        if user_desc:
            desc = f"{desc} — {user_desc}"
        doc = {
            "awb_id": awb["_id"],
            "cost_category": "Vendor",
            "payment_type": "Accrue",
            "amount": amt,
            "description": desc,
            "vendor_name": vendor_name,
            "is_settled": False,
            "is_prorata": True,
            "cost_group_id": group_id,
            "prorata_share_pct": share_pct,
            "created_by_role": "operation",
            "created_by": user_id,
            "cash_account_code": None,
            "created_at": now,
        }
        r = await db.awb_costs.insert_one(doc)
        created_ids.append(str(r.inserted_id))
        # Per-child journal: DR 5101 / CR 2101
        try:
            await post_journal(
                date=now,
                description=f"Akrual biaya vendor (Prorata) {awb['awb_number']} - {vendor_name}",
                lines=[
                    {"account_code": "5101", "debit": amt, "credit": 0, "memo": f"{awb['awb_number']} - {vendor_name}"},
                    {"account_code": "2101", "debit": 0, "credit": amt, "memo": f"Prorata {vendor_name}"},
                ],
                reference_type="cost", reference_id=str(r.inserted_id), posted_by=user_id,
            )
        except HTTPException:
            pass
        # Trigger revenue recognition (PSAK 72) — first cost = jasa jalan
        try:
            await recognize_revenue_for_awb(awb["_id"], user_id, trigger_date=now)
        except Exception:
            pass
    return created_ids

async def _delete_prorata_children(group_id: ObjectId):
    """Delete unsettled children of a group + cascade their journals.
    Return count of children still settled (which blocks deletion)."""
    settled = await db.awb_costs.count_documents({"cost_group_id": group_id, "is_settled": True})
    if settled > 0:
        return settled
    children = await db.awb_costs.find({"cost_group_id": group_id}).to_list(1000)
    child_ids = [str(c["_id"]) for c in children]
    for cid in child_ids:
        await db.journal_entries.delete_many({"reference_type": "cost", "reference_id": cid})
    await db.awb_costs.delete_many({"cost_group_id": group_id})
    return 0

@app.get("/api/cost-groups")
async def list_cost_groups(period_month: Optional[str] = None, vendor_name: Optional[str] = None,
                          user: dict = Depends(require_role("operation", "finance", "administrator"))):
    q = {}
    if period_month: q["period_month"] = period_month
    if vendor_name: q["vendor_name"] = vendor_name
    docs = await db.cost_groups.find(q).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        s = serialize(d)
        # Attach children summary
        children = await db.awb_costs.find({"cost_group_id": d["_id"]}).to_list(1000)
        settled_cnt = sum(1 for c in children if c.get("is_settled"))
        s["awb_count"] = len(children)
        s["settled_count"] = settled_cnt
        s["all_settled"] = settled_cnt == len(children) and len(children) > 0
        s["awb_ids"] = [str(x) for x in d.get("awb_ids", [])]
        # Detail rows
        awb_map = {}
        awb_docs = await db.awb_orders.find({"_id": {"$in": [c["awb_id"] for c in children]}}).to_list(1000)
        for a in awb_docs:
            awb_map[a["_id"]] = a
        s["children"] = [
            {
                "cost_id": str(c["_id"]),
                "awb_id": str(c["awb_id"]),
                "awb_number": (awb_map.get(c["awb_id"]) or {}).get("awb_number"),
                "grand_total": float((awb_map.get(c["awb_id"]) or {}).get("grand_total") or 0),
                "amount": float(c.get("amount") or 0),
                "share_pct": float(c.get("prorata_share_pct") or 0),
                "is_settled": bool(c.get("is_settled")),
            }
            for c in children
        ]
        out.append(s)
    return out

@app.post("/api/cost-groups")
async def create_cost_group(data: CostGroupIn, user: dict = Depends(require_role("operation", "administrator"))):
    if len(data.awb_ids) < 2:
        raise HTTPException(400, "Minimal 2 AWB untuk fitur prorata")
    if data.total_amount <= 0:
        raise HTTPException(400, "Total amount harus > 0")
    if not data.vendor_name.strip():
        raise HTTPException(400, "Vendor name wajib diisi")
    now = datetime.now(timezone.utc)
    doc = {
        "vendor_name": data.vendor_name.strip(),
        "period_month": data.period_month,
        "total_amount": float(data.total_amount),
        "awb_ids": [_oid(x) for x in data.awb_ids],
        "description": data.description,
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.cost_groups.insert_one(doc)
    doc["_id"] = r.inserted_id
    child_ids = await _generate_prorata_children(r.inserted_id, doc, user["id"])
    return {"ok": True, "cost_group_id": str(r.inserted_id), "children_created": len(child_ids)}

@app.put("/api/cost-groups/{gid}")
async def update_cost_group(gid: str, data: CostGroupIn,
                            user: dict = Depends(require_role("operation", "administrator"))):
    group = await db.cost_groups.find_one({"_id": _oid(gid)})
    if not group:
        raise HTTPException(404, "Cost group tidak ditemukan")
    # Delete + regenerate children (block if any settled)
    still_settled = await _delete_prorata_children(_oid(gid))
    if still_settled > 0:
        raise HTTPException(400, f"Tidak bisa update — {still_settled} child cost sudah settled. Batalkan settlement dulu.")
    # Update group
    upd = {
        "vendor_name": data.vendor_name.strip(),
        "period_month": data.period_month,
        "total_amount": float(data.total_amount),
        "awb_ids": [_oid(x) for x in data.awb_ids],
        "description": data.description,
        "updated_at": datetime.now(timezone.utc),
    }
    await db.cost_groups.update_one({"_id": _oid(gid)}, {"$set": upd})
    new_group = {**group, **upd, "_id": _oid(gid)}
    child_ids = await _generate_prorata_children(_oid(gid), new_group, user["id"])
    return {"ok": True, "children_recreated": len(child_ids)}

@app.post("/api/cost-groups/{gid}/refresh")
async def refresh_cost_group(gid: str, user: dict = Depends(require_role("operation", "administrator"))):
    """Recalculate proportional split based on CURRENT grand_total of the AWBs in group.
    Delete + regenerate children (blocked if any settled)."""
    group = await db.cost_groups.find_one({"_id": _oid(gid)})
    if not group:
        raise HTTPException(404, "Cost group tidak ditemukan")
    still_settled = await _delete_prorata_children(_oid(gid))
    if still_settled > 0:
        raise HTTPException(400, f"Tidak bisa refresh — {still_settled} child cost sudah settled. Batalkan settlement dulu.")
    child_ids = await _generate_prorata_children(_oid(gid), group, user["id"])
    await db.cost_groups.update_one({"_id": _oid(gid)}, {"$set": {"updated_at": datetime.now(timezone.utc)}})
    return {"ok": True, "children_recreated": len(child_ids)}

@app.delete("/api/cost-groups/{gid}")
async def delete_cost_group(gid: str, user: dict = Depends(require_role("operation", "administrator"))):
    group = await db.cost_groups.find_one({"_id": _oid(gid)})
    if not group:
        raise HTTPException(404, "Cost group tidak ditemukan")
    still_settled = await _delete_prorata_children(_oid(gid))
    if still_settled > 0:
        raise HTTPException(400, f"Tidak bisa hapus — {still_settled} child cost sudah settled.")
    await db.cost_groups.delete_one({"_id": _oid(gid)})
    return {"ok": True}

@app.get("/api/cost-groups/candidate-awbs")
async def prorata_candidate_awbs(period_month: Optional[str] = None,
                                 user: dict = Depends(require_role("operation", "finance", "administrator"))):
    """List AWB yang eligible untuk dijadikan target prorata:
    status Open atau Reconciled, punya grand_total > 0.
    Filter opsional period_month (YYYY-MM) match created_at."""
    q = {"status": {"$in": ["Open", "Reconciled"]}}
    docs = await db.awb_orders.find(q).sort("created_at", -1).to_list(3000)
    out = []
    for d in docs:
        if period_month:
            ca = d.get("created_at")
            if not ca:
                continue
            ym = ca.strftime("%Y-%m") if hasattr(ca, "strftime") else str(ca)[:7]
            if ym != period_month:
                continue
        gt = float(d.get("grand_total") or 0)
        if gt <= 0:
            continue
        out.append({
            "id": str(d["_id"]),
            "awb_number": d.get("awb_number"),
            "customer_name": d.get("customer_name"),
            "origin": d.get("origin"),
            "destination": d.get("destination"),
            "grand_total": gt,
            "status": d.get("status"),
            "created_at": d.get("created_at"),
        })
    return out


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
    # NEW: POD juga harus diterima
    no_pod = [a["awb_number"] for a in awbs_all if a.get("received_at") and not a.get("pod_received_at")]
    if no_pod:
        raise HTTPException(400, f"POD belum diterima — tidak boleh direkonsiliasi: {', '.join(no_pod[:5])}{'...' if len(no_pod) > 5 else ''}")
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
            # Kop surat global (dipakai di header InvoicePrint HTML)
            "kop_address": settings.get("kop_address", ""),
            "kop_phone": settings.get("kop_phone", ""),
            "kop_email": settings.get("kop_email", ""),
            "kop_website": settings.get("kop_website", ""),
            "kop_tagline": settings.get("kop_tagline", ""),
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
async def mark_paid(oid: str, data: MarkPaidIn = MarkPaidIn(), user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
    spsi_eff = float(data.spsi_amount or 0) if data.spsi_enabled else 0
    forklift_eff = float(data.sewa_forklift_amount or 0) if data.sewa_forklift_enabled else 0
    # NEW: Recompute grand_total = base + tax + invoice addons (SPSI/Forklift/Polis/Asuransi)
    base_tariff = float(o.get("total_tariff") or 0)
    base_tax = float(o.get("tax_amount") or 0)
    addons_total = polis_eff + asur_eff + spsi_eff + forklift_eff
    new_grand_total = round(base_tariff + base_tax + addons_total, 2)
    upd = {
        "received_at": rd,
        "received_by_name": data.received_by_name.strip(),
        "received_polis_enabled": bool(data.polis_enabled),
        "received_polis_amount": polis_eff,
        "received_asuransi_enabled": bool(data.asuransi_enabled),
        "received_asuransi_amount": asur_eff,
        "spsi_enabled": bool(data.spsi_enabled),
        "spsi_amount": spsi_eff,
        "sewa_forklift_enabled": bool(data.sewa_forklift_enabled),
        "sewa_forklift_amount": forklift_eff,
        "addons_total": round(addons_total, 2),
        "grand_total": new_grand_total,  # auto-include addons
        "work_type": data.work_type,
        "mode": data.mode,
        "received_notes": (data.received_notes or "").strip() or None,
        "received_by": user["id"],
    }
    await db.awb_orders.update_one({"_id": _oid(oid)}, {"$set": upd})
    # NOTE: SPSI / Sewa Forklift / Polis / Asuransi adalah penambah nilai INVOICE,
    # bukan cost. Mereka HANYA disimpan di field awb_orders dan otomatis menambah grand_total
    # serta ditampilkan di invoice saat dicetak.
    # Hapus cost lama yang mungkin dibuat oleh versi sebelumnya untuk migrasi data lama —
    # FILTER KETAT: hanya source=receive AND category=Operational AND sub_label in (SPSI, Sewa Forklift)
    # supaya TIDAK pernah menyentuh Vendor accruals atau cost manual lainnya.
    await db.awb_costs.delete_many({
        "awb_id": _oid(oid),
        "source": "receive",
        "cost_category": "Operational",
        "sub_label": {"$in": ["SPSI", "Sewa Forklift"]},
    })
    return serialize(await db.awb_orders.find_one({"_id": _oid(oid)}))

# ── Tracking (posisi/status barang berjalan) ───────────────────────────────
# Sifatnya append-only: setiap update posisi = row baru di collection awb_tracking.
# Field yang muncul di list AWB adalah entry terakhir (paling recent).
# Tombol tracking di UI di-kunci setelah AWB "received" (barang diterima).
@app.post("/api/orders/{oid}/tracking")
async def add_tracking(oid: str, data: TrackingIn, user: dict = Depends(get_current_user)):
    o = await db.awb_orders.find_one({"_id": _oid(oid)}, {"awb_number": 1, "received_at": 1})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if o.get("received_at"):
        raise HTTPException(400, "AWB sudah diterima — tracking dikunci.")
    text = (data.position or "").strip()
    if not text:
        raise HTTPException(400, "Posisi tidak boleh kosong")
    doc = {
        "awb_id": _oid(oid),
        "position": text,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["id"],
        "created_by_name": user.get("full_name") or user.get("username") or "?",
    }
    r = await db.awb_tracking.insert_one(doc)
    return {"ok": True, "id": str(r.inserted_id), "position": text, "created_at": doc["created_at"]}

@app.get("/api/orders/{oid}/tracking")
async def list_tracking(oid: str, user: dict = Depends(get_current_user)):
    cursor = db.awb_tracking.find({"awb_id": _oid(oid)}).sort("created_at", -1)
    rows = []
    async for d in cursor:
        rows.append({
            "id": str(d["_id"]),
            "position": d.get("position"),
            "created_at": d.get("created_at"),
            "created_by_name": d.get("created_by_name"),
        })
    return rows



@app.post("/api/orders/{oid}/receive-pod")
async def receive_pod_awb(oid: str, data: AwbPodIn = AwbPodIn(), user: dict = Depends(get_current_user)):
    """Terima POD pada AWB — Proof of Delivery dari consignee."""
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if not o.get("received_at"):
        raise HTTPException(400, "Barang belum diterima. Lakukan 'Terima Barang' dulu.")
    if data.pod_date:
        try:
            y, m, d = [int(x) for x in data.pod_date.split("-")]
            now = datetime.now(timezone.utc)
            pod_dt = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "pod_date harus YYYY-MM-DD")
    else:
        pod_dt = datetime.now(timezone.utc)
    await db.awb_orders.update_one(
        {"_id": _oid(oid)},
        {"$set": {
            "pod_received_at": pod_dt,
            "pod_notes": (data.pod_notes or "").strip() or None,
            "pod_signed_by": (data.pod_signed_by or "").strip() or None,
            "pod_received_by_user": user["id"],
        }},
    )
    return serialize(await db.awb_orders.find_one({"_id": _oid(oid)}))

@app.post("/api/payments/bulk-mark-paid")
async def bulk_mark_paid(data: BulkMarkPaidIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
# Fixed Costs (Expense — Finance only)
# ---------------------------------------------------------------------------
# DEPRECATED: kept for backwards-compat; categories now live in db.expense_categories.
FIXED_COST_CATEGORIES = ["Operation", "Gaji", "Sewa", "Utilities", "Marketing", "Administrasi", "Lainnya"]

@app.get("/api/fixed-costs/categories")
async def fixed_cost_categories(user: dict = Depends(get_current_user)):
    """Legacy endpoint — returns category names only. New clients should use /api/expense-categories."""
    cats = await db.expense_categories.find({"active": {"$ne": False}}).sort("name", 1).to_list(500)
    return [c["name"] for c in cats]

# --- New: Expense Categories CRUD ---
class ExpenseCategoryIn(BaseModel):
    name: str
    posting_type: Optional[str] = "expense"  # 'cogs' or 'expense'

@app.get("/api/expense-categories")
async def list_expense_categories(include_usage: bool = False, user: dict = Depends(get_current_user)):
    docs = await db.expense_categories.find({"active": {"$ne": False}}).sort([("posting_type", 1), ("name", 1)]).to_list(500)
    out = [serialize(d) for d in docs]
    if include_usage:
        for c in out:
            c["in_use_count"] = await db.fixed_costs.count_documents({"category": c["name"]})
    return out

@app.post("/api/expense-categories")
async def create_expense_category_ep(data: ExpenseCategoryIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await create_expense_category(data.name, posting_type=data.posting_type or "expense", user_id=user["id"])
    return serialize(doc)

class ExpenseCategoryUpdate(BaseModel):
    name: Optional[str] = None
    posting_type: Optional[str] = None  # 'cogs' or 'expense'

@app.put("/api/expense-categories/{cid}")
async def update_expense_category(cid: str, data: ExpenseCategoryUpdate, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.expense_categories.find_one({"_id": _oid(cid)})
    if not doc:
        raise HTTPException(404, "Kategori tidak ditemukan")
    if doc.get("is_system"):
        raise HTTPException(400, "Kategori sistem tidak dapat diubah")
    update_set = {}
    rename_from = None
    if data.name and data.name.strip() and data.name.strip() != doc["name"]:
        new_name = data.name.strip()
        exists = await db.expense_categories.find_one({"name": {"$regex": f"^{re.escape(new_name)}$", "$options": "i"}})
        if exists and str(exists["_id"]) != cid:
            raise HTTPException(400, f"Kategori '{new_name}' sudah ada")
        rename_from = doc["name"]
        update_set["name"] = new_name
    if data.posting_type:
        ptype = data.posting_type.lower()
        if ptype not in ("cogs", "expense"):
            raise HTTPException(400, "posting_type harus 'cogs' atau 'expense'")
        if ptype != doc.get("posting_type"):
            update_set["posting_type"] = ptype
            # change account_code accordingly: cogs → 5102, expense → keep current if 6xxx else 6199
            if ptype == "cogs":
                update_set["account_code"] = "5102"
            else:
                cur = doc.get("account_code") or ""
                if not cur.startswith("6"):
                    update_set["account_code"] = "6199"
    if not update_set:
        return serialize(doc)
    await db.expense_categories.update_one({"_id": _oid(cid)}, {"$set": update_set})
    # Propagate to existing fixed_cost records using this category
    if rename_from:
        await db.fixed_costs.update_many({"category": rename_from}, {"$set": {"category": update_set["name"]}})
    if "posting_type" in update_set:
        propagate = {"posting_type": update_set["posting_type"]}
        if "account_code" in update_set:
            propagate["account_code"] = update_set["account_code"]
        target_name = update_set.get("name") or doc["name"]
        await db.fixed_costs.update_many({"category": target_name}, {"$set": propagate})
    return serialize(await db.expense_categories.find_one({"_id": _oid(cid)}))

@app.delete("/api/expense-categories/{cid}")
async def delete_expense_category(cid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.expense_categories.find_one({"_id": _oid(cid)})
    if not doc:
        raise HTTPException(404, "Kategori tidak ditemukan")
    if doc.get("is_system"):
        raise HTTPException(400, "Kategori sistem tidak dapat dihapus")
    in_use = await db.fixed_costs.count_documents({"category": doc["name"]})
    if in_use > 0:
        raise HTTPException(400, f"Kategori sedang digunakan oleh {in_use} record expense. Hapus/ubah dulu.")
    await db.expense_categories.delete_one({"_id": _oid(cid)})
    return {"ok": True}

@app.get("/api/fixed-costs")
async def list_fixed_costs(
    month: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {}
    if start_date and end_date:
        # Date range filter (preferred). Uses expense_date if available; fallback expects period_month logic.
        q["expense_date"] = {"$gte": start_date, "$lte": end_date}
    elif month:
        q["period_month"] = month
    docs = await db.fixed_costs.find(q).sort("created_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/fixed-costs")
async def create_fixed_cost(data: FixedCostIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    # Lookup category from db.expense_categories (replaces hardcoded list)
    cat = await get_expense_category(data.category)
    if not cat:
        raise HTTPException(400, f"Kategori '{data.category}' tidak terdaftar. Tambahkan kategori dulu.")
    # Resolve expense_date and period_month (accept either, derive the other)
    expense_date_str = data.expense_date
    period_month = data.period_month
    expense_dt = None
    if expense_date_str:
        try:
            expense_dt = datetime.strptime(expense_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Format tanggal harus YYYY-MM-DD")
        period_month = expense_dt.strftime("%Y-%m")
    elif period_month:
        try:
            y, m = period_month.split("-")
            int(y); int(m)
        except Exception:
            raise HTTPException(400, "Format periode harus YYYY-MM")
        # Default expense_date = 1st of that month
        expense_dt = datetime.strptime(f"{period_month}-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
        expense_date_str = expense_dt.strftime("%Y-%m-%d")
    else:
        # Both empty → use today
        expense_dt = datetime.now(timezone.utc)
        expense_date_str = expense_dt.strftime("%Y-%m-%d")
        period_month = expense_dt.strftime("%Y-%m")
    cash_acc = data.cash_account_code or "1101"
    acc = await get_account(cash_acc)
    if not acc or not acc.get("is_cash"):
        raise HTTPException(400, "Akun kas/bank tidak valid")
    now = datetime.now(timezone.utc)
    doc = {
        "category": cat["name"],  # canonical name from DB
        "posting_type": cat.get("posting_type", "expense"),
        "account_code": cat.get("account_code"),
        "description": data.description,
        "amount": data.amount,
        "expense_date": expense_date_str,  # YYYY-MM-DD (new)
        "period_month": period_month,       # YYYY-MM (kept for filtering/copy)
        "cash_account_code": cash_acc,
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.fixed_costs.insert_one(doc)
    new = await db.fixed_costs.find_one({"_id": r.inserted_id})
    # Auto-post journal — uses account from category and expense_date as journal date
    try:
        expense_code = cat.get("account_code") or FIXED_COST_TO_COA.get(data.category, "6199")
        label = "Beban Operasional" if cat.get("posting_type") == "cogs" else "Beban"
        await post_journal(
            date=expense_dt,
            description=f"{label} {cat['name']} - {expense_date_str}",
            lines=[
                {"account_code": expense_code, "debit": data.amount, "credit": 0, "memo": data.description or cat["name"]},
                {"account_code": cash_acc, "debit": 0, "credit": data.amount, "memo": cat["name"]},
            ],
            reference_type="fixed_cost", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException as e:
        new["journal_warning"] = e.detail
    return serialize(new)

class FixedCostUpdate(BaseModel):
    category: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    expense_date: Optional[str] = None  # YYYY-MM-DD

@app.put("/api/fixed-costs/{fid}")
async def update_fixed_cost(fid: str, data: FixedCostUpdate, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.fixed_costs.find_one({"_id": _oid(fid)})
    if not doc:
        raise HTTPException(404, "Expense tidak ditemukan")
    update_set: dict = {}
    expense_dt = None
    if data.expense_date:
        try:
            expense_dt = datetime.strptime(data.expense_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Format tanggal harus YYYY-MM-DD")
        update_set["expense_date"] = data.expense_date
        update_set["period_month"] = expense_dt.strftime("%Y-%m")
    if data.amount is not None:
        if data.amount <= 0:
            raise HTTPException(400, "Amount harus > 0")
        update_set["amount"] = float(data.amount)
    if data.description is not None:
        update_set["description"] = data.description
    if data.category:
        cat = await get_expense_category(data.category)
        if not cat:
            raise HTTPException(400, f"Kategori '{data.category}' tidak terdaftar")
        update_set["category"] = cat["name"]
        update_set["posting_type"] = cat.get("posting_type", "expense")
        update_set["account_code"] = cat.get("account_code")
    if not update_set:
        return serialize(doc)
    update_set["updated_by"] = user["id"]
    update_set["updated_at"] = datetime.now(timezone.utc)
    await db.fixed_costs.update_one({"_id": _oid(fid)}, {"$set": update_set})
    # Re-post journal: delete old, post new
    await db.journal_entries.delete_many({"reference_type": "fixed_cost", "reference_id": fid})
    new = await db.fixed_costs.find_one({"_id": _oid(fid)})
    try:
        expense_code = new.get("account_code") or "6199"
        label = "Beban Operasional" if new.get("posting_type") == "cogs" else "Beban"
        cash_acc = new.get("cash_account_code") or "1101"
        new_dt = expense_dt or (datetime.strptime(new["expense_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc) if new.get("expense_date") else new.get("created_at"))
        await post_journal(
            date=new_dt,
            description=f"{label} {new['category']} - {new.get('expense_date') or new.get('period_month')} (edited)",
            lines=[
                {"account_code": expense_code, "debit": new["amount"], "credit": 0, "memo": new.get("description") or new["category"]},
                {"account_code": cash_acc, "debit": 0, "credit": new["amount"], "memo": new["category"]},
            ],
            reference_type="fixed_cost", reference_id=fid, posted_by=user["id"],
        )
    except HTTPException:
        pass
    return serialize(new)

@app.delete("/api/fixed-costs/{fid}")
async def delete_fixed_cost(fid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.fixed_costs.find_one({"_id": _oid(fid)})
    if not doc:
        raise HTTPException(404, "Expense tidak ditemukan")
    await db.fixed_costs.delete_one({"_id": _oid(fid)})
    # Also clean up associated journals to keep books consistent
    await db.journal_entries.delete_many({"reference_type": "fixed_cost", "reference_id": fid})
    return {"ok": True}

# ---------------------------------------------------------------------------
# Profit & Loss (Module 7)
# ---------------------------------------------------------------------------
@app.get("/api/reports/profit-loss")
async def profit_loss(
    month: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    customer_id: Optional[str] = None,
    user: dict = Depends(require_role("finance", "operation")),
):
    q = {}
    if customer_id:
        q["customer_id"] = _oid(customer_id)
    start_dt = end_dt = None
    if start_date and end_date:
        try:
            sy, sm, sd = [int(x) for x in start_date.split("-")]
            ey, em, ed = [int(x) for x in end_date.split("-")]
            start_dt = datetime(sy, sm, sd, tzinfo=timezone.utc)
            end_dt = datetime(ey, em, ed, 23, 59, 59, tzinfo=timezone.utc)
            q["created_at"] = {"$gte": start_dt, "$lte": end_dt}
        except Exception:
            raise HTTPException(400, "Format date harus YYYY-MM-DD")
    elif month:
        try:
            y, m = month.split("-")
            y, m = int(y), int(m)
            start_dt = datetime(y, m, 1, tzinfo=timezone.utc)
            end_dt = datetime(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
            q["created_at"] = {"$gte": start_dt, "$lt": end_dt}
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

    # Fixed costs / Expenses for the period. Filter by date range (preferred) or month.
    fixed_q = {}
    if start_date and end_date:
        fixed_q["expense_date"] = {"$gte": start_date, "$lte": end_date}
    elif month:
        fixed_q["period_month"] = month
    fixed_rows = await db.fixed_costs.find(fixed_q).sort("created_at", -1).to_list(2000)
    # Resolve posting_type from db.expense_categories (handles legacy records w/o the field)
    cat_map = {c["name"]: c for c in await db.expense_categories.find({}).to_list(500)}
    fixed_breakdown = {}        # non-COGS only (Expense bucket)
    cogs_expense_breakdown = {} # COGS-typed expenses (e.g. Operation)
    total_fixed = 0.0           # Expense bucket only
    total_cogs_expense = 0.0    # COGS-typed expenses added to total_cogs below
    for f in fixed_rows:
        amt = f.get("amount", 0) or 0
        cat_name = f.get("category")
        ptype = f.get("posting_type") or (cat_map.get(cat_name) or {}).get("posting_type", "expense")
        if ptype == "cogs":
            total_cogs_expense += amt
            cogs_expense_breakdown[cat_name] = cogs_expense_breakdown.get(cat_name, 0) + amt
        else:
            total_fixed += amt
            fixed_breakdown[cat_name] = fixed_breakdown.get(cat_name, 0) + amt

    # Add COGS-typed expenses into total_cogs so Gross Margin reflects them
    total_cogs += total_cogs_expense

    gross_margin = total_revenue - total_cogs
    net_profit = gross_margin - total_fixed

    return {
        "rows": rows,
        "fixed_costs": [serialize(f) for f in fixed_rows],
        "fixed_breakdown": fixed_breakdown,
        "cogs_expense_breakdown": cogs_expense_breakdown,
        "summary": {
            "total_revenue": total_revenue,
            "total_cogs": total_cogs,
            "total_cogs_expense": total_cogs_expense,
            "gross_margin": gross_margin,
            "gross_margin_pct": (gross_margin / total_revenue * 100) if total_revenue else 0,
            "total_fixed_cost": total_fixed,
            "total_expense": total_fixed,  # alias for new UI label
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
async def post_manual_journal(data: JournalEntryIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
    # Normalize permission_actions: {module: {feature_key: bool}} — only allow valid module + feature combinations
    pa = {}
    if data.permission_actions:
        for mk, feats in data.permission_actions.items():
            if mk not in MODULE_KEYS or not isinstance(feats, dict):
                continue
            valid_keys = {fk for (fk, _) in MODULE_FEATURES.get(mk, [])}
            pa[mk] = {fk: bool(feats.get(fk, False)) for fk in valid_keys}
    # ALWAYS derive permissions from permission_actions (single source of truth)
    # If pa is empty and admin sent permissions explicitly, fall back to that (legacy compat)
    derived_perms = derive_permissions_from_actions(pa)
    final_perms = derived_perms if pa else (data.permissions if data.permissions is not None else default_permissions(data.role))
    doc = {
        "username": uname,
        "password_hash": hash_password(data.password),
        "role": data.role,
        "full_name": data.full_name or uname,
        "permissions": final_perms,
        "permission_actions": pa,
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
    if data.permissions is not None and data.permission_actions is None:
        # Only honor explicit permissions array if frontend did NOT send permission_actions
        # (since permission_actions overrides). Backward-compat for legacy clients.
        invalid = [p for p in data.permissions if p not in MODULE_KEYS]
        if invalid:
            raise HTTPException(400, f"Permission tidak valid: {', '.join(invalid)}")
        updates["permissions"] = data.permissions
    if data.permission_actions is not None:
        pa = {}
        for mk, feats in (data.permission_actions or {}).items():
            if mk not in MODULE_KEYS or not isinstance(feats, dict):
                continue
            valid_keys = {fk for (fk, _) in MODULE_FEATURES.get(mk, [])}
            pa[mk] = {fk: bool(feats.get(fk, False)) for fk in valid_keys}
        updates["permission_actions"] = pa
        # ALWAYS auto-derive permissions array from permission_actions (single source of truth).
        updates["permissions"] = derive_permissions_from_actions(pa)
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
async def copy_fixed_costs(data: CopyFixedCostIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
        # Lookup current category posting in case schema changed
        cat = await get_expense_category(f["category"])
        new_docs.append({
            "category": f["category"],
            "posting_type": (cat or {}).get("posting_type", f.get("posting_type", "expense")),
            "account_code": (cat or {}).get("account_code", f.get("account_code")),
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
                expense_code = doc.get("account_code") or FIXED_COST_TO_COA.get(doc["category"], "6199")
                label = "Beban Operasional" if doc.get("posting_type") == "cogs" else "Beban"
                await post_journal(
                    date=doc["created_at"],
                    description=f"{label} {doc['category']} - {doc['period_month']} (copy)",
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
class FamilyMember(BaseModel):
    hubungan: Optional[str] = None  # e.g. Istri, Suami, Anak, Ayah, Ibu
    nama: Optional[str] = None
    alamat: Optional[str] = None
    no_hp: Optional[str] = None
    no_ktp: Optional[str] = None

class EmployeeIn(BaseModel):
    # --- Identitas ---
    full_name: str
    nickname: Optional[str] = None
    tempat_lahir: Optional[str] = None
    tanggal_lahir: Optional[str] = None       # YYYY-MM-DD
    status_pernikahan: Optional[str] = None   # "Lajang" | "Menikah" | "Cerai Hidup" | "Cerai Mati"
    jenis_kelamin: Optional[str] = None       # "L" | "P"
    # --- Kontak & Legal ---
    no_hp: Optional[str] = None
    alamat_ktp: Optional[str] = None
    alamat_domisili: Optional[str] = None
    nik: Optional[str] = None                 # No. KTP
    no_kk: Optional[str] = None               # No. KK
    npwp: Optional[str] = None
    email: Optional[str] = None
    # --- Logistik & Finansial ---
    kendaraan_operasional: Optional[str] = None
    sim_c: Optional[str] = None               # No. SIM C (kosong = tidak punya)
    sim_a: Optional[str] = None
    sim_lain: Optional[str] = None
    bank_type: Optional[str] = None           # "BCA" | "Mandiri" | dsb
    bank_account: Optional[str] = None
    # --- Kontak Darurat ---
    emergency1_name: Optional[str] = None
    emergency1_phone: Optional[str] = None
    emergency1_relation: Optional[str] = None
    emergency1_address: Optional[str] = None
    emergency2_name: Optional[str] = None
    emergency2_phone: Optional[str] = None
    emergency2_relation: Optional[str] = None
    emergency2_address: Optional[str] = None
    # --- Data Keluarga (list) ---
    family: List[FamilyMember] = []
    # --- Kepegawaian (existing) ---
    position: Optional[str] = None
    bpjs_no: Optional[str] = None
    base_salary: float = 0
    allowance: float = 0
    meal_allowance: float = 0  # Uang makan harian (dibayar hanya kalau HADIR)
    join_date: Optional[str] = None           # YYYY-MM-DD
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

    # Hitung hari kerja bulan ini: Senin-Sabtu (Sabtu = 5, Minggu = 6)
    year, month = data.period_month.split("-")
    year, month = int(year), int(month)
    import calendar as _cal
    last_day = _cal.monthrange(year, month)[1]
    working_days = 0
    for d in range(1, last_day + 1):
        weekday = _cal.weekday(year, month, d)  # 0=Mon .. 6=Sun
        if weekday <= 5:  # Mon-Sat
            working_days += 1

    # Ambil semua attendance periode ini
    from datetime import date as _date
    period_start = _date(year, month, 1)
    period_end = _date(year, month, last_day)
    attendance_docs = await db.attendance.find({
        "date": {"$gte": period_start.isoformat(), "$lte": period_end.isoformat()}
    }).to_list(50000)
    # Index by employee_id -> {date: status}
    att_by_emp = {}
    for a in attendance_docs:
        eid = str(a.get("employee_id"))
        att_by_emp.setdefault(eid, {})[a.get("date")] = a.get("status")

    slips = []
    total_gross = 0.0
    for e in employees:
        emp_id = str(e["_id"])
        base = float(e.get("base_salary", 0))
        meal_per_day = float(e.get("meal_allowance", 0))
        att = att_by_emp.get(emp_id, {})

        # Hitung per-status
        hari_hadir = sum(1 for s in att.values() if s == "Hadir")
        hari_sakit = sum(1 for s in att.values() if s == "Sakit")
        hari_izin = sum(1 for s in att.values() if s == "Izin")
        hari_alfa = sum(1 for s in att.values() if s == "Alfa")
        hari_recorded = hari_hadir + hari_sakit + hari_izin + hari_alfa
        # Hari yang belum ada record → dianggap Hadir (default optimis)
        hari_missing = max(0, working_days - hari_recorded)
        hari_hadir_effective = hari_hadir + hari_missing

        # Deduction karena Alfa (potongan proporsional dari base salary)
        deduction_alfa = round((base / working_days) * hari_alfa, 2) if working_days > 0 else 0
        gaji_pokok_net = base - deduction_alfa
        # Uang makan hanya dibayar untuk HADIR
        uang_makan = round(meal_per_day * hari_hadir_effective, 2)
        gross = gaji_pokok_net + uang_makan

        slips.append({
            "employee_id": emp_id,
            "employee_name": e.get("full_name"),
            "position": e.get("position"),
            "base_salary": base,
            "meal_allowance_per_day": meal_per_day,
            "working_days": working_days,
            "hari_hadir": hari_hadir_effective,
            "hari_sakit": hari_sakit,
            "hari_izin": hari_izin,
            "hari_alfa": hari_alfa,
            "hari_missing_treated_hadir": hari_missing,
            "deduction_alfa": deduction_alfa,
            "gaji_pokok_net": gaji_pokok_net,
            "uang_makan": uang_makan,
            "gross": gross,
            "net": gross,  # No tax deduction untuk sekarang (user bilang tidak ada tunjangan/pajak logic)
        })
        total_gross += gross

    cash_acc = data.cash_account_code or "1101"
    payroll_doc = {
        "period_month": data.period_month,
        "working_days": working_days,
        "slips": slips,
        "total_gross": round(total_gross, 2),
        "cash_account_code": cash_acc,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.payroll.insert_one(payroll_doc)
    # Post journal: Dr 6101 Beban Gaji / Cr Kas
    lines = [
        {"account_code": "6101", "debit": total_gross, "credit": 0, "memo": f"Payroll {data.period_month}"},
        {"account_code": cash_acc, "debit": 0, "credit": total_gross, "memo": "Bayar gaji"},
    ]
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

# ---------------------------------------------------------------------------
# ATTENDANCE (Absensi) — imported from HRIS
# ---------------------------------------------------------------------------
ALLOWED_ATT_STATUS = {"Hadir", "Sakit", "Izin", "Alfa"}

class AttendanceIn(BaseModel):
    employee_id: str
    date: str  # YYYY-MM-DD
    status: str  # Hadir | Sakit | Izin | Alfa
    check_in: Optional[str] = None  # HH:MM
    check_out: Optional[str] = None  # HH:MM
    note: Optional[str] = None

def _derive_status_from_times(check_in: Optional[str], check_out: Optional[str]) -> str:
    """Kalau tidak ada check_in/out → Alfa. Kalau ada → Hadir (late tetap Hadir)."""
    if check_in and check_in.strip():
        return "Hadir"
    return "Alfa"

@app.get("/api/hr/attendance")
async def list_attendance(
    month: Optional[str] = None,  # YYYY-MM
    employee_id: Optional[str] = None,
    user: dict = Depends(require_feature("hr")),
):
    q: dict = {}
    if employee_id:
        q["employee_id"] = employee_id
    if month:
        year, mm = month.split("-")
        year, mm = int(year), int(mm)
        import calendar as _cal
        last_day = _cal.monthrange(year, mm)[1]
        q["date"] = {"$gte": f"{year}-{mm:02d}-01", "$lte": f"{year}-{mm:02d}-{last_day:02d}"}
    docs = await db.attendance.find(q).sort("date", -1).to_list(50000)
    return [serialize(d) for d in docs]

@app.post("/api/hr/attendance")
async def create_attendance(data: AttendanceIn, user: dict = Depends(require_feature("hr"))):
    if data.status not in ALLOWED_ATT_STATUS:
        raise HTTPException(400, f"Status invalid. Pilih: {', '.join(ALLOWED_ATT_STATUS)}")
    # Cek employee exists
    if not await db.employees.find_one({"_id": _oid(data.employee_id)}):
        raise HTTPException(404, "Karyawan tidak ditemukan")
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc)
    doc["created_by"] = user["id"]
    # Upsert (unique per employee+date)
    await db.attendance.update_one(
        {"employee_id": doc["employee_id"], "date": doc["date"]},
        {"$set": doc},
        upsert=True,
    )
    res = await db.attendance.find_one({"employee_id": doc["employee_id"], "date": doc["date"]})
    return serialize(res)

@app.put("/api/hr/attendance/{aid}")
async def update_attendance(aid: str, data: AttendanceIn, user: dict = Depends(require_feature("hr"))):
    if data.status not in ALLOWED_ATT_STATUS:
        raise HTTPException(400, f"Status invalid")
    await db.attendance.update_one({"_id": _oid(aid)}, {"$set": data.model_dump()})
    return serialize(await db.attendance.find_one({"_id": _oid(aid)}))

@app.delete("/api/hr/attendance/{aid}")
async def delete_attendance(aid: str, user: dict = Depends(require_feature("hr"))):
    await db.attendance.delete_one({"_id": _oid(aid)})
    return {"ok": True}

@app.post("/api/hr/attendance/import")
async def import_attendance(
    file: UploadFile = File(...),
    user: dict = Depends(require_feature("hr")),
):
    """
    Import absensi dari Excel/CSV. Auto-detect format:
    - Format A: employee_id/nik/nama_karyawan, tanggal, status
    - Format B: employee_id/nik/nama_karyawan, tanggal, check_in, check_out
      → status auto-derived (Hadir kalau ada check_in, else Alfa)
    """
    import io
    filename = (file.filename or "").lower()
    content = await file.read()
    rows = []
    if filename.endswith(".csv") or filename.endswith(".txt"):
        import csv
        text = content.decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))
        for r in reader:
            rows.append({k.strip().lower(): (v or "").strip() for k, v in r.items()})
    elif filename.endswith(".xlsx") or filename.endswith(".xls"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(500, "openpyxl belum terinstall")
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
        headers = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i == 0:
                headers = [str(h or "").strip().lower() for h in row]
                continue
            item = {}
            for j, val in enumerate(row):
                if j < len(headers):
                    item[headers[j]] = str(val).strip() if val is not None else ""
            rows.append(item)
    else:
        raise HTTPException(400, "Format file tidak didukung. Pakai .xlsx atau .csv")

    # Normalize field names
    def _get(r, *keys):
        for k in keys:
            if k in r and r[k]:
                return r[k]
        return None

    # Build employee lookup: {employee_id: emp_doc, nik: emp_doc, full_name (lower): emp_doc}
    employees = await db.employees.find({}).to_list(5000)
    emp_by_id = {str(e["_id"]): e for e in employees}
    emp_by_nik = {e.get("nik"): e for e in employees if e.get("nik")}
    emp_by_name = {(e.get("full_name") or "").strip().lower(): e for e in employees}

    imported = 0
    skipped = []
    for idx, r in enumerate(rows):
        # Find employee
        emp_key = _get(r, "employee_id", "id_karyawan", "id")
        nik = _get(r, "nik", "no_ktp")
        name = _get(r, "nama", "nama_karyawan", "full_name", "name")
        emp = None
        if emp_key and emp_key in emp_by_id:
            emp = emp_by_id[emp_key]
        elif nik and nik in emp_by_nik:
            emp = emp_by_nik[nik]
        elif name:
            emp = emp_by_name.get(name.strip().lower())
        if not emp:
            skipped.append({"row": idx + 2, "reason": f"Karyawan tidak ditemukan (id/nik/nama={emp_key or nik or name})"})
            continue

        # Parse date
        date_raw = _get(r, "tanggal", "date", "tgl")
        if not date_raw:
            skipped.append({"row": idx + 2, "reason": "Tanggal kosong"})
            continue
        # Normalize date to YYYY-MM-DD
        date_str = None
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y"):
            try:
                from datetime import datetime as _dt
                date_str = _dt.strptime(date_raw.split(" ")[0], fmt).strftime("%Y-%m-%d")
                break
            except Exception:
                continue
        if not date_str:
            skipped.append({"row": idx + 2, "reason": f"Format tanggal invalid: {date_raw}"})
            continue

        # Get status or derive from check_in/out
        status_raw = _get(r, "status", "keterangan", "kondisi")
        check_in = _get(r, "check_in", "jam_masuk", "in", "clock_in")
        check_out = _get(r, "check_out", "jam_keluar", "out", "clock_out")
        if status_raw:
            # Normalize
            s = status_raw.strip().title()
            if s.lower() in ("h", "hadir", "present", "masuk"):
                status = "Hadir"
            elif s.lower() in ("s", "sakit", "sick"):
                status = "Sakit"
            elif s.lower() in ("i", "izin", "cuti", "leave"):
                status = "Izin"
            elif s.lower() in ("a", "alfa", "absent", "tanpa keterangan"):
                status = "Alfa"
            else:
                status = "Hadir"  # default
        else:
            status = _derive_status_from_times(check_in, check_out)

        # Upsert
        doc = {
            "employee_id": str(emp["_id"]),
            "date": date_str,
            "status": status,
            "check_in": check_in,
            "check_out": check_out,
            "note": _get(r, "note", "catatan", "keterangan_detail"),
            "created_at": datetime.now(timezone.utc),
            "created_by": user["id"],
        }
        await db.attendance.update_one(
            {"employee_id": doc["employee_id"], "date": doc["date"]},
            {"$set": doc},
            upsert=True,
        )
        imported += 1

    return {
        "imported": imported,
        "skipped_count": len(skipped),
        "skipped_details": skipped[:100],  # cap for UI
    }

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

# ---------------------------------------------------------------------------
# APPROVAL WORKFLOW (Generic)
# ---------------------------------------------------------------------------
# Configurable per document_type (e.g. "cash_advance", "invoice", etc).
# Each config = list of steps; each step has name + list of approver user_ids.
# Runtime: when document created, create Approval record with copy of steps.
# Actions: approve/reject with note. Sequential — must approve step-by-step.
# ---------------------------------------------------------------------------

class ApprovalStepConfig(BaseModel):
    name: str  # e.g. "Di Cek Oleh", "Approval MGR"
    approver_ids: List[str]  # user ids yang boleh approve step ini

class ApprovalConfigIn(BaseModel):
    document_type: str  # "cash_advance", etc
    enabled: bool = True
    steps: List[ApprovalStepConfig]

class ApprovalActionIn(BaseModel):
    note: Optional[str] = None

async def _get_active_approval_config(doc_type: str):
    cfg = await db.approval_configs.find_one({"document_type": doc_type, "enabled": True})
    return cfg

async def _create_approval_request(doc_type: str, doc_id: str, doc_number: str, doc_snapshot: dict, requester_id: str, override_steps: Optional[List[dict]] = None):
    """Create pending approval based on active config for doc_type — atau override_steps kalau diisi.
    Returns approval doc or None if no config & no override."""
    steps_source = None
    if override_steps and len(override_steps) > 0:
        # Custom flow per-pengajuan
        steps_source = override_steps
    else:
        cfg = await _get_active_approval_config(doc_type)
        if not cfg or not cfg.get("steps"):
            return None
        steps_source = cfg["steps"]
    steps = []
    for s in steps_source:
        steps.append({
            "name": s.get("name") or "Diperiksa Oleh",
            "approver_ids": [str(a) for a in (s.get("approver_ids") or [])],
            "status": "Pending",  # Pending / Approved / Rejected
            "approved_by": None,
            "approved_by_name": None,
            "approved_at": None,
            "note": None,
        })
    doc = {
        "document_type": doc_type,
        "document_id": doc_id,
        "document_number": doc_number,
        "document_snapshot": doc_snapshot,
        "status": "Pending",
        "current_step_idx": 0,
        "steps": steps,
        "requested_by": requester_id,
        "requested_at": datetime.now(timezone.utc),
        "completed_at": None,
        "is_custom_flow": bool(override_steps),
    }
    r = await db.approvals.insert_one(doc)
    doc["_id"] = r.inserted_id
    return doc

@app.get("/api/approval-configs")
async def list_approval_configs(user: dict = Depends(get_current_user)):
    docs = await db.approval_configs.find({}).to_list(200)
    return [serialize(d) for d in docs]

@app.get("/api/approval-configs/{doc_type}")
async def get_approval_config(doc_type: str, user: dict = Depends(get_current_user)):
    doc = await db.approval_configs.find_one({"document_type": doc_type})
    if not doc:
        return None
    return serialize(doc)

@app.post("/api/approval-configs")
async def upsert_approval_config(data: ApprovalConfigIn, user: dict = Depends(require_role("administrator"))):
    payload = {
        "document_type": data.document_type,
        "enabled": data.enabled,
        "steps": [{"name": s.name, "approver_ids": s.approver_ids} for s in data.steps],
        "updated_at": datetime.now(timezone.utc),
        "updated_by": user["id"],
    }
    await db.approval_configs.update_one(
        {"document_type": data.document_type},
        {"$set": payload, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return serialize(await db.approval_configs.find_one({"document_type": data.document_type}))

@app.delete("/api/approval-configs/{doc_type}")
async def delete_approval_config(doc_type: str, user: dict = Depends(require_role("administrator"))):
    await db.approval_configs.delete_one({"document_type": doc_type})
    return {"ok": True}

@app.get("/api/approvals")
async def list_approvals(
    scope: Optional[str] = None,  # "pending_for_me" | "mine" | "all"
    document_type: Optional[str] = None,
    status_v: Optional[str] = None,  # Pending / Approved / Rejected
    user: dict = Depends(get_current_user),
):
    q: dict = {}
    if document_type:
        q["document_type"] = document_type
    if status_v:
        q["status"] = status_v
    if scope == "mine":
        q["requested_by"] = user["id"]
    elif scope == "pending_for_me":
        q["status"] = "Pending"
        # We need approvals where user is approver of the current step
        # Handled with post-filter since Mongo query on dynamic index is expensive
        docs = await db.approvals.find(q).sort("requested_at", -1).to_list(2000)
        out = []
        for d in docs:
            idx = d.get("current_step_idx", 0)
            steps = d.get("steps") or []
            if 0 <= idx < len(steps):
                approver_ids = steps[idx].get("approver_ids") or []
                if user["id"] in approver_ids:
                    out.append(serialize(d))
        return out
    docs = await db.approvals.find(q).sort("requested_at", -1).to_list(2000)
    return [serialize(d) for d in docs]

@app.get("/api/approvals/pending-count")
async def approvals_pending_count(user: dict = Depends(get_current_user)):
    docs = await db.approvals.find({"status": "Pending"}).to_list(2000)
    n = 0
    for d in docs:
        idx = d.get("current_step_idx", 0)
        steps = d.get("steps") or []
        if 0 <= idx < len(steps):
            approver_ids = steps[idx].get("approver_ids") or []
            if user["id"] in approver_ids:
                n += 1
    return {"count": n}

@app.get("/api/approvals/{aid}")
async def get_approval(aid: str, user: dict = Depends(get_current_user)):
    doc = await db.approvals.find_one({"_id": _oid(aid)})
    if not doc:
        raise HTTPException(404, "Approval not found")
    return serialize(doc)

async def _apply_approval_action(aid: str, user: dict, action: str, note: Optional[str]):
    doc = await db.approvals.find_one({"_id": _oid(aid)})
    if not doc:
        raise HTTPException(404, "Approval not found")
    if doc.get("status") != "Pending":
        raise HTTPException(400, f"Approval sudah {doc.get('status')}")
    idx = doc.get("current_step_idx", 0)
    steps = doc.get("steps") or []
    if idx < 0 or idx >= len(steps):
        raise HTTPException(400, "Step index invalid")
    step = steps[idx]
    approver_ids = step.get("approver_ids") or []
    if user["id"] not in approver_ids:
        raise HTTPException(403, "Anda tidak berwenang approve step ini")

    now = datetime.now(timezone.utc)
    step_upd = {
        "status": "Approved" if action == "approve" else "Rejected",
        "approved_by": user["id"],
        "approved_by_name": user.get("full_name") or user.get("username"),
        "approved_at": now,
        "note": (note or "").strip() or None,
    }
    steps[idx] = {**step, **step_upd}

    upd: dict = {"steps": steps}
    if action == "reject":
        upd["status"] = "Rejected"
        upd["completed_at"] = now
    else:
        # Move to next step (or complete)
        if idx + 1 >= len(steps):
            upd["status"] = "Approved"
            upd["completed_at"] = now
        else:
            upd["current_step_idx"] = idx + 1

    await db.approvals.update_one({"_id": _oid(aid)}, {"$set": upd})

    # Sync back to source document (cash_advance for now)
    if doc.get("document_type") == "cash_advance":
        awb_upd = {"approval_status": upd.get("status", "Pending"), "approval_id": str(doc["_id"])}
        await db.cash_advances.update_one({"_id": _oid(doc["document_id"])}, {"$set": awb_upd})

    return serialize(await db.approvals.find_one({"_id": _oid(aid)}))

@app.post("/api/approvals/{aid}/approve")
async def approve_action(aid: str, data: ApprovalActionIn, user: dict = Depends(get_current_user)):
    return await _apply_approval_action(aid, user, "approve", data.note)

@app.post("/api/approvals/{aid}/reject")
async def reject_action(aid: str, data: ApprovalActionIn, user: dict = Depends(get_current_user)):
    return await _apply_approval_action(aid, user, "reject", data.note)


# ---------------------------------------------------------------------------
# END APPROVAL WORKFLOW
# ---------------------------------------------------------------------------

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


@app.on_event("startup")
async def _startup_backfill_tracking_codes():
    """Backfill unique tracking_code untuk semua customer existing.
    Idempotent: hanya customer tanpa tracking_code yang di-update."""
    missing = await db.customers.find(
        {"$or": [{"tracking_code": {"$exists": False}}, {"tracking_code": None}, {"tracking_code": ""}]}
    ).to_list(10000)
    if not missing:
        return
    # Also ensure unique sparse index
    try:
        await db.customers.create_index("tracking_code", unique=True, sparse=True, name="tracking_code_1")
    except Exception:
        pass
    for c in missing:
        try:
            code = await _generate_unique_tracking_code(c.get("name") or "CUST", exclude_id=c["_id"])
            await db.customers.update_one({"_id": c["_id"]}, {"$set": {"tracking_code": code}})
        except Exception as e:
            print(f"[backfill tracking_code] failed for {c.get('name')}: {e}")
    print(f"[migration] Backfilled tracking_code untuk {len(missing)} customer")


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
    armada_requested: Optional[str] = None
    armada_internal: Optional[str] = None
    container_type: Optional[str] = None
    driver_name: Optional[str] = None
    nopol: Optional[str] = None
    insurance_enabled: Optional[bool] = None
    polis_amount: Optional[float] = None
    insurance_amount: Optional[float] = None
    is_charter: Optional[bool] = None
    charter_amount: Optional[float] = None
    pickup_date: Optional[str] = None  # YYYY-MM-DD
    closing_date: Optional[str] = None
    etd: Optional[str] = None
    eta: Optional[str] = None
    plan_eta_customer: Optional[str] = None

@app.patch("/api/orders/{oid}/extended")
async def patch_awb_extended(oid: str, data: AwbExtendedUpdate, user: dict = Depends(get_current_user)):
    raw = data.model_dump()
    upd = {k: v for k, v in raw.items() if v is not None}
    # Only allow editing for Open AWBs unless admin
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if user["role"] != "administrator" and o.get("status") not in ("Open", "Reconciled", None):
        raise HTTPException(403, f"Hanya AWB Open/Reconciled yang dapat di-edit (status saat ini: {o.get('status')})")
    # Cannot edit if already invoiced
    if o.get("status") in ("Invoiced", "Paid"):
        raise HTTPException(403, f"AWB sudah {o.get('status')} — tidak dapat di-edit")
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
    # Recalculate totals when tariff/qty/tax changes — PPN dihitung HANYA dari total_tariff (selling),
    # addons (polis/asuransi/spsi/forklift) TIDAK kena PPN tapi tetap menambah grand_total
    if any(k in upd for k in ("tariff_per_kg", "qty_kg", "tax_percentage", "charter_amount")):
        is_charter = bool(upd.get("is_charter", o.get("is_charter")))
        if is_charter:
            charter_amt = float(upd.get("charter_amount", o.get("charter_amount") or 0))
            total = round(charter_amt, 2)
        else:
            tariff = float(upd.get("tariff_per_kg", o.get("tariff_per_kg") or 0))
            qty = float(upd.get("qty_kg", o.get("qty_kg") or 0))
            total = round(tariff * qty, 2)
        pct = float(upd.get("tax_percentage", o.get("tax_percentage") or 0))
        tax_amt = round(total * pct / 100, 2)  # PPN from selling only
        addons_total = float(o.get("addons_total") or 0)
        upd["total_tariff"] = total
        upd["tax_amount"] = tax_amt
        upd["grand_total"] = round(total + tax_amt + addons_total, 2)  # excl PPN on addons
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc)
        upd["updated_by"] = user["id"]
        await db.awb_orders.update_one({"_id": _oid(oid)}, {"$set": upd})
        # Re-post journal if AWB has accrued sales (Reconciled status)
        if o.get("status") == "Reconciled" and any(k in upd for k in ("total_tariff", "tax_amount")):
            await db.journal_entries.delete_many({"reference_type": "sales_accrued", "reference_id": oid})
            try:
                new_doc = await db.awb_orders.find_one({"_id": _oid(oid)})
                await post_journal(
                    date=new_doc.get("reconciled_at") or new_doc.get("created_at"),
                    description=f"Sales Accrual (edited) - {new_doc['awb_number']}",
                    lines=[
                        {"account_code": "1290", "debit": new_doc["total_tariff"], "credit": 0, "memo": new_doc["awb_number"]},
                        {"account_code": "2390", "debit": 0, "credit": new_doc["total_tariff"], "memo": new_doc["awb_number"]},
                    ],
                    reference_type="sales_accrued", reference_id=oid, posted_by=user["id"],
                )
            except HTTPException:
                pass
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
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
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

def _parse_iso_date(s: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s)
        dt = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return dt
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
    dt = _parse_iso_date(period_to, end_of_day=True)
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
    # Get costs aggregate per AWB & primary vendor + vendor list (max 3, urutan created_at asc)
    awb_ids = [a["_id"] for a in awbs]
    cost_agg: dict = {}
    primary_vendor: dict = {}
    vendor_list: dict = {}  # awb_id -> [vendor1, vendor2, vendor3]
    if awb_ids:
        async for c in db.awb_costs.find({"awb_id": {"$in": awb_ids}}).sort("created_at", 1):
            cost_agg[c["awb_id"]] = cost_agg.get(c["awb_id"], 0) + float(c.get("amount", 0))
            vn = (c.get("vendor_name") or "").strip()
            if vn:
                if c["awb_id"] not in primary_vendor:
                    primary_vendor[c["awb_id"]] = vn
                lst = vendor_list.setdefault(c["awb_id"], [])
                if vn not in lst and len(lst) < 3:
                    lst.append(vn)
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
            "vendor_1": vendor_list.get(a["_id"], [None])[0] if vendor_list.get(a["_id"]) else None,
            "vendor_2": vendor_list.get(a["_id"], [])[1] if len(vendor_list.get(a["_id"], [])) > 1 else None,
            "vendor_3": vendor_list.get(a["_id"], [])[2] if len(vendor_list.get(a["_id"], [])) > 2 else None,
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

# ---- Payment Recipients & Senders master (untuk Bank Payment Voucher) ----
class PaymentPartyIn(BaseModel):
    name: str
    bank: str
    account_number: str

@app.get("/api/payment-recipients")
async def list_payment_recipients(user: dict = Depends(get_current_user)):
    docs = await db.payment_recipients.find({}).sort("name", 1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/payment-recipients")
async def create_payment_recipient(data: PaymentPartyIn, user: dict = Depends(get_current_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Nama wajib diisi")
    doc = {
        "name": name,
        "bank": data.bank.strip(),
        "account_number": data.account_number.strip(),
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.payment_recipients.insert_one(doc)
    return serialize(await db.payment_recipients.find_one({"_id": r.inserted_id}))

@app.put("/api/payment-recipients/{rid}")
async def update_payment_recipient(rid: str, data: PaymentPartyIn, user: dict = Depends(get_current_user)):
    upd = {"name": data.name.strip(), "bank": data.bank.strip(), "account_number": data.account_number.strip()}
    await db.payment_recipients.update_one({"_id": _oid(rid)}, {"$set": upd})
    return serialize(await db.payment_recipients.find_one({"_id": _oid(rid)}))

@app.delete("/api/payment-recipients/{rid}")
async def delete_payment_recipient(rid: str, user: dict = Depends(get_current_user)):
    await db.payment_recipients.delete_one({"_id": _oid(rid)})
    return {"ok": True}

@app.get("/api/payment-senders")
async def list_payment_senders(user: dict = Depends(get_current_user)):
    docs = await db.payment_senders.find({}).sort("name", 1).to_list(2000)
    return [serialize(d) for d in docs]

@app.post("/api/payment-senders")
async def create_payment_sender(data: PaymentPartyIn, user: dict = Depends(get_current_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Nama wajib diisi")
    doc = {
        "name": name,
        "bank": data.bank.strip(),
        "account_number": data.account_number.strip(),
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.payment_senders.insert_one(doc)
    return serialize(await db.payment_senders.find_one({"_id": r.inserted_id}))

@app.put("/api/payment-senders/{sid}")
async def update_payment_sender(sid: str, data: PaymentPartyIn, user: dict = Depends(get_current_user)):
    upd = {"name": data.name.strip(), "bank": data.bank.strip(), "account_number": data.account_number.strip()}
    await db.payment_senders.update_one({"_id": _oid(sid)}, {"$set": upd})
    return serialize(await db.payment_senders.find_one({"_id": _oid(sid)}))

@app.delete("/api/payment-senders/{sid}")
async def delete_payment_sender(sid: str, user: dict = Depends(get_current_user)):
    await db.payment_senders.delete_one({"_id": _oid(sid)})
    return {"ok": True}


class CashAdvanceIn(BaseModel):
    recipient_name: str
    purpose: Optional[str] = None
    amount: float
    advance_date: Optional[str] = None  # YYYY-MM-DD; default today
    cash_account_code: Optional[str] = None  # default 1101
    notes: Optional[str] = None
    # ---- Bank Payment Voucher extras (opsional biar backward-compat) ----
    recipient_id: Optional[str] = None       # ref payment_recipients
    recipient_bank: Optional[str] = None     # snapshot
    recipient_account: Optional[str] = None  # snapshot
    sender_id: Optional[str] = None          # ref payment_senders
    sender_name: Optional[str] = None        # snapshot (nama PT/entitas penyetor)
    sender_bank: Optional[str] = None        # snapshot
    sender_account: Optional[str] = None     # snapshot
    ppn_amount: Optional[float] = 0
    pph_amount: Optional[float] = 0
    reff_number: Optional[str] = None        # mis. "INV CMB-311220240026"
    # ---- Custom approval flow (opsional) ----
    # Jika diisi, override template global. Format: [{"name":"...", "approver_ids":[...]}]
    custom_approval_steps: Optional[List[Dict[str, Any]]] = None

class CashAdvanceBreakdownItem(BaseModel):
    awb_id: Optional[str] = None  # None / "OPERATION" → direct cost ke operation (no AWB)
    target: Optional[str] = None  # "awb" | "operation" | "finance"
    amount: float
    description: Optional[str] = None
    expense_category: Optional[str] = None  # required when target="finance" — name of category in db.expense_categories
    transaction_date: Optional[str] = None  # YYYY-MM-DD; kalau kosong, pakai settle_date

class CashAdvanceSettleIn(BaseModel):
    actual_amount: Optional[float] = None  # actual expense from the advance
    refund_amount: Optional[float] = None  # cash returned by recipient (if any)
    settle_date: Optional[str] = None      # YYYY-MM-DD; default today
    cash_account_code: Optional[str] = None  # for refund; default 1101
    notes: Optional[str] = None
    awb_breakdown: Optional[List[CashAdvanceBreakdownItem]] = None  # list AWB + nominal; nilai jadi cost di AWB ybs
    # ---- Carry-over sisa panjar ----
    transfer_remaining_to_next: Optional[bool] = False    # kalau True: sisa disimpan sebagai carry-over untuk panjar berikutnya (status jadi Settled)
    apply_carry_over_from: Optional[List[str]] = None     # list ID panjar sebelumnya (penerima sama) yang carry-over-nya diserap ke settle ini

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
        # Bank Payment Voucher fields (snapshot supaya voucher lama tidak berubah kalau master di-edit)
        "recipient_id": (data.recipient_id or None),
        "recipient_bank": (data.recipient_bank or "").strip() or None,
        "recipient_account": (data.recipient_account or "").strip() or None,
        "sender_id": (data.sender_id or None),
        "sender_name": (data.sender_name or "").strip() or None,
        "sender_bank": (data.sender_bank or "").strip() or None,
        "sender_account": (data.sender_account or "").strip() or None,
        "ppn_amount": float(data.ppn_amount or 0),
        "pph_amount": float(data.pph_amount or 0),
        "reff_number": (data.reff_number or "").strip() or None,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.cash_advances.insert_one(doc)
    # Auto-create approval request based on custom flow (if provided) or global template
    approval = await _create_approval_request(
        doc_type="cash_advance",
        doc_id=str(r.inserted_id),
        doc_number=doc["number"],
        doc_snapshot={
            "recipient_name": doc["recipient_name"],
            "amount": doc["amount"],
            "purpose": doc.get("purpose"),
            "advance_date": adv_date.isoformat(),
        },
        requester_id=user["id"],
        override_steps=data.custom_approval_steps,
    )
    if approval:
        await db.cash_advances.update_one(
            {"_id": r.inserted_id},
            {"$set": {"approval_status": "Pending", "approval_id": str(approval["_id"])}},
        )
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
async def settle_cash_advance(cid: str, data: CashAdvanceSettleIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    ca = await db.cash_advances.find_one({"_id": _oid(cid)})
    if not ca:
        raise HTTPException(404, "Panjar tidak ditemukan")
    if ca.get("status") == "Settled":
        raise HTTPException(400, "Panjar sudah disettle")
    # Validate AWB breakdown if provided
    breakdown = []
    if data.awb_breakdown:
        # Each item: target="awb" (with awb_id) OR target="operation" (direct HPP) OR target="finance" (expense with category)
        for it in data.awb_breakdown:
            target = (it.target or ("operation" if not it.awb_id else "awb")).lower()
            # Per-baris transaction date (opsional). Fallback ke settle_date nanti.
            row_txn_date = None
            if it.transaction_date:
                try:
                    y, m, d = [int(x) for x in it.transaction_date.split("-")]
                    row_txn_date = datetime(y, m, d, tzinfo=timezone.utc)
                except Exception:
                    raise HTTPException(400, f"transaction_date '{it.transaction_date}' tidak valid (YYYY-MM-DD)")
            if target == "operation":
                breakdown.append({
                    "target": "operation",
                    "awb_id": None,
                    "awb_number": None,
                    "amount": float(it.amount),
                    "description": (it.description or "").strip() or None,
                    "expense_category": None,
                    "expense_account_code": None,
                    "expense_posting_type": None,
                    "transaction_date": row_txn_date,
                })
            elif target == "finance":
                cat_name = (it.expense_category or "").strip()
                if not cat_name:
                    raise HTTPException(400, "expense_category wajib jika target=finance")
                cat = await get_expense_category(cat_name)
                if not cat:
                    raise HTTPException(400, f"Kategori expense '{cat_name}' tidak ditemukan")
                breakdown.append({
                    "target": "finance",
                    "awb_id": None,
                    "awb_number": None,
                    "amount": float(it.amount),
                    "description": (it.description or "").strip() or None,
                    "expense_category": cat["name"],
                    "expense_account_code": cat.get("account_code"),
                    "expense_posting_type": cat.get("posting_type", "expense"),
                    "transaction_date": row_txn_date,
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
                    "expense_category": None,
                    "expense_account_code": None,
                    "expense_posting_type": None,
                    "transaction_date": row_txn_date,
                })
        total_breakdown_this_round = sum(b["amount"] for b in breakdown)
        actual = float(data.actual_amount if data.actual_amount is not None else total_breakdown_this_round)
        if abs(total_breakdown_this_round - actual) > 0.01:
            raise HTTPException(400, f"Total breakdown ({total_breakdown_this_round}) tidak sama dengan actual_amount ({actual})")
    else:
        actual = float(data.actual_amount if data.actual_amount is not None else 0)
    refund = float(data.refund_amount or 0)
    # ===== Apply carry-over dari panjar sebelumnya (penerima sama) =====
    carry_over_applied = []       # [{panjar_id, panjar_number, amount}]
    carry_over_applied_total = 0.0
    if data.apply_carry_over_from:
        for src_id in data.apply_carry_over_from:
            src = await db.cash_advances.find_one({"_id": _oid(src_id)})
            if not src:
                raise HTTPException(400, f"Panjar carry-over {src_id} tidak ditemukan")
            if (src.get("recipient_name") or "").strip().lower() != (ca.get("recipient_name") or "").strip().lower():
                raise HTTPException(400, f"Carry-over dari {src.get('number')} tidak diperbolehkan — penerima berbeda ({src.get('recipient_name')} vs {ca.get('recipient_name')})")
            if not src.get("carry_over_transferred") or src.get("carry_over_consumed_by"):
                raise HTTPException(400, f"Panjar {src.get('number')} tidak memiliki carry-over yang tersedia")
            amt = float(src.get("carry_over_amount") or 0)
            if amt <= 0:
                raise HTTPException(400, f"Panjar {src.get('number')} tidak memiliki sisa carry-over")
            carry_over_applied.append({"panjar_id": str(src["_id"]), "panjar_number": src["number"], "amount": amt})
            carry_over_applied_total = round(carry_over_applied_total + amt, 2)

    # ===== PARTIAL SETTLE: status tetap "Open" sampai total settled+refund == panjar amount + carry_over =====
    panjar_amt = float(ca.get("amount") or 0)
    prev_settled = float(ca.get("settled_amount") or 0)
    prev_refund = float(ca.get("refund_amount") or 0)
    new_settled_total = round(prev_settled + actual, 2)
    new_refund_total = round(prev_refund + refund, 2)
    consumed = round(new_settled_total + new_refund_total, 2)
    total_budget = round(panjar_amt + carry_over_applied_total + float(ca.get("carry_over_applied_total") or 0), 2)
    remaining = round(total_budget - consumed, 2)
    if remaining < -0.01:
        raise HTTPException(400, f"Total settle ({consumed}) melebihi total budget ({total_budget}). Sisa: {remaining}")

    is_full = abs(remaining) < 0.01
    # ===== Handle transfer_remaining_to_next checkbox =====
    transfer_this_time = bool(data.transfer_remaining_to_next) and remaining > 0.01
    new_status = "Settled" if (is_full or transfer_this_time) else "Open"
    if data.settle_date:
        try:
            y, m, d = [int(x) for x in data.settle_date.split("-")]
            sd = datetime(y, m, d, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "settle_date harus YYYY-MM-DD")
    else:
        sd = datetime.now(timezone.utc)
    cash_acc = data.cash_account_code or ca.get("cash_account_code") or "1101"

    # Append to history (each partial settle event)
    history_evt = {
        "settle_date": sd,
        "actual_amount": actual,
        "refund_amount": refund,
        "notes": (data.notes or "").strip() or None,
        "settled_by": user["id"],
        "breakdown": [
            {
                **b,
                "awb_id": str(b["awb_id"]) if b.get("awb_id") else None,
                "transaction_date": b["transaction_date"].isoformat() if b.get("transaction_date") else None,
            } for b in breakdown
        ] if breakdown else [],
        "carry_over_applied": carry_over_applied,
        "transfer_remaining": transfer_this_time,
    }

    set_upd = {
        "status": new_status,
        "settled_amount": new_settled_total,
        "refund_amount": new_refund_total,
        "actual_amount": new_settled_total,  # back-compat
        "remaining_amount": max(0.0, remaining),
        "settled_at": sd if (is_full or transfer_this_time) else ca.get("settled_at"),
        "settled_by": user["id"] if (is_full or transfer_this_time) else ca.get("settled_by"),
        "settle_notes": (data.notes or "").strip() or ca.get("settle_notes"),
        "carry_over_applied_total": round(float(ca.get("carry_over_applied_total") or 0) + carry_over_applied_total, 2),
    }
    if transfer_this_time:
        # Sisa disimpan sebagai carry-over untuk panjar berikutnya (penerima sama)
        set_upd["carry_over_transferred"] = True
        set_upd["carry_over_amount"] = remaining
        set_upd["carry_over_consumed_by"] = None
        set_upd["carry_over_consumed_at"] = None

    await db.cash_advances.update_one(
        {"_id": _oid(cid)},
        {"$set": set_upd, "$push": {"settle_history": history_evt}},
    )

    # Mark source carry-over panjars as consumed
    for src in carry_over_applied:
        await db.cash_advances.update_one(
            {"_id": _oid(src["panjar_id"])},
            {"$set": {
                "carry_over_consumed_by": cid,
                "carry_over_consumed_number": ca["number"],
                "carry_over_consumed_at": sd,
            }},
        )
    # Create awb_costs for AWB targets / direct journal for Operation targets / fixed_costs entry for Finance
    finance_expense_amount = 0.0        # for journal split
    finance_expense_lines = {}          # account_code → total amount (aggregate per COA)
    for b in breakdown:
        # Tanggal transaksi baris: pakai per-row kalau ada, fallback ke settle_date
        row_date = b.get("transaction_date") or sd
        if b.get("target") == "operation":
            # Direct cost (Operation, no AWB) — journal DR 5102 / CR 1108. Handled below.
            pass
        elif b.get("target") == "finance":
            # Create fixed_costs entry (biar tampil di halaman Expenses & P&L)
            period_m = row_date.strftime("%Y-%m")
            fc_doc = {
                "category": b["expense_category"],
                "posting_type": b.get("expense_posting_type", "expense"),
                "account_code": b.get("expense_account_code"),
                "description": (b["description"] or f"Panjar {ca['number']} - {ca['recipient_name']}"),
                "amount": b["amount"],
                "expense_date": row_date.strftime("%Y-%m-%d"),
                "period_month": period_m,
                "cash_account_code": cash_acc,
                "source": "cash_advance_settle",
                "source_ref": cid,
                "source_number": ca["number"],
                "created_by": user["id"],
                "created_at": sd,
            }
            await db.fixed_costs.insert_one(fc_doc)
            # Aggregate journal DR by expense account_code
            acc_code = b.get("expense_account_code") or "6199"
            finance_expense_lines[acc_code] = round(finance_expense_lines.get(acc_code, 0) + b["amount"], 2)
            finance_expense_amount = round(finance_expense_amount + b["amount"], 2)
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
                "transaction_date": row_date,
                "created_by": user["id"],
                "created_at": sd,
            }
            await db.awb_costs.insert_one(cdoc)
    # Journal per partial event
    try:
        # Split actual:
        #   AWB/Operation targets → 5102 (HPP Operational Pengiriman)
        #   Finance target       → per expense_account_code (dari expense_category)
        # Semua di-credit ke 1108 (Panjar Kerja) untuk actual + Cash untuk refund.
        # Kalau ada carry-over: split CR 1108 antara panjar source (memo referensi) & panjar sekarang.
        hpp_amount = round(actual - finance_expense_amount, 2)
        lines = []
        if hpp_amount > 0.01:
            lines.append({"account_code": "5102", "debit": hpp_amount, "credit": 0, "memo": f"Panjar {ca['number']} - {ca['recipient_name']}"})
        for acc_code, amt in finance_expense_lines.items():
            if amt > 0.01:
                lines.append({"account_code": acc_code, "debit": amt, "credit": 0, "memo": f"Panjar {ca['number']} (finance)"})
        if refund > 0:
            lines.append({"account_code": cash_acc, "debit": refund, "credit": 0, "memo": f"Refund panjar {ca['number']}"})
        total_cr_needed = round(actual + refund, 2)
        remaining_cr = total_cr_needed
        # Konsumsi carry-over lebih dulu (dari panjar source, memo referensi)
        for src in carry_over_applied:
            take = min(src["amount"], remaining_cr)
            if take > 0.01:
                lines.append({"account_code": "1108", "debit": 0, "credit": take, "memo": f"Carry-over dari {src['panjar_number']}"})
                remaining_cr = round(remaining_cr - take, 2)
        if remaining_cr > 0.01:
            lines.append({"account_code": "1108", "debit": 0, "credit": remaining_cr, "memo": ca["number"]})
        if total_cr_needed > 0.01:
            await post_journal(
                date=sd,
                description=f"Settle panjar kerja {ca['number']}" + (" (partial)" if not (is_full or transfer_this_time) else (" (transfer sisa)" if transfer_this_time else " (final)")),
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
        {"key_name": {"$regex": "^(signer_|address_|npwp_|company_|bank_|invoice_|kop_)"}}
    )}
    # Kop surat global (settings baru — dipakai untuk SEMUA issuer)
    kop_address = settings.get("kop_address", "")
    kop_phone   = settings.get("kop_phone", "")
    kop_email   = settings.get("kop_email", "")
    kop_website = settings.get("kop_website", "")
    kop_tagline = settings.get("kop_tagline", "")
    # Per-issuer setting untuk signer & bank (tetap dipakai untuk tanda tangan & rekening)
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

    # --- Logo (rows 1-5, pojok kiri atas A1) ---
    if logo_b64:
        try:
            raw = logo_b64.split(",", 1)[1] if "," in logo_b64 and logo_b64.startswith("data:") else logo_b64
            img_bytes = base64.b64decode(raw)
            try:
                from PIL import Image as PILImage  # type: ignore
                pil = PILImage.open(io.BytesIO(img_bytes))
                target_h = 110  # px
                if pil.height > 0:
                    ratio = target_h / pil.height
                    pil = pil.resize((int(pil.width * ratio), target_h), PILImage.LANCZOS)
                    if pil.mode == "RGBA":
                        bg = PILImage.new("RGB", pil.size, (255, 255, 255)); bg.paste(pil, mask=pil.split()[3]); pil = bg
                    elif pil.mode != "RGB":
                        pil = pil.convert("RGB")
                    buf2 = io.BytesIO(); pil.save(buf2, format="PNG", optimize=True); img_bytes = buf2.getvalue()
            except Exception:
                pass
            img = XLImage(io.BytesIO(img_bytes))
            ws.add_image(img, "A1")
        except Exception:
            pass
    for r in range(1, 6): ws.row_dimensions[r].height = 22

    # === KOP SURAT (rows 1-5) — di sisa lebar KANAN dari logo, semua CENTER ===
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    bold_company = Font(name="Calibri", bold=True, size=14, color="1F3864")
    kop_regular = Font(name="Calibri", size=10, color="404040")
    kop_italic = Font(name="Calibri", italic=True, size=10, color="1F3864")

    # R1: Nama Perusahaan (dari AWB) — center K1:W1
    ws.merge_cells("K1:W1"); ws["K1"] = (issuer or "PT. Abirama Mitra").upper()
    ws["K1"].font = bold_company; ws["K1"].alignment = center

    # R2: Alamat
    ws.merge_cells("K2:W2"); ws["K2"] = (kop_address or "").replace("\n", " ")
    ws["K2"].font = kop_regular; ws["K2"].alignment = center

    # R3: Telp · Email
    contact_parts = []
    if kop_phone: contact_parts.append(f"Telp: {kop_phone}")
    if kop_email: contact_parts.append(f"Email: {kop_email}")
    ws.merge_cells("K3:W3"); ws["K3"] = " · ".join(contact_parts)
    ws["K3"].font = kop_regular; ws["K3"].alignment = center

    # R4: Website
    ws.merge_cells("K4:W4"); ws["K4"] = f"Website: {kop_website}" if kop_website else ""
    ws["K4"].font = kop_regular; ws["K4"].alignment = center

    # R5: Tagline
    ws.merge_cells("K5:W5"); ws["K5"] = kop_tagline or ""
    ws["K5"].font = kop_italic; ws["K5"].alignment = center

    # --- Grey banner with INVOICE title (row 7) ---
    ws.merge_cells("B7:W7")
    c = ws["B7"]; c.value = "INVOICE"
    c.font = bold_white_big; c.fill = grey_banner
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[7].height = 32

    # --- Meta block (rows 9-11) — Invoice No / Date / Due Date di kanan ---
    ws["P9"] = "Invoice No"; ws["P9"].font = bold
    ws["U9"] = ":"; ws["U9"].font = bold
    ws.merge_cells("V9:W9"); ws["V9"] = invoice.get("invoice_number", ""); ws["V9"].font = bold
    ws["P10"] = "Date"; ws["P10"].font = bold
    ws["U10"] = ":"; ws["U10"].font = bold
    inv_date = (invoice.get("created_at") or datetime.now(timezone.utc)).replace(tzinfo=None)
    ws.merge_cells("V10:W10"); ws["V10"] = _fmt_id_date(inv_date)
    due = inv_date + timedelta(days=30)
    ws["P11"] = "Due Date"; ws["P11"].font = bold
    ws["U11"] = ":"; ws["U11"].font = bold
    ws.merge_cells("V11:W11"); ws["V11"] = _fmt_id_date(due)

    # --- NPWP issuer di kiri (kalau ada) ---
    if issuer_npwp:
        ws["B9"] = f"NPWP: {issuer_npwp}"; ws["B9"].font = regular

    # --- Attn (row 12) ---
    ws["B12"] = "Attn :"; ws["B12"].font = regular
    attn = awb.get("consignee") or (customer.get("name") if customer else "")
    ws["C12"] = attn; ws["C12"].font = regular

    # --- Table header (row 14) — dark band white text ---
    header_row = 14
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
    # Service + container_type (untuk FCL: mis. "FCL 40FT HQ")
    svc = awb.get("service") or ""
    if awb.get("container_type"):
        svc = f"{svc} {awb['container_type']}".strip()
    if svc: suffix.append(svc)
    # Untuk invoice, pakai armada_requested (yang di-request customer); fallback ke armada legacy
    armada_bill = awb.get("armada_requested") or awb.get("armada")
    if armada_bill: suffix.append(armada_bill)
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
async def reclass_cost_to_accrue(cid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
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
class POItemIn(BaseModel):
    origin: str
    destination: str
    armada: Optional[str] = None
    item_description: Optional[str] = None  # Isi Barang / Material
    qty: Optional[float] = None
    harga: Optional[float] = None  # boleh kosong, diisi nanti
    awb_id: Optional[str] = None  # boleh kosong, diisi nanti

class POIn(BaseModel):
    vendor_name: str
    po_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[POItemIn] = []

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

async def _process_po_item_cost(po_doc: dict, item: dict, user_id: str, po_dt: datetime) -> Optional[str]:
    """Jika item punya awb_id DAN harga > 0 → auto-create vendor cost + journal.
    Return linked_cost_id (string) or None."""
    if not item.get("awb_id") or not item.get("harga") or float(item["harga"]) <= 0:
        return None
    awb_oid = _oid(item["awb_id"]) if isinstance(item["awb_id"], str) else item["awb_id"]
    awb = await db.awb_orders.find_one({"_id": awb_oid})
    if not awb:
        return None
    cost_doc = {
        "awb_id": awb_oid,
        "cost_category": "Vendor",
        "amount": float(item["harga"]),
        "description": f"PO {po_doc['number']} — {item.get('origin', '')}→{item.get('destination', '')} ({item.get('item_description') or 'Material'})",
        "sub_label": "PO Vendor",
        "vendor_name": po_doc["vendor_name"],
        "payment_type": "Accrue",
        "is_settled": False,
        "source": "purchase_order",
        "source_ref": str(po_doc["_id"]),
        "created_by": user_id,
        "created_at": po_dt,
    }
    cr = await db.awb_costs.insert_one(cost_doc)
    try:
        await post_journal(
            date=po_dt,
            description=f"PO {po_doc['number']} → cost {awb['awb_number']}",
            lines=[
                {"account_code": "5101", "debit": cost_doc["amount"], "credit": 0,
                 "memo": f"PO {po_doc['number']} - {po_doc['vendor_name']}"},
                {"account_code": "2101", "debit": 0, "credit": cost_doc["amount"],
                 "memo": po_doc["vendor_name"]},
            ],
            reference_type="cost", reference_id=str(cr.inserted_id), posted_by=user_id,
        )
    except HTTPException:
        pass
    try:
        await recognize_revenue_for_awb(awb_oid, user_id, trigger_date=po_dt)
    except Exception:
        pass
    return str(cr.inserted_id)

@app.get("/api/purchase-orders")
async def list_purchase_orders(user: dict = Depends(get_current_user)):
    docs = await db.purchase_orders.find().sort("po_date", -1).to_list(2000)
    # Collect all referenced AWBs across all items
    all_awb_ids = set()
    for d in docs:
        for it in (d.get("items") or []):
            if it.get("awb_id"):
                all_awb_ids.add(it["awb_id"])
        # legacy single-AWB field
        if d.get("awb_id"):
            all_awb_ids.add(d["awb_id"])
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": list(all_awb_ids)}}).to_list(5000)}
    out = []
    for d in docs:
        s = serialize(d)
        items_out = []
        for it in (d.get("items") or []):
            io = dict(it)
            if io.get("awb_id"):
                a = amap.get(io["awb_id"])
                io["awb_id"] = str(io["awb_id"])
                io["awb_number"] = a["awb_number"] if a else None
            items_out.append(io)
        s["items"] = items_out
        # Aggregate totals
        s["total_amount"] = sum(float(it.get("harga") or 0) for it in items_out)
        s["total_qty"] = sum(float(it.get("qty") or 0) for it in items_out)
        s["item_count"] = len(items_out)
        # back-compat: legacy single-item flatten
        if not items_out and d.get("amount"):
            s["legacy"] = True
            s["total_amount"] = float(d.get("amount") or 0)
            s["item_count"] = 1
            awb_legacy = amap.get(d.get("awb_id")) if d.get("awb_id") else None
            s["items"] = [{
                "origin": "-", "destination": "-", "armada": None,
                "item_description": d.get("description"),
                "qty": None, "harga": float(d.get("amount") or 0),
                "awb_id": str(d["awb_id"]) if d.get("awb_id") else None,
                "awb_number": awb_legacy["awb_number"] if awb_legacy else None,
                "linked_cost_id": d.get("linked_cost_id"),
            }]
        out.append(s)
    return out

@app.post("/api/purchase-orders")
async def create_purchase_order(data: POIn, user: dict = Depends(require_role("operation", "finance"))):
    if not data.vendor_name or not data.vendor_name.strip():
        raise HTTPException(400, "Vendor wajib diisi")
    if not data.items or len(data.items) == 0:
        raise HTTPException(400, "Minimal 1 baris item wajib")
    # Validate items
    for i, it in enumerate(data.items):
        if not it.origin or not it.destination:
            raise HTTPException(400, f"Item #{i+1}: Origin & Destination wajib")
    if data.po_date:
        try:
            y, m, d = [int(x) for x in data.po_date.split("-")]
            now = datetime.now(timezone.utc)
            po_dt = datetime(y, m, d, now.hour, now.minute, now.second, now.microsecond, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "po_date harus YYYY-MM-DD")
    else:
        po_dt = datetime.now(timezone.utc)
    # Build items list (awb_id stored as ObjectId or None)
    items_doc = []
    for it in data.items:
        items_doc.append({
            "origin": it.origin.strip(),
            "destination": it.destination.strip(),
            "armada": (it.armada or "").strip() or None,
            "item_description": (it.item_description or "").strip() or None,
            "qty": float(it.qty) if it.qty not in (None, "") else None,
            "harga": float(it.harga) if it.harga not in (None, "") else None,
            "awb_id": _oid(it.awb_id) if it.awb_id else None,
            "linked_cost_id": None,
        })
    doc = {
        "number": await next_po_number(),
        "vendor_name": data.vendor_name.strip(),
        "po_date": po_dt,
        "notes": (data.notes or "").strip() or None,
        "status": "Open",
        "items": items_doc,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.purchase_orders.insert_one(doc)
    doc["_id"] = r.inserted_id
    # Process each item: if AWB + harga both present → auto-create cost
    for idx, it in enumerate(items_doc):
        cid = await _process_po_item_cost(doc, it, user["id"], po_dt)
        if cid:
            await db.purchase_orders.update_one(
                {"_id": r.inserted_id, f"items.{idx}.linked_cost_id": None},
                {"$set": {f"items.{idx}.linked_cost_id": cid}},
            )
    return serialize(await db.purchase_orders.find_one({"_id": r.inserted_id}))

@app.patch("/api/purchase-orders/{pid}/items/{idx}")
async def update_po_item(pid: str, idx: int, data: POItemIn, user: dict = Depends(require_role("operation", "finance"))):
    """Update satu baris item PO. Jika harga & AWB baru → otomatis create cost (kalau belum ada)."""
    po = await db.purchase_orders.find_one({"_id": _oid(pid)})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan")
    items = po.get("items") or []
    if idx < 0 or idx >= len(items):
        raise HTTPException(400, "Index item tidak valid")
    item = items[idx]
    old_linked = item.get("linked_cost_id")
    # Build updated values
    new_item = {
        "origin": data.origin.strip(),
        "destination": data.destination.strip(),
        "armada": (data.armada or "").strip() or None,
        "item_description": (data.item_description or "").strip() or None,
        "qty": float(data.qty) if data.qty not in (None, "") else None,
        "harga": float(data.harga) if data.harga not in (None, "") else None,
        "awb_id": _oid(data.awb_id) if data.awb_id else None,
        "linked_cost_id": old_linked,
    }
    # If was previously linked but now AWB or harga missing → reverse the cost
    if old_linked:
        cost = await db.awb_costs.find_one({"_id": _oid(old_linked)})
        same_awb = bool(new_item.get("awb_id")) and cost and cost.get("awb_id") == new_item["awb_id"]
        same_amt = cost and abs(float(cost.get("amount") or 0) - float(new_item.get("harga") or 0)) < 0.01
        need_recreate = not (new_item.get("awb_id") and new_item.get("harga") and new_item["harga"] > 0)
        if need_recreate or not same_awb or not same_amt:
            if cost and cost.get("is_settled"):
                raise HTTPException(400, "Cost terkait sudah disettle — tidak bisa update item. Reverse pembayaran dulu.")
            await db.awb_costs.delete_one({"_id": _oid(old_linked)})
            await db.journal_entries.delete_many({"reference_type": "cost", "reference_id": old_linked})
            new_item["linked_cost_id"] = None
    # Set item
    items[idx] = new_item
    await db.purchase_orders.update_one({"_id": _oid(pid)}, {"$set": {"items": items}})
    # If now eligible → create cost
    if not new_item.get("linked_cost_id") and new_item.get("awb_id") and new_item.get("harga") and new_item["harga"] > 0:
        po_dt = po.get("po_date") or datetime.now(timezone.utc)
        po_doc = {"_id": _oid(pid), "number": po["number"], "vendor_name": po["vendor_name"]}
        cid = await _process_po_item_cost(po_doc, new_item, user["id"], po_dt)
        if cid:
            await db.purchase_orders.update_one(
                {"_id": _oid(pid)},
                {"$set": {f"items.{idx}.linked_cost_id": cid}},
            )
    return serialize(await db.purchase_orders.find_one({"_id": _oid(pid)}))

class POReceiveIn(BaseModel):
    pod_date: Optional[str] = None
    pod_notes: Optional[str] = None

# NOTE: POD receive endpoint dipindah ke modul AWB (POST /api/orders/{oid}/receive-pod)
# karena POD adalah konfirmasi penerimaan barang oleh consignee, bukan vendor PO confirmation.

@app.delete("/api/purchase-orders/{pid}")
async def delete_purchase_order(pid: str, user: dict = Depends(require_role("administrator", "operation"))):
    po = await db.purchase_orders.find_one({"_id": _oid(pid)})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan")
    items = po.get("items") or []
    linked_ids = [it.get("linked_cost_id") for it in items if it.get("linked_cost_id")]
    if po.get("linked_cost_id"):
        linked_ids.append(po["linked_cost_id"])
    # PRE-CHECK: refuse if ANY linked cost is settled (avoid partial cascade)
    if linked_ids:
        settled = await db.awb_costs.find({"_id": {"$in": [_oid(c) for c in linked_ids]}, "is_settled": True}).to_list(100)
        if settled:
            raise HTTPException(400, f"Tidak bisa hapus PO {po['number']} — ada {len(settled)} cost sudah disettle. Reverse pembayaran dulu.")
    # Cascade delete
    for cid in linked_ids:
        try:
            await db.awb_costs.delete_one({"_id": _oid(cid)})
            await db.journal_entries.delete_many({"reference_type": "cost", "reference_id": cid})
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
        if isinstance(cdate, datetime) and cdate.tzinfo is None:
            cdate = cdate.replace(tzinfo=timezone.utc)
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

# ===========================================================================
# Excel Export — Vendor Aging report
# ===========================================================================
@app.get("/api/exports/vendor-aging")
async def export_vendor_aging(as_of: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Export aging hutang vendor ke Excel."""
    if as_of:
        try:
            y, m, d = [int(x) for x in as_of.split("-")]
            ref_date = datetime(y, m, d, 23, 59, 59, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "as_of harus YYYY-MM-DD")
    else:
        ref_date = datetime.now(timezone.utc)

    # Reuse aging computation
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
        if isinstance(cdate, datetime) and cdate.tzinfo is None:
            cdate = cdate.replace(tzinfo=timezone.utc)
        days = max(0, (ref_date - cdate).days) if isinstance(cdate, datetime) else 0
        bucket = "0-30" if days <= 30 else ("31-60" if days <= 60 else ("61-90" if days <= 90 else "90+"))
        amt = float(c.get("amount") or 0)
        if vendor not in by_vendor:
            by_vendor[vendor] = {"vendor": vendor, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, "total": 0, "items": []}
        by_vendor[vendor][bucket] += amt
        by_vendor[vendor]["total"] += amt
        awb_doc = amap.get(c.get("awb_id"))
        by_vendor[vendor]["items"].append({
            "awb_number": awb_doc["awb_number"] if awb_doc else "",
            "amount": amt,
            "created_at": cdate,
            "days": days,
            "bucket": bucket,
            "description": c.get("description") or "",
        })
    rows = sorted(by_vendor.values(), key=lambda r: r["total"], reverse=True)
    totals = {b: sum(r[b] for r in rows) for b in buckets}
    totals["total"] = sum(r["total"] for r in rows)

    # Build Excel
    wb = openpyxl.Workbook()
    ws_sum = wb.active
    ws_sum.title = "Summary Aging"

    bold = Font(bold=True)
    bold_white = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="2563EB")
    sub_fill = PatternFill("solid", fgColor="F1F5F9")
    rose_fill = PatternFill("solid", fgColor="FEF2F2")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center")
    right_align = Alignment(horizontal="right")

    # Title
    ws_sum.cell(1, 1, f"AGING HUTANG VENDOR — Per {ref_date.strftime('%d %B %Y')}").font = Font(bold=True, size=14)
    ws_sum.merge_cells(start_row=1, start_column=1, end_row=1, end_column=6)

    # Header row 3
    headers = ["Vendor", "0-30 Hari", "31-60 Hari", "61-90 Hari", "90+ Hari (Overdue)", "Total"]
    for i, h in enumerate(headers, 1):
        c = ws_sum.cell(3, i, h)
        c.font = bold_white
        c.fill = header_fill
        c.alignment = center
        c.border = border

    # Data rows
    row_idx = 4
    for r in rows:
        ws_sum.cell(row_idx, 1, r["vendor"]).border = border
        for i, b in enumerate(buckets, start=2):
            cell = ws_sum.cell(row_idx, i, r[b])
            cell.number_format = "#,##0"
            cell.alignment = right_align
            cell.border = border
            if b == "90+" and r[b] > 0:
                cell.fill = rose_fill
                cell.font = bold
        tot = ws_sum.cell(row_idx, 6, r["total"])
        tot.number_format = "#,##0"
        tot.font = bold
        tot.alignment = right_align
        tot.border = border
        row_idx += 1

    # Total row
    ws_sum.cell(row_idx, 1, "TOTAL").font = bold
    ws_sum.cell(row_idx, 1).fill = sub_fill
    ws_sum.cell(row_idx, 1).border = border
    for i, b in enumerate(buckets, start=2):
        cell = ws_sum.cell(row_idx, i, totals[b])
        cell.number_format = "#,##0"
        cell.font = bold
        cell.fill = sub_fill
        cell.alignment = right_align
        cell.border = border
    cell = ws_sum.cell(row_idx, 6, totals["total"])
    cell.number_format = "#,##0"
    cell.font = Font(bold=True, size=12)
    cell.fill = sub_fill
    cell.alignment = right_align
    cell.border = border

    # Column widths
    ws_sum.column_dimensions["A"].width = 40
    for col_letter in ["B", "C", "D", "E", "F"]:
        ws_sum.column_dimensions[col_letter].width = 18

    # Detail sheet
    ws_det = wb.create_sheet(title="Detail per Item")
    det_headers = ["Vendor", "AWB", "Tanggal", "Umur (Hari)", "Bucket", "Deskripsi", "Nominal"]
    for i, h in enumerate(det_headers, 1):
        c = ws_det.cell(1, i, h)
        c.font = bold_white
        c.fill = header_fill
        c.alignment = center
        c.border = border

    rd = 2
    for r in rows:
        for it in r["items"]:
            ws_det.cell(rd, 1, r["vendor"]).border = border
            ws_det.cell(rd, 2, it["awb_number"] or "—").border = border
            cdate = it["created_at"]
            if isinstance(cdate, datetime):
                date_cell = ws_det.cell(rd, 3, cdate.replace(tzinfo=None))
                date_cell.number_format = "dd/mm/yyyy"
            else:
                ws_det.cell(rd, 3, "—")
            ws_det.cell(rd, 3).border = border
            ws_det.cell(rd, 4, it["days"]).alignment = right_align
            ws_det.cell(rd, 4).border = border
            bcell = ws_det.cell(rd, 5, it["bucket"])
            bcell.alignment = center
            bcell.border = border
            if it["bucket"] == "90+":
                bcell.fill = rose_fill
                bcell.font = bold
            ws_det.cell(rd, 6, it["description"]).border = border
            amt = ws_det.cell(rd, 7, it["amount"])
            amt.number_format = "#,##0"
            amt.alignment = right_align
            amt.border = border
            rd += 1

    ws_det.column_dimensions["A"].width = 30
    ws_det.column_dimensions["B"].width = 20
    ws_det.column_dimensions["C"].width = 14
    ws_det.column_dimensions["D"].width = 12
    ws_det.column_dimensions["E"].width = 12
    ws_det.column_dimensions["F"].width = 40
    ws_det.column_dimensions["G"].width = 18

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    fname = f"Vendor_Aging_{ref_date.strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )

# ===========================================================================
# Migration: Reverse AR journal for invoices that haven't been printed yet.
# Per PSAK: Piutang Usaha (1201) baru diakui saat faktur diterbitkan/dicetak.
# Sebelum cetak → tetap di Pendapatan Yang Masih Harus Diterima (PYMHD / 1290).
# ===========================================================================
@app.post("/api/admin/migrate/reverse-unprinted-ar")
async def migrate_reverse_unprinted_ar(user: dict = Depends(require_role("administrator"))):
    """Untuk invoice yang sudah punya jurnal AR (1201) tapi belum dicetak (invoice_date=null),
    POST REVERSING JOURNAL — bukan delete — supaya saldo kembali ke 1290 (PYMHD) sesuai PSAK,
    DAN tetap muncul konsisten di Balance Sheet, Trial Balance, dan General Ledger (audit trail)."""
    invoices_unprinted = await db.invoices.find({
        "$or": [
            {"invoice_date": None},
            {"invoice_date": {"$exists": False}},
        ]
    }).to_list(20000)
    reversed_count = 0
    affected_invoices = []
    now = datetime.now(timezone.utc)
    for inv in invoices_unprinted:
        # Aggregate net DR/CR per account from journals of this invoice
        journals = await db.journal_entries.find({
            "reference_type": "invoice",
            "reference_id": str(inv["_id"]),
            "is_reversal": {"$ne": True},  # skip already-reversed
        }).to_list(100)
        if not journals:
            continue
        # Sum lines per account (to know what to reverse)
        from collections import defaultdict
        line_sum = defaultdict(lambda: {"debit": 0.0, "credit": 0.0})
        for j in journals:
            for line in (j.get("lines") or []):
                code = line.get("account_code")
                line_sum[code]["debit"] += float(line.get("debit") or 0)
                line_sum[code]["credit"] += float(line.get("credit") or 0)
        # If 1201 not present, skip (means AR was never posted)
        if "1201" not in line_sum or abs(line_sum["1201"]["debit"]) < 0.01:
            continue
        # Build reversing journal: swap debit ↔ credit per line
        reverse_lines = []
        for code, vals in line_sum.items():
            net_dr = vals["debit"] - vals["credit"]
            if abs(net_dr) < 0.01:
                continue
            if net_dr > 0:
                # was net debit → reverse with credit
                reverse_lines.append({"account_code": code, "debit": 0, "credit": round(net_dr, 2), "memo": f"Reversal — {inv['invoice_number']} belum dicetak"})
            else:
                reverse_lines.append({"account_code": code, "debit": round(-net_dr, 2), "credit": 0, "memo": f"Reversal — {inv['invoice_number']} belum dicetak"})
        try:
            await post_journal(
                date=now,
                description=f"REVERSAL AR — Invoice {inv['invoice_number']} belum dicetak (PSAK: piutang baru diakui saat faktur dicetak)",
                lines=reverse_lines,
                reference_type="invoice_ar_reversal",
                reference_id=str(inv["_id"]),
                posted_by=user["id"],
                extra_fields={"is_reversal": True, "reversed_invoice": inv["invoice_number"]},
            )
        except HTTPException:
            continue
        # Mark invoice as ar_recognized=false (re-creatable on print)
        await db.invoices.update_one(
            {"_id": inv["_id"]},
            {"$set": {"ar_recognized": False, "invoice_date": None, "ar_reversed_at": now}}
        )
        reversed_count += 1
        affected_invoices.append({
            "invoice_number": inv.get("invoice_number"),
            "amount": round(line_sum["1201"]["debit"], 2),
        })
    return {
        "ok": True,
        "reversed_count": reversed_count,
        "total_invoices_unprinted": len(invoices_unprinted),
        "affected": affected_invoices,
        "note": "Posted reverse-journals (audit trail kept). Saat invoice dicetak, AR akan re-post otomatis.",
    }

# ===========================================================================
# Invoice PO Number — Input & Bulk Import via Excel
# ===========================================================================
class InvoicePONumberIn(BaseModel):
    po_number: Optional[str] = None  # null/empty → clear

@app.patch("/api/invoices/{iid}/po-number")
async def set_invoice_po_number(iid: str, data: InvoicePONumberIn, user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"_id": _oid(iid)})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    po_num = (data.po_number or "").strip() or None
    await db.invoices.update_one(
        {"_id": _oid(iid)},
        {"$set": {"po_number": po_num, "po_number_updated_at": datetime.now(timezone.utc), "po_number_updated_by": user["id"]}}
    )
    return serialize(await db.invoices.find_one({"_id": _oid(iid)}))

@app.get("/api/invoices/po-number-template")
async def invoice_po_number_template(user: dict = Depends(get_current_user)):
    """Excel template untuk bulk import PO Number per Invoice."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Import PO Number"
    bold = Font(bold=True)
    bold_white = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="2563EB")
    info_fill = PatternFill("solid", fgColor="FEF3C7")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Header
    headers = ["Invoice Number *", "PO Number"]
    for i, h in enumerate(headers, 1):
        c = ws.cell(1, i, h)
        c.font = bold_white
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center")
        c.border = border

    # Sample invoice numbers from DB
    sample_invoices = await db.invoices.find().sort("created_at", -1).limit(5).to_list(5)
    for i, inv in enumerate(sample_invoices, start=2):
        ws.cell(i, 1, inv.get("invoice_number")).border = border
        po_cell = ws.cell(i, 2, inv.get("po_number") or "")
        po_cell.border = border

    # Info note row
    info_row = max(7, 2 + len(sample_invoices) + 2)
    ws.cell(info_row, 1, "ℹ Instruksi:").font = bold
    ws.cell(info_row + 1, 1, "• Kolom A 'Invoice Number' wajib diisi (case-insensitive, harus match dengan nomor invoice di sistem).")
    ws.cell(info_row + 2, 1, "• Kolom B 'PO Number' — boleh kosong (clear), atau isi PO number dari customer.")
    ws.cell(info_row + 3, 1, "• Baris yang invoice number-nya tidak ditemukan akan di-skip.")
    ws.cell(info_row + 4, 1, "• Aman: import berulang akan UPDATE existing (idempotent).")
    for r in range(info_row, info_row + 5):
        ws.cell(r, 1).fill = info_fill
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)

    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 30

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Invoice_PO_Number_Template.xlsx"'},
    )

@app.post("/api/invoices/import-po-numbers")
async def import_invoice_po_numbers(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Bulk import PO numbers ke invoice via Excel upload."""
    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"File tidak valid: {e}")
    ws = wb.active
    updated = []
    skipped = []
    not_found = []
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    now = datetime.now(timezone.utc)
    for row in rows:
        if not row or all(v is None for v in row):
            continue
        inv_no = str(row[0] or "").strip()
        po_no = (str(row[1]).strip() if len(row) > 1 and row[1] is not None else "") or None
        if not inv_no or inv_no.startswith("ℹ") or inv_no.startswith("•"):
            continue  # skip info rows
        inv = await db.invoices.find_one({"invoice_number": {"$regex": f"^{re.escape(inv_no)}$", "$options": "i"}})
        if not inv:
            not_found.append(inv_no)
            continue
        await db.invoices.update_one(
            {"_id": inv["_id"]},
            {"$set": {"po_number": po_no, "po_number_updated_at": now, "po_number_updated_by": user["id"]}}
        )
        updated.append({"invoice_number": inv["invoice_number"], "po_number": po_no})
    return {
        "ok": True,
        "updated_count": len(updated),
        "not_found_count": len(not_found),
        "updated": updated[:50],
        "not_found": not_found[:50],
    }


# ===========================================================================
# BKK (Bukti Kas Keluar) Import — for Expense + Panjar Kerja
# ===========================================================================
def _bkk_parse_recipient(desc: str) -> Optional[str]:
    """Extract recipient name from BKK description.
    Examples:
      'Kasbon Operasional - Samsir' → 'Samsir'
      'Pembelian P3K (...) - Desi'  → 'Desi'
      'Laporan Operasional - Aziz (Perpanjang KIR) B 9096 TCS BV' → 'Aziz'
    """
    if not desc:
        return None
    # Split on " - " and take last segment's first word block
    parts = re.split(r"\s+-\s+", desc)
    if len(parts) >= 2:
        last = parts[-1].strip()
        # Take first word/name (before space or parenthesis)
        m = re.match(r"([A-Za-z][A-Za-z\s]*?)(?:\s*[\(\[]|$|\s+B\s+\d)", last)
        if m:
            name = m.group(1).strip()
            if 2 <= len(name) <= 30:
                return name
    return None


@app.post("/api/expense/import-bkk")
async def import_bkk_excel(
    file: UploadFile = File(...),
    dry_run: bool = False,
    user: dict = Depends(require_role("operation", "finance", "administrator")),
):
    """Import BKK (Bukti Kas Keluar) Excel file.
    Rules:
      - BKK-JV (Cr filled)         → Panjar Kerja (cash advance)
      - BKK-numeric (Dr or Cr)     → Expense (fixed_cost). Amount = Dr if present else Cr.
      - Code column → expense category (auto-create if missing as posting_type='expense').
      - Date column → expense_date/advance_date.
      - Header detected automatically (looks for row with 'No. BKK' or 'Desc.').
      - Idempotent: skips rows where (bkk_source_no, expense_date, amount) already exists.
    """
    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"File tidak valid: {e}")
    ws = wb.active

    # --- Detect header row dynamically ---
    header_row_idx = None
    col_idx = {}
    for ridx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if ridx > 20:
            break
        norm = [str(c).strip().lower() if c is not None else "" for c in row]
        if any("no. bkk" in c for c in norm) or any("no.bkk" in c for c in norm):
            header_row_idx = ridx
            for i, c in enumerate(norm):
                if c in ("no.", "no") and "no" not in col_idx:
                    col_idx["no"] = i
                elif c == "month":
                    col_idx["month"] = i
                elif "no. bkk" in c or "no.bkk" in c:
                    col_idx["no_bkk"] = i
                elif c == "date":
                    col_idx["date"] = i
                elif c in ("desc.", "desc", "description"):
                    col_idx["desc"] = i
                elif c == "code":
                    col_idx["code"] = i
                elif c == "dr":
                    col_idx["dr"] = i
                elif c == "cr":
                    col_idx["cr"] = i
                elif c == "saldo":
                    col_idx["saldo"] = i
                elif c == "remark":
                    col_idx["remark"] = i
            break
    if not header_row_idx or "no_bkk" not in col_idx or "desc" not in col_idx:
        raise HTTPException(400, "Header BKK tidak terdeteksi. Pastikan ada kolom 'No. BKK' dan 'Desc.'")

    # --- Process rows ---
    summary = {
        "panjar_imported": 0,
        "panjar_settled": 0,
        "panjar_overspent": 0,
        "expense_imported": 0,
        "skipped_duplicate": 0,
        "skipped_empty": 0,
        "categories_created": [],
        "errors": [],  # list of {row, message}
        "samples": {"panjar": [], "expense": [], "settlements": []},
    }

    # Cache categories (avoid re-fetching)
    cat_cache: dict = {}
    async def _resolve_or_create_cat(name: str) -> dict:
        n = (name or "").strip()
        if not n:
            n = "Lainnya"
        if n in cat_cache:
            return cat_cache[n]
        cat = await get_expense_category(n)
        if not cat:
            try:
                cat = await create_expense_category(n, posting_type="expense", user_id=user["id"])
                summary["categories_created"].append({
                    "name": cat["name"],
                    "account_code": cat["account_code"],
                    "posting_type": cat["posting_type"],
                })
            except HTTPException:
                cat = await get_expense_category(n) or await get_expense_category("Lainnya")
        cat_cache[n] = cat
        return cat

    # In-memory tracking for dry-run mode (since panjars aren't actually inserted)
    dry_run_open_panjars: list = []  # list of {recipient, amount, advance_date, "number": fake}

    now = datetime.now(timezone.utc)
    for ridx, row in enumerate(ws.iter_rows(min_row=header_row_idx + 1, values_only=True), start=header_row_idx + 1):
        try:
            if not row or all(v is None for v in row):
                summary["skipped_empty"] += 1
                continue
            no_bkk_raw = row[col_idx["no_bkk"]]
            desc_raw = row[col_idx["desc"]]
            if no_bkk_raw is None and desc_raw is None:
                summary["skipped_empty"] += 1
                continue
            no_bkk = str(no_bkk_raw).strip() if no_bkk_raw is not None else ""
            desc = str(desc_raw).strip() if desc_raw is not None else ""
            code = str(row[col_idx["code"]]).strip() if col_idx.get("code") is not None and row[col_idx["code"]] is not None else ""
            date_val = row[col_idx["date"]] if col_idx.get("date") is not None else None
            dr_val = row[col_idx.get("dr")] if col_idx.get("dr") is not None else None
            cr_val = row[col_idx.get("cr")] if col_idx.get("cr") is not None else None
            remark = str(row[col_idx["remark"]]).strip() if col_idx.get("remark") is not None and row[col_idx["remark"]] is not None else None

            # parse date
            expense_date = None
            if isinstance(date_val, datetime):
                expense_date = date_val.replace(tzinfo=timezone.utc) if date_val.tzinfo is None else date_val
            elif isinstance(date_val, str) and date_val:
                try:
                    expense_date = datetime.strptime(date_val.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except Exception:
                    pass
            if not expense_date:
                expense_date = now

            # parse amounts
            def _to_float(v):
                if v is None:
                    return 0.0
                if isinstance(v, (int, float)):
                    return float(v)
                try:
                    return float(str(v).replace(",", "").replace("Rp", "").strip())
                except Exception:
                    return 0.0
            dr_amt = _to_float(dr_val)
            cr_amt = _to_float(cr_val)

            # classify: BKK-JV → panjar (uses Cr); else BKK-numeric → expense (Dr if present else Cr)
            is_panjar = no_bkk.upper().startswith("BKK-JV") or no_bkk.upper().startswith("BK-JV")

            if is_panjar:
                amount = cr_amt or dr_amt
                if amount <= 0:
                    summary["errors"].append({"row": ridx, "message": "Panjar tanpa nilai"})
                    continue
                recipient = _bkk_parse_recipient(desc) or "Unknown"
                # idempotency check
                dup = await db.cash_advances.find_one({
                    "bkk_source_no": no_bkk,
                    "advance_date": expense_date,
                    "amount": amount,
                    "recipient_name": recipient,
                })
                if dup:
                    summary["skipped_duplicate"] += 1
                    continue
                if dry_run:
                    summary["panjar_imported"] += 1
                    # Track in-memory so settlement lookup later can match it (within same import file)
                    dry_run_open_panjars.append({
                        "recipient": recipient,
                        "amount": amount,
                        "advance_date": expense_date,
                        "number": f"DRY-{ridx}",
                    })
                    if len(summary["samples"]["panjar"]) < 5:
                        summary["samples"]["panjar"].append({"recipient": recipient, "amount": amount, "date": expense_date.strftime("%Y-%m-%d"), "desc": desc[:80]})
                    continue
                # Create panjar
                pj_doc = {
                    "number": await next_cash_advance_number(),
                    "recipient_name": recipient,
                    "purpose": desc,
                    "amount": amount,
                    "advance_date": expense_date,
                    "cash_account_code": "1101",
                    "status": "Open",
                    "actual_amount": None,
                    "refund_amount": None,
                    "settled_at": None,
                    "notes": f"Imported from BKK ({no_bkk})",
                    "bkk_source_no": no_bkk,
                    "bkk_imported_at": now,
                    "bkk_imported_by": user["id"],
                    "created_by": user["id"],
                    "created_at": now,
                }
                r = await db.cash_advances.insert_one(pj_doc)
                try:
                    await post_journal(
                        date=expense_date,
                        description=f"Panjar kerja {pj_doc['number']} - {recipient}",
                        lines=[
                            {"account_code": "1108", "debit": amount, "credit": 0, "memo": recipient},
                            {"account_code": "1101", "debit": 0, "credit": amount, "memo": pj_doc["number"]},
                        ],
                        reference_type="cash_advance", reference_id=str(r.inserted_id), posted_by=user["id"],
                    )
                except HTTPException:
                    pass
                summary["panjar_imported"] += 1
                if len(summary["samples"]["panjar"]) < 5:
                    summary["samples"]["panjar"].append({"number": pj_doc["number"], "recipient": recipient, "amount": amount, "date": expense_date.strftime("%Y-%m-%d")})
            else:
                # BKK-numeric → either:
                #   - Settlement of an Open Panjar (if Dr filled & matching panjar found by recipient), OR
                #   - Direct Expense (fallback)
                amount = dr_amt if dr_amt > 0 else cr_amt
                if amount <= 0:
                    summary["skipped_empty"] += 1
                    continue
                expense_date_str = expense_date.strftime("%Y-%m-%d")
                period_month = expense_date.strftime("%Y-%m")

                # --- Try to settle an existing Open Panjar (only when Dr is filled) ---
                settled_panjar = False
                if dr_amt > 0 and "laporan" in desc.lower():
                    recipient = _bkk_parse_recipient(desc) or None
                    if recipient:
                        panjar = None
                        # In dry-run, check in-memory simulated panjars first
                        if dry_run:
                            for i, p in enumerate(dry_run_open_panjars):
                                if p["recipient"].lower() == recipient.lower() and p["advance_date"] <= expense_date:
                                    panjar = {"_id": None, "number": p["number"], "amount": p["amount"], "recipient_name": p["recipient"]}
                                    dry_run_open_panjars.pop(i)
                                    break
                        # Real DB lookup (also fallback for dry-run when no in-mem match)
                        if not panjar:
                            panjar = await db.cash_advances.find_one(
                                {
                                    "recipient_name": {"$regex": f"^{re.escape(recipient)}$", "$options": "i"},
                                    "status": "Open",
                                    "advance_date": {"$lte": expense_date},
                                },
                                sort=[("advance_date", 1)],
                            )
                        if panjar:
                            # idempotency: if this BKK already linked, skip
                            existing_links = panjar.get("bkk_settle_links") or []
                            if any(l.get("bkk_source_no") == no_bkk for l in existing_links):
                                summary["skipped_duplicate"] += 1
                                continue
                            if dry_run:
                                summary["panjar_settled"] = summary.get("panjar_settled", 0) + 1
                                panjar_amt = float(panjar.get("amount") or 0)
                                if amount > panjar_amt:
                                    summary["panjar_overspent"] = summary.get("panjar_overspent", 0) + 1
                                if len(summary["samples"].setdefault("settlements", [])) < 5:
                                    summary["samples"]["settlements"].append({
                                        "panjar": panjar.get("number"),
                                        "recipient": recipient,
                                        "panjar_amt": panjar_amt,
                                        "settle_amt": amount,
                                        "diff": amount - panjar_amt,
                                        "date": expense_date_str,
                                    })
                                settled_panjar = True
                                continue
                            # --- DO SETTLE ---
                            panjar_amt = float(panjar.get("amount") or 0)
                            overspend = max(0.0, amount - panjar_amt)   # extra cash out (settle > panjar)
                            refund    = max(0.0, panjar_amt - amount)   # cash returned to office (settle < panjar)
                            cat = await _resolve_or_create_cat(code or "Operation")
                            expense_code = cat.get("account_code") or "5102"
                            # Update panjar
                            update_set = {
                                "actual_amount": amount,
                                "settled_amount": amount,
                                "refund_amount": refund,
                                "overspend_amount": overspend,
                                "status": "Settled",
                                "settled_at": expense_date,
                                "settle_category": cat["name"],
                                "settle_account_code": expense_code,
                                "settle_description": desc,
                                "settle_bkk_source_no": no_bkk,
                            }
                            await db.cash_advances.update_one(
                                {"_id": panjar["_id"]},
                                {
                                    "$set": update_set,
                                    "$push": {"bkk_settle_links": {
                                        "bkk_source_no": no_bkk,
                                        "amount": amount,
                                        "date": expense_date_str,
                                        "description": desc,
                                        "remark": remark,
                                        "overspend": overspend,
                                        "refund": refund,
                                        "imported_at": now,
                                    }},
                                },
                            )
                            # Journal: clears 1108 (panjar), records expense, handles refund/overspend cash
                            lines = [
                                {"account_code": expense_code, "debit": amount, "credit": 0, "memo": desc[:60]},
                                {"account_code": "1108", "debit": 0, "credit": panjar_amt, "memo": panjar["number"]},
                            ]
                            if overspend > 0:
                                lines.append({"account_code": "1101", "debit": 0, "credit": overspend, "memo": f"Overspend {panjar['number']}"})
                            if refund > 0:
                                lines.append({"account_code": "1101", "debit": refund, "credit": 0, "memo": f"Refund {panjar['number']}"})
                            try:
                                tag = " (overspend)" if overspend > 0 else (" (refund)" if refund > 0 else "")
                                await post_journal(
                                    date=expense_date,
                                    description=f"Settle panjar {panjar['number']} - {recipient}{tag} ({no_bkk})",
                                    lines=lines,
                                    reference_type="cash_advance_settle",
                                    reference_id=str(panjar["_id"]),
                                    posted_by=user["id"],
                                )
                            except HTTPException:
                                pass
                            summary["panjar_settled"] = summary.get("panjar_settled", 0) + 1
                            if overspend > 0:
                                summary["panjar_overspent"] = summary.get("panjar_overspent", 0) + 1
                            if len(summary["samples"].setdefault("settlements", [])) < 5:
                                summary["samples"]["settlements"].append({
                                    "panjar": panjar["number"],
                                    "recipient": recipient,
                                    "panjar_amt": panjar_amt,
                                    "settle_amt": amount,
                                    "diff": amount - panjar_amt,
                                    "date": expense_date_str,
                                })
                            settled_panjar = True

                if settled_panjar:
                    continue  # don't also create as standalone expense

                # --- Fallback: create as standalone Expense ---
                cat = await _resolve_or_create_cat(code or "Lainnya")
                if not cat:
                    summary["errors"].append({"row": ridx, "message": f"Kategori '{code}' tidak bisa di-resolve"})
                    continue
                # idempotency
                dup = await db.fixed_costs.find_one({
                    "bkk_source_no": no_bkk,
                    "expense_date": expense_date_str,
                    "amount": amount,
                })
                if dup:
                    summary["skipped_duplicate"] += 1
                    continue
                if dry_run:
                    summary["expense_imported"] += 1
                    if len(summary["samples"]["expense"]) < 5:
                        summary["samples"]["expense"].append({"category": cat["name"], "amount": amount, "date": expense_date_str, "desc": desc[:80]})
                    continue
                ex_doc = {
                    "category": cat["name"],
                    "posting_type": cat.get("posting_type", "expense"),
                    "account_code": cat.get("account_code"),
                    "description": desc + (f" [Remark: {remark}]" if remark else ""),
                    "amount": amount,
                    "expense_date": expense_date_str,
                    "period_month": period_month,
                    "cash_account_code": "1101",
                    "bkk_source_no": no_bkk,
                    "bkk_imported_at": now,
                    "bkk_imported_by": user["id"],
                    "created_by": user["id"],
                    "created_at": now,
                }
                r = await db.fixed_costs.insert_one(ex_doc)
                try:
                    expense_code = cat.get("account_code") or "6199"
                    label = "Beban Operasional" if cat.get("posting_type") == "cogs" else "Beban"
                    await post_journal(
                        date=expense_date,
                        description=f"{label} {cat['name']} - {expense_date_str} ({no_bkk})",
                        lines=[
                            {"account_code": expense_code, "debit": amount, "credit": 0, "memo": desc[:60]},
                            {"account_code": "1101", "debit": 0, "credit": amount, "memo": no_bkk},
                        ],
                        reference_type="fixed_cost", reference_id=str(r.inserted_id), posted_by=user["id"],
                    )
                except HTTPException:
                    pass
                summary["expense_imported"] += 1
                if len(summary["samples"]["expense"]) < 5:
                    summary["samples"]["expense"].append({"category": cat["name"], "amount": amount, "date": expense_date_str, "no_bkk": no_bkk})
        except Exception as e:
            summary["errors"].append({"row": ridx, "message": str(e)[:200]})
    return summary


# ===========================================================================
# Export Open AWB to Excel (format identical to import → can be re-imported)
# ===========================================================================
@app.get("/api/orders/export/open")
async def export_open_awb_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(require_role("operation", "finance", "administrator")),
):
    """Export all Open AWBs to Excel in IMPORT-compatible format.
    Use case: user can edit fields offline and re-import via the same import endpoint.
    """
    q = {"status": "Open"}
    if start_date and end_date:
        try:
            sy, sm, sd = [int(x) for x in start_date.split("-")]
            ey, em, ed = [int(x) for x in end_date.split("-")]
            q["created_at"] = {
                "$gte": datetime(sy, sm, sd, tzinfo=timezone.utc),
                "$lte": datetime(ey, em, ed, 23, 59, 59, tzinfo=timezone.utc),
            }
        except Exception:
            raise HTTPException(400, "Format date harus YYYY-MM-DD")

    awbs = await db.awb_orders.find(q).sort("created_at", -1).to_list(50000)

    # Build customer name lookup
    cust_ids = [a["customer_id"] for a in awbs if a.get("customer_id")]
    cust_map = {}
    if cust_ids:
        async for c in db.customers.find({"_id": {"$in": cust_ids}}):
            cust_map[c["_id"]] = c

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "DATA ALL BASE"

    # Headers EXACTLY match import aliases (so re-import works seamlessly)
    headers = [
        "No.", "No. WO", "Bulan", "Tgl. Pick Up", "No AWB", "Customer", "Customer Name",
        "Tujuan", "City", "Wilayah", "Item", "Tarif/Kg", "Kg", "Selling", "PPN", "INV+PPN",
        "Vendor", "Tipe Armada", "Jenis Armada", "Biaya Ops", "Uang Jalan (Lintas)", "T. Biaya Ops",
        "Kategori Cust", "Dalam/Luar Kota", "Cashback", "Total Tagihan", "PPh 2%", "Selling Net",
        "No. Inv", "Tgl. Inv", "Status Penagihan", "Status Pembayaran", "Tgl. Bayar", "Ket.",
    ]
    from openpyxl.styles import Font, PatternFill, Alignment
    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Sum existing vendor costs per AWB for "Biaya Ops" / "Uang Jalan (Lintas)" columns
    all_awb_ids = [a["_id"] for a in awbs]
    costs_by_awb: dict = {}
    if all_awb_ids:
        async for c in db.awb_costs.find({"awb_id": {"$in": all_awb_ids}}):
            costs_by_awb.setdefault(c["awb_id"], []).append(c)

    def _sum_cost(awb_id, category):
        return sum(float(c.get("amount") or 0) for c in costs_by_awb.get(awb_id, []) if c.get("cost_category") == category)

    def _bulan_id(d):
        if not d:
            return ""
        months = ["", "JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGS", "SEP", "OKT", "NOV", "DES"]
        return months[d.month] + "-" + str(d.year)[-2:]

    for idx, a in enumerate(awbs, 1):
        cust = cust_map.get(a.get("customer_id"))
        cust_short = (cust or {}).get("short_name") or ""
        cust_name = (cust or {}).get("name") or ""
        pickup = a.get("created_at")
        biaya_vendor = _sum_cost(a["_id"], "Vendor")
        biaya_ops    = _sum_cost(a["_id"], "Operational")
        uang_jalan   = _sum_cost(a["_id"], "Lintas")
        total_biaya  = biaya_vendor + biaya_ops + uang_jalan
        row = [
            idx,                                    # No.
            a.get("wo_number") or "",               # No. WO
            _bulan_id(pickup),                       # Bulan
            pickup.strftime("%Y-%m-%d") if pickup else "",  # Tgl. Pick Up
            a.get("awb_number") or "",              # No AWB
            cust_short,                              # Customer (short)
            cust_name,                               # Customer Name
            a.get("destination") or "",              # Tujuan
            a.get("destination_city") or "",         # City
            a.get("region") or "",                   # Wilayah
            a.get("item_description") or "",         # Item
            "",                                      # Tarif/Kg (pricing_desc, free text)
            a.get("qty_kg") or 0,                    # Kg
            a.get("total_tariff") or 0,              # Selling
            a.get("tax_amount") or 0,                # PPN
            a.get("grand_total") or 0,               # INV+PPN
            "",                                      # Vendor (TODO if needed)
            a.get("armada_type") or "",              # Tipe Armada
            a.get("fleet_type") or "",               # Jenis Armada
            biaya_ops,                               # Biaya Ops
            uang_jalan,                              # Uang Jalan (Lintas)
            total_biaya,                             # T. Biaya Ops
            (cust or {}).get("category") or "",      # Kategori Cust
            "Dalam Kota" if a.get("intracity") else "Luar Kota",
            a.get("cashback_amount") or 0,           # Cashback
            a.get("grand_total") or 0,               # Total Tagihan
            a.get("pph_final") or 0,                 # PPh 2%
            (float(a.get("grand_total") or 0) - float(a.get("pph_final") or 0)),  # Selling Net
            a.get("external_invoice_number") or "",  # No. Inv
            a.get("invoice_date").strftime("%Y-%m-%d") if a.get("invoice_date") else "",
            "Belum INV",                             # Status Penagihan (Open = belum INV)
            "Belum Bayar",                           # Status Pembayaran
            a.get("paid_at").strftime("%Y-%m-%d") if a.get("paid_at") else "",
            a.get("notes") or "",                    # Ket.
        ]
        for col_idx, val in enumerate(row, 1):
            ws.cell(row=idx + 1, column=col_idx, value=val)

    # Column widths
    widths = [5, 12, 9, 12, 18, 14, 24, 18, 12, 12, 18, 12, 8, 14, 12, 14, 18, 12, 12, 12, 14, 14, 12, 12, 10, 14, 10, 14, 14, 12, 14, 14, 12, 20]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    # Freeze header
    ws.freeze_panes = "A2"

    # Write to bytes
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    fname = f"Open_AWB_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ===========================================================================
# Item #3: Import Invoice Number → mark AWB as Invoiced / Paid
# ===========================================================================
@app.get("/api/invoices/import-numbers-template")
async def import_invoice_numbers_template(user: dict = Depends(require_role("finance", "operation", "administrator"))):
    """Download Excel template untuk Import Invoice Number.
    Kolom: AWB Number | Invoice Number | Status (Invoiced/Paid) | Paid Date (YYYY-MM-DD, opsional)."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Import Invoice"
    headers = ["AWB Number", "Invoice Number", "Status", "Paid Date"]
    from openpyxl.styles import Font as _F, PatternFill as _P, Alignment as _A
    bold = _F(bold=True, color="FFFFFF")
    fill = _P("solid", fgColor="1E40AF")
    center = _A(horizontal="center", vertical="center")
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = bold; c.fill = fill; c.alignment = center
    # Sample rows
    samples = [
        ("AWB-202606-0001", "INV-EXT/2026/0001", "Invoiced", ""),
        ("AWB-202606-0002", "INV-EXT/2026/0002", "Paid", "2026-06-30"),
    ]
    for r, row in enumerate(samples, start=2):
        for c, v in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=v)
    # Column widths
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 16
    # Notes sheet
    ws2 = wb.create_sheet("Petunjuk")
    notes = [
        ("Petunjuk Import Invoice Number", ""),
        ("", ""),
        ("Kolom A: AWB Number", "Wajib. Case-insensitive. Harus sudah ada di sistem."),
        ("Kolom B: Invoice Number", "Opsional. Nomor invoice eksternal dari customer."),
        ("Kolom C: Status", "Invoiced ATAU Paid (case-insensitive)."),
        ("Kolom D: Paid Date", "Opsional. Format YYYY-MM-DD. Wajib jika Status=Paid."),
        ("", ""),
        ("Cara kerja:", ""),
        ("1. Status=Invoiced", "AWB di-mark Invoiced + simpan Invoice Number."),
        ("2. Status=Paid", "AWB di-mark Paid + tanggal bayar. Otomatis Invoiced juga."),
        ("3. Matching gagal", "Baris di-skip, error dilaporkan di hasil import."),
    ]
    for r, (a, b) in enumerate(notes, start=1):
        ws2.cell(row=r, column=1, value=a)
        ws2.cell(row=r, column=2, value=b)
    ws2["A1"].font = _F(bold=True, size=14)
    ws2.column_dimensions["A"].width = 30
    ws2.column_dimensions["B"].width = 60

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Template_Import_Invoice_Number.xlsx"},
    )

@app.post("/api/invoices/import-numbers")
async def import_invoice_numbers(
    file: UploadFile = File(...),
    dry_run: bool = False,
    user: dict = Depends(require_role("operation", "finance", "administrator")),
):
    """Import Excel with columns: Invoice Number, AWB Number, Status (Invoiced/Paid), Paid Date (optional YYYY-MM-DD).
    - Matches AWB by awb_number (case-insensitive)
    - Status=Invoiced → sets external_invoice_number, status=Invoiced, invoice_date=today (if absent)
    - Status=Paid → sets paid_at, status=Paid. Also sets external_invoice_number if provided
    - Idempotent: re-import same row produces no error, just no change
    """
    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"File tidak valid: {e}")
    ws = wb.active

    # Detect header row (look for "AWB" + "Invoice")
    header_row_idx = None
    col_idx = {}
    for ridx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if ridx > 10:
            break
        norm = [str(c).strip().lower() if c is not None else "" for c in row]
        if any("awb" in c and "no" in c for c in norm) or any("awb number" in c for c in norm):
            header_row_idx = ridx
            for i, c in enumerate(norm):
                if "awb" in c and ("number" in c or "no" in c) and "awb" not in col_idx:
                    col_idx["awb"] = i
                elif "invoice" in c and ("number" in c or "no" in c) and "inv" not in col_idx:
                    col_idx["inv"] = i
                elif c == "status":
                    col_idx["status"] = i
                elif "paid" in c and "date" in c:
                    col_idx["paid_date"] = i
            break
    if not header_row_idx or "awb" not in col_idx:
        raise HTTPException(400, "Header tidak terdeteksi. Pastikan ada kolom 'AWB Number' dan 'Invoice Number'.")

    summary = {"marked_invoiced": 0, "marked_paid": 0, "skipped": 0, "errors": [], "errors_truncated": 0, "samples": []}
    now = datetime.now(timezone.utc)
    MAX_ERRORS_REPORTED = 50  # cap agar response payload tidak balloon → hindari 500 di gateway

    for ridx, row in enumerate(ws.iter_rows(min_row=header_row_idx + 1, values_only=True), start=header_row_idx + 1):
      try:
        if not row or all(v is None for v in row):
            continue
        awb_no = str(row[col_idx["awb"]] or "").strip()
        # Buang trailing ".0" dari Excel-numeric AWB (mis. 200765.0 → 200765)
        if awb_no.endswith(".0") and awb_no[:-2].isdigit():
            awb_no = awb_no[:-2]
        inv_no = str(row[col_idx.get("inv")] or "").strip() if col_idx.get("inv") is not None else ""
        status_v = str(row[col_idx.get("status")] or "").strip().lower() if col_idx.get("status") is not None else ""
        paid_date_raw = row[col_idx.get("paid_date")] if col_idx.get("paid_date") is not None else None
        if not awb_no:
            continue
        # Find AWB
        awb = await db.awb_orders.find_one({"awb_number": {"$regex": f"^{re.escape(awb_no)}$", "$options": "i"}})
        if not awb:
            if len(summary["errors"]) < MAX_ERRORS_REPORTED:
                summary["errors"].append({"row": ridx, "message": f"AWB '{awb_no}' tidak ditemukan"})
            else:
                summary["errors_truncated"] += 1
            summary["skipped"] += 1
            continue
        update_set: dict = {}
        # Always update invoice number when provided
        if inv_no:
            update_set["external_invoice_number"] = inv_no
        # Status logic
        if "paid" in status_v or "lunas" in status_v:
            # Parse paid date
            paid_dt = None
            if isinstance(paid_date_raw, datetime):
                paid_dt = paid_date_raw if paid_date_raw.tzinfo else paid_date_raw.replace(tzinfo=timezone.utc)
            elif isinstance(paid_date_raw, str) and paid_date_raw:
                try:
                    paid_dt = datetime.strptime(paid_date_raw.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except Exception:
                    pass
            update_set["paid_at"] = paid_dt or now
            update_set["status"] = "Paid"
            # Also mark Invoiced fields if AWB was still Open/Reconciled
            if awb.get("status") not in ("Invoiced", "Paid"):
                update_set["invoice_date"] = awb.get("invoice_date") or (paid_dt or now)
                update_set.setdefault("external_invoice_number", inv_no or awb.get("external_invoice_number") or "")
            kind = "paid"
            summary["marked_paid"] += 1
        elif "invoice" in status_v or "inv" in status_v or inv_no:
            update_set["status"] = "Invoiced"
            if not awb.get("invoice_date"):
                update_set["invoice_date"] = now
            kind = "invoiced"
            summary["marked_invoiced"] += 1
        else:
            summary["skipped"] += 1
            continue
        if dry_run:
            if len(summary["samples"]) < 5:
                summary["samples"].append({"awb": awb_no, "invoice": inv_no, "action": kind, "current_status": awb.get("status")})
            continue
        update_set["updated_at"] = now
        update_set["updated_by"] = user["id"]
        await db.awb_orders.update_one({"_id": awb["_id"]}, {"$set": update_set})

        # === Upsert dokumen di collection `invoices` supaya AWB muncul di halaman "Invoice Tercetak" ===
        # Prioritas match:
        #   1. Cari invoice by AWB (existing_by_awb) — reimport data yg sama
        #   2. Kalau tidak ada, cari by invoice_number (existing_by_inv_no) — multi-AWB grouping
        #   3. Kalau juga tidak ada, buat baru
        existing_by_awb = await db.invoices.find_one({"$or": [
            {"awb_id": awb["_id"]},
            {"awb_ids": awb["_id"]},
        ]})
        existing_by_inv_no = None
        if not existing_by_awb and inv_no:
            existing_by_inv_no = await db.invoices.find_one({"invoice_number": inv_no})
        existing_inv = existing_by_awb or existing_by_inv_no
        # Nomor invoice: pakai dari Excel; kalau kosong pakai auto-generated dari sistem
        eff_inv_no = inv_no or (existing_inv or {}).get("invoice_number") or await next_invoice_number()
        inv_date_val = update_set.get("invoice_date") or (existing_inv or {}).get("invoice_date") or now
        inv_doc_set = {
            "invoice_number": eff_inv_no,
            "external_invoice_number": inv_no or (existing_inv or {}).get("external_invoice_number") or "",
            "invoice_date": inv_date_val,
            "first_printed_at": (existing_inv or {}).get("first_printed_at") or inv_date_val,
            "print_count": (existing_inv or {}).get("print_count") or 1,
            "ar_recognized": (existing_inv or {}).get("ar_recognized") or False,
            "updated_at": now,
            "updated_by": user["id"],
            "imported_via_upload": True,
        }
        if kind == "paid":
            inv_doc_set["paid_at"] = update_set.get("paid_at")
        if existing_by_awb:
            # Reimport untuk AWB yg sama — cukup update field, jangan sentuh awb_ids
            await db.invoices.update_one({"_id": existing_by_awb["_id"]}, {"$set": inv_doc_set})
        elif existing_by_inv_no:
            # Grouping — tambahkan AWB ini ke invoice yg sudah ada dgn nomor yg sama
            await db.invoices.update_one(
                {"_id": existing_by_inv_no["_id"]},
                {"$set": inv_doc_set, "$addToSet": {"awb_ids": awb["_id"]}},
            )
        else:
            inv_doc_set.update({
                "awb_id": awb["_id"],
                "awb_ids": [awb["_id"]],
                "created_at": now,
                "created_by": user["id"],
            })
            await db.invoices.insert_one(inv_doc_set)

        if len(summary["samples"]) < 5:
            summary["samples"].append({"awb": awb_no, "invoice": inv_no, "action": kind})
      except Exception as ex:
        # Row-level error containment — 1 baris rusak tidak mem-crash seluruh import
        summary["skipped"] += 1
        if len(summary["errors"]) < MAX_ERRORS_REPORTED:
            summary["errors"].append({"row": ridx, "message": f"Error: {str(ex)[:120]}"})
        else:
            summary["errors_truncated"] += 1
    return summary


# ===========================================================================
# Item #8: Multi-receiver Payment per AWB
# ===========================================================================
class PaymentReceiptIn(BaseModel):
    amount: float
    payment_date: str  # YYYY-MM-DD
    payment_method: Optional[str] = "Transfer"  # Cash, Transfer, Cek, etc
    notes: Optional[str] = None
    reference_no: Optional[str] = None  # cek/transfer ref

@app.get("/api/orders/{oid}/payments")
async def list_payment_receipts(oid: str, user: dict = Depends(require_role("finance", "operation", "administrator"))):
    awb = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not awb:
        raise HTTPException(404, "AWB tidak ditemukan")
    docs = await db.payment_receipts.find({"awb_id": _oid(oid)}).sort("payment_date", 1).to_list(200)
    total_paid = sum(float(d.get("amount") or 0) for d in docs)
    grand = float(awb.get("grand_total") or 0)
    return {
        "awb_number": awb.get("awb_number"),
        "grand_total": grand,
        "total_paid": total_paid,
        "remaining": round(grand - total_paid, 2),
        "is_fully_paid": total_paid >= grand and grand > 0,
        "receipts": [serialize(d) for d in docs],
    }

@app.post("/api/orders/{oid}/payments")
async def add_payment_receipt(oid: str, data: PaymentReceiptIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    awb = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not awb:
        raise HTTPException(404, "AWB tidak ditemukan")
    if data.amount <= 0:
        raise HTTPException(400, "Amount harus > 0")
    try:
        pay_dt = datetime.strptime(data.payment_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "Format payment_date harus YYYY-MM-DD")
    now = datetime.now(timezone.utc)
    doc = {
        "awb_id": _oid(oid),
        "amount": float(data.amount),
        "payment_date": pay_dt,
        "payment_method": data.payment_method or "Transfer",
        "notes": data.notes,
        "reference_no": data.reference_no,
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.payment_receipts.insert_one(doc)
    # Journal: Dr Cash / Cr AR
    try:
        await post_journal(
            date=pay_dt,
            description=f"Pembayaran #{r.inserted_id} - AWB {awb.get('awb_number')}",
            lines=[
                {"account_code": "1101", "debit": float(data.amount), "credit": 0, "memo": data.reference_no or awb.get("awb_number")},
                {"account_code": "1201", "debit": 0, "credit": float(data.amount), "memo": awb.get("awb_number")},
            ],
            reference_type="payment_receipt", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException:
        pass
    # Check if fully paid → update AWB status
    total_paid = await db.payment_receipts.aggregate([
        {"$match": {"awb_id": _oid(oid)}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}}
    ]).to_list(1)
    paid_sum = float(total_paid[0]["sum"]) if total_paid else 0
    grand = float(awb.get("grand_total") or 0)
    if grand > 0 and paid_sum >= grand:
        await db.awb_orders.update_one(
            {"_id": _oid(oid)},
            {"$set": {"status": "Paid", "paid_at": pay_dt, "updated_at": now, "updated_by": user["id"]}},
        )
    return {
        "ok": True,
        "receipt_id": str(r.inserted_id),
        "total_paid": paid_sum,
        "grand_total": grand,
        "remaining": round(grand - paid_sum, 2),
        "is_fully_paid": grand > 0 and paid_sum >= grand,
    }

@app.delete("/api/payment-receipts/{rid}")
async def delete_payment_receipt(rid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.payment_receipts.find_one({"_id": _oid(rid)})
    if not doc:
        raise HTTPException(404, "Receipt tidak ditemukan")
    awb_id = doc["awb_id"]
    await db.payment_receipts.delete_one({"_id": _oid(rid)})
    await db.journal_entries.delete_many({"reference_type": "payment_receipt", "reference_id": rid})
    await log_activity(user, "delete", "payment_receipt", rid, f"Deleted payment {doc.get('amount')} for AWB {str(awb_id)[-6:]}")
    # Recheck status — if was Paid but now not fully paid → revert to Invoiced
    total_paid = await db.payment_receipts.aggregate([
        {"$match": {"awb_id": awb_id}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}}
    ]).to_list(1)
    paid_sum = float(total_paid[0]["sum"]) if total_paid else 0
    awb = await db.awb_orders.find_one({"_id": awb_id})
    if awb and awb.get("status") == "Paid":
        grand = float(awb.get("grand_total") or 0)
        if paid_sum < grand:
            await db.awb_orders.update_one(
                {"_id": awb_id},
                {"$set": {"status": "Invoiced"}, "$unset": {"paid_at": ""}},
            )
    return {"ok": True}

# ===========================================================================
# Item #4: Activity Log read + Item #2 partial: Notifications API
# ===========================================================================
@app.get("/api/activity-logs")
async def list_activity_logs(
    user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    action: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(require_role("administrator")),
):
    q = {}
    if user_id:
        q["user_id"] = user_id
    if target_type:
        q["target_type"] = target_type
    if action:
        q["action"] = action
    if start_date and end_date:
        try:
            sy, sm, sd = [int(x) for x in start_date.split("-")]
            ey, em, ed = [int(x) for x in end_date.split("-")]
            q["timestamp"] = {
                "$gte": datetime(sy, sm, sd, tzinfo=timezone.utc),
                "$lte": datetime(ey, em, ed, 23, 59, 59, tzinfo=timezone.utc),
            }
        except Exception:
            pass
    docs = await db.activity_logs.find(q).sort("timestamp", -1).limit(min(limit, 2000)).to_list(2000)
    return [serialize(d) for d in docs]

@app.get("/api/notifications")
async def list_my_notifications(unread_only: bool = False, user: dict = Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    docs = await db.notifications.find(q).sort("created_at", -1).limit(100).to_list(100)
    unread_count = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"notifications": [serialize(d) for d in docs], "unread_count": unread_count}

@app.post("/api/notifications/{nid}/read")
async def mark_notification_read(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one(
        {"_id": _oid(nid), "user_id": user["id"]},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}

@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(user: dict = Depends(get_current_user)):
    r = await db.notifications.update_many(
        {"user_id": user["id"], "read": False},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"updated": r.modified_count}


# ===========================================================================
# Item #2: Recurring Expense (Cost Automatic)
# ===========================================================================
class RecurringExpenseIn(BaseModel):
    name: str
    category: str                      # must exist in expense_categories
    amount: float
    frequency: str                     # 'monthly', 'weekly', 'daily', 'custom'
    execute_day: Optional[int] = 1     # day of month (1-31) for monthly, day of week (0-6) for weekly
    start_date: str                    # YYYY-MM-DD
    end_date: Optional[str] = None     # YYYY-MM-DD optional limit
    max_occurrences: Optional[int] = None
    description: Optional[str] = None
    notify_enabled: bool = True
    auto_execute: bool = True          # if true, system creates expense automatically; if false, only notifies
    cash_account_code: Optional[str] = "1101"

def _compute_next_due(frequency: str, current_due: datetime, execute_day: Optional[int] = None) -> datetime:
    if frequency == "monthly":
        y = current_due.year
        m = current_due.month + 1
        if m > 12:
            m = 1
            y += 1
        # clamp day
        from calendar import monthrange
        last_day = monthrange(y, m)[1]
        d = min(execute_day or current_due.day, last_day)
        return datetime(y, m, d, tzinfo=timezone.utc)
    if frequency == "weekly":
        return current_due + timedelta(days=7)
    if frequency == "daily":
        return current_due + timedelta(days=1)
    return current_due + timedelta(days=30)

@app.get("/api/recurring-expenses")
async def list_recurring_expenses(user: dict = Depends(require_role("operation", "finance", "administrator"))):
    docs = await db.recurring_expenses.find({}).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]

@app.get("/api/recurring-expenses/upcoming")
async def list_upcoming_recurring(user: dict = Depends(require_role("operation", "finance", "administrator"))):
    """List recurring expense untuk widget dashboard:
    - H-1 (besok jatuh tempo)         → card pink, tanpa tombol
    - H (hari ini) / overdue -1 hari  → card merah + tombol Laksanakan Pembayaran
    - Sudah auto-executed hari ini    → card hijau, tombol disabled "Sudah Dieksekusi"
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    tomorrow_end = today_start + timedelta(days=2)  # exclusive upper bound

    # (A) Yang masih pending (next_due dalam window kemarin/hari-ini/besok)
    pending = await db.recurring_expenses.find({
        "active": True,
        "next_due": {"$gte": today_start - timedelta(days=1), "$lt": tomorrow_end},
        "$or": [{"end_date": None}, {"end_date": {"$gte": now}}],
    }).sort("next_due", 1).to_list(200)

    # (B) Yang sudah auto-executed hari ini (last_executed_at di rentang hari ini)
    executed_today = await db.recurring_expenses.find({
        "last_executed_at": {"$gte": today_start, "$lt": today_start + timedelta(days=1)},
    }).sort("last_executed_at", -1).to_list(200)

    seen_ids = set()
    out = []

    for d in pending:
        due = d.get("next_due")
        if not due:
            continue
        if getattr(due, "tzinfo", None) is not None:
            due = due.replace(tzinfo=None)
        due_date = due.replace(hour=0, minute=0, second=0, microsecond=0)
        delta = (due_date - today_start).days
        if delta < -1 or delta > 1:
            continue
        s = serialize(d)
        s["days_until_due"] = delta
        s["is_today"] = delta == 0
        s["is_tomorrow"] = delta == 1
        s["is_overdue"] = delta < 0
        s["already_executed"] = False
        out.append(s)
        seen_ids.add(s["id"])

    for d in executed_today:
        s = serialize(d)
        if s["id"] in seen_ids:
            continue
        # Cari expense record hari ini utk info waktu eksekusi
        last_exec = d.get("last_executed_at")
        if last_exec and getattr(last_exec, "tzinfo", None) is None:
            last_exec = last_exec.replace(tzinfo=timezone.utc)
        s["days_until_due"] = 0
        s["is_today"] = True
        s["is_tomorrow"] = False
        s["is_overdue"] = False
        s["already_executed"] = True
        s["last_executed_at"] = last_exec.isoformat() if last_exec else None
        s["auto_execute"] = bool(d.get("auto_execute", True))
        out.append(s)
        seen_ids.add(s["id"])

    return out

@app.post("/api/recurring-expenses/{rid}/execute-once")
async def execute_recurring_once(rid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    """Eksekusi 1 recurring expense secara manual (dari klik tombol Laksanakan Pembayaran).
    Membuat expense di fixed_costs + jurnal + advance next_due.
    """
    rec = await db.recurring_expenses.find_one({"_id": _oid(rid)})
    if not rec:
        raise HTTPException(404, "Recurring expense tidak ditemukan")
    if not rec.get("active"):
        raise HTTPException(400, "Recurring expense sudah tidak aktif")
    now = datetime.now(timezone.utc)
    exp_date = (rec.get("next_due") or now).strftime("%Y-%m-%d")
    ex_doc = {
        "category": rec["category"],
        "posting_type": rec.get("posting_type", "expense"),
        "account_code": rec.get("account_code"),
        "description": (rec.get("description") or "") + f" [Recurring: {rec['name']}]",
        "amount": float(rec["amount"]),
        "expense_date": exp_date,
        "period_month": (rec.get("next_due") or now).strftime("%Y-%m"),
        "cash_account_code": rec.get("cash_account_code", "1101"),
        "recurring_id": str(rec["_id"]),
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.fixed_costs.insert_one(ex_doc)
    # Post journal
    try:
        expense_code = rec.get("account_code") or "6199"
        label = "Beban Operasional" if rec.get("posting_type") == "cogs" else "Beban"
        await post_journal(
            date=rec.get("next_due") or now,
            description=f"{label} {rec['category']} - {exp_date} (Manual: {rec['name']})",
            lines=[
                {"account_code": expense_code, "debit": float(rec["amount"]), "credit": 0, "memo": rec.get("description") or rec["name"]},
                {"account_code": rec.get("cash_account_code", "1101"), "debit": 0, "credit": float(rec["amount"]), "memo": rec["name"]},
            ],
            reference_type="fixed_cost", reference_id=str(r.inserted_id), posted_by=user["id"],
        )
    except HTTPException:
        pass
    # Advance next_due & occurrence count
    next_due = _compute_next_due(rec["frequency"], rec.get("next_due") or now, rec.get("execute_day"))
    upd = {"$set": {"next_due": next_due, "last_executed_at": now}, "$inc": {"occurrence_count": 1}}
    # Deactivate jika sudah max_occurrences
    new_count = (rec.get("occurrence_count") or 0) + 1
    if rec.get("max_occurrences") and new_count >= rec["max_occurrences"]:
        upd["$set"]["active"] = False
    await db.recurring_expenses.update_one({"_id": rec["_id"]}, upd)
    await log_activity(user, "manual_execute", "recurring_expense", rid,
                       f"Manually executed {rec['name']} amount={rec['amount']}")
    return {"ok": True, "expense_id": str(r.inserted_id), "next_due": next_due, "amount": float(rec["amount"])}

@app.post("/api/recurring-expenses")
async def create_recurring_expense(data: RecurringExpenseIn, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    cat = await get_expense_category(data.category)
    if not cat:
        raise HTTPException(400, f"Kategori '{data.category}' tidak terdaftar")
    if data.frequency not in ("monthly", "weekly", "daily", "custom"):
        raise HTTPException(400, "frequency harus 'monthly', 'weekly', 'daily', atau 'custom'")
    try:
        start_dt = datetime.strptime(data.start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "Format start_date harus YYYY-MM-DD")
    end_dt = None
    if data.end_date:
        try:
            end_dt = datetime.strptime(data.end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Format end_date harus YYYY-MM-DD")
    now = datetime.now(timezone.utc)
    doc = {
        "name": data.name.strip(),
        "category": cat["name"],
        "posting_type": cat.get("posting_type"),
        "account_code": cat.get("account_code"),
        "amount": float(data.amount),
        "frequency": data.frequency,
        "execute_day": data.execute_day,
        "start_date": start_dt,
        "end_date": end_dt,
        "max_occurrences": data.max_occurrences,
        "description": data.description,
        "notify_enabled": bool(data.notify_enabled),
        "auto_execute": bool(data.auto_execute),
        "cash_account_code": data.cash_account_code or "1101",
        "next_due": start_dt,
        "last_executed_at": None,
        "occurrence_count": 0,
        "active": True,
        "created_by": user["id"],
        "created_at": now,
    }
    r = await db.recurring_expenses.insert_one(doc)
    await log_activity(user, "create", "recurring_expense", str(r.inserted_id), f"Created {doc['name']} ({data.frequency})")
    return serialize(await db.recurring_expenses.find_one({"_id": r.inserted_id}))

class RecurringExpenseUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    notify_enabled: Optional[bool] = None
    auto_execute: Optional[bool] = None
    active: Optional[bool] = None
    end_date: Optional[str] = None

@app.put("/api/recurring-expenses/{rid}")
async def update_recurring_expense(rid: str, data: RecurringExpenseUpdate, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.recurring_expenses.find_one({"_id": _oid(rid)})
    if not doc:
        raise HTTPException(404, "Recurring expense tidak ditemukan")
    upd = {k: v for k, v in data.dict().items() if v is not None}
    if "end_date" in upd:
        try:
            upd["end_date"] = datetime.strptime(upd["end_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Format end_date harus YYYY-MM-DD")
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc)
        await db.recurring_expenses.update_one({"_id": _oid(rid)}, {"$set": upd})
        await log_activity(user, "update", "recurring_expense", rid, f"Updated {doc.get('name')}")
    return serialize(await db.recurring_expenses.find_one({"_id": _oid(rid)}))

@app.delete("/api/recurring-expenses/{rid}")
async def delete_recurring_expense(rid: str, user: dict = Depends(require_role("operation", "finance", "administrator"))):
    doc = await db.recurring_expenses.find_one({"_id": _oid(rid)})
    if not doc:
        raise HTTPException(404, "Recurring expense tidak ditemukan")
    await db.recurring_expenses.delete_one({"_id": _oid(rid)})
    await log_activity(user, "delete", "recurring_expense", rid, f"Deleted {doc.get('name')}")
    return {"ok": True}

@app.post("/api/recurring-expenses/run-due")
async def run_due_recurring_expenses(user: dict = Depends(require_role("operation", "finance", "administrator"))):
    """Find all active recurring expenses with next_due <= today and create the actual expense.
    Returns count of expenses created and notifications sent. Can be called manually or via a cron job.
    """
    now = datetime.now(timezone.utc)
    due = await db.recurring_expenses.find({
        "active": True,
        "next_due": {"$lte": now},
        "$or": [{"end_date": None}, {"end_date": {"$gte": now}}],
    }).to_list(1000)
    created = 0
    notified = 0
    for rec in due:
        # Check max_occurrences
        if rec.get("max_occurrences") and (rec.get("occurrence_count") or 0) >= rec["max_occurrences"]:
            await db.recurring_expenses.update_one({"_id": rec["_id"]}, {"$set": {"active": False}})
            continue
        if rec.get("auto_execute", True):
            # Create the expense
            exp_date = (rec["next_due"]).strftime("%Y-%m-%d")
            ex_doc = {
                "category": rec["category"],
                "posting_type": rec.get("posting_type", "expense"),
                "account_code": rec.get("account_code"),
                "description": (rec.get("description") or "") + f" [Recurring: {rec['name']}]",
                "amount": float(rec["amount"]),
                "expense_date": exp_date,
                "period_month": rec["next_due"].strftime("%Y-%m"),
                "cash_account_code": rec.get("cash_account_code", "1101"),
                "recurring_id": str(rec["_id"]),
                "created_by": user["id"],
                "created_at": now,
            }
            r = await db.fixed_costs.insert_one(ex_doc)
            try:
                expense_code = rec.get("account_code") or "6199"
                label = "Beban Operasional" if rec.get("posting_type") == "cogs" else "Beban"
                await post_journal(
                    date=rec["next_due"],
                    description=f"{label} {rec['category']} - {exp_date} (Auto: {rec['name']})",
                    lines=[
                        {"account_code": expense_code, "debit": float(rec["amount"]), "credit": 0, "memo": rec.get("description") or rec["name"]},
                        {"account_code": rec.get("cash_account_code", "1101"), "debit": 0, "credit": float(rec["amount"]), "memo": rec["name"]},
                    ],
                    reference_type="fixed_cost", reference_id=str(r.inserted_id), posted_by=user["id"],
                )
            except HTTPException:
                pass
            created += 1
            await log_activity(user, "auto_create", "recurring_expense", str(rec["_id"]), f"Auto-created expense {rec['name']} ({rec['amount']})")
        # Send notification
        if rec.get("notify_enabled"):
            await push_notification(
                user_id=str(rec.get("created_by")),
                title="Recurring Expense Executed" if rec.get("auto_execute") else "Recurring Expense Due",
                message=f"{rec['name']} sebesar Rp {rec['amount']:,.0f} ({rec['category']})",
                level="info" if rec.get("auto_execute") else "warning",
                link="/fixed-costs",
            )
            notified += 1
        # Update next_due + occurrence_count
        next_due = _compute_next_due(rec["frequency"], rec["next_due"], rec.get("execute_day"))
        await db.recurring_expenses.update_one(
            {"_id": rec["_id"]},
            {
                "$set": {"next_due": next_due, "last_executed_at": now},
                "$inc": {"occurrence_count": 1},
            },
        )
    return {"due_found": len(due), "expenses_created": created, "notifications_sent": notified}


# ===========================================================================
# RBAC: Per-User Granular Feature Permissions
# Endpoint exposes MODULE_FEATURES catalog so frontend can render matrix UI
# and resolve user.permission_actions[module][feature] = bool
# ===========================================================================
@app.get("/api/rbac/module-features")
async def rbac_module_features(user: dict = Depends(get_current_user)):
    """Return per-module list of granular features for permission matrix."""
    out = []
    for m in MODULES:
        features = MODULE_FEATURES.get(m["key"], [])
        out.append({
            "key": m["key"],
            "label": m["label"],
            "is_feature_flag": bool(m.get("is_feature")),
            "features": [{"key": fk, "label": flabel} for (fk, flabel) in features],
        })
    return {"modules": out}


# ===========================================================================
# Item #9: Export Faktur Pajak Keluaran (FPK) — Excel format matching DJP Coretax template
# ===========================================================================
import shutil
from pathlib import Path as _Path

FPK_TEMPLATE_PATH = _Path(__file__).parent / "templates" / "template_fpk.xlsx"

def _clean_npwp(npwp: Optional[str]) -> str:
    """Strip dots, dashes, spaces from NPWP. Returns 16-digit string or empty."""
    if not npwp:
        return ""
    cleaned = re.sub(r"[^0-9]", "", str(npwp))
    # NPWP 15-digit legacy → prepend 0 to make 16-digit (Coretax standard since 2024)
    if len(cleaned) == 15:
        cleaned = "0" + cleaned
    return cleaned[:16].ljust(16, "0") if cleaned else ""

def _id_tku(npwp_16: str) -> str:
    """ID TKU = NPWP 16-digit + cabang 6-digit (default 000000). Returns 22-digit string."""
    if not npwp_16:
        return ""
    return (npwp_16 + "000000")[:22]

class FpkExportIn(BaseModel):
    invoice_ids: List[str]

@app.post("/api/invoices/export-fpk")
async def export_faktur_pajak(data: FpkExportIn, user: dict = Depends(require_role("finance", "operation", "administrator"))):
    """Export invoices to DJP Coretax FPK XML upload template (.xlsx).
    Layout PERSIS sama dengan TEMPLATE XML FPK — yang berubah hanya Tanggal Faktur, Referensi (no invoice),
    data pembeli (NPWP, nama, alamat), dan nilai per baris (Harga Satuan & DPP Nilai Lain).
    Sheet structure: Faktur, DetailFaktur, REF, Keterangan (REF & Keterangan dipertahankan utuh).
    """
    if not data.invoice_ids:
        raise HTTPException(400, "invoice_ids tidak boleh kosong")
    if not FPK_TEMPLATE_PATH.exists():
        raise HTTPException(500, f"Template FPK tidak ditemukan: {FPK_TEMPLATE_PATH}")

    # --- Fetch invoices + AWBs + customers + settings ---
    inv_oids = [_oid(i) for i in data.invoice_ids]
    invs = await db.invoices.find({"_id": {"$in": inv_oids}}).to_list(1000)
    if not invs:
        raise HTTPException(404, "Invoice tidak ditemukan")
    # Order invoices by request order
    inv_by_id = {str(i["_id"]): i for i in invs}
    ordered_invs = [inv_by_id[iid] for iid in data.invoice_ids if iid in inv_by_id]

    # Pre-fetch AWBs and customers
    all_awb_ids = set()
    for inv in ordered_invs:
        if inv.get("awb_id"):
            all_awb_ids.add(inv["awb_id"])
        for x in inv.get("awb_ids") or []:
            all_awb_ids.add(x)
    amap = {a["_id"]: a for a in await db.awb_orders.find({"_id": {"$in": list(all_awb_ids)}}).to_list(5000)}
    cust_ids = list({a.get("customer_id") for a in amap.values() if a.get("customer_id")})
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(2000)}
    settings = {s["key_name"]: s.get("key_value", "") for s in await db.settings.find().to_list(2000)}

    # --- Load template (copy bytes into memory) ---
    with open(FPK_TEMPLATE_PATH, "rb") as f:
        template_bytes = f.read()
    wb = openpyxl.load_workbook(io.BytesIO(template_bytes), data_only=False, keep_vba=False)
    ws_f = wb["Faktur"]
    ws_d = wb["DetailFaktur"]

    # --- Determine seller NPWP (penjual) from first invoice's company_name ---
    first_inv = ordered_invs[0]
    first_awb = amap.get(first_inv.get("awb_id")) or next(iter(amap.values()), {})
    issuer_name = first_awb.get("company_name") or ""
    seller_npwp = _clean_npwp(settings.get(f"npwp_{issuer_name}") or settings.get("company_npwp", ""))
    # If user hasn't configured NPWP, keep the template's default (don't overwrite C1)
    if seller_npwp:
        ws_f["C1"] = seller_npwp
    seller_tku = _id_tku(seller_npwp) if seller_npwp else (ws_f["J4"].value or "")

    # --- Clear existing sample data rows (Faktur 4-71, DetailFaktur 2-69) BUT preserve cell styles ---
    FAKTUR_TEMPLATE_LAST = 71
    DETAIL_TEMPLATE_LAST = 69
    FAKTUR_DATA_COLS = list(range(1, 19))  # A-R
    DETAIL_DATA_COLS = list(range(1, 15))  # A-N
    for r in range(4, FAKTUR_TEMPLATE_LAST + 1):
        for c in FAKTUR_DATA_COLS:
            ws_f.cell(row=r, column=c).value = None
    for r in range(2, DETAIL_TEMPLATE_LAST + 1):
        for c in DETAIL_DATA_COLS:
            ws_d.cell(row=r, column=c).value = None

    # --- Fill data rows ---
    # For invoices beyond row 71 (Faktur) / 69 (DetailFaktur), styling is auto-copied by openpyxl
    # since we just set new cell values; openpyxl preserves number_format inheritance from prior rows.
    for idx, inv in enumerate(ordered_invs):
        baris = idx + 1
        f_row = idx + 4      # Faktur starts row 4
        d_row = idx + 2      # DetailFaktur starts row 2

        # Resolve invoice details
        awb_ids_list = inv.get("awb_ids") or ([inv["awb_id"]] if inv.get("awb_id") else [])
        awbs_for_inv = [amap[x] for x in awb_ids_list if x in amap]
        primary = awbs_for_inv[0] if awbs_for_inv else {}
        cust = cmap.get(primary.get("customer_id"), {}) if primary else {}

        # Tanggal Faktur — DJP format DD/MM/YYYY (as text per Keterangan sheet)
        inv_date = inv.get("invoice_date") or inv.get("created_at")
        if isinstance(inv_date, datetime):
            tgl_str = inv_date.strftime("%d/%m/%Y")
        elif isinstance(inv_date, str) and inv_date:
            try:
                tgl_str = datetime.fromisoformat(inv_date.replace("Z", "+00:00")).strftime("%d/%m/%Y")
            except Exception:
                tgl_str = inv_date[:10]
        else:
            tgl_str = datetime.now(timezone.utc).strftime("%d/%m/%Y")

        # Customer details
        cust_npwp = _clean_npwp(cust.get("npwp"))
        cust_tku = _id_tku(cust_npwp) if cust_npwp else ""
        cust_name = (cust.get("name") or "").upper()
        cust_addr = cust.get("address") or ""
        # Jenis ID Pembeli: TIN if 16-digit NPWP, else NIK
        jenis_id = "TIN" if cust_npwp and len(cust_npwp) == 16 else ("NIK" if cust_npwp else "TIN")
        if not cust_npwp:
            cust_npwp = "0000000000000000"

        # Invoice value — DPP = total selling (no addons, since addons not taxed)
        # Use total_tariff (selling base before tax) summed across all AWBs of invoice
        total_tariff = sum(float(a.get("total_tariff") or 0) for a in awbs_for_inv)
        # If total_tariff is zero, fallback to grand_total - tax_amount
        if total_tariff <= 0:
            gt = sum(float(a.get("grand_total") or 0) for a in awbs_for_inv)
            tax = sum(float(a.get("tax_amount") or 0) for a in awbs_for_inv)
            total_tariff = max(0, gt - tax)

        # === Faktur sheet ===
        ws_f.cell(row=f_row, column=1).value = str(baris)                    # Baris (text)
        ws_f.cell(row=f_row, column=2).value = tgl_str                        # Tanggal Faktur
        ws_f.cell(row=f_row, column=3).value = "Normal"                       # Jenis Faktur
        ws_f.cell(row=f_row, column=4).value = "05"                           # Kode Transaksi
        # E: Keterangan Tambahan (only for 07/08) — empty
        # F: Dokumen Pendukung — empty
        # G: Period Dok Pendukung — empty
        ws_f.cell(row=f_row, column=8).value = inv.get("invoice_number", "")  # Referensi
        # I: Cap Fasilitas — empty
        ws_f.cell(row=f_row, column=10).value = seller_tku                    # ID TKU Penjual
        ws_f.cell(row=f_row, column=11).value = cust_npwp                     # NPWP/NIK Pembeli
        ws_f.cell(row=f_row, column=12).value = jenis_id                      # Jenis ID Pembeli
        ws_f.cell(row=f_row, column=13).value = "IDN"                         # Negara Pembeli
        ws_f.cell(row=f_row, column=14).value = "-"                           # Nomor Dokumen Pembeli
        ws_f.cell(row=f_row, column=15).value = cust_name                     # Nama Pembeli
        ws_f.cell(row=f_row, column=16).value = cust_addr                     # Alamat Pembeli
        # Q: Email Pembeli — empty (optional)
        ws_f.cell(row=f_row, column=18).value = cust_tku or cust_npwp + "000000"  # ID TKU Pembeli

        # === DetailFaktur sheet ===
        ws_d.cell(row=d_row, column=1).value = baris                           # Baris (numeric)
        ws_d.cell(row=d_row, column=2).value = "B"                             # Barang/Jasa = Jasa
        ws_d.cell(row=d_row, column=3).value = "000000"                        # Kode
        ws_d.cell(row=d_row, column=4).value = "JASA PENGIRIMAN BARANG"        # Nama
        ws_d.cell(row=d_row, column=5).value = "UM.0033"                       # Satuan
        ws_d.cell(row=d_row, column=6).value = float(total_tariff)             # Harga Satuan
        ws_d.cell(row=d_row, column=7).value = 1                                # Jumlah
        ws_d.cell(row=d_row, column=8).value = 0                                # Diskon
        ws_d.cell(row=d_row, column=9).value = f"=G{d_row}*F{d_row}-H{d_row}"  # DPP formula
        ws_d.cell(row=d_row, column=10).value = float(total_tariff)            # DPP Nilai Lain
        ws_d.cell(row=d_row, column=11).value = 12                              # Tarif PPN
        ws_d.cell(row=d_row, column=12).value = f"=1.1%*J{d_row}"              # PPN formula
        ws_d.cell(row=d_row, column=13).value = 0                               # Tarif PPnBM
        ws_d.cell(row=d_row, column=14).value = 0                               # PPnBM

    # --- Save to bytes ---
    out_buf = io.BytesIO()
    wb.save(out_buf)
    out_buf.seek(0)

    await log_activity(user, "export", "invoice_fpk", None, f"Exported FPK Excel for {len(ordered_invs)} invoice(s)")

    filename = f"FPK_EMR_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        out_buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

