"""
Iteration 15 — TMS refactor (7 modifications)
Tests:
- POST /api/orders/{oid}/receive — verify NO awb_costs for SPSI/Forklift/Polis/Asuransi,
  and the values are stored on awb_orders.
- POST /api/orders/{oid}/receive-pod — POD endpoint on AWB level, requires receive first.
- POST /api/purchase-orders/{pid}/receive-pod — REMOVED (404 or 405).
- Partial settle Panjar Kerja — settled_amount, remaining_amount, settle_history, partial→Open.
- Operation target in panjar breakdown — no petty_cash entry created.
- POST /api/admin/migrate/reverse-unprinted-ar — admin only, returns proper structure.
- GET /api/reports/vendor-aging — still works.
- GET /api/exports/vendor-aging — Excel export still works.
"""
import os, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://jni-project-test.preview.emergentagent.com").rstrip("/")

def _login(username, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login {username} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

def H(tok): return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def admin_token():    return _login("admin", "admin123")
@pytest.fixture(scope="module")
def operation_token(): return _login("operation", "operation123")
@pytest.fixture(scope="module")
def finance_token():   return _login("finance", "finance123")

@pytest.fixture(scope="module")
def first_customer(admin_token):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(admin_token), timeout=30)
    assert r.status_code == 200
    cs = r.json()
    if cs:
        return cs[0]
    create = requests.post(f"{BASE_URL}/api/customers", headers=H(admin_token),
                           json={"name": f"TEST_IT15_Customer_{uuid.uuid4().hex[:6]}", "address": "Jl. Test"}, timeout=30)
    assert create.status_code in (200, 201), create.text
    return create.json()

def _create_awb(op_token, cust):
    payload = {
        "customer_id": cust["id"],
        "company_name": cust.get("default_company") or "PT. Abirama Mitra Pradana",
        "item_description": "TEST-IT15", "goods_content": "Boxes",
        "origin": "JKT", "destination": "SBY",
        "tariff_per_kg": 5000, "qty_kg": 100, "tax_percentage": 0,
        "service": "LCL", "via": "D", "koli_count": 5,
    }
    r = requests.post(f"{BASE_URL}/api/orders", headers=H(op_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- 1) Receive: SPSI/Forklift/Polis/Asuransi NO COST ----------
class TestReceiveNoCost:
    def test_receive_does_not_create_costs_for_invoice_addons(self, operation_token, first_customer):
        awb = _create_awb(operation_token, first_customer)
        oid = awb["id"]
        # Trigger receive with SPSI/Forklift/Polis/Asuransi all set
        recv_payload = {
            "received_by_name": "TEST_Recv_User",
            "work_type": "Kirim Barang",
            "mode": "Trucking",
            "polis_enabled": True, "polis_amount": 100000,
            "asuransi_enabled": True, "asuransi_amount": 200000,
            "spsi_enabled": True, "spsi_amount": 50000,
            "sewa_forklift_enabled": True, "sewa_forklift_amount": 75000,
        }
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/receive",
                          headers=H(operation_token), json=recv_payload, timeout=30)
        assert r.status_code == 200, r.text
        updated = r.json()
        # Verify AWB stores fields
        assert updated.get("received_polis_amount") == 100000
        assert updated.get("received_asuransi_amount") == 200000
        assert updated.get("spsi_amount") == 50000
        assert updated.get("sewa_forklift_amount") == 75000
        assert updated.get("received_at") is not None

        # Verify NO awb_costs with source=receive for this AWB
        costs_r = requests.get(f"{BASE_URL}/api/costs?awb_id={oid}",
                               headers=H(operation_token), timeout=30)
        assert costs_r.status_code == 200, costs_r.text
        receive_costs = [c for c in costs_r.json() if c.get("source") == "receive"]
        assert len(receive_costs) == 0, f"Expected 0 receive-sourced costs but found: {receive_costs}"

        # Verify NO journal entry posted during receive for these addons
        j_r = requests.get(f"{BASE_URL}/api/journal", headers=H(operation_token), timeout=30)
        assert j_r.status_code == 200
        # Look for any journal whose description references this AWB and 'penerimaan'
        awb_num = updated["awb_number"]
        bad = [j for j in j_r.json() if awb_num in (j.get("description") or "") and "penerimaan" in (j.get("description") or "").lower()]
        assert len(bad) == 0, f"Expected 0 receive-penerimaan journals but found: {bad}"

        pytest.it15_awb_id = oid
        pytest.it15_awb_number = awb_num


# ---------- 2) POD endpoint on AWB ----------
class TestReceivePod:
    def test_pod_requires_received_first(self, operation_token, first_customer):
        awb = _create_awb(operation_token, first_customer)
        oid = awb["id"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/receive-pod",
                          headers=H(operation_token), json={"pod_date": "2026-01-15"}, timeout=30)
        assert r.status_code == 400, r.text
        assert "belum diterima" in r.text.lower() or "barang" in r.text.lower()

    def test_pod_sets_pod_received_at(self, operation_token):
        oid = pytest.it15_awb_id  # Already received in TestReceiveNoCost
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/receive-pod",
                          headers=H(operation_token),
                          json={"pod_date": "2026-01-20", "pod_signed_by": "John Doe", "pod_notes": "TEST_IT15 POD"},
                          timeout=30)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated.get("pod_received_at") is not None
        assert updated.get("pod_signed_by") == "John Doe"
        assert updated.get("pod_notes") == "TEST_IT15 POD"


# ---------- 3) Old PO POD endpoint REMOVED ----------
class TestPoPodRemoved:
    def test_po_receive_pod_returns_not_found_or_method_not_allowed(self, operation_token):
        # Create a PO
        po_r = requests.post(f"{BASE_URL}/api/purchase-orders", headers=H(operation_token),
                             json={"vendor_name": "TEST_IT15_PO", "description": "PO test", "amount": 100000}, timeout=30)
        assert po_r.status_code == 200, po_r.text
        pid = po_r.json()["id"]
        # Try the removed endpoint
        r = requests.post(f"{BASE_URL}/api/purchase-orders/{pid}/receive-pod",
                          headers=H(operation_token), json={"pod_date": "2026-01-20"}, timeout=30)
        assert r.status_code in (404, 405), f"Expected 404/405 but got {r.status_code}: {r.text}"


# ---------- 4) Partial Settle Panjar ----------
class TestPartialSettlePanjar:
    def test_partial_settle_flow(self, finance_token, operation_token, first_customer):
        # Create panjar 1,000,000
        ca_payload = {
            "recipient_name": "TEST_IT15_Recipient",
            "amount": 1000000,
            "purpose": "TEST IT15 Partial Settle",
            "cash_account_code": "1101",
        }
        c = requests.post(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), json=ca_payload, timeout=30)
        assert c.status_code == 200, c.text
        ca = c.json()
        cid = ca["id"]

        # Create an AWB to settle against
        awb = _create_awb(operation_token, first_customer)

        # 1st partial settle: 400,000 (target=awb)
        s1 = requests.post(
            f"{BASE_URL}/api/cash-advances/{cid}/settle",
            headers=H(finance_token),
            json={
                "actual_amount": 400000,
                "breakdown": [{"target": "awb", "awb_id": awb["id"], "amount": 400000, "description": "Partial 1"}],
            }, timeout=30
        )
        assert s1.status_code == 200, s1.text
        d1 = s1.json()
        # Refetch — no single-id endpoint; fetch the list
        g1 = requests.get(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), timeout=30)
        assert g1.status_code == 200
        c1 = next((x for x in g1.json() if x["id"] == cid), None)
        assert c1, f"Cash advance {cid} not found in list"
        assert c1["status"] == "Open", f"Expected Open after partial, got {c1['status']}"
        assert c1["settled_amount"] == 400000
        assert c1["remaining_amount"] == 600000

        # 2nd settle: 600,000 — should close
        s2 = requests.post(
            f"{BASE_URL}/api/cash-advances/{cid}/settle",
            headers=H(finance_token),
            json={
                "actual_amount": 600000,
                "breakdown": [{"target": "awb", "awb_id": awb["id"], "amount": 600000, "description": "Partial 2"}],
            }, timeout=30
        )
        assert s2.status_code == 200, s2.text
        g2 = requests.get(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), timeout=30)
        c2 = next((x for x in g2.json() if x["id"] == cid), None)
        assert c2, "cash advance not found after 2nd settle"
        assert c2["status"] == "Settled"
        assert c2["settled_amount"] == 1000000
        assert c2["remaining_amount"] == 0
        # history should have 2 events
        assert len(c2.get("settle_history") or []) >= 2

    def test_partial_settle_over_amount_rejected(self, finance_token, operation_token, first_customer):
        ca_payload = {
            "recipient_name": "TEST_IT15_Over",
            "amount": 1000000,
            "purpose": "TEST IT15 over-amount",
            "cash_account_code": "1101",
        }
        c = requests.post(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), json=ca_payload, timeout=30)
        assert c.status_code == 200, c.text
        cid = c.json()["id"]
        awb = _create_awb(operation_token, first_customer)
        s = requests.post(
            f"{BASE_URL}/api/cash-advances/{cid}/settle",
            headers=H(finance_token),
            json={
                "actual_amount": 1500000,
                "breakdown": [{"target": "awb", "awb_id": awb["id"], "amount": 1500000}],
            }, timeout=30
        )
        assert s.status_code == 400, s.text
        assert "melebihi" in s.text.lower()

    def test_operation_target_no_petty_cash_entry(self, finance_token):
        ca = requests.post(f"{BASE_URL}/api/cash-advances", headers=H(finance_token),
                           json={"recipient_name": "TEST_IT15_OpsOnly", "amount": 200000,
                                 "purpose": "TEST IT15 ops target", "cash_account_code": "1101"}, timeout=30).json()
        cid = ca["id"]

        # Get petty-cash count BEFORE settle
        pc_before = requests.get(f"{BASE_URL}/api/petty-cash", headers=H(finance_token), timeout=30).json()
        before_count = len(pc_before)

        s = requests.post(
            f"{BASE_URL}/api/cash-advances/{cid}/settle",
            headers=H(finance_token),
            json={
                "actual_amount": 200000,
                "breakdown": [{"target": "operation", "amount": 200000, "description": "TEST_IT15 ops-direct"}],
            }, timeout=30
        )
        assert s.status_code == 200, s.text

        # No new petty_cash entry should be created
        pc_after = requests.get(f"{BASE_URL}/api/petty-cash", headers=H(finance_token), timeout=30).json()
        assert len(pc_after) == before_count, "Operation target should NOT create petty_cash entries"

        # Verify journal still posted DR 5102 / CR 1108 (cash advance accrual)
        j_all = requests.get(f"{BASE_URL}/api/journal", headers=H(finance_token), timeout=30).json()
        related = [j for j in j_all if j.get("reference_type") == "cash_advance_settle" and j.get("reference_id") == cid]
        assert len(related) >= 1, "Expected at least one settle journal"
        # Verify lines include 5102 DR and 1108 CR
        lines = related[0].get("lines", [])
        has_5102_dr = any(l.get("account_code") == "5102" and (l.get("debit") or 0) > 0 for l in lines)
        has_1108_cr = any(l.get("account_code") == "1108" and (l.get("credit") or 0) > 0 for l in lines)
        assert has_5102_dr, f"Expected DR 5102 in {lines}"
        assert has_1108_cr, f"Expected CR 1108 in {lines}"


# ---------- 5) Migrate reverse-unprinted-ar ----------
class TestMigrateReverseUnprintedAr:
    def test_endpoint_exists_admin_only(self, admin_token, operation_token):
        # Non-admin should be rejected
        r_op = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar",
                             headers=H(operation_token), timeout=60)
        assert r_op.status_code in (401, 403), f"operation should not access admin endpoint, got {r_op.status_code}"
        # Admin OK
        r = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar",
                          headers=H(admin_token), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "reversed_count" in data
        assert "total_invoices_unprinted" in data
        assert "affected" in data
        assert isinstance(data["affected"], list)


# ---------- 6) Vendor aging report + Excel export ----------
class TestVendorAging:
    def test_vendor_aging_report(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/reports/vendor-aging", headers=H(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "buckets" in d
        assert "rows" in d
        assert "totals" in d

    def test_vendor_aging_excel_export(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/exports/vendor-aging", headers=H(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        # Should return Excel content-type
        ct = r.headers.get("content-type", "")
        assert "spreadsheet" in ct or "excel" in ct or "octet-stream" in ct, f"Unexpected content-type: {ct}"
        assert len(r.content) > 100  # non-empty file


# ---------- 7) Auth ----------
class TestAuth:
    def test_admin_login(self, admin_token): assert len(admin_token) > 20
    def test_operation_login(self, operation_token): assert len(operation_token) > 20
    def test_finance_login(self, finance_token): assert len(finance_token) > 20
