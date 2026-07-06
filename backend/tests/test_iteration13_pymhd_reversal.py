"""Iteration 13 backend tests:
   1) GET /api/dashboard/pymhd-pipeline
   2) DELETE /api/costs/{cid} warning gate (no confirm)
   3) DELETE /api/costs/{cid}?confirm=true reversal journal
   4) Non-last cost delete (no warning required)
   5) Already-invoiced AWB: no reversal
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://date-inclusion-bug.preview.emergentagent.com").rstrip("/")

ADMIN = ("admin", "admin123")
OP = ("operation", "operation123")
FIN = ("finance", "finance123")


def login(username: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_token():
    return login(*ADMIN)


@pytest.fixture(scope="module")
def op_token():
    return login(*OP)


@pytest.fixture(scope="module")
def fin_token():
    return login(*FIN)


@pytest.fixture(scope="module")
def some_customer(admin_token):
    r = requests.get(f"{BASE_URL}/api/customers", headers=_h(admin_token), timeout=30)
    assert r.status_code == 200
    rows = r.json()
    assert rows, "No customers seeded"
    return rows[0]


def _create_awb(op_token, customer_id, tariff=2_000_000, qty=1.0):
    awb_no = f"TEST-IT13-{int(time.time() * 1000)}"
    payload = {
        "customer_id": customer_id,
        "item_description": "TEST_IT13_REVERSAL",
        "goods_content": "Dokumen",
        "origin": "JKT",
        "destination": "SBY",
        "tariff_per_kg": tariff,
        "qty_kg": qty,
        "tax_percentage": 11,
        "service": "LCL",
        "via": "D",
        "awb_number": awb_no,
    }
    r = requests.post(f"{BASE_URL}/api/orders", headers=_h(op_token), json=payload, timeout=30)
    assert r.status_code == 200, f"create_order: {r.status_code} {r.text}"
    return r.json()


def _add_cost(op_token, awb_id, amount=500_000, vendor="TEST_IT13_VENDOR"):
    payload = {
        "awb_id": awb_id,
        "cost_category": "Vendor",
        "category": "Vendor",
        "amount": amount,
        "vendor_name": vendor,
        "description": "TEST_IT13_COST",
    }
    r = requests.post(f"{BASE_URL}/api/costs", headers=_h(op_token), json=payload, timeout=30)
    assert r.status_code == 200, f"create cost: {r.status_code} {r.text}"
    return r.json()


# ---------------- Tests ----------------

# 1) Pipeline endpoint
class TestPymhdPipeline:
    def _check_shape(self, data):
        for k in ("total_count", "total_amount", "recognized_amount",
                  "unrecognized_amount", "by_status", "by_customer"):
            assert k in data, f"missing key {k}"
        assert isinstance(data["by_customer"], list)
        assert isinstance(data["by_status"], dict)
        assert "Open" in data["by_status"]
        assert "Reconciled" in data["by_status"]
        # sorted DESC by amount
        amounts = [c["amount"] for c in data["by_customer"]]
        assert amounts == sorted(amounts, reverse=True), "by_customer not sorted DESC"

    def test_admin(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/pymhd-pipeline", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json())

    def test_finance(self, fin_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/pymhd-pipeline", headers=_h(fin_token), timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json())

    def test_operation(self, op_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/pymhd-pipeline", headers=_h(op_token), timeout=30)
        assert r.status_code == 200, r.text
        self._check_shape(r.json())


# 2) Warning gate
class TestReverseCostDeleteWarning:
    def test_warning_without_confirm(self, op_token, some_customer):
        awb = _create_awb(op_token, some_customer["id"], tariff=1_500_000, qty=1)
        awb_id = awb["id"]
        awb_no = awb["awb_number"]
        cost = _add_cost(op_token, awb_id, amount=200_000)
        cid = cost["id"]

        # Plain delete - should return warning
        r = requests.delete(f"{BASE_URL}/api/costs/{cid}", headers=_h(op_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is False, f"expected ok=false, got {body}"
        assert body.get("needs_confirmation") is True
        warning = body.get("warning", "")
        assert "cost terakhir" in warning.lower() or "COST TERAKHIR" in warning
        assert awb_no in warning
        assert body.get("awb_number") == awb_no
        assert float(body.get("reversal_amount", 0)) > 0
        # Cost should NOT yet be deleted
        r2 = requests.get(f"{BASE_URL}/api/costs?awb_id={awb_id}", headers=_h(op_token), timeout=30)
        assert any(c["id"] == cid for c in r2.json()), "cost should remain after warning"

        # Save for next test
        TestReverseCostDeleteWarning._awb = awb
        TestReverseCostDeleteWarning._cid = cid

    def test_delete_with_confirm(self, op_token, admin_token):
        # Re-use the prior awb/cid
        awb = getattr(TestReverseCostDeleteWarning, "_awb", None)
        cid = getattr(TestReverseCostDeleteWarning, "_cid", None)
        assert awb and cid, "previous test must run first"
        awb_id = awb["id"]
        awb_no = awb["awb_number"]
        expected_amt = float(awb["total_tariff"])

        r = requests.delete(f"{BASE_URL}/api/costs/{cid}?confirm=true", headers=_h(op_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        rev = body.get("reversal")
        assert rev and rev.get("reversed") is True, f"expected reversed=true, got {rev}"
        assert abs(float(rev.get("amount", 0)) - expected_amt) < 0.01

        # cost gone
        r2 = requests.get(f"{BASE_URL}/api/costs?awb_id={awb_id}", headers=_h(op_token), timeout=30)
        assert not any(c["id"] == cid for c in r2.json())

        # AWB.revenue_recognized = false
        r3 = requests.get(f"{BASE_URL}/api/orders/{awb_id}", headers=_h(admin_token), timeout=30)
        assert r3.status_code == 200, r3.text
        assert r3.json().get("revenue_recognized") is False, "awb.revenue_recognized must reset"

        # Journal has reversal entry
        rj = requests.get(f"{BASE_URL}/api/journal", headers=_h(admin_token), timeout=30)
        assert rj.status_code == 200
        entries = rj.json()
        if isinstance(entries, dict):
            entries = entries.get("entries") or entries.get("rows") or entries.get("data") or []
        reversal_entries = [
            e for e in entries
            if e.get("reference_type") == "awb_revenue_reversal" and e.get("reference_id") == awb_id
        ]
        assert reversal_entries, "expected an awb_revenue_reversal journal entry"
        rev_e = reversal_entries[0]
        assert rev_e.get("is_reversal") is True, f"is_reversal flag missing: {rev_e}"
        lines = rev_e.get("lines", [])
        codes_dr = {l["account_code"] for l in lines if (l.get("debit") or 0) > 0}
        codes_cr = {l["account_code"] for l in lines if (l.get("credit") or 0) > 0}
        assert "4101" in codes_dr, f"expected DR 4101, got DR codes {codes_dr}"
        assert "2390" in codes_cr, f"expected CR 2390, got CR codes {codes_cr}"


# 3) Non-last cost - delete without warning
class TestNonLastCostDelete:
    def test_no_warning_when_not_last(self, op_token, some_customer):
        awb = _create_awb(op_token, some_customer["id"], tariff=1_000_000)
        awb_id = awb["id"]
        c1 = _add_cost(op_token, awb_id, amount=100_000, vendor="TEST_IT13_V1")
        c2 = _add_cost(op_token, awb_id, amount=150_000, vendor="TEST_IT13_V2")

        # Delete the FIRST cost (not last) without confirm — should succeed directly.
        r = requests.delete(f"{BASE_URL}/api/costs/{c1['id']}", headers=_h(op_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        # needs_confirmation should NOT be set
        assert "needs_confirmation" not in body or body.get("needs_confirmation") is not True
        # reversal should be None / not reversed (because c2 still exists)
        rev = body.get("reversal")
        assert rev is None or rev.get("reversed") is not True


# 4) Invoiced AWB - no reversal
class TestInvoicedAwbNoReversal:
    def test_no_reversal_when_invoiced(self, op_token, admin_token, fin_token, some_customer):
        # Create AWB
        awb = _create_awb(op_token, some_customer["id"], tariff=800_000)
        awb_id = awb["id"]
        # Add cost (recognizes revenue)
        cost = _add_cost(op_token, awb_id, amount=120_000, vendor="TEST_IT13_INVD")
        cid = cost["id"]

        # Reconcile (operation)
        rec = requests.post(
            f"{BASE_URL}/api/orders/reconcile",
            headers=_h(op_token),
            json={"awb_ids": [awb_id]},
            timeout=30,
        )
        assert rec.status_code == 200, f"reconcile failed: {rec.status_code} {rec.text}"
        # Create invoice (operation role per server.py)
        inv_resp = requests.post(
            f"{BASE_URL}/api/invoices",
            headers=_h(op_token),
            json={"awb_id": awb_id},
            timeout=30,
        )
        assert inv_resp.status_code == 200, f"invoice create: {inv_resp.status_code} {inv_resp.text}"

        # Now delete last cost on invoiced AWB
        r = requests.delete(f"{BASE_URL}/api/costs/{cid}?confirm=true", headers=_h(op_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        rev = body.get("reversal")
        assert rev is None or rev.get("reversed") is False, f"expected no reversal on invoiced AWB, got {rev}"
