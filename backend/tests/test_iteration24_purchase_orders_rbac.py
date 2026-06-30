"""
Iteration 24 — Granular RBAC for purchase_orders module
Verifies:
- GET /api/rbac/module-features has purchase_orders (5 features, correct label)
- Admin /auth/me has purchase_orders auto-merged with all 5 features=true
- POST /api/users persists granular purchase_orders permission_actions
- /auth/login returns same data
"""
import os
import uuid
import pytest
import requests


def _read_env_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


BASE_URL = _read_env_url().rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

ADMIN = {"username": "admin", "password": "admin123"}
PO_FEATURES = {"create", "edit_item", "delete", "send_wa", "print"}
EXPECTED_LABEL = "PO / Surat Perintah Vendor"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- 1) catalog ----------
class TestPurchaseOrdersCatalog:
    def test_catalog_has_21_modules(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        mods = r.json()["modules"]
        assert len(mods) >= 21, f"expected >=21 modules, got {len(mods)}"

    def test_purchase_orders_module_present_with_label(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        mods = {m["key"]: m for m in r.json()["modules"]}
        assert "purchase_orders" in mods, "purchase_orders missing from catalog"
        assert mods["purchase_orders"]["label"] == EXPECTED_LABEL

    def test_purchase_orders_has_5_features(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        mods = {m["key"]: m for m in r.json()["modules"]}
        feat_keys = {f["key"] for f in mods["purchase_orders"]["features"]}
        assert feat_keys == PO_FEATURES, f"feature mismatch — got {feat_keys}, expected {PO_FEATURES}"


# ---------- 2) admin auto-merge ----------
class TestAdminAutoMerge:
    def test_admin_me_has_purchase_orders_all_true(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        me = r.json()
        pa = me.get("permission_actions") or {}
        assert "purchase_orders" in pa, f"admin permission_actions missing purchase_orders; keys={list(pa.keys())}"
        po = pa["purchase_orders"]
        for fk in PO_FEATURES:
            assert po.get(fk) is True, f"admin purchase_orders.{fk} expected True, got {po.get(fk)}"

    def test_admin_permissions_array_includes_purchase_orders(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=10)
        perms = r.json().get("permissions") or []
        assert "purchase_orders" in perms, f"permissions array missing purchase_orders: {perms}"

    def test_admin_login_response_has_purchase_orders(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=20)
        u = r.json()["user"]
        pa = u.get("permission_actions") or {}
        assert "purchase_orders" in pa
        assert pa["purchase_orders"].get("create") is True
        assert pa["purchase_orders"].get("print") is True


# ---------- 3) POST persists purchase_orders ----------
class TestPostUserPurchaseOrders:
    def test_create_user_with_partial_po_perms(self, admin_headers):
        uname = f"test_po_{uuid.uuid4().hex[:6]}"
        payload = {
            "username": uname,
            "password": "test123",
            "role": "operation",
            "permission_actions": {
                "purchase_orders": {
                    "create": True,
                    "edit_item": False,
                    "delete": False,
                    "send_wa": True,
                    "print": True,
                }
            },
        }
        r = requests.post(f"{BASE_URL}/api/users", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        uid = r.json()["id"]
        try:
            # Verify by GET list
            g = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=10)
            assert g.status_code == 200
            found = next((u for u in g.json() if u["id"] == uid), None)
            assert found is not None, "created user not in list"
            po = found["permission_actions"]["purchase_orders"]
            assert po["create"] is True
            assert po["edit_item"] is False
            assert po["delete"] is False
            assert po["send_wa"] is True
            assert po["print"] is True
        finally:
            requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_headers, timeout=10)

    def test_invalid_po_feature_dropped(self, admin_headers):
        uname = f"test_po_inv_{uuid.uuid4().hex[:6]}"
        payload = {
            "username": uname,
            "password": "test123",
            "role": "operation",
            "permission_actions": {
                "purchase_orders": {"create": True, "bogus_action": True},
            },
        }
        r = requests.post(f"{BASE_URL}/api/users", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201)
        uid = r.json()["id"]
        try:
            g = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=10)
            found = next((u for u in g.json() if u["id"] == uid), None)
            po = found["permission_actions"]["purchase_orders"]
            assert "bogus_action" not in po
            assert po["create"] is True
            # unspecified valid keys default False
            for fk in PO_FEATURES - {"create"}:
                assert po[fk] is False
        finally:
            requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_headers, timeout=10)


# ---------- 4) regression: catalog still has key modules ----------
class TestRegression:
    @pytest.mark.parametrize("mkey,fcount", [
        ("orders_list", 8),
        ("invoices_created", 6),
        ("payments", 4),
        ("purchase_orders", 5),
    ])
    def test_module_feature_counts(self, admin_headers, mkey, fcount):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        mods = {m["key"]: m for m in r.json()["modules"]}
        assert mkey in mods
        assert len(mods[mkey]["features"]) >= fcount, f"{mkey} should have >= {fcount} features"
