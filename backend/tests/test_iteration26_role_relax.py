"""Iteration 26 — Operation role relax verification.

Bug fix: 5 modules (Pembayaran, Settle Hutang Vendor, Expenses, Master Kategori
expense, Cost automatic) previously had backend require_role('finance') which
403'd operation-role users even when their permission_actions enabled the
underlying features. Fix: require_role expanded to (operation, finance,
administrator) for ~22 endpoints. UI granular gating via useCan is now
authoritative.

This file verifies:
 - test_op_perm (role=operation with payments/accrue/fixed_costs/
   expense_categories features) can GET all 5 endpoints (was 403, must be 200).
 - operation user is allowed to POST to mark_paid, expense-categories,
   recurring-expenses, accrue settle (returns 200, 400, or domain-specific 404
   — but NOT 403).
 - admin still has full access.
 - finance still has full access.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://plot-expenses.preview.emergentagent.com",
).rstrip("/")
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"

TEST_OP_PERM_USER = "test_op_perm"
TEST_OP_PERM_PASS = "test123"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update(
        {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    )
    return s


@pytest.fixture(scope="module")
def op_perm_token(admin_client):
    """Login as test_op_perm; if missing, create it with the documented
    permission_actions. Cleans up nothing — user persisted per main agent note."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": TEST_OP_PERM_USER, "password": TEST_OP_PERM_PASS},
        timeout=15,
    )
    if r.status_code != 200:
        # Create user
        payload = {
            "username": TEST_OP_PERM_USER,
            "password": TEST_OP_PERM_PASS,
            "role": "operation",
            "full_name": "Test Op Perm",
            "permission_actions": {
                "payments": {"mark_paid": True, "multi_payment": True},
                "accrue": {"settle": True},
                "fixed_costs": {"create": True, "petty_cash_create": True},
                "expense_categories": {"create": True, "edit": True},
            },
        }
        c = admin_client.post(f"{BASE_URL}/api/users", json=payload, timeout=15)
        assert c.status_code in (200, 201), f"create test_op_perm failed: {c.text}"
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": TEST_OP_PERM_USER, "password": TEST_OP_PERM_PASS},
            timeout=15,
        )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def op_perm_client(op_perm_token):
    s = requests.Session()
    s.headers.update(
        {"Authorization": f"Bearer {op_perm_token}", "Content-Type": "application/json"}
    )
    return s


@pytest.fixture(scope="module")
def legacy_op_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "operation", "password": "operation123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def legacy_op_client(legacy_op_token):
    s = requests.Session()
    s.headers.update(
        {"Authorization": f"Bearer {legacy_op_token}", "Content-Type": "application/json"}
    )
    return s


@pytest.fixture(scope="module")
def finance_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "finance", "password": "finance123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def finance_client(finance_token):
    s = requests.Session()
    s.headers.update(
        {"Authorization": f"Bearer {finance_token}", "Content-Type": "application/json"}
    )
    return s


# ---------------------------------------------------------------------------
# P0: 5 GET endpoints must return 200 for test_op_perm
# ---------------------------------------------------------------------------
class TestOpPermCanRead:
    def test_get_payments(self, op_perm_client):
        """Payments page actually calls GET /api/orders?status_v=Invoiced."""
        r = op_perm_client.get(
            f"{BASE_URL}/api/orders", params={"status_v": "Invoiced"}, timeout=15
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"

    def test_get_accrue_list(self, op_perm_client):
        """Accrue page actually calls GET /api/costs?payment_type=Accrue."""
        r = op_perm_client.get(
            f"{BASE_URL}/api/costs",
            params={"payment_type": "Accrue", "is_settled": "false"},
            timeout=15,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"

    def test_get_fixed_costs(self, op_perm_client):
        r = op_perm_client.get(f"{BASE_URL}/api/fixed-costs", timeout=15)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"

    def test_get_expense_categories(self, op_perm_client):
        r = op_perm_client.get(f"{BASE_URL}/api/expense-categories", timeout=15)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"

    def test_get_recurring_expenses(self, op_perm_client):
        r = op_perm_client.get(f"{BASE_URL}/api/recurring-expenses", timeout=15)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# P0: POST/PUT operations must NOT return 403 for test_op_perm
# ---------------------------------------------------------------------------
class TestOpPermCanWrite:
    def test_post_expense_category(self, op_perm_client):
        name = f"TEST_cat_{uuid.uuid4().hex[:6]}"
        r = op_perm_client.post(
            f"{BASE_URL}/api/expense-categories",
            json={"name": name, "code": name[:8]},
            timeout=15,
        )
        # Accept 200/201 (success). Reject 403 (the bug we are testing).
        assert r.status_code != 403, f"403 forbidden — fix didn't apply: {r.text}"
        assert r.status_code in (200, 201, 400, 409), f"got {r.status_code}: {r.text}"

        # Verify persistence & cleanup
        if r.status_code in (200, 201):
            created = r.json()
            cid = created.get("id")
            # PUT
            put = op_perm_client.put(
                f"{BASE_URL}/api/expense-categories/{cid}",
                json={"name": name + "_upd", "code": name[:8]},
                timeout=15,
            )
            assert put.status_code != 403, put.text
            # DELETE
            d = op_perm_client.delete(
                f"{BASE_URL}/api/expense-categories/{cid}", timeout=15
            )
            assert d.status_code != 403, d.text

    def test_post_recurring_expense(self, op_perm_client):
        # Try to POST a recurring expense — payload may be wrong, but must not be 403
        r = op_perm_client.post(
            f"{BASE_URL}/api/recurring-expenses",
            json={
                "name": f"TEST_rec_{uuid.uuid4().hex[:6]}",
                "amount": 100000,
                "frequency": "monthly",
                "start_date": "2026-01-01",
            },
            timeout=15,
        )
        assert r.status_code != 403, f"403 forbidden on recurring-expenses POST: {r.text}"
        # Cleanup if created
        if r.status_code in (200, 201):
            rid = r.json().get("id")
            if rid:
                op_perm_client.delete(
                    f"{BASE_URL}/api/recurring-expenses/{rid}", timeout=10
                )

    def test_post_payment_mark_paid_not_forbidden(self, op_perm_client):
        """mark_paid POST — sending dummy id; expect 404/400, NOT 403."""
        r = op_perm_client.post(
            f"{BASE_URL}/api/orders/nonexistent/mark-paid",
            json={"paid_amount": 0},
            timeout=15,
        )
        assert r.status_code != 403, f"403 on orders/{{id}}/mark-paid: {r.text}"

    def test_post_payment_bulk_mark_paid_not_forbidden(self, op_perm_client):
        r = op_perm_client.post(
            f"{BASE_URL}/api/payments/bulk-mark-paid",
            json={"order_ids": []},
            timeout=15,
        )
        assert r.status_code != 403, f"403 on payments/bulk-mark-paid: {r.text}"

    def test_post_accrue_settle_not_forbidden(self, op_perm_client):
        """Accrue settle is actually POST /api/costs/{id}/settle."""
        r = op_perm_client.post(
            f"{BASE_URL}/api/costs/nonexistent_id/settle",
            timeout=15,
        )
        assert r.status_code != 403, f"403 on costs settle: {r.text}"


# ---------------------------------------------------------------------------
# Legacy operation user (backward compat) — should also access endpoints
# ---------------------------------------------------------------------------
class TestLegacyOperationUser:
    def test_legacy_op_can_read_payments(self, legacy_op_client):
        r = legacy_op_client.get(
            f"{BASE_URL}/api/orders", params={"status_v": "Invoiced"}, timeout=15
        )
        assert r.status_code == 200, r.text

    def test_legacy_op_can_read_accrue(self, legacy_op_client):
        r = legacy_op_client.get(
            f"{BASE_URL}/api/costs",
            params={"payment_type": "Accrue", "is_settled": "false"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_legacy_op_can_read_fixed_costs(self, legacy_op_client):
        r = legacy_op_client.get(f"{BASE_URL}/api/fixed-costs", timeout=15)
        assert r.status_code == 200, r.text

    def test_legacy_op_can_read_expense_categories(self, legacy_op_client):
        r = legacy_op_client.get(f"{BASE_URL}/api/expense-categories", timeout=15)
        assert r.status_code == 200, r.text

    def test_legacy_op_can_read_recurring_expenses(self, legacy_op_client):
        r = legacy_op_client.get(f"{BASE_URL}/api/recurring-expenses", timeout=15)
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Admin/Finance regression
# ---------------------------------------------------------------------------
class TestAdminAndFinance:
    def test_admin_get_all_five(self, admin_client):
        for path in [
            "/api/orders?status_v=Invoiced",
            "/api/costs?payment_type=Accrue&is_settled=false",
            "/api/fixed-costs",
            "/api/expense-categories",
            "/api/recurring-expenses",
        ]:
            r = admin_client.get(f"{BASE_URL}{path}", timeout=15)
            assert r.status_code == 200, f"admin {path} -> {r.status_code}: {r.text}"

    def test_finance_get_all_five(self, finance_client):
        for path in [
            "/api/orders?status_v=Invoiced",
            "/api/costs?payment_type=Accrue&is_settled=false",
            "/api/fixed-costs",
            "/api/expense-categories",
            "/api/recurring-expenses",
        ]:
            r = finance_client.get(f"{BASE_URL}{path}", timeout=15)
            assert r.status_code == 200, f"finance {path} -> {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# Sidebar/derive consistency for test_op_perm
# ---------------------------------------------------------------------------
class TestOpPermDerivedPerms:
    def test_op_perm_perms_contain_5_modules(self, op_perm_token):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {op_perm_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        u = r.json()
        perms = set(u.get("permissions", []))
        # All 4 modules should be derived (5 sidebar items map to 4 modules:
        # fixed_costs covers both Cost Automatic + Master Kategori? Actually:
        #   payments, accrue, fixed_costs, expense_categories — 4 modules)
        expected = {"payments", "accrue", "fixed_costs", "expense_categories"}
        assert expected.issubset(perms), (
            f"Expected {expected} ⊆ derived permissions, got {perms}"
        )
        # Should NOT contain unrelated modules
        forbidden = {"orders_list", "invoices", "recap", "customers"}
        assert not (forbidden & perms), f"Unexpected modules: {forbidden & perms}"
