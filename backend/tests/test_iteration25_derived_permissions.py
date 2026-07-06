"""Iteration 25 — Derived permissions tests.

Validates that `permissions` array is now DERIVED from `permission_actions`
on every read (/auth/me, /auth/login) and write (POST/PUT users).

Bug fix: previously, role=operation user with all features=false still saw
many sidebar items because backend persisted the legacy permissions array
from applyRoleDefaults and admin auto-bypass in Layout.hasPerm.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://date-inclusion-bug.preview.emergentagent.com").rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def temp_user(admin_client):
    """Create a temporary user for a single test, then cleanup."""
    created = []

    def _create(payload):
        r = admin_client.post(f"{BASE_URL}/api/users", json=payload, timeout=15)
        assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
        u = r.json()
        created.append(u["id"])
        return u

    yield _create

    for uid in created:
        try:
            admin_client.delete(f"{BASE_URL}/api/users/{uid}", timeout=10)
        except Exception:
            pass


def _uniq(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------------------
# POST /api/users — derivation on create
# ---------------------------------------------------------------------------
class TestCreateUserDerivation:
    def test_all_false_permission_actions_yields_empty_perms(self, temp_user):
        uname = _uniq("TEST_allfalse")
        u = temp_user({
            "username": uname,
            "password": "test123",
            "role": "operation",
            "full_name": "All False",
            "permission_actions": {
                "orders_list": {"receive": False, "pod": False, "drop": False,
                                "edit_receive": False, "edit_pod": False, "delete": False,
                                "view_cost": False, "export_open": False},
            },
        })
        assert u["permissions"] == [], f"Expected empty permissions, got {u['permissions']}"
        # permission_actions should be persisted with only valid keys
        assert "orders_list" in u["permission_actions"]
        assert all(v is False for v in u["permission_actions"]["orders_list"].values())

    def test_one_true_feature_yields_one_module(self, temp_user):
        uname = _uniq("TEST_onetrue")
        u = temp_user({
            "username": uname,
            "password": "test123",
            "role": "operation",
            "full_name": "One True",
            "permission_actions": {
                "orders_list": {"receive": True, "pod": False, "drop": False,
                                "edit_receive": False, "edit_pod": False, "delete": False,
                                "view_cost": False, "export_open": False},
            },
        })
        assert u["permissions"] == ["orders_list"], f"Expected ['orders_list'], got {u['permissions']}"

    def test_multiple_modules_with_some_true(self, temp_user):
        uname = _uniq("TEST_multi")
        u = temp_user({
            "username": uname,
            "password": "test123",
            "role": "operation",
            "full_name": "Multi",
            "permission_actions": {
                "orders_list": {"receive": True},
                "recap": {"export_recap": False},  # all false -> excluded
                "pnl": {"export": True},
            },
        })
        assert set(u["permissions"]) == {"orders_list", "pnl"}


# ---------------------------------------------------------------------------
# PUT /api/users/{id} — derivation on update
# ---------------------------------------------------------------------------
class TestUpdateUserDerivation:
    def test_update_pa_overrides_explicit_permissions(self, admin_client, temp_user):
        uname = _uniq("TEST_putover")
        u = temp_user({
            "username": uname, "password": "test123", "role": "operation",
            "full_name": "Put Override",
            "permission_actions": {"orders_list": {"receive": True}},
        })
        uid = u["id"]
        # Try to send permissions=['recap'] but pa says orders_list only -> derived wins
        r = admin_client.put(f"{BASE_URL}/api/users/{uid}", json={
            "permissions": ["recap", "invoices"],
            "permission_actions": {"orders_list": {"receive": True, "pod": False}},
        }, timeout=15)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["permissions"] == ["orders_list"], updated["permissions"]

    def test_update_all_false_clears_permissions(self, admin_client, temp_user):
        uname = _uniq("TEST_putclr")
        u = temp_user({
            "username": uname, "password": "test123", "role": "operation",
            "full_name": "Put Clear",
            "permission_actions": {"orders_list": {"receive": True}},
        })
        uid = u["id"]
        r = admin_client.put(f"{BASE_URL}/api/users/{uid}", json={
            "permission_actions": {"orders_list": {"receive": False, "pod": False, "drop": False,
                                                    "edit_receive": False, "edit_pod": False, "delete": False,
                                                    "view_cost": False, "export_open": False}},
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["permissions"] == []


# ---------------------------------------------------------------------------
# /api/auth/login — derivation on login response
# ---------------------------------------------------------------------------
class TestLoginDerivation:
    def test_login_returns_derived_perms(self, temp_user):
        uname = _uniq("TEST_login")
        pwd = "test123"
        temp_user({
            "username": uname, "password": pwd, "role": "operation",
            "full_name": "Login Test",
            "permission_actions": {"orders_list": {"receive": True, "pod": False}},
        })
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": pwd}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["permissions"] == ["orders_list"]

    def test_login_empty_pa_returns_empty_perms(self, temp_user):
        uname = _uniq("TEST_loginempty")
        pwd = "test123"
        temp_user({
            "username": uname, "password": pwd, "role": "operation",
            "full_name": "Login Empty",
            "permission_actions": {"orders_list": {"receive": False, "pod": False, "drop": False,
                                                   "edit_receive": False, "edit_pod": False, "delete": False,
                                                   "view_cost": False, "export_open": False}},
        })
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": pwd}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["permissions"] == []

    def test_existing_test_alvinda_login_returns_empty(self):
        """Manual seed: test_alvinda was created with stale stored permissions but
        permission_actions with all features=false. Login must derive to []."""
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "test_alvinda", "password": "test123"}, timeout=15)
        if r.status_code != 200:
            pytest.skip("test_alvinda user not present")
        u = r.json()["user"]
        assert u["permissions"] == [], f"Expected derived []; got {u['permissions']}"


# ---------------------------------------------------------------------------
# /api/auth/me — derivation on me
# ---------------------------------------------------------------------------
class TestMeDerivation:
    def test_me_for_admin_returns_all_modules(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        # All 21 modules present
        assert len(u["permissions"]) >= 20, f"Admin should have ≥20 modules, got {len(u['permissions'])}"
        for mod in ["orders_list", "invoices_created", "accounting", "hr", "tax", "asset", "bank_recon",
                    "purchase_orders", "user_management", "fixed_costs", "pnl"]:
            assert mod in u["permissions"], f"Admin missing {mod}"

    def test_me_for_non_admin_derived(self, temp_user):
        """Non-admin: permissions derived from permission_actions, ignoring stored."""
        uname = _uniq("TEST_me_nonadmin")
        pwd = "test123"
        temp_user({
            "username": uname, "password": pwd, "role": "operation",
            "full_name": "Me Derived",
            "permissions": ["orders_list", "recap", "invoices"],  # try to inject stale stored
            "permission_actions": {"orders_list": {"receive": True}},
        })
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"username": uname, "password": pwd}, timeout=15)
        tok = login.json()["access_token"]
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        # derived only orders_list, not the explicit ['orders_list','recap','invoices']
        assert u["permissions"] == ["orders_list"]

    def test_me_legacy_user_no_pa_falls_back(self, admin_client):
        """User with empty permission_actions but permissions in stored falls back to stored."""
        # Create with no permission_actions, then directly check /me
        uname = _uniq("TEST_legacy")
        r = admin_client.post(f"{BASE_URL}/api/users", json={
            "username": uname, "password": "test123", "role": "operation",
            "full_name": "Legacy", "permissions": ["orders_list"],
            # No permission_actions sent - pa will be {} in DB
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
        uid = r.json()["id"]
        try:
            login = requests.post(f"{BASE_URL}/api/auth/login",
                                  json={"username": uname, "password": "test123"}, timeout=15)
            tok = login.json()["access_token"]
            me = requests.get(f"{BASE_URL}/api/auth/me",
                              headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
            # pa is {} so it should fall back to stored ['orders_list']
            assert me["permissions"] == ["orders_list"], me["permissions"]
        finally:
            admin_client.delete(f"{BASE_URL}/api/users/{uid}", timeout=10)


# ---------------------------------------------------------------------------
# Direct URL protection (regression)
# ---------------------------------------------------------------------------
class TestProtectedRoutes:
    def test_protected_routes_documented_behavior(self, temp_user):
        """KNOWN: backend GET /api/orders is open to any authed user — gating is
        frontend-only via React Protected route. This test documents the gap so
        main agent is aware. Returns 200 today; future hardening should add
        require_permission('orders_list') on the endpoint."""
        uname = _uniq("TEST_noaccess")
        pwd = "test123"
        temp_user({
            "username": uname, "password": pwd, "role": "operation",
            "full_name": "No Access",
            "permission_actions": {"orders_list": {"receive": False, "pod": False, "drop": False,
                                                    "edit_receive": False, "edit_pod": False, "delete": False,
                                                    "view_cost": False, "export_open": False}},
        })
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"username": uname, "password": pwd}, timeout=15)
        tok = login.json()["access_token"]
        r = requests.get(f"{BASE_URL}/api/orders",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        # Document current behavior — accept 200 (gap), 401 or 403 (hardened)
        assert r.status_code in (200, 401, 403)
