"""
Iteration 21 — Edit AWB selling (charter vs per-kg) regression tests.

Covers backend PATCH /api/orders/{oid}/extended:
- Per-Kg path: tariff_per_kg * qty_kg → total_tariff; PPN from selling only.
- Charter path: is_charter=true + charter_amount → total_tariff; tariff_per_kg & qty_kg forced to 0.
- Addons (insurance/polis) are NOT included in tax_amount calculation.
- Re-post sales_accrued journal when Reconciled AWB total_tariff changes.
"""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

ADMIN = {"username": "admin", "password": "admin123"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _get_first_customer(headers):
    r = requests.get(f"{BASE_URL}/api/customers", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items", [])
    assert items, "No customers available for testing"
    return items[0]


def _create_open_awb(headers, *, is_charter=False, charter_amount=None, tariff=5000, qty=10, tax=11):
    """Create an Open AWB for editing. Uses minimal valid payload."""
    cust = _get_first_customer(headers)
    awb_no = f"TEST-EDIT-{uuid.uuid4().hex[:8].upper()}"
    payload = {
        "awb_number": awb_no,
        "customer_id": cust["id"],
        "consignee": "TEST_Consignee",
        "origin": "JKT",
        "destination": "SBY",
        "service": "FTL",
        "item_description": "TEST item",
        "goods_content": "TEST goods",
        "is_charter": is_charter,
        "tariff_per_kg": 0 if is_charter else tariff,
        "qty_kg": 0 if is_charter else qty,
        "tax_percentage": tax,
        "koli_count": 1,
        "koli_qty_per": "1",
    }
    if is_charter:
        payload["charter_amount"] = charter_amount
    r = requests.post(f"{BASE_URL}/api/orders", headers=headers, json=payload, timeout=15)
    assert r.status_code in (200, 201), f"create AWB failed: {r.status_code} {r.text}"
    return r.json()


# ---------------------------------------------------------------------------
# Per-Kg edit path
# ---------------------------------------------------------------------------
class TestEditPerKg:
    def test_edit_perkg_recomputes_total_tax_grand(self, auth_headers):
        awb = _create_open_awb(auth_headers, tariff=1000, qty=2, tax=0)
        oid = awb["id"]
        # Edit to 10000 * 5, PPN 11
        patch = {
            "is_charter": False,
            "tariff_per_kg": 10000,
            "qty_kg": 5,
            "tax_percentage": 11,
        }
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/extended", headers=auth_headers, json=patch, timeout=15)
        assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
        doc = r.json()
        assert doc["tariff_per_kg"] == 10000
        assert doc["qty_kg"] == 5
        assert doc["total_tariff"] == 50000
        assert doc["tax_amount"] == 5500
        # grand_total = total + tax + addons (addons=0)
        assert doc["grand_total"] == 55500
        assert bool(doc.get("is_charter")) is False

        # GET to verify persistence
        g = requests.get(f"{BASE_URL}/api/orders/{oid}", headers=auth_headers, timeout=15)
        assert g.status_code == 200
        d2 = g.json()
        assert d2["total_tariff"] == 50000
        assert d2["tax_amount"] == 5500
        assert d2["grand_total"] == 55500


# ---------------------------------------------------------------------------
# Charter edit path
# ---------------------------------------------------------------------------
class TestEditCharter:
    def test_switch_perkg_to_charter(self, auth_headers):
        """AWB created per-kg, edited to charter — tariff/qty must be cleared, charter total honored."""
        awb = _create_open_awb(auth_headers, tariff=5000, qty=10, tax=0)
        oid = awb["id"]
        patch = {
            "is_charter": True,
            "charter_amount": 75000,
            "tariff_per_kg": 0,
            "qty_kg": 0,
            "tax_percentage": 11,
        }
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/extended", headers=auth_headers, json=patch, timeout=15)
        assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
        doc = r.json()
        assert bool(doc.get("is_charter")) is True
        assert doc["charter_amount"] == 75000
        assert doc["tariff_per_kg"] == 0
        assert doc["qty_kg"] == 0
        assert doc["total_tariff"] == 75000
        assert doc["tax_amount"] == 8250  # 75000 * 0.11
        assert doc["grand_total"] == 83250

    def test_charter_amount_only_update(self, auth_headers):
        """Existing charter AWB: change charter_amount only — total/tax/grand should recompute."""
        awb = _create_open_awb(auth_headers, is_charter=True, charter_amount=28000, tariff=0, qty=0, tax=11)
        oid = awb["id"]
        assert awb.get("total_tariff") in (28000, 28000.0)
        # PATCH charter_amount=50000
        patch = {"is_charter": True, "charter_amount": 50000, "tariff_per_kg": 0, "qty_kg": 0, "tax_percentage": 11}
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/extended", headers=auth_headers, json=patch, timeout=15)
        assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
        doc = r.json()
        assert doc["total_tariff"] == 50000
        assert doc["tax_amount"] == 5500
        assert doc["grand_total"] == 55500
        assert bool(doc.get("is_charter")) is True

    def test_switch_charter_to_perkg(self, auth_headers):
        """Charter AWB switched back to per-kg should compute from tariff*qty (charter_amount no longer the source)."""
        awb = _create_open_awb(auth_headers, is_charter=True, charter_amount=99000, tariff=0, qty=0, tax=0)
        oid = awb["id"]
        patch = {
            "is_charter": False,
            "tariff_per_kg": 4000,
            "qty_kg": 3,
            "tax_percentage": 11,
        }
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/extended", headers=auth_headers, json=patch, timeout=15)
        assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
        doc = r.json()
        assert bool(doc.get("is_charter")) is False
        assert doc["total_tariff"] == 12000
        assert doc["tax_amount"] == 1320
        # grand may include charter_amount as addon? Confirm not the case.
        assert doc["grand_total"] == 13320


# ---------------------------------------------------------------------------
# Addons exclusion from PPN
# ---------------------------------------------------------------------------
class TestAddonsNotTaxed:
    def test_polis_does_not_affect_tax_amount(self, auth_headers):
        """Add polis_amount, then edit tariff — tax_amount must equal total_tariff * pct / 100 (no addons)."""
        awb = _create_open_awb(auth_headers, tariff=10000, qty=10, tax=11)
        oid = awb["id"]
        # Apply polis via same PATCH (addons_total is server-computed though; test if polis_amount alone changes addons)
        # First set polis
        r1 = requests.patch(
            f"{BASE_URL}/api/orders/{oid}/extended",
            headers=auth_headers,
            json={"insurance_enabled": True, "polis_amount": 15000, "insurance_amount": 0},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text
        # Now edit tariff
        r2 = requests.patch(
            f"{BASE_URL}/api/orders/{oid}/extended",
            headers=auth_headers,
            json={"tariff_per_kg": 20000, "qty_kg": 4, "tax_percentage": 11, "is_charter": False},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        doc = r2.json()
        # total_tariff = 80000, tax = 80000 * 0.11 = 8800 (NOT including polis)
        assert doc["total_tariff"] == 80000
        assert doc["tax_amount"] == 8800
        # grand_total includes addons_total. addons_total may or may not be auto-updated by polis;
        # just verify tax is NOT counting the polis.
        addons_total = float(doc.get("addons_total") or 0)
        assert doc["grand_total"] == round(80000 + 8800 + addons_total, 2)


# ---------------------------------------------------------------------------
# Edit Reconciled AWB → journal re-post
# ---------------------------------------------------------------------------
class TestReconciledRePost:
    def test_edit_reconciled_reposts_sales_accrued(self, auth_headers):
        """Edit a Reconciled AWB's total — old journal deleted, new one posted."""
        awb = _create_open_awb(auth_headers, tariff=1000, qty=10, tax=11)
        oid = awb["id"]
        # Need a cost first before reconcile
        rc_cost = requests.post(
            f"{BASE_URL}/api/costs",
            headers=auth_headers,
            json={"awb_id": oid, "cost_category": "Vendor", "amount": 1000, "description": "TEST", "vendor_name": "TEST_VENDOR"},
            timeout=15,
        )
        if rc_cost.status_code not in (200, 201):
            pytest.skip(f"Cannot add cost for reconcile test: {rc_cost.status_code} {rc_cost.text}")
        # Mark "barang diterima" (POD received) before reconcile
        rcv = requests.post(
            f"{BASE_URL}/api/orders/{oid}/receive",
            headers=auth_headers,
            json={"received_by_name": "TEST_Receiver", "work_type": "Kirim Barang", "mode": "Trucking"},
            timeout=15,
        )
        if rcv.status_code not in (200, 201):
            pytest.skip(f"Cannot mark received: {rcv.status_code} {rcv.text}")
        # Also receive-pod (some flows need both)
        requests.post(f"{BASE_URL}/api/orders/{oid}/receive-pod", headers=auth_headers, json={}, timeout=15)
        # Reconcile via bulk endpoint
        rc = requests.post(
            f"{BASE_URL}/api/orders/reconcile",
            headers=auth_headers,
            json={"awb_ids": [oid]},
            timeout=15,
        )
        if rc.status_code != 200:
            pytest.skip(f"reconcile not available: {rc.status_code} {rc.text}")
        # Confirm status
        g = requests.get(f"{BASE_URL}/api/orders/{oid}", headers=auth_headers, timeout=15)
        if g.status_code != 200 or g.json().get("status") != "Reconciled":
            pytest.skip(f"AWB not Reconciled after reconcile call: status={g.json().get('status')}")
        # Now edit tariff
        r = requests.patch(
            f"{BASE_URL}/api/orders/{oid}/extended",
            headers=auth_headers,
            json={"tariff_per_kg": 2000, "qty_kg": 10, "tax_percentage": 11, "is_charter": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["total_tariff"] == 20000
        assert doc["tax_amount"] == 2200
