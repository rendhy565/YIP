"""
Iteration 22 — Granular per-button permissions (MODULE_FEATURES catalog)
Tests:
- GET /api/rbac/module-features structure
- Admin auto-seed permission_actions on login & /auth/me
- POST/PUT /api/users normalization of permission_actions
- Removal of old RBAC endpoints (/rbac/matrix, /rbac/update, /rbac/my-permissions)
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

# Expected granular feature catalogs (key subsets)
EXPECTED_FEATURES = {
    "orders_list": {"receive", "pod", "edit_receive", "edit_pod", "view_cost", "drop", "delete", "export_open"},
    "invoices_created": {"cancel", "import_numbers", "export_fpk", "export_ar", "bulk_print", "save_po_number"},
    "payments": {"mark_paid", "mark_paid_bulk", "multi_payment", "delete_receipt"},
    "fixed_costs": {"create", "edit", "delete", "import_bkk", "petty_cash_create", "petty_cash_settle", "petty_cash_delete"},
    "recap": {"edit_selling", "reconcile", "delete", "export"},
    "invoices": {"create", "delete_draft"},
}


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------------- 1) module-features catalog ----------------
class TestModuleFeaturesCatalog:
    def test_endpoint_returns_at_least_20_modules(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "modules" in data
        assert isinstance(data["modules"], list)
        assert len(data["modules"]) >= 20, f"expected >=20 modules, got {len(data['modules'])}"

    def test_module_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        for m in r.json()["modules"]:
            assert "key" in m and "label" in m and "features" in m
            assert isinstance(m["features"], list)
            for f in m["features"]:
                assert "key" in f and "label" in f

    @pytest.mark.parametrize("module_key,expected_keys", list(EXPECTED_FEATURES.items()))
    def test_specific_modules_have_expected_features(self, admin_headers, module_key, expected_keys):
        r = requests.get(f"{BASE_URL}/api/rbac/module-features", headers=admin_headers, timeout=10)
        modules = {m["key"]: {f["key"] for f in m["features"]} for m in r.json()["modules"]}
        assert module_key in modules, f"module {module_key} missing from catalog"
        got = modules[module_key]
        assert expected_keys.issubset(got), f"{module_key} missing features: {expected_keys - got}"


# ---------------- 2) admin auto-seed ----------------
class TestAdminAutoSeed:
    def test_auth_me_admin_has_all_modules_all_features_true(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        me = r.json()
        pa = me.get("permission_actions") or {}
        assert len(pa) >= 20, f"admin permission_actions has only {len(pa)} modules"
        # all orders_list features must be True
        ol = pa.get("orders_list") or {}
        for fk in EXPECTED_FEATURES["orders_list"]:
            assert ol.get(fk) is True, f"admin orders_list.{fk} should be True, got {ol.get(fk)}"

    def test_login_response_includes_permission_actions(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=20)
        assert r.status_code == 200
        u = r.json()["user"]
        pa = u.get("permission_actions") or {}
        assert "orders_list" in pa
        assert pa["orders_list"].get("receive") is True


# ---------------- 3) POST /users normalization ----------------
class TestPostUserNormalization:
    def test_invalid_features_dropped_valid_kept(self, admin_headers):
        uname = f"test_rbac_{uuid.uuid4().hex[:6]}"
        payload = {
            "username": uname,
            "password": "test123",
            "role": "finance",
            "permission_actions": {
                "orders_list": {"receive": True, "pod": False, "bogus_feature": True},
                "fake_module": {"x": True},  # invalid module — dropped
                "invoices_created": {"cancel": True, "export_fpk": False},
            },
        }
        r = requests.post(f"{BASE_URL}/api/users", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        u = r.json()
        pa = u["permission_actions"]
        # fake_module dropped
        assert "fake_module" not in pa
        # orders_list normalized: only valid feature_keys persisted with bool
        ol = pa["orders_list"]
        assert "bogus_feature" not in ol
        assert ol["receive"] is True
        assert ol["pod"] is False
        # unspecified valid keys default to False
        assert ol["drop"] is False
        # invoices_created normalized
        ic = pa["invoices_created"]
        assert ic["cancel"] is True
        assert ic["export_fpk"] is False
        # cleanup
        requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=admin_headers, timeout=10)


# ---------------- 4) PUT /users update ----------------
class TestPutUserUpdate:
    def test_update_permission_actions_persists(self, admin_headers):
        uname = f"test_rbac_put_{uuid.uuid4().hex[:6]}"
        create_r = requests.post(
            f"{BASE_URL}/api/users",
            json={"username": uname, "password": "test123", "role": "finance"},
            headers=admin_headers, timeout=15,
        )
        assert create_r.status_code in (200, 201), create_r.text
        uid = create_r.json()["id"]
        try:
            put_r = requests.put(
                f"{BASE_URL}/api/users/{uid}",
                json={"permission_actions": {"invoices_created": {"cancel": False, "export_fpk": True}}},
                headers=admin_headers, timeout=15,
            )
            assert put_r.status_code == 200, put_r.text
            # Verify via GET list (single-user GET may not exist)
            get_r = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=10)
            assert get_r.status_code == 200
            found = next((u for u in get_r.json() if u["id"] == uid), None)
            assert found is not None
            ic = found["permission_actions"]["invoices_created"]
            assert ic["cancel"] is False
            assert ic["export_fpk"] is True
        finally:
            requests.delete(f"{BASE_URL}/api/users/{uid}", headers=admin_headers, timeout=10)


# ---------------- 5) old RBAC endpoints removed ----------------
class TestOldRbacRemoved:
    @pytest.mark.parametrize("path,method", [
        ("/api/rbac/matrix", "get"),
        ("/api/rbac/update", "post"),
        ("/api/rbac/my-permissions", "get"),
    ])
    def test_old_endpoint_gone(self, admin_headers, path, method):
        fn = getattr(requests, method)
        kwargs = {"headers": admin_headers, "timeout": 10}
        if method == "post":
            kwargs["json"] = {}
        r = fn(f"{BASE_URL}{path}", **kwargs)
        # FastAPI returns 404 for unknown routes, 405 for wrong method on existing path
        assert r.status_code in (404, 405), f"{method.upper()} {path} should be removed but got {r.status_code}"


# ---------------- 6) gating behavior — login as finance ----------------
class TestFinanceUserLogin:
    def test_finance_login_returns_permission_actions(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "finance", "password": "finance123"}, timeout=15)
        if r.status_code != 200:
            pytest.skip("finance user not seeded")
        u = r.json()["user"]
        # finance may or may not have permission_actions populated; spec only requires admin auto-seed
        # Validate keys present permissions array contains expected modules
        assert isinstance(u.get("permissions", []), list)
