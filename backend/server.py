from dotenv import load_dotenv
load_dotenv()

import os
import re
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal, Annotated
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

    # Sample customers + contracts
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
            f["created_at"] = datetime.now(timezone.utc)
            await db.fixed_costs.insert_one(f)

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
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.awb_costs.insert_one(doc)
    new = await db.awb_costs.find_one({"_id": r.inserted_id})
    return serialize(new)

@app.post("/api/costs/{cid}/settle")
async def settle_cost(cid: str, user: dict = Depends(require_role("finance"))):
    cost = await db.awb_costs.find_one({"_id": _oid(cid)})
    if not cost:
        raise HTTPException(404, "Biaya tidak ditemukan")
    if cost["payment_type"] != "Accrue":
        raise HTTPException(400, "Hanya biaya Accrue yang dapat di-settle ke Cash")
    await db.awb_costs.update_one(
        {"_id": _oid(cid)},
        {"$set": {"payment_type": "Cash", "is_settled": True, "settled_at": datetime.now(timezone.utc), "settled_by": user["id"]}},
    )
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
async def mark_paid(oid: str, user: dict = Depends(require_role("finance"))):
    o = await db.awb_orders.find_one({"_id": _oid(oid)})
    if not o:
        raise HTTPException(404, "Order tidak ditemukan")
    if o["status"] != "Invoiced":
        raise HTTPException(400, "Hanya order Invoiced yang dapat ditandai Paid")
    await db.awb_orders.update_one(
        {"_id": _oid(oid)},
        {"$set": {"status": "Paid", "paid_at": datetime.now(timezone.utc), "paid_by": user["id"]}},
    )
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
    doc = {
        "category": data.category,
        "description": data.description,
        "amount": data.amount,
        "period_month": data.period_month,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
    }
    r = await db.fixed_costs.insert_one(doc)
    new = await db.fixed_costs.find_one({"_id": r.inserted_id})
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
        await db.fixed_costs.delete_many({"period_month": data.target_month})
    new_docs = []
    for f in src:
        new_docs.append({
            "category": f["category"],
            "description": f.get("description"),
            "amount": f.get("amount", 0),
            "period_month": data.target_month,
            "created_by": user["id"],
            "copied_from_month": data.source_month,
            "created_at": datetime.now(timezone.utc),
        })
    if new_docs:
        await db.fixed_costs.insert_many(new_docs)
    return {"copied": len(new_docs), "target_month": data.target_month, "overwrite": data.overwrite}
