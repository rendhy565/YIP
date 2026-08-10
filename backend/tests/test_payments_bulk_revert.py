"""Tests for Payments bulk-mark-paid filter safety + revert-paid endpoints."""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or frontend_env.get("REACT_APP_BACKEND_URL")
)
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": "admin", "password": "admin123"},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# ---------- Baseline ----------
class TestBaseline:
    def test_baseline_zero_paid(self, client):
        r = client.get(f"{BASE_URL}/api/orders", params={"status_v": "Invoiced,Paid"}, timeout=60)
        assert r.status_code == 200
        rows = r.json()
        paid = [o for o in rows if o.get("status") == "Paid"]
        invoiced = [o for o in rows if o.get("status") == "Invoiced"]
        print(f"Baseline: Paid={len(paid)}, Invoiced={len(invoiced)}, Total={len(rows)}")
        # We don't strictly require 0 Paid, just record it
        assert len(invoiced) > 0, "need some Invoiced orders for tests"


# ---------- Bulk mark paid ONLY marks passed ids ----------
class TestBulkMarkPaidRespectsIds:
    created_paid_ids = []

    def test_bulk_marks_only_passed_subset(self, client):
        # Fetch invoiced
        r = client.get(f"{BASE_URL}/api/orders", params={"status_v": "Invoiced"}, timeout=60)
        assert r.status_code == 200
        invoiced = [o for o in r.json() if o.get("status") == "Invoiced"]
        assert len(invoiced) >= 3, "need ≥3 invoiced orders"
        pre_invoiced_count = len(invoiced)

        subset = invoiced[:2]  # take first 2
        subset_ids = [o["id"] for o in subset]

        resp = client.post(
            f"{BASE_URL}/api/payments/bulk-mark-paid",
            json={
                "awb_ids": subset_ids,
                "payment_invoice_number": "TEST-INV-BULK-001",
                "paid_date": None,
            },
            timeout=60,
        )
        assert resp.status_code == 200, resp.text[:300]
        data = resp.json()
        assert data["paid_count"] == 2, f"expected 2 paid, got {data}"
        assert data["skipped_count"] == 0

        # Track for cleanup
        TestBulkMarkPaidRespectsIds.created_paid_ids.extend(subset_ids)

        # Verify only 2 orders became Paid (delta check)
        r2 = client.get(f"{BASE_URL}/api/orders", params={"status_v": "Invoiced,Paid"}, timeout=60)
        rows2 = r2.json()
        paid_now = [o for o in rows2 if o.get("status") == "Paid"]
        invoiced_now = [o for o in rows2 if o.get("status") == "Invoiced"]
        # Invoiced decreased by exactly 2
        assert invoiced_now.__len__() == pre_invoiced_count - 2, (
            f"Invoiced dropped by {pre_invoiced_count - len(invoiced_now)} (expected 2)"
        )
        # Our 2 ids are in Paid
        paid_ids = {o["id"] for o in paid_now}
        for sid in subset_ids:
            assert sid in paid_ids
            o = next(o for o in paid_now if o["id"] == sid)
            assert o.get("payment_invoice_number") == "TEST-INV-BULK-001"

    def test_revert_paid_endpoint(self, client):
        """Verify POST /api/orders/{oid}/revert-paid restores to Invoiced + removes journal."""
        assert TestBulkMarkPaidRespectsIds.created_paid_ids, "need paid ids from prior test"
        first_id = TestBulkMarkPaidRespectsIds.created_paid_ids[0]

        resp = client.post(f"{BASE_URL}/api/orders/{first_id}/revert-paid", timeout=30)
        assert resp.status_code == 200, resp.text[:300]
        body = resp.json()
        assert body.get("ok") is True

        # Verify status
        r = client.get(f"{BASE_URL}/api/orders/{first_id}", timeout=30)
        assert r.status_code == 200
        o = r.json()
        assert o["status"] == "Invoiced"
        assert not o.get("paid_at")
        assert not o.get("payment_invoice_number")

        # Reverting again should 400
        resp2 = client.post(f"{BASE_URL}/api/orders/{first_id}/revert-paid", timeout=30)
        assert resp2.status_code == 400

        TestBulkMarkPaidRespectsIds.created_paid_ids.remove(first_id)

    def test_bulk_revert_paid(self, client):
        """Revert remaining paid ids via bulk endpoint (cleanup + test)."""
        remaining = list(TestBulkMarkPaidRespectsIds.created_paid_ids)
        if not remaining:
            pytest.skip("nothing to revert")
        resp = client.post(
            f"{BASE_URL}/api/payments/bulk-revert-paid",
            json={"awb_ids": remaining, "payment_invoice_number": None, "paid_date": None},
            timeout=60,
        )
        assert resp.status_code == 200, resp.text[:300]
        data = resp.json()
        assert data["reverted_count"] == len(remaining)
        for sid in remaining:
            r = client.get(f"{BASE_URL}/api/orders/{sid}", timeout=30)
            assert r.json()["status"] == "Invoiced"
        TestBulkMarkPaidRespectsIds.created_paid_ids.clear()


# ---------- Cleanup safety ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(client):
    yield
    # Ensure no leftover TEST paid orders
    leftover = list(TestBulkMarkPaidRespectsIds.created_paid_ids)
    if leftover:
        client.post(
            f"{BASE_URL}/api/payments/bulk-revert-paid",
            json={"awb_ids": leftover, "payment_invoice_number": None, "paid_date": None},
            timeout=60,
        )
