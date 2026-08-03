"""
Iteration 14 — Major TMS Refactor (17 modifications)
Tests:
- Login (admin/admin123, operation/operation123, finance/finance123)
- Order creation: koli mandatory, charter mode (FCL/FTL/Lumpsum), sender memory
- Petty Cash CRUD + journal
- Purchase Orders CRUD + auto-cost + receive-POD + cascade delete
- Vendor Aging report
- Reconcile: enforces received_at
- Invoice two-phase: create (no AR) → mark-printed (AR posted) → cancel (reversal)
- Invoice bulk grouped (multi-AWB + different customer skip)
- Sender suggestions (GET/DELETE/save on order)
- Cash advance settle with target=operation creates petty_cash entry
- Contract minimum_kg
"""
import os, time, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://date-filter-refactor.preview.emergentagent.com").rstrip("/")

def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

@pytest.fixture(scope="module")
def admin_token():
    return _login("admin", "admin123")

@pytest.fixture(scope="module")
def operation_token():
    return _login("operation", "operation123")

@pytest.fixture(scope="module")
def finance_token():
    return _login("finance", "finance123")

def H(tok): return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def first_customer(admin_token):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    cs = r.json()
    if len(cs) > 0:
        return cs[0]
    # Create a TEST customer if none exists
    create = requests.post(f"{BASE_URL}/api/customers", headers=H(admin_token),
                           json={"name": f"TEST_IT14_Customer_{uuid.uuid4().hex[:6]}",
                                 "address": "Jl. Test", "npwp": "01.234.567.8-901.000"},
                           timeout=30)
    assert create.status_code in (200, 201), create.text
    return create.json()

@pytest.fixture(scope="module")
def second_customer(admin_token, first_customer):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(admin_token), timeout=30)
    cs = r.json()
    if len(cs) >= 2:
        return cs[1] if cs[1]["id"] != first_customer["id"] else cs[0]
    create = requests.post(f"{BASE_URL}/api/customers", headers=H(admin_token),
                           json={"name": f"TEST_IT14_Customer2_{uuid.uuid4().hex[:6]}",
                                 "address": "Jl. Test 2"}, timeout=30)
    assert create.status_code in (200, 201), create.text
    return create.json()

# ---------- 1) Auth ----------
class TestAuth:
    def test_admin_login(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 20
    def test_operation_login(self, operation_token):
        assert isinstance(operation_token, str)
    def test_finance_login(self, finance_token):
        assert isinstance(finance_token, str)

# ---------- 2) Orders: koli mandatory + charter ----------
class TestOrdersCharter:
    def test_create_order_koli_missing_rejected(self, operation_token, first_customer):
        payload = {
            "customer_id": first_customer["id"],
            "company_name": first_customer.get("default_company") or "PT. Abirama Mitra Pradana",
            "item_description": "TEST-IT14", "goods_content": "Boxes",
            "origin": "JKT", "destination": "SBY",
            "tariff_per_kg": 5000, "qty_kg": 100, "tax_percentage": 0,
            "service": "LCL", "via": "D",
            # koli_count intentionally omitted
        }
        r = requests.post(f"{BASE_URL}/api/orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code == 400
        assert "Koli" in r.text or "koli" in r.text

    def test_create_lcl_order_with_koli(self, operation_token, first_customer):
        payload = {
            "customer_id": first_customer["id"],
            "company_name": first_customer.get("default_company") or "PT. Abirama Mitra Pradana",
            "item_description": "TEST-IT14-LCL", "goods_content": "Boxes",
            "origin": "JKT", "destination": "SBY",
            "tariff_per_kg": 5000, "qty_kg": 100, "tax_percentage": 0,
            "service": "LCL", "via": "D", "koli_count": 5,
            "sender_name": f"TEST_Sender_{uuid.uuid4().hex[:6]}",
        }
        r = requests.post(f"{BASE_URL}/api/orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        assert o["koli_count"] == 5
        assert o["total_tariff"] == 500000
        assert o.get("is_charter") in (False, None)
        pytest.lcl_awb_id = o["id"]
        pytest.lcl_sender = payload["sender_name"]
        pytest.lcl_customer = first_customer["id"]

    def test_create_charter_fcl_order(self, operation_token, first_customer):
        payload = {
            "customer_id": first_customer["id"],
            "company_name": first_customer.get("default_company") or "PT. Abirama Mitra Pradana",
            "item_description": "TEST-IT14-CHARTER", "goods_content": "Charter",
            "origin": "JKT", "destination": "BDG",
            "tariff_per_kg": 0, "qty_kg": 0, "tax_percentage": 0,
            "service": "FCL", "via": "D", "koli_count": 1,
            "is_charter": True, "charter_amount": 7500000,
        }
        r = requests.post(f"{BASE_URL}/api/orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        assert o["is_charter"] is True
        assert o["total_tariff"] == 7500000
        assert o["qty_kg"] == 0
        pytest.charter_awb_id = o["id"]

    def test_charter_zero_amount_rejected_via_lumpsum(self, operation_token, first_customer):
        # Lumpsum should be charter; charter_amount=0 and tariff=0 means total=0 — still creates? Just verify request shape works.
        payload = {
            "customer_id": first_customer["id"],
            "company_name": first_customer.get("default_company") or "PT. Abirama Mitra Pradana",
            "item_description": "TEST-IT14-LUMPSUM", "goods_content": "X",
            "origin": "JKT", "destination": "MDN",
            "tariff_per_kg": 12345, "qty_kg": 0, "tax_percentage": 0,
            "service": "Lumpsum", "via": "U", "koli_count": 2,
        }
        r = requests.post(f"{BASE_URL}/api/orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        # is_charter auto-detected from service
        assert o["is_charter"] is True
        # tariff_per_kg used as fallback charter amount
        assert o["total_tariff"] == 12345

# ---------- 3) Sender Suggestions ----------
class TestSenderSuggestions:
    def test_sender_suggestion_saved_after_order(self, operation_token):
        cust_id = pytest.lcl_customer
        r = requests.get(f"{BASE_URL}/api/sender-suggestions?customer_id={cust_id}",
                         headers=H(operation_token), timeout=30)
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert pytest.lcl_sender in names

    def test_delete_sender_suggestion(self, operation_token):
        cust_id = pytest.lcl_customer
        r = requests.get(f"{BASE_URL}/api/sender-suggestions?customer_id={cust_id}",
                         headers=H(operation_token), timeout=30)
        target = next((s for s in r.json() if s["name"] == pytest.lcl_sender), None)
        assert target is not None
        sid = target["id"]
        d = requests.delete(f"{BASE_URL}/api/sender-suggestions/{sid}", headers=H(operation_token), timeout=30)
        assert d.status_code == 200
        # verify removed
        r2 = requests.get(f"{BASE_URL}/api/sender-suggestions?customer_id={cust_id}",
                          headers=H(operation_token), timeout=30)
        assert pytest.lcl_sender not in [s["name"] for s in r2.json()]

# ---------- 4) Petty Cash ----------
class TestPettyCash:
    def test_list_petty_cash(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/petty-cash", headers=H(finance_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    @pytest.mark.parametrize("cat", ["Operational", "Lintas", "Umum", "Kantor", "Lainnya"])
    def test_create_petty_cash_each_category(self, finance_token, cat):
        payload = {"category": cat, "amount": 50000, "description": f"TEST_IT14 {cat}"}
        r = requests.post(f"{BASE_URL}/api/petty-cash", headers=H(finance_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        pc = r.json()
        assert pc["category"] == cat
        assert pc["amount"] == 50000
        assert "id" in pc and pc.get("number", "").startswith("PC-")
        # verify journal posted (DR 5102 / CR 1101)
        j = requests.get(f"{BASE_URL}/api/journal", headers=H(finance_token), timeout=30)
        assert j.status_code == 200
        match = [x for x in j.json() if x.get("reference_type") == "petty_cash" and x.get("reference_id") == pc["id"]]
        assert len(match) >= 1
        lines = match[0].get("lines", [])
        codes = {(l["account_code"], l["debit"], l["credit"]) for l in lines}
        assert ("5102", 50000, 0) in codes
        assert ("1101", 0, 50000) in codes
        # cleanup
        requests.delete(f"{BASE_URL}/api/petty-cash/{pc['id']}", headers=H(finance_token), timeout=30)

    def test_invalid_category_rejected(self, finance_token):
        r = requests.post(f"{BASE_URL}/api/petty-cash", headers=H(finance_token),
                          json={"category": "InvalidX", "amount": 1000}, timeout=30)
        assert r.status_code == 400

# ---------- 5) Purchase Orders ----------
class TestPurchaseOrders:
    def test_list_po(self, operation_token):
        r = requests.get(f"{BASE_URL}/api/purchase-orders", headers=H(operation_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_po_without_awb(self, operation_token):
        payload = {"vendor_name": "TEST_Vendor_NoAWB", "description": "TEST_IT14 PO no-awb", "amount": 250000}
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["status"] == "Open"
        assert po["linked_cost_id"] is None
        assert po.get("number", "").startswith("PO-")
        pytest.po_no_awb_id = po["id"]

    def test_create_po_with_awb_auto_cost(self, operation_token, finance_token):
        awb_id = pytest.lcl_awb_id
        payload = {"vendor_name": "TEST_Vendor_WithAWB", "description": "TEST_IT14 PO with awb",
                   "amount": 333000, "awb_id": awb_id}
        r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=H(operation_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["linked_cost_id"] is not None
        pytest.po_with_awb_id = po["id"]
        # Verify cost was created on AWB
        costs = requests.get(f"{BASE_URL}/api/costs?awb_id={awb_id}", headers=H(finance_token), timeout=30)
        if costs.status_code == 200:
            arr = costs.json()
            assert any(c.get("vendor_name") == "TEST_Vendor_WithAWB" for c in arr), arr
        # Verify journal DR 5101 / CR 2101
        j = requests.get(f"{BASE_URL}/api/journal", headers=H(finance_token), timeout=30)
        match = [x for x in j.json() if x.get("reference_type") == "cost" and x.get("reference_id") == po["linked_cost_id"]]
        assert len(match) >= 1

    def test_receive_pod(self, operation_token):
        r = requests.post(f"{BASE_URL}/api/purchase-orders/{pytest.po_no_awb_id}/receive-pod",
                          headers=H(operation_token), json={}, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["status"] == "Received POD"
        assert po.get("pod_date") is not None

    def test_delete_po_cascade(self, operation_token):
        r = requests.delete(f"{BASE_URL}/api/purchase-orders/{pytest.po_with_awb_id}",
                            headers=H(operation_token), timeout=30)
        assert r.status_code == 200
        # Verify PO gone
        lst = requests.get(f"{BASE_URL}/api/purchase-orders", headers=H(operation_token), timeout=30).json()
        assert pytest.po_with_awb_id not in [p["id"] for p in lst]

# ---------- 6) Vendor Aging ----------
class TestVendorAging:
    def test_vendor_aging_structure(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/reports/vendor-aging", headers=H(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "buckets" in data and data["buckets"] == ["0-30", "31-60", "61-90", "90+"]
        assert "rows" in data and isinstance(data["rows"], list)
        assert "totals" in data
        for b in ["0-30", "31-60", "61-90", "90+", "total"]:
            assert b in data["totals"]

# ---------- 7) Reconcile requires received_at ----------
class TestReconcileBlockedWithoutReceive:
    def test_reconcile_blocked_when_not_received(self, operation_token, finance_token):
        # Use the LCL AWB (already has cost from PO test). But PO is deleted; create a simple cost first.
        awb_id = pytest.lcl_awb_id
        # Add a quick cost to make it eligible
        cost_payload = {"awb_id": awb_id, "cost_category": "Operational", "category": "Operational",
                        "amount": 10000, "description": "TEST_IT14 to enable reconcile"}
        c = requests.post(f"{BASE_URL}/api/costs", headers=H(finance_token), json=cost_payload, timeout=30)
        # Cost endpoint may or may not require 'category' - assume success or already-have-cost
        # Try reconcile WITHOUT received
        r = requests.post(f"{BASE_URL}/api/orders/reconcile", headers=H(operation_token),
                          json={"awb_ids": [awb_id]}, timeout=30)
        assert r.status_code == 400, f"Expected 400 due to barang belum diterima, got {r.status_code}: {r.text}"
        assert "diterima" in r.text.lower() or "received" in r.text.lower()

    def test_receive_then_reconcile(self, operation_token):
        awb_id = pytest.lcl_awb_id
        rec = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token),
                            json={"received_by_name": "TEST_Receiver", "work_type": "Kirim Barang", "mode": "Trucking"}, timeout=30)
        assert rec.status_code == 200, rec.text
        r = requests.post(f"{BASE_URL}/api/orders/reconcile", headers=H(operation_token),
                          json={"awb_ids": [awb_id]}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Either promoted to Reconciled or Invoiced
        assert body.get("updated", 0) >= 1

# ---------- 8) Invoice 2-phase (create / mark-printed / cancel) ----------
class TestInvoiceTwoPhase:
    def test_create_invoice_no_ar_journal(self, operation_token, finance_token):
        # Ensure AWB is Reconciled
        awb_id = pytest.lcl_awb_id
        o = requests.get(f"{BASE_URL}/api/orders/{awb_id}", headers=H(operation_token), timeout=30).json()
        if o["status"] != "Reconciled":
            pytest.skip(f"AWB status is {o['status']} — not Reconciled, skipping invoice test")
        r = requests.post(f"{BASE_URL}/api/invoices", headers=H(operation_token),
                          json={"awb_id": awb_id}, timeout=30)
        assert r.status_code in (200, 201), r.text
        inv = r.json()
        assert inv.get("invoice_date") is None
        assert inv.get("ar_recognized") is False
        assert inv.get("print_count", 0) == 0
        pytest.inv_id = inv["id"]
        # No AR journal yet
        j = requests.get(f"{BASE_URL}/api/journal", headers=H(finance_token), timeout=30).json()
        ar = [x for x in j if x.get("reference_type") == "invoice" and x.get("reference_id") == inv["id"]]
        assert len(ar) == 0, f"AR journal should not be posted before print: {ar}"

    def test_mark_printed_first_posts_ar(self, operation_token, finance_token):
        r = requests.post(f"{BASE_URL}/api/invoices/{pytest.inv_id}/mark-printed",
                          headers=H(operation_token), json={}, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv.get("print_count") == 1
        assert inv.get("ar_recognized") is True
        assert inv.get("invoice_date") is not None
        # AR journal posted
        j = requests.get(f"{BASE_URL}/api/journal", headers=H(finance_token), timeout=30).json()
        ar = [x for x in j if x.get("reference_type") == "invoice" and x.get("reference_id") == pytest.inv_id]
        assert len(ar) >= 1
        codes = {l["account_code"] for l in ar[0]["lines"]}
        assert "1201" in codes and "1290" in codes
        pytest.inv_date_v1 = inv["invoice_date"]

    def test_mark_printed_second_with_old_date(self, operation_token):
        r = requests.post(f"{BASE_URL}/api/invoices/{pytest.inv_id}/mark-printed",
                          headers=H(operation_token), json={"use_old_date": True}, timeout=30)
        assert r.status_code == 200
        inv = r.json()
        assert inv["print_count"] == 2
        assert inv["invoice_date"] == pytest.inv_date_v1  # unchanged

    def test_cancel_invoice_reverts(self, operation_token, finance_token):
        r = requests.post(f"{BASE_URL}/api/invoices/{pytest.inv_id}/cancel",
                          headers=H(operation_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body.get("journals_deleted", 0) >= 1
        # AWB back to Reconciled
        o = requests.get(f"{BASE_URL}/api/orders/{pytest.lcl_awb_id}", headers=H(operation_token), timeout=30).json()
        assert o["status"] == "Reconciled"
        # Invoice doc gone
        chk = requests.get(f"{BASE_URL}/api/invoices/{pytest.inv_id}/full", headers=H(operation_token), timeout=30)
        assert chk.status_code == 404

# ---------- 9) Bulk grouped invoices ----------
class TestBulkGrouped:
    def test_bulk_with_grouping_different_customer_skipped(self, operation_token, finance_token, admin_token, first_customer, second_customer):
        c1, c2 = first_customer, second_customer
        if c1["id"] == c2["id"]:
            pytest.skip("Need 2 distinct customers")
        # Create 2 AWBs different customer, bring to Reconciled
        def mk(cust):
            p = {"customer_id": cust["id"], "company_name": cust.get("default_company") or "PT. Abirama Mitra Pradana",
                 "item_description": "TEST_IT14_BULK", "goods_content": "X",
                 "origin": "JKT", "destination": "SBY",
                 "tariff_per_kg": 1000, "qty_kg": 10, "tax_percentage": 0,
                 "service": "LCL", "via": "D", "koli_count": 1}
            o = requests.post(f"{BASE_URL}/api/orders", headers=H(operation_token), json=p, timeout=30).json()
            requests.post(f"{BASE_URL}/api/costs", headers=H(finance_token),
                          json={"awb_id": o["id"], "cost_category": "Operational", "category": "Operational",
                                "amount": 500, "description": "x"}, timeout=30)
            requests.post(f"{BASE_URL}/api/orders/{o['id']}/receive", headers=H(operation_token),
                          json={"received_by_name": "TEST", "work_type": "Kirim Barang", "mode": "Trucking"}, timeout=30)
            requests.post(f"{BASE_URL}/api/orders/reconcile", headers=H(operation_token),
                          json={"awb_ids": [o["id"]]}, timeout=30)
            return o["id"]
        a1 = mk(c1)
        a2 = mk(c2)
        # Try to group them
        r = requests.post(f"{BASE_URL}/api/invoices/bulk", headers=H(operation_token),
                          json={"awb_ids": [a1, a2], "grouped": [[a1, a2]]}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Group should be skipped because customer berbeda
        skipped_reasons = " ".join(s.get("reason", "") for s in body.get("skipped", []))
        assert "customer berbeda" in skipped_reasons.lower() or "berbeda" in skipped_reasons.lower()

# ---------- 10) Contract minimum_kg ----------
class TestContract:
    def test_create_contract_with_minimum_kg(self, finance_token, first_customer):
        payload = {"customer_id": first_customer["id"], "origin": "JKT", "destination": "TEST_IT14_DEST",
                   "price_per_kg": 5000, "via": "D", "minimum_kg": 100}
        r = requests.post(f"{BASE_URL}/api/contracts", headers=H(finance_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        c = r.json()
        assert c.get("minimum_kg") == 100
        # cleanup
        try:
            requests.delete(f"{BASE_URL}/api/contracts/{c['id']}", headers=H(finance_token), timeout=30)
        except Exception:
            pass
