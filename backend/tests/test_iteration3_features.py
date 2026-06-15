"""
Iteration-3 backend tests for ARC (TMS) — covers:
  - New Input Order fields (manual AWB uniqueness, auto-gen, pickup_date, status_pengiriman, etc.)
  - Tax options must include 0/1/11/12
  - Contract via=D/L/U persistence
  - Reconcile requires AWB has at least 1 cost (skipped_no_cost)
  - Marketing cost (5104) – journal Dr 5104 / Cr 1101
  - PATCH /api/orders/{id}/extended recalc + status guard + AWB uniqueness
  - Bulk invoice creation
  - Mark paid w/ payment_invoice_number + paid_date
  - Bulk mark paid
  - Cash advance (Panjar Kerja) create / settle / delete RBAC
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, f"login {u}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_tok(): return _login("admin", "admin123")


@pytest.fixture(scope="session")
def op_tok(): return _login("operation", "operation123")


@pytest.fixture(scope="session")
def fin_tok(): return _login("finance", "finance123")


@pytest.fixture(scope="session")
def first_customer(op_tok):
    r = requests.get(f"{API}/customers", headers=H(op_tok), timeout=20)
    assert r.status_code == 200
    customers = r.json()
    if customers:
        return customers[0]
    # Auto-create a TEST customer when DB has none (fresh env)
    rc = requests.post(f"{API}/customers",
                       json={"name": f"TEST_Customer_{uuid.uuid4().hex[:6]}",
                             "address": "Jakarta"},
                       headers=H(op_tok), timeout=20)
    assert rc.status_code == 200, rc.text
    return rc.json()


# ---------- 1. Tax options ----------
class TestTaxOptions:
    def test_includes_0_1_11_12(self, op_tok):
        r = requests.get(f"{API}/settings/tax-options", headers=H(op_tok), timeout=20)
        assert r.status_code == 200
        vals = {d["value"] for d in r.json()}
        for need in (0.0, 1.0, 11.0, 12.0):
            assert need in vals, f"PPN {need}% missing from {vals}"


# ---------- 2. Contracts with via ----------
class TestContractVia:
    def test_create_with_via_persists(self, op_tok, first_customer):
        payload = {
            "customer_id": first_customer["id"],
            "origin": "JAKARTA",
            "destination": f"TEST_DEST_{uuid.uuid4().hex[:6]}",
            "price_per_kg": 5000,
            "via": "L",
        }
        r = requests.post(f"{API}/contracts", json=payload, headers=H(op_tok), timeout=20)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # via persisted in GET
        r2 = requests.get(f"{API}/contracts", headers=H(op_tok), timeout=20)
        contracts = r2.json()
        match = next((c for c in contracts if c["id"] == cid), None)
        assert match is not None
        assert match.get("via") == "L"


# ---------- 3. Orders – new fields ----------
class TestOrderNewFields:
    def test_create_with_manual_awb_and_unique_violation(self, op_tok, first_customer):
        awb_no = f"TEST-AWB-{uuid.uuid4().hex[:8].upper()}"
        body = {
            "customer_id": first_customer["id"],
            "item_description": "Test Item",
            "goods_content": "Electronics",
            "origin": "JKT",
            "destination": "SBY",
            "tariff_per_kg": 10000,
            "qty_kg": 5,
            "tax_percentage": 11,
            "awb_number": awb_no,
            "reff_no": "REF-001",
            "company_name": "PT. Abirama Mitra Pradana",
            "pickup_date": "2026-01-10",
            "consignee": "Penerima A",
            "service": "FCL",
            "via": "D",
            "status_pengiriman": "Reguler",
            "koli_count": 3,
            "koli_qty_per": "10kg",
            "armada": "CDD",
            "driver_name": "Budi",
            "nopol": "B 1234 ABC",
            "insurance_enabled": True,
            "insurance_policy": "POL-1",
            "insurance_amount": 1000000,
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["awb_number"] == awb_no
        assert o["reff_no"] == "REF-001"
        assert o["company_name"] == "PT. Abirama Mitra Pradana"
        assert o["consignee"] == "Penerima A"
        assert o["service"] == "FCL"
        assert o["via"] == "D"
        assert o["status_pengiriman"] == "Reguler"
        assert o["koli_count"] == 3
        assert o["koli_qty_per"] == "10kg"
        assert o["armada"] == "CDD"
        assert o["driver_name"] == "Budi"
        assert o["nopol"] == "B 1234 ABC"
        assert o["insurance_enabled"] is True
        assert o["insurance_policy"] == "POL-1"
        assert o["insurance_amount"] == 1000000
        assert o["total_tariff"] == 50000
        assert o["tax_amount"] == 5500
        assert o["grand_total"] == 55500
        assert "2026-01-10" in o["created_at"]
        # Duplicate AWB should be rejected
        r2 = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        assert r2.status_code == 400, f"expected 400 got {r2.status_code} {r2.text}"

    def test_auto_awb_when_omitted(self, op_tok, first_customer):
        body = {
            "customer_id": first_customer["id"],
            "item_description": "Auto AWB Item",
            "goods_content": "Box",
            "origin": "JKT",
            "destination": "DPS",
            "tariff_per_kg": 8000,
            "qty_kg": 2,
            "tax_percentage": 11,
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["awb_number"].startswith("AWB-")

    def test_status_pengiriman_empty_not_persisted(self, op_tok, first_customer):
        body = {
            "customer_id": first_customer["id"],
            "item_description": "x",
            "goods_content": "x",
            "origin": "A",
            "destination": "B",
            "tariff_per_kg": 1000,
            "qty_kg": 1,
            "tax_percentage": 0,
            "status_pengiriman": "",
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o.get("status_pengiriman") in (None, "", False)
        assert o["status_pengiriman"] is None or o["status_pengiriman"] == ""


# ---------- 4. Marketing cost ----------
class TestMarketingCost:
    def test_create_marketing_cost_admin(self, admin_tok, op_tok, first_customer):
        # Need an open AWB
        body = {
            "customer_id": first_customer["id"],
            "item_description": "Mkt Cost Order",
            "goods_content": "x",
            "origin": "JKT", "destination": "BDG",
            "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0,
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        assert r.status_code == 200
        awb_id = r.json()["id"]
        # Marketing cost as admin
        cost_body = {
            "awb_id": awb_id,
            "cost_category": "Marketing",
            "amount": 250000,
            "description": "TEST_Marketing campaign",
        }
        rc = requests.post(f"{API}/costs", json=cost_body, headers=H(admin_tok), timeout=20)
        assert rc.status_code == 200, rc.text
        cost = rc.json()
        assert cost["cost_category"] == "Marketing"
        assert cost["amount"] == 250000
        assert cost.get("payment_type") == "Cash"

    def test_marketing_cost_blocked_for_operation(self, op_tok, first_customer):
        body = {
            "customer_id": first_customer["id"], "item_description": "x", "goods_content": "x",
            "origin": "A", "destination": "B", "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0,
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        awb_id = r.json()["id"]
        rc = requests.post(f"{API}/costs", json={
            "awb_id": awb_id, "cost_category": "Marketing", "amount": 100000,
        }, headers=H(op_tok), timeout=20)
        assert rc.status_code == 403


# ---------- 5. Reconcile rules ----------
class TestReconcile:
    def test_reconcile_requires_cost(self, op_tok, admin_tok, first_customer):
        # Order WITHOUT cost
        body = {
            "customer_id": first_customer["id"], "item_description": "no-cost",
            "goods_content": "x", "origin": "A", "destination": "B",
            "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0,
        }
        r_no = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        no_cost_id = r_no.json()["id"]
        # Order WITH cost
        r_yes = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        with_cost_id = r_yes.json()["id"]
        cc = requests.post(f"{API}/costs", json={
            "awb_id": with_cost_id, "cost_category": "Vendor", "amount": 100000, "vendor_name": "V1",
        }, headers=H(op_tok), timeout=20)
        assert cc.status_code == 200, cc.text

        # Reconcile both
        rr = requests.post(f"{API}/orders/reconcile", json={"awb_ids": [no_cost_id, with_cost_id]},
                           headers=H(op_tok), timeout=20)
        assert rr.status_code == 200, rr.text
        body_j = rr.json()
        assert body_j["skipped_no_cost"] == 1
        assert body_j["updated"] == 1

        # Verify statuses
        g1 = requests.get(f"{API}/orders/{no_cost_id}", headers=H(op_tok), timeout=20).json()
        g2 = requests.get(f"{API}/orders/{with_cost_id}", headers=H(op_tok), timeout=20).json()
        assert g1["status"] == "Open"
        assert g2["status"] == "Reconciled"

    def test_reconcile_all_no_cost_returns_400(self, op_tok, first_customer):
        body = {
            "customer_id": first_customer["id"], "item_description": "no-cost-2",
            "goods_content": "x", "origin": "A", "destination": "B",
            "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0,
        }
        r = requests.post(f"{API}/orders", json=body, headers=H(op_tok), timeout=20)
        oid = r.json()["id"]
        rr = requests.post(f"{API}/orders/reconcile", json={"awb_ids": [oid]},
                           headers=H(op_tok), timeout=20)
        assert rr.status_code == 400


# ---------- 6. Patch extended ----------
class TestPatchExtended:
    def test_patch_open_recalc_and_uniqueness(self, op_tok, first_customer):
        # Create awb #1
        b1 = {"customer_id": first_customer["id"], "item_description": "p1", "goods_content": "x",
              "origin": "A", "destination": "B", "tariff_per_kg": 1000, "qty_kg": 5, "tax_percentage": 11}
        r1 = requests.post(f"{API}/orders", json=b1, headers=H(op_tok), timeout=20)
        a1 = r1.json()
        # Create awb #2
        manual_awb = f"TEST-UNIQ-{uuid.uuid4().hex[:6].upper()}"
        b2 = dict(b1, awb_number=manual_awb)
        r2 = requests.post(f"{API}/orders", json=b2, headers=H(op_tok), timeout=20)
        a2 = r2.json()
        # Patch a1: change tariff/qty -> recalc + new fields
        new_awb = f"TEST-PATCH-{uuid.uuid4().hex[:6].upper()}"
        p = requests.patch(f"{API}/orders/{a1['id']}/extended", headers=H(op_tok), timeout=20, json={
            "awb_number": new_awb,
            "reff_no": "REF-PATCH",
            "tariff_per_kg": 2000, "qty_kg": 10, "tax_percentage": 11,
            "pickup_date": "2026-02-01",
            "service": "AIR", "via": "U",
            "consignee": "Penerima B",
        })
        assert p.status_code == 200, p.text
        d = p.json()
        assert d["awb_number"] == new_awb
        assert d["reff_no"] == "REF-PATCH"
        assert d["total_tariff"] == 20000
        assert d["tax_amount"] == 2200
        assert d["grand_total"] == 22200
        assert d["service"] == "AIR"
        assert d["via"] == "U"
        assert "2026-02-01" in d["created_at"]
        # Uniqueness: patch a2 to a1's number should 400
        p2 = requests.patch(f"{API}/orders/{a2['id']}/extended", headers=H(op_tok), timeout=20,
                            json={"awb_number": new_awb})
        assert p2.status_code == 400

    def test_patch_non_open_forbidden_for_non_admin(self, op_tok, admin_tok, first_customer):
        b = {"customer_id": first_customer["id"], "item_description": "p3", "goods_content": "x",
             "origin": "A", "destination": "B", "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 11}
        r = requests.post(f"{API}/orders", json=b, headers=H(op_tok), timeout=20)
        oid = r.json()["id"]
        # Add cost + reconcile
        requests.post(f"{API}/costs", json={"awb_id": oid, "cost_category": "Vendor",
                                            "amount": 50000, "vendor_name": "V"},
                      headers=H(op_tok), timeout=20)
        requests.post(f"{API}/orders/reconcile", json={"awb_ids": [oid]},
                      headers=H(op_tok), timeout=20)
        # Non-admin patch on Reconciled -> 403
        p = requests.patch(f"{API}/orders/{oid}/extended", headers=H(op_tok), timeout=20,
                           json={"consignee": "Shouldnt work"})
        assert p.status_code == 403
        # Admin can still patch
        pa = requests.patch(f"{API}/orders/{oid}/extended", headers=H(admin_tok), timeout=20,
                            json={"consignee": "Admin OK"})
        assert pa.status_code == 200, pa.text
        assert pa.json()["consignee"] == "Admin OK"


# ---------- 7. Bulk invoice ----------
class TestBulkInvoice:
    def test_bulk_invoice_counts(self, op_tok, first_customer):
        # Create 2 AWBs, add cost, reconcile both
        ids = []
        for _ in range(2):
            b = {"customer_id": first_customer["id"], "item_description": "binv", "goods_content": "x",
                 "origin": "A", "destination": "B", "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0}
            r = requests.post(f"{API}/orders", json=b, headers=H(op_tok), timeout=20)
            oid = r.json()["id"]
            requests.post(f"{API}/costs", json={"awb_id": oid, "cost_category": "Vendor",
                                                "amount": 100, "vendor_name": "V"},
                          headers=H(op_tok), timeout=20)
            ids.append(oid)
        rr = requests.post(f"{API}/orders/reconcile", json={"awb_ids": ids},
                           headers=H(op_tok), timeout=20)
        assert rr.status_code == 200
        # Plus an Open AWB that should be skipped
        b_open = {"customer_id": first_customer["id"], "item_description": "skip", "goods_content": "x",
                  "origin": "A", "destination": "B", "tariff_per_kg": 1000, "qty_kg": 1, "tax_percentage": 0}
        r_open = requests.post(f"{API}/orders", json=b_open, headers=H(op_tok), timeout=20)
        open_id = r_open.json()["id"]

        ri = requests.post(f"{API}/invoices/bulk",
                           json={"awb_ids": ids + [open_id]},
                           headers=H(op_tok), timeout=20)
        assert ri.status_code == 200, ri.text
        d = ri.json()
        assert d["created_count"] == 2
        assert d["skipped_count"] == 1
        # Save first id for the mark-paid test
        TestBulkInvoice.invoiced_ids = ids


# ---------- 8. Mark paid + bulk ----------
class TestPaid:
    def _make_invoiced_awb(self, op_tok, customer):
        b = {"customer_id": customer["id"], "item_description": "pay", "goods_content": "x",
             "origin": "A", "destination": "B", "tariff_per_kg": 5000, "qty_kg": 2, "tax_percentage": 11}
        r = requests.post(f"{API}/orders", json=b, headers=H(op_tok), timeout=20)
        oid = r.json()["id"]
        requests.post(f"{API}/costs",
                      json={"awb_id": oid, "cost_category": "Vendor", "amount": 100, "vendor_name": "V"},
                      headers=H(op_tok), timeout=20)
        requests.post(f"{API}/orders/reconcile", json={"awb_ids": [oid]},
                      headers=H(op_tok), timeout=20)
        rr = requests.post(f"{API}/invoices", json={"awb_id": oid},
                           headers=H(op_tok), timeout=20)
        assert rr.status_code == 200, rr.text
        return oid

    def test_mark_paid_with_invoice_number_and_date(self, op_tok, fin_tok, first_customer):
        oid = self._make_invoiced_awb(op_tok, first_customer)
        rp = requests.post(f"{API}/orders/{oid}/mark-paid",
                           json={"payment_invoice_number": "INV-CUST-001", "paid_date": "2026-01-15"},
                           headers=H(fin_tok), timeout=20)
        assert rp.status_code == 200, rp.text
        # Verify saved
        g = requests.get(f"{API}/orders/{oid}", headers=H(fin_tok), timeout=20).json()
        assert g["status"] == "Paid"
        assert g["payment_invoice_number"] == "INV-CUST-001"
        assert "2026-01-15" in g["paid_at"]

    def test_bulk_mark_paid(self, op_tok, fin_tok, first_customer):
        ids = [self._make_invoiced_awb(op_tok, first_customer) for _ in range(2)]
        rp = requests.post(f"{API}/payments/bulk-mark-paid",
                           json={"awb_ids": ids,
                                 "payment_invoice_number": "INV-CUST-BULK-001",
                                 "paid_date": "2026-01-20"},
                           headers=H(fin_tok), timeout=20)
        assert rp.status_code == 200, rp.text
        d = rp.json()
        assert d["paid_count"] == 2
        assert d["skipped_count"] == 0
        # Verify one
        g = requests.get(f"{API}/orders/{ids[0]}", headers=H(fin_tok), timeout=20).json()
        assert g["status"] == "Paid"
        assert g["payment_invoice_number"] == "INV-CUST-BULK-001"
        assert "2026-01-20" in g["paid_at"]


# ---------- 9. Cash Advance (Panjar Kerja) ----------
class TestCashAdvance:
    created_id = None

    def test_create_advance(self, fin_tok):
        body = {
            "recipient_name": "TEST_Driver A",
            "purpose": "BBM & toll",
            "amount": 500000,
            "advance_date": "2026-01-05",
        }
        r = requests.post(f"{API}/cash-advances", json=body, headers=H(fin_tok), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "Open"
        assert d["amount"] == 500000
        assert d["recipient_name"] == "TEST_Driver A"
        assert d["number"].startswith("PNJ-")
        TestCashAdvance.created_id = d["id"]

    def test_list_includes_created(self, fin_tok):
        r = requests.get(f"{API}/cash-advances", headers=H(fin_tok), timeout=20)
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert TestCashAdvance.created_id in ids

    def test_settle_advance(self, fin_tok):
        cid = TestCashAdvance.created_id
        r = requests.post(f"{API}/cash-advances/{cid}/settle",
                          json={"actual_amount": 450000, "refund_amount": 50000,
                                "settle_date": "2026-01-10"},
                          headers=H(fin_tok), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "Settled"
        assert d["actual_amount"] == 450000
        assert d["refund_amount"] == 50000

    def test_delete_non_admin_forbidden(self, fin_tok):
        # Create a fresh one for delete tests
        body = {"recipient_name": "TEST_DelDriver", "amount": 100000}
        r = requests.post(f"{API}/cash-advances", json=body, headers=H(fin_tok), timeout=20)
        cid = r.json()["id"]
        # finance attempt
        rd = requests.delete(f"{API}/cash-advances/{cid}", headers=H(fin_tok), timeout=20)
        assert rd.status_code == 403

    def test_delete_admin_ok(self, fin_tok, admin_tok):
        body = {"recipient_name": "TEST_DelDriver2", "amount": 100000}
        r = requests.post(f"{API}/cash-advances", json=body, headers=H(fin_tok), timeout=20)
        cid = r.json()["id"]
        rd = requests.delete(f"{API}/cash-advances/{cid}", headers=H(admin_tok), timeout=20)
        assert rd.status_code == 200
