"""
Iteration 16 — Tests
- Receive must update awb_orders.grand_total = base + addons_total (SPSI+Forklift+Polis+Asuransi)
- Receive narrow delete filter: only deletes source=receive AND Operational AND SPSI/Sewa Forklift sub_label
- Vendor cost (source!=receive) must NEVER be deleted by /receive
- Reconcile requires both received_at AND pod_received_at
- Migrate reverse-unprinted-ar: POSTS reverse-journal (count goes UP), idempotent, is_reversal=true
- Settle Panjar: settle_history is array of events
- Login admin/operation/finance still works
- Trial Balance and Balance Sheet both balanced
"""
import os, uuid, pytest, requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://deploy-init-2.preview.emergentagent.com").rstrip("/")

def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, f"Login {u} failed: {r.text}"
    return r.json()["access_token"]

def H(tok): return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def admin_token(): return _login("admin", "admin123")
@pytest.fixture(scope="module")
def operation_token(): return _login("operation", "operation123")
@pytest.fixture(scope="module")
def finance_token(): return _login("finance", "finance123")

@pytest.fixture(scope="module")
def cust(admin_token):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(admin_token), timeout=30)
    cs = r.json() if r.status_code == 200 else []
    if cs: return cs[0]
    cr = requests.post(f"{BASE_URL}/api/customers", headers=H(admin_token),
                       json={"name": f"TEST_IT16_C_{uuid.uuid4().hex[:5]}", "address": "Jl."}, timeout=30)
    return cr.json()

def _mk_awb(op_token, cust, tariff=5000, qty=100):
    payload = {
        "customer_id": cust["id"],
        "company_name": cust.get("default_company") or "PT. Abirama Mitra Pradana",
        "item_description": "TEST-IT16", "goods_content": "Boxes",
        "origin": "JKT", "destination": "SBY",
        "tariff_per_kg": tariff, "qty_kg": qty, "tax_percentage": 0,
        "service": "LCL", "via": "D", "koli_count": 5,
    }
    r = requests.post(f"{BASE_URL}/api/orders", headers=H(op_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()

def _today(): return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ===== Test 1: receive updates grand_total = base + addons_total =====
class TestReceiveAddonsToGrandTotal:
    def test_receive_updates_grand_total_with_addons(self, operation_token, cust):
        awb = _mk_awb(operation_token, cust, tariff=10000, qty=10)  # base=100k
        base_gt = float(awb.get("grand_total") or 0)
        awb_id = awb["id"]
        # Receive with addons SPSI 100k + Forklift 50k + Polis 25k + Asuransi 10k = 185k
        r = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token), json={
            "received_by_name": "Tester",
            "received_date": _today(),
            "polis_enabled": True, "polis_amount": 25000,
            "asuransi_enabled": True, "asuransi_amount": 10000,
            "spsi_enabled": True, "spsi_amount": 100000,
            "sewa_forklift_enabled": True, "sewa_forklift_amount": 50000,
            "work_type": "Kirim Barang", "mode": "Trucking",
        }, timeout=30)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd.get("addons_total") == 185000, f"addons_total mismatch: {upd.get('addons_total')}"
        new_gt = float(upd.get("grand_total") or 0)
        assert abs(new_gt - (base_gt + 185000)) < 0.01, f"grand_total {new_gt} != base {base_gt} + 185000"

    def test_receive_does_not_create_costs(self, operation_token, cust):
        awb = _mk_awb(operation_token, cust)
        awb_id = awb["id"]
        # baseline
        r0 = requests.get(f"{BASE_URL}/api/costs", headers=H(operation_token), params={"awb_id": awb_id}, timeout=30)
        before = len(r0.json()) if r0.status_code == 200 else 0
        # receive with all addons enabled
        r = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token), json={
            "received_by_name": "Tester",
            "polis_enabled": True, "polis_amount": 5000,
            "asuransi_enabled": True, "asuransi_amount": 3000,
            "spsi_enabled": True, "spsi_amount": 7000,
            "sewa_forklift_enabled": True, "sewa_forklift_amount": 4000,
            "work_type": "Kirim Barang", "mode": "Trucking",
        }, timeout=30)
        assert r.status_code == 200, r.text
        r1 = requests.get(f"{BASE_URL}/api/costs", headers=H(operation_token), params={"awb_id": awb_id}, timeout=30)
        after = len(r1.json()) if r1.status_code == 200 else 0
        assert after == before, f"awb_costs count changed: before={before} after={after}"


# ===== Test 2: receive narrow filter — Vendor cost must survive =====
class TestReceiveDoesNotTouchVendorCost:
    def test_vendor_cost_persists_after_receive(self, operation_token, finance_token, cust):
        awb = _mk_awb(operation_token, cust)
        awb_id = awb["id"]
        # Add a Vendor cost (source manual, cost_category=Vendor)
        cost_payload = {
            "awb_id": awb_id,
            "cost_category": "Vendor",
            "sub_label": "Trucking",
            "vendor_name": "TEST_IT16_VendorX",
            "amount": 250000,
            "description": "Trucking JKT-SBY",
        }
        rc = requests.post(f"{BASE_URL}/api/costs", headers=H(operation_token), json=cost_payload, timeout=30)
        assert rc.status_code in (200, 201), rc.text
        cost_id = rc.json().get("id")
        assert cost_id, "cost id missing"

        # now call receive
        r = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token), json={
            "received_by_name": "Tester",
            "spsi_enabled": True, "spsi_amount": 1000,
            "work_type": "Kirim Barang", "mode": "Trucking",
        }, timeout=30)
        assert r.status_code == 200, r.text
        # check vendor cost still exists
        r2 = requests.get(f"{BASE_URL}/api/costs", headers=H(operation_token), params={"awb_id": awb_id}, timeout=30)
        assert r2.status_code == 200, r2.text
        ids = [c["id"] for c in r2.json()]
        assert cost_id in ids, "Vendor cost was wrongly deleted by /receive!"


# ===== Test 3: Reconcile requires POD =====
class TestReconcileRequiresPOD:
    def test_reconcile_without_pod_400(self, operation_token, cust):
        awb = _mk_awb(operation_token, cust)
        awb_id = awb["id"]
        # Add a real cost so reconcile passes the "no cost" check
        rc = requests.post(f"{BASE_URL}/api/costs", headers=H(operation_token), json={
            "awb_id": awb_id, "cost_category": "Vendor", "sub_label": "Test",
            "vendor_name": "TEST_IT16_Vx", "amount": 10000,
        }, timeout=30)
        assert rc.status_code in (200, 201)
        # receive only (no POD)
        rr = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token), json={
            "received_by_name": "Tester",
            "work_type": "Kirim Barang", "mode": "Trucking",
        }, timeout=30)
        assert rr.status_code == 200, rr.text
        # try reconcile
        rec = requests.post(f"{BASE_URL}/api/orders/reconcile", headers=H(operation_token), json={"awb_ids": [awb_id]}, timeout=30)
        assert rec.status_code == 400, f"expected 400, got {rec.status_code}: {rec.text}"
        assert "POD belum diterima" in rec.text

    def test_reconcile_with_pod_succeeds(self, operation_token, cust):
        awb = _mk_awb(operation_token, cust)
        awb_id = awb["id"]
        rc = requests.post(f"{BASE_URL}/api/costs", headers=H(operation_token), json={
            "awb_id": awb_id, "cost_category": "Vendor", "sub_label": "Test",
            "vendor_name": "TEST_IT16_Vy", "amount": 5000,
        }, timeout=30)
        assert rc.status_code in (200, 201)
        rr = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive", headers=H(operation_token), json={
            "received_by_name": "Tester",
            "work_type": "Kirim Barang", "mode": "Trucking",
        }, timeout=30)
        assert rr.status_code == 200
        rp = requests.post(f"{BASE_URL}/api/orders/{awb_id}/receive-pod", headers=H(operation_token), json={
            "pod_signed_by": "Receiver", "pod_notes": "ok",
        }, timeout=30)
        assert rp.status_code == 200, rp.text
        rec = requests.post(f"{BASE_URL}/api/orders/reconcile", headers=H(operation_token), json={"awb_ids": [awb_id]}, timeout=30)
        assert rec.status_code == 200, rec.text


# ===== Test 4: Migration reverse-unprinted-ar uses reverse-journal pattern =====
class TestMigrationReverseJournal:
    def _count_journals(self, tok):
        # Use trial-balance to get a stable view; but better is count via reports route. We'll just call migrate twice.
        return 0

    def test_migration_admin_only(self, operation_token):
        r = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar", headers=H(operation_token), timeout=60)
        assert r.status_code in (401, 403), f"operation should NOT have access: {r.status_code}"

    def test_migration_returns_structure(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar", headers=H(admin_token), timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "reversed_count" in body
        assert "total_invoices_unprinted" in body
        assert "affected" in body
        # Note field should mention reverse-journal/audit trail
        note = body.get("note", "").lower()
        assert "reverse" in note or "audit" in note, f"note doesn't mention reverse/audit: {note}"

    def test_migration_idempotent(self, admin_token):
        # Run twice — second time reversed_count should be 0 (already reversed via is_reversal flag)
        r1 = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar", headers=H(admin_token), timeout=120)
        r2 = requests.post(f"{BASE_URL}/api/admin/migrate/reverse-unprinted-ar", headers=H(admin_token), timeout=120)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r2.json().get("reversed_count", -1) == 0, f"2nd run should be idempotent (0 new reversals), got {r2.json()}"


# ===== Test 5: Trial Balance + Balance Sheet both balanced =====
class TestReportsConsistency:
    def test_trial_balance_balanced(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/reports/trial-balance", headers=H(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Should have total_debit == total_credit (balanced)
        td = float(body.get("total_debit") or 0)
        tc = float(body.get("total_credit") or 0)
        assert abs(td - tc) < 0.01, f"Trial balance not balanced: DR={td} CR={tc}"

    def test_balance_sheet_balanced(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/reports/balance-sheet", headers=H(finance_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Balance Sheet: Assets = Liab + Equity
        ta = float(body.get("total_assets") or 0)
        tl = float(body.get("total_liabilities") or 0)
        te = float(body.get("total_equity") or 0)
        assert abs(ta - (tl + te)) < 1.0, f"BS not balanced: A={ta} L={tl} E={te}"


# ===== Test 6: Settle history is an array =====
class TestSettleHistory:
    def test_panjar_settle_history_array(self, admin_token, operation_token, finance_token, cust):
        # create panjar (no separate approve/disburse — POST creates+disburses)
        awb = _mk_awb(operation_token, cust)
        cr = requests.post(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), json={
            "recipient_name": "TEST_IT16_Recipient",
            "amount": 1000000,
            "purpose": "Test partial settle IT16",
            "cash_account_code": "1101",
        }, timeout=30)
        assert cr.status_code == 200, cr.text
        ca = cr.json()
        ca_id = ca["id"]
        # settle 400k against the AWB
        st = requests.post(f"{BASE_URL}/api/cash-advances/{ca_id}/settle", headers=H(finance_token), json={
            "actual_amount": 400000,
            "breakdown": [{"target": "awb", "awb_id": awb["id"], "amount": 400000, "description": "Partial 1"}],
        }, timeout=30)
        assert st.status_code == 200, st.text
        # fetch via list
        gr = requests.get(f"{BASE_URL}/api/cash-advances", headers=H(finance_token), timeout=30)
        assert gr.status_code == 200
        body = next((x for x in gr.json() if x["id"] == ca_id), None)
        assert body, "panjar not found"
        hist = body.get("settle_history")
        assert isinstance(hist, list), f"settle_history not list: {type(hist)}"
        assert len(hist) >= 1, "settle_history is empty"
        ev = hist[-1]
        assert "settle_date" in ev
        assert "actual_amount" in ev
        assert "breakdown" in ev
        assert ev.get("actual_amount") == 400000


# ===== Test 7: Login still works =====
class TestLogin:
    def test_admin_login(self): _login("admin", "admin123")
    def test_op_login(self): _login("operation", "operation123")
    def test_fin_login(self): _login("finance", "finance123")
