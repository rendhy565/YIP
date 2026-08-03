"""Iteration 17 — PO / Surat Perintah Vendor multi-item refactor tests."""
import os
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://date-filter-refactor.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sample_awb(headers):
    """Pick any AWB available (create one if none)."""
    r = requests.get(f"{BASE_URL}/api/orders", headers=headers, timeout=30)
    assert r.status_code == 200
    orders = r.json()
    if orders:
        return orders[0]
    # Create
    cr = requests.get(f"{BASE_URL}/api/customers", headers=headers, timeout=30).json()
    if not cr:
        cust = requests.post(f"{BASE_URL}/api/customers", headers=headers,
                             json={"name": "TEST_PO_CUST"}, timeout=30).json()
        cust_id = cust["id"]
    else:
        cust_id = cr[0]["id"]
    payload = {
        "customer_id": cust_id, "item_description": "Test item", "goods_content": "GC",
        "origin": "CGK", "destination": "DPS", "tariff_per_kg": 1000, "qty_kg": 10, "tax_percentage": 0,
        "koli_count": 1,
    }
    r = requests.post(f"{BASE_URL}/api/orders", headers=headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# -------------------- POST validations --------------------
class TestPOCreateValidation:
    def test_empty_items_rejected(self, headers):
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers,
                          json={"vendor_name": "TEST_Vendor", "items": []}, timeout=30)
        assert r.status_code == 400
        assert "Minimal 1 baris item" in r.json().get("detail", "")

    def test_missing_origin(self, headers):
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json={
            "vendor_name": "TEST_Vendor",
            "items": [{"origin": "", "destination": "DPS"}],
        }, timeout=30)
        assert r.status_code == 400

    def test_missing_destination(self, headers):
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json={
            "vendor_name": "TEST_Vendor",
            "items": [{"origin": "CGK", "destination": ""}],
        }, timeout=30)
        assert r.status_code == 400


# -------------------- Create + cost auto-creation --------------------
class TestPOCreateAndCost:
    def test_create_with_awb_and_harga_creates_cost(self, headers, sample_awb):
        payload = {
            "vendor_name": "TEST_PO_Vendor_A",
            "items": [{
                "origin": "CGK", "destination": "DPS", "armada": "Truk", "item_description": "Box",
                "qty": 5, "harga": 250000, "awb_id": sample_awb["id"],
            }],
        }
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["items"][0]["linked_cost_id"]
        cost_id = po["items"][0]["linked_cost_id"]
        # Verify cost exists with proper attrs
        cs = requests.get(f"{BASE_URL}/api/costs", headers=headers,
                          params={"awb_id": sample_awb["id"]}, timeout=30).json()
        match = [c for c in cs if c["id"] == cost_id]
        assert len(match) == 1
        cost = match[0]
        assert cost["cost_category"] == "Vendor"
        assert cost["payment_type"] == "Accrue"
        assert cost["amount"] == 250000
        assert cost["vendor_name"] == "TEST_PO_Vendor_A"
        assert cost.get("source") == "purchase_order"
        assert cost.get("source_ref") == po["id"]
        # Cleanup
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_create_with_harga_no_awb_no_cost(self, headers):
        payload = {
            "vendor_name": "TEST_PO_Vendor_B",
            "items": [{"origin": "CGK", "destination": "SUB", "harga": 100000}],
        }
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["items"][0]["linked_cost_id"] is None
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_create_with_awb_no_harga_no_cost(self, headers, sample_awb):
        payload = {
            "vendor_name": "TEST_PO_Vendor_C",
            "items": [{"origin": "CGK", "destination": "SUB", "awb_id": sample_awb["id"]}],
        }
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["items"][0]["linked_cost_id"] is None
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)


# -------------------- GET list --------------------
class TestPOList:
    def test_list_aggregates_totals(self, headers, sample_awb):
        payload = {
            "vendor_name": "TEST_LIST_V",
            "items": [
                {"origin": "A", "destination": "B", "harga": 100000, "qty": 1},
                {"origin": "C", "destination": "D", "harga": 50000, "qty": 2, "awb_id": sample_awb["id"]},
            ],
        }
        cr = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json=payload, timeout=30)
        assert cr.status_code == 200
        pid = cr.json()["id"]
        lst = requests.get(f"{BASE_URL}/api/purchase-orders", headers=headers, timeout=30).json()
        target = next((p for p in lst if p["id"] == pid), None)
        assert target is not None
        assert target["item_count"] == 2
        assert target["total_amount"] == 150000
        # AWB number populated for item with awb_id
        items_with_awb = [it for it in target["items"] if it.get("awb_id")]
        assert items_with_awb[0].get("awb_number")
        requests.delete(f"{BASE_URL}/api/purchase-orders/{pid}", headers=headers, timeout=30)


# -------------------- PATCH --------------------
class TestPOPatch:
    def _create(self, headers, items):
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers,
                          json={"vendor_name": "TEST_PATCH_V", "items": items}, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_patch_invalid_idx(self, headers):
        po = self._create(headers, [{"origin": "A", "destination": "B"}])
        r = requests.patch(f"{BASE_URL}/api/purchase-orders/{po['id']}/items/99", headers=headers,
                           json={"origin": "X", "destination": "Y"}, timeout=30)
        assert r.status_code == 400
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_patch_add_harga_and_awb_creates_cost(self, headers, sample_awb):
        po = self._create(headers, [{"origin": "A", "destination": "B"}])
        r = requests.patch(f"{BASE_URL}/api/purchase-orders/{po['id']}/items/0", headers=headers, json={
            "origin": "A", "destination": "B", "harga": 75000, "awb_id": sample_awb["id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["items"][0]["linked_cost_id"]
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_patch_remove_awb_deletes_cost(self, headers, sample_awb):
        po = self._create(headers, [{"origin": "A", "destination": "B",
                                     "harga": 50000, "awb_id": sample_awb["id"]}])
        assert po["items"][0]["linked_cost_id"]
        cost_id = po["items"][0]["linked_cost_id"]
        r = requests.patch(f"{BASE_URL}/api/purchase-orders/{po['id']}/items/0", headers=headers, json={
            "origin": "A", "destination": "B", "harga": 50000,
        }, timeout=30)
        assert r.status_code == 200
        upd = r.json()
        assert upd["items"][0]["linked_cost_id"] is None
        # Verify cost actually deleted
        cs = requests.get(f"{BASE_URL}/api/costs", headers=headers, timeout=30).json()
        assert not any(c["id"] == cost_id for c in cs)
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_patch_remove_harga_deletes_cost(self, headers, sample_awb):
        po = self._create(headers, [{"origin": "A", "destination": "B",
                                     "harga": 50000, "awb_id": sample_awb["id"]}])
        cost_id = po["items"][0]["linked_cost_id"]
        assert cost_id
        r = requests.patch(f"{BASE_URL}/api/purchase-orders/{po['id']}/items/0", headers=headers, json={
            "origin": "A", "destination": "B", "awb_id": sample_awb["id"],
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["items"][0]["linked_cost_id"] is None
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)

    def test_patch_change_harga_recreates_cost(self, headers, sample_awb):
        po = self._create(headers, [{"origin": "A", "destination": "B",
                                     "harga": 30000, "awb_id": sample_awb["id"]}])
        old_cost = po["items"][0]["linked_cost_id"]
        r = requests.patch(f"{BASE_URL}/api/purchase-orders/{po['id']}/items/0", headers=headers, json={
            "origin": "A", "destination": "B", "harga": 90000, "awb_id": sample_awb["id"],
        }, timeout=30)
        assert r.status_code == 200
        new_cost = r.json()["items"][0]["linked_cost_id"]
        assert new_cost and new_cost != old_cost
        # Validate new amount
        cs = requests.get(f"{BASE_URL}/api/costs", headers=headers, timeout=30).json()
        new_obj = next((c for c in cs if c["id"] == new_cost), None)
        assert new_obj and new_obj["amount"] == 90000
        requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)


# -------------------- DELETE cascade --------------------
class TestPODelete:
    def test_delete_cascades_costs(self, headers, sample_awb):
        cr = requests.post(f"{BASE_URL}/api/purchase-orders", headers=headers, json={
            "vendor_name": "TEST_DEL_V",
            "items": [{"origin": "A", "destination": "B", "harga": 25000, "awb_id": sample_awb["id"]}],
        }, timeout=30)
        po = cr.json()
        cost_id = po["items"][0]["linked_cost_id"]
        assert cost_id
        dr = requests.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", headers=headers, timeout=30)
        assert dr.status_code == 200
        cs = requests.get(f"{BASE_URL}/api/costs", headers=headers, timeout=30).json()
        assert not any(c["id"] == cost_id for c in cs)


# -------------------- Regression: serialize() recursive --------------------
class TestSerializeRegression:
    def test_invoices_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/invoices", headers=headers, timeout=30)
        assert r.status_code == 200

    def test_costs_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/costs", headers=headers, timeout=30)
        assert r.status_code == 200

    def test_panjar_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/panjar", headers=headers, timeout=30)
        # endpoint may or may not exist; accept 200 or 404
        assert r.status_code in (200, 404)

    def test_orders_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/orders", headers=headers, timeout=30)
        assert r.status_code == 200
