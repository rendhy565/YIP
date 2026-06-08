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
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Akses ditolak untuk role ini")
        return user
    return dep

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

    # Users
    seeds = [
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
            "created_at": datetime.now(timezone.utc),
        }
        if not existing:
            await db.users.insert_one(doc)
        else:
            # keep password in sync with .env
            if not verify_password(s["password"], existing.get("password_hash", "")):
                await db.users.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"password_hash": doc["password_hash"], "role": s["role"]}},
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
        # also try as-is for backward compat
        user = await db.users.find_one({"username": data.username})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    token = create_access_token(str(user["_id"]), user["username"], user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "role": user["role"],
            "full_name": user.get("full_name"),
        },
    }

@app.get("/api/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(id=user["id"], username=user["username"], role=user["role"], full_name=user.get("full_name"))

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
    # Business rule enforcement
    if data.cost_category == "Vendor":
        if role != "operation":
            raise HTTPException(403, "Hanya role Operation yang dapat input biaya Vendor")
        payment_type = "Accrue"
        is_settled = False
    elif data.cost_category in ("Operational", "Lintas"):
        if role != "finance":
            raise HTTPException(403, "Hanya role Finance yang dapat input biaya Operational/Lintas")
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
    # operation can only delete their own vendor (unsettled), finance can delete any cash
    if user["role"] == "operation" and cost["cost_category"] != "Vendor":
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
    if o["status"] != "Reconciled":
        raise HTTPException(400, "Hanya order dengan status Reconciled yang bisa dibuat invoice")
    existing = await db.invoices.find_one({"awb_id": o["_id"]})
    if existing:
        return serialize(existing)
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

    cost_pipeline = [
        {"$match": {"awb_id": {"$in": awb_ids}}},
        {"$group": {"_id": "$awb_id", "total_cost": {"$sum": "$amount"}}},
    ]
    cost_agg = {c["_id"]: c["total_cost"] for c in await db.awb_costs.aggregate(cost_pipeline).to_list(5000)}
    cmap = {c["_id"]: c for c in await db.customers.find({"_id": {"$in": cust_ids}}).to_list(1000)}

    rows = []
    total_revenue = 0.0
    total_cost = 0.0
    for o in orders:
        rev = o.get("total_tariff", 0) or 0
        cst = cost_agg.get(o["_id"], 0) or 0
        net = rev - cst
        total_revenue += rev
        total_cost += cst
        c = cmap.get(o.get("customer_id"))
        rows.append({
            "awb_id": str(o["_id"]),
            "awb_number": o["awb_number"],
            "customer_name": c["name"] if c else None,
            "created_at": o["created_at"].isoformat() if o.get("created_at") else None,
            "status": o["status"],
            "revenue": rev,
            "total_cost": cst,
            "net_profit": net,
            "margin_pct": (net / rev * 100) if rev else 0,
        })
    return {
        "rows": rows,
        "summary": {
            "total_revenue": total_revenue,
            "total_cost": total_cost,
            "net_profit": total_revenue - total_cost,
            "count": len(rows),
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
