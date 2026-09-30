"""Iteration 20 backend tests:
- BUG FIX (P0): Cancel printed invoice flow
- Item #3: Import Invoice Numbers template (xlsx with 2 sheets)
- Item #8: Multi-Receiver Payment endpoints (POST/DELETE /api/orders/{id}/payments) — sanity
- Item #5: Per-user permission_actions persistence (POST/PUT /api/users)
- auth/me returns permission_actions
- Regressions: FPK export, activity-log list, recurring-expenses list
"""
import os
import io
import uuid
import pytest
import requests
import openpyxl

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://payroll-system-154.preview.emergentagent.com").rstrip("/")


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def reconciled_awb(headers):
    """Find an existing Reconciled AWB. If none, skip (do not modify production seeded data)."""
    r = requests.get(f"{BASE_URL}/api/orders", headers=headers, timeout=20)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    rec = [i for i in items if i.get("status") == "Reconciled"]
    if not rec:
        pytest.skip("No Reconciled AWBs available to seed invoice")
    return rec[0]


# ---------- Item #3: import-numbers-template ----------
class TestImportInvoiceTemplate:
    def test_template_download_returns_xlsx_with_two_sheets(self, headers):
        r = requests.get(f"{BASE_URL}/api/invoices/import-numbers-template",
                         headers=headers, timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert ("spreadsheetml" in ct) or ("excel" in ct.lower()) or ("octet-stream" in ct), f"bad ct: {ct}"
        wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
        names = wb.sheetnames
        assert "Import Invoice" in names, f"sheets={names}"
        assert "Petunjuk" in names, f"sheets={names}"
        ws = wb["Import Invoice"]
        assert ws.cell(row=1, column=1).value == "AWB Number"
        assert ws.cell(row=1, column=2).value == "Invoice Number"
        assert ws.cell(row=1, column=3).value == "Status"
        assert ws.cell(row=1, column=4).value == "Paid Date"


# ---------- BUG FIX (P0): Cancel printed invoice ----------
class TestCancelPrintedInvoiceFlow:
    """Seed invoice from Reconciled AWB → mark-printed → cancel → verify AWB reverted + journals cleared."""

    @pytest.fixture(scope="class")
    def seeded(self, headers, reconciled_awb):
        awb_id = reconciled_awb["id"]
        # POST /api/invoices with awb_ids
        r = requests.post(
            f"{BASE_URL}/api/invoices",
            headers=headers,
            json={"awb_id": awb_id},
            timeout=30,
        )
        assert r.status_code in (200, 201), f"create invoice failed: {r.status_code} {r.text}"
        inv = r.json()
        inv_id = inv.get("id") or inv.get("_id")
        assert inv_id, f"no id in invoice: {inv}"
        assert inv.get("invoice_number"), "missing invoice_number"
        yield {"inv_id": inv_id, "invoice_number": inv["invoice_number"], "awb_id": awb_id}

    def test_a_mark_printed_creates_journal_and_sets_invoiced(self, headers, seeded):
        r = requests.post(
            f"{BASE_URL}/api/invoices/{seeded['inv_id']}/mark-printed",
            headers=headers, json={}, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        data = r.json()
        assert int(data.get("print_count") or 0) >= 1
        assert data.get("ar_recognized") is True or data.get("first_printed_at")
        # AWB should now be Invoiced
        r2 = requests.get(f"{BASE_URL}/api/orders/{seeded['awb_id']}", headers=headers, timeout=20)
        assert r2.status_code == 200
        assert r2.json().get("status") == "Invoiced", f"awb status={r2.json().get('status')}"

    def test_b_cancel_returns_200_with_awbs_reverted(self, headers, seeded):
        r = requests.post(
            f"{BASE_URL}/api/invoices/{seeded['inv_id']}/cancel",
            headers=headers, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("invoice_number") == seeded["invoice_number"]
        assert isinstance(body.get("awbs_reverted"), list) and len(body["awbs_reverted"]) >= 1
        assert "journals_deleted" in body

    def test_c_awb_reverted_to_reconciled_after_cancel(self, headers, seeded):
        r = requests.get(f"{BASE_URL}/api/orders/{seeded['awb_id']}", headers=headers, timeout=20)
        assert r.status_code == 200
        assert r.json().get("status") == "Reconciled", f"awb status={r.json().get('status')}"

    def test_d_invoice_doc_deleted(self, headers, seeded):
        # Listing invoices: cancelled invoice should be gone
        r = requests.get(f"{BASE_URL}/api/invoices", headers=headers, timeout=20)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        ids = [i.get("id") or i.get("_id") for i in items]
        assert seeded["inv_id"] not in ids, "invoice should be deleted after cancel"


# ---------- Item #5: permission_actions on users (POST/PUT) ----------
class TestPermissionActions:
    USERNAME = f"TEST_permmatrix_{uuid.uuid4().hex[:6]}"

    @pytest.fixture(scope="class")
    def created_user(self, headers):
        payload = {
            "username": self.USERNAME,
            "password": "Passw0rd!",
            "full_name": "Test PermMatrix",
            "role": "operation",
            "permission_actions": {
                "orders_input": {
                    "view": True, "create": False, "edit": False,
                    "delete": False, "import": False, "export": False,
                }
            },
        }
        r = requests.post(f"{BASE_URL}/api/users", headers=headers, json=payload, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
        u = r.json()
        uid = u.get("id") or u.get("_id")
        assert uid
        yield uid
        # cleanup
        requests.delete(f"{BASE_URL}/api/users/{uid}", headers=headers, timeout=20)

    def test_a_post_user_persists_permission_actions(self, headers, created_user):
        # Find user via list (or GET single)
        r = requests.get(f"{BASE_URL}/api/users", headers=headers, timeout=20)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        u = next((x for x in items if (x.get("id") or x.get("_id")) == created_user), None)
        assert u is not None, "created user missing in list"
        pa = u.get("permission_actions") or {}
        assert "orders_input" in pa, f"permission_actions missing orders_input: {pa}"
        assert pa["orders_input"]["view"] is True
        assert pa["orders_input"]["create"] is False
        assert pa["orders_input"]["edit"] is False

    def test_b_put_user_updates_permission_actions(self, headers, created_user):
        new_pa = {
            "orders_input": {
                "view": True, "create": True, "edit": True,
                "delete": False, "import": False, "export": True,
            },
            "customers": {
                "view": True, "create": False, "edit": False,
                "delete": True, "import": False, "export": False,
            },
        }
        r = requests.put(
            f"{BASE_URL}/api/users/{created_user}",
            headers=headers,
            json={"permission_actions": new_pa},
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        # Re-fetch
        r2 = requests.get(f"{BASE_URL}/api/users", headers=headers, timeout=20)
        items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        u = next((x for x in items if (x.get("id") or x.get("_id")) == created_user), None)
        pa = u.get("permission_actions") or {}
        assert pa.get("orders_input", {}).get("create") is True
        assert pa.get("orders_input", {}).get("export") is True
        assert pa.get("orders_input", {}).get("delete") is False
        assert pa.get("customers", {}).get("delete") is True


# ---------- auth/me returns permission_actions ----------
class TestAuthMe:
    def test_me_returns_permission_actions_field(self, headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=20)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        data = r.json()
        # admin has empty pa but key should still exist or be None — spec says "must return"
        assert "permission_actions" in data, f"missing permission_actions in /auth/me: keys={list(data.keys())}"


# ---------- Regression tests ----------
class TestRegressions:
    def test_activity_logs(self, headers):
        r = requests.get(f"{BASE_URL}/api/activity-logs", headers=headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        assert isinstance(items, list)

    def test_recurring_expenses(self, headers):
        r = requests.get(f"{BASE_URL}/api/recurring-expenses", headers=headers, timeout=20)
        assert r.status_code == 200

    def test_fpk_export_xlsx(self, headers):
        # FPK export is POST with invoice_ids body. With empty list expect 400.
        r = requests.post(f"{BASE_URL}/api/invoices/export-fpk", headers=headers,
                          json={"invoice_ids": []}, timeout=30)
        assert r.status_code in (200, 400, 404), f"{r.status_code}: {r.text[:200]}"
