"""Batch 2 backend tests:
- Import Invoice Numbers (mark Invoiced/Paid)
- Multi-receiver Payment per AWB
- Activity Log read
- Notifications API
- Recurring Expenses CRUD + run-due
- RBAC matrix get/update + admin block
- Regression: existing endpoints still 200
"""
import os
import io
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://date-inclusion-bug.preview.emergentagent.com").rstrip("/")


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin", "admin123")


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def finance_token():
    return _login("finance", "finance123")


# ---------------------------------------------------------------------------
# Regression: critical existing endpoints
# ---------------------------------------------------------------------------
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/orders", "/api/customers", "/api/invoices",
        "/api/petty-cash", "/api/fixed-costs", "/api/expense-categories",
    ])
    def test_endpoint_200(self, admin_headers, path):
        r = requests.get(f"{BASE_URL}{path}", headers=admin_headers, timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
        data = r.json()
        assert isinstance(data, (list, dict))


# ---------------------------------------------------------------------------
# Activity Log
# ---------------------------------------------------------------------------
class TestActivityLogs:
    def test_list_logs_admin(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/activity-logs", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_filter_by_action(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/activity-logs?action=create&limit=20", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        for d in data:
            assert d.get("action") == "create"

    def test_non_admin_forbidden(self, finance_token):
        h = {"Authorization": f"Bearer {finance_token}"}
        r = requests.get(f"{BASE_URL}/api/activity-logs", headers=h, timeout=20)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Notifications API
# ---------------------------------------------------------------------------
class TestNotifications:
    def test_list_returns_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "notifications" in data and "unread_count" in data
        assert isinstance(data["notifications"], list)
        assert isinstance(data["unread_count"], int)

    def test_read_all(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/notifications/read-all", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        assert "updated" in r.json()
        # After read-all, unread_count should be 0
        r2 = requests.get(f"{BASE_URL}/api/notifications", headers=admin_headers, timeout=20)
        assert r2.json()["unread_count"] == 0


# ---------------------------------------------------------------------------
# RBAC Matrix
# ---------------------------------------------------------------------------
class TestRBAC:
    def test_get_matrix(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/rbac/matrix", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "modules" in data and "actions" in data and "matrix" in data
        assert isinstance(data["modules"], list) and len(data["modules"]) > 0
        assert all("key" in m and "label" in m for m in data["modules"])
        assert set(["view", "create", "edit", "delete", "import", "export"]).issubset(set(data["actions"]))

    def test_update_finance_role(self, admin_headers):
        # Pick first module
        m = requests.get(f"{BASE_URL}/api/rbac/matrix", headers=admin_headers, timeout=20).json()
        first_mod = m["modules"][0]["key"]
        payload = {"role": "finance", "permissions": {first_mod: {"view": True, "create": False, "edit": False, "delete": False, "import": False, "export": False}}}
        r = requests.post(f"{BASE_URL}/api/rbac/update", headers=admin_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify persisted
        m2 = requests.get(f"{BASE_URL}/api/rbac/matrix", headers=admin_headers, timeout=20).json()
        assert m2["matrix"].get("finance", {}).get(first_mod, {}).get("view") is True

    def test_block_administrator_update(self, admin_headers):
        payload = {"role": "administrator", "permissions": {"orders": {"view": False}}}
        r = requests.post(f"{BASE_URL}/api/rbac/update", headers=admin_headers, json=payload, timeout=20)
        assert r.status_code == 400, f"Expected 400 but got {r.status_code}: {r.text}"

    def test_my_permissions(self, finance_token):
        h = {"Authorization": f"Bearer {finance_token}"}
        r = requests.get(f"{BASE_URL}/api/rbac/my-permissions", headers=h, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "finance"
        assert "permissions" in data


# ---------------------------------------------------------------------------
# Recurring Expenses
# ---------------------------------------------------------------------------
@pytest.fixture(scope="class")
def expense_category(admin_headers):
    r = requests.get(f"{BASE_URL}/api/expense-categories", headers=admin_headers, timeout=20)
    assert r.status_code == 200
    cats = r.json()
    assert isinstance(cats, list) and len(cats) > 0, "No expense categories seeded"
    return cats[0]["name"]


class TestRecurringExpenses:
    created_id = None

    def test_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/recurring-expenses", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create(self, admin_headers, expense_category):
        # Use yesterday so run-due picks it up
        today = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        payload = {
            "name": "TEST_Sewa_Batch2",
            "category": expense_category,
            "amount": 100000,
            "frequency": "monthly",
            "execute_day": 1,
            "start_date": today,
            "notify_enabled": True,
            "auto_execute": True,
        }
        r = requests.post(f"{BASE_URL}/api/recurring-expenses", headers=admin_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Sewa_Batch2"
        assert data["amount"] == 100000
        assert data["frequency"] == "monthly"
        assert data["active"] is True
        TestRecurringExpenses.created_id = data["id"]

    def test_update_toggle_active(self, admin_headers):
        assert TestRecurringExpenses.created_id, "Create must run first"
        r = requests.put(
            f"{BASE_URL}/api/recurring-expenses/{TestRecurringExpenses.created_id}",
            headers=admin_headers, json={"active": False}, timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["active"] is False
        # Toggle back on so run-due picks it up
        r2 = requests.put(
            f"{BASE_URL}/api/recurring-expenses/{TestRecurringExpenses.created_id}",
            headers=admin_headers, json={"active": True}, timeout=20,
        )
        assert r2.status_code == 200
        assert r2.json()["active"] is True

    def test_run_due_creates_expense(self, admin_headers):
        # Snapshot fixed_costs count
        before = requests.get(f"{BASE_URL}/api/fixed-costs", headers=admin_headers, timeout=20).json()
        before_count = len(before)

        r = requests.post(f"{BASE_URL}/api/recurring-expenses/run-due", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "due_found" in data and "expenses_created" in data
        # Our created recurring should be due (start_date = yesterday)
        assert data["due_found"] >= 1
        assert data["expenses_created"] >= 1

        after = requests.get(f"{BASE_URL}/api/fixed-costs", headers=admin_headers, timeout=20).json()
        assert len(after) >= before_count + 1

        # Verify next_due incremented
        lst = requests.get(f"{BASE_URL}/api/recurring-expenses", headers=admin_headers, timeout=20).json()
        ours = next((x for x in lst if x.get("id") == TestRecurringExpenses.created_id), None)
        assert ours is not None
        assert ours.get("occurrence_count", 0) >= 1
        assert ours.get("last_executed_at") is not None

    def test_delete(self, admin_headers):
        assert TestRecurringExpenses.created_id
        r = requests.delete(
            f"{BASE_URL}/api/recurring-expenses/{TestRecurringExpenses.created_id}",
            headers=admin_headers, timeout=20,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------------------------------------------------------------------------
# Multi-Payment Receipt per AWB
# ---------------------------------------------------------------------------
@pytest.fixture(scope="class")
def unpaid_awb(admin_headers):
    """Pick an existing AWB with status != Paid for payment tests. If none exists, skip."""
    r = requests.get(f"{BASE_URL}/api/orders", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    orders = r.json()
    # Look for one with grand_total > 0 and status not Paid
    candidates = [
        o for o in orders
        if (o.get("status") not in ("Paid",)) and float(o.get("grand_total") or 0) > 0
    ]
    if not candidates:
        pytest.skip("No unpaid AWB with grand_total > 0 available for payment receipt tests")
    return candidates[0]


class TestPaymentReceipts:
    receipt_id = None
    awb_id = None

    def test_list_payments_initial(self, admin_headers, unpaid_awb):
        oid = unpaid_awb["id"]
        TestPaymentReceipts.awb_id = oid
        r = requests.get(f"{BASE_URL}/api/orders/{oid}/payments", headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "grand_total" in data and "total_paid" in data and "remaining" in data
        assert "receipts" in data and isinstance(data["receipts"], list)

    def test_add_payment(self, admin_headers, unpaid_awb):
        oid = unpaid_awb["id"]
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        payload = {"amount": 10000, "payment_date": today, "payment_method": "Transfer", "notes": "TEST_batch2"}
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/payments", headers=admin_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert "receipt_id" in data
        TestPaymentReceipts.receipt_id = data["receipt_id"]
        # total_paid should reflect new amount
        assert data["total_paid"] >= 10000

    def test_payment_in_list(self, admin_headers):
        oid = TestPaymentReceipts.awb_id
        r = requests.get(f"{BASE_URL}/api/orders/{oid}/payments", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        ids = [x.get("id") for x in data["receipts"]]
        assert TestPaymentReceipts.receipt_id in ids

    def test_bad_payment_date(self, admin_headers):
        oid = TestPaymentReceipts.awb_id
        r = requests.post(
            f"{BASE_URL}/api/orders/{oid}/payments",
            headers=admin_headers,
            json={"amount": 1000, "payment_date": "not-a-date", "payment_method": "Cash"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_zero_amount_rejected(self, admin_headers):
        oid = TestPaymentReceipts.awb_id
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.post(
            f"{BASE_URL}/api/orders/{oid}/payments",
            headers=admin_headers,
            json={"amount": 0, "payment_date": today},
            timeout=20,
        )
        assert r.status_code == 400

    def test_delete_payment(self, admin_headers):
        rid = TestPaymentReceipts.receipt_id
        assert rid
        r = requests.delete(f"{BASE_URL}/api/payment-receipts/{rid}", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        # Verify removed
        oid = TestPaymentReceipts.awb_id
        r2 = requests.get(f"{BASE_URL}/api/orders/{oid}/payments", headers=admin_headers, timeout=20)
        ids = [x.get("id") for x in r2.json()["receipts"]]
        assert rid not in ids


# ---------------------------------------------------------------------------
# Import Invoice Numbers
# ---------------------------------------------------------------------------
class TestImportInvoiceNumbers:
    def test_dry_run_invalid_file(self, admin_token):
        files = {"file": ("bad.xlsx", b"not a real xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE_URL}/api/invoices/import-numbers?dry_run=true", headers=h, files=files, timeout=20)
        assert r.status_code == 400

    def test_dry_run_no_match(self, admin_token):
        # Build a tiny valid xlsx with header but a fake AWB
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["AWB Number", "Invoice Number", "Status", "Paid Date"])
        ws.append(["AWB-DOESNOTEXIST-9999", "INV-TEST-001", "Invoiced", ""])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        files = {"file": ("test.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE_URL}/api/invoices/import-numbers?dry_run=true", headers=h, files=files, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "errors" in data
        # At least one error for the fake AWB
        assert any("AWB-DOESNOTEXIST-9999" in (e.get("message") or "") for e in data["errors"])
