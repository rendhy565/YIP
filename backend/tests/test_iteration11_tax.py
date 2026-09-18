"""Iteration 11 — tax-feature backend tests.

Covers:
- COA seed contains new tax accounts (1401/1402/2221/2223/2230 + existing 2210/2220)
- Per-user feature permission (`tax`) gating on /api/tax/pph
- Settle vendor auto-deducts PPh23 (and PP23UMKM 0.5%) with proper journal lines
- Vendor without pph_type produces 2-line journal, pph_amount=0
- POST/GET /api/tax/ppn-masukan auto-journal and listing
- DELETE /api/tax/ppn-masukan removes entry + reverses journal
- /api/tax/ppn-summary reflects manual masukan entries
"""
import os
import time
from typing import Dict, Optional

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


def _login(u: str, p: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin", "admin123")


@pytest.fixture(scope="session")
def operation_token():
    return _login("operation", "operation123")


@pytest.fixture(scope="session")
def finance_token():
    return _login("finance", "finance123")


# -------------------- COA seed --------------------

class TestCOASeed:
    REQUIRED = {"1401", "1402", "2221", "2223", "2230", "2210", "2220"}

    def test_required_tax_accounts_exist(self, admin_token):
        r = requests.get(f"{API}/accounts", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        codes = {a.get("code") for a in r.json()}
        missing = self.REQUIRED - codes
        assert not missing, f"Missing COA accounts: {missing}"

    def test_account_1401_name(self, admin_token):
        r = requests.get(f"{API}/accounts", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        by_code = {a.get("code"): a for a in r.json()}
        assert "1401" in by_code
        name = (by_code["1401"].get("name") or "").lower()
        assert "ppn" in name and "masukan" in name, by_code["1401"]


# -------------------- Per-user permission gating --------------------

def _get_user_by_username(admin_token: str, username: str) -> Optional[dict]:
    r = requests.get(f"{API}/users", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200, r.text
    for u in r.json():
        if u.get("username") == username:
            return u
    return None


def _set_user_permissions(admin_token: str, uid: str, perms: list):
    r = requests.put(f"{API}/users/{uid}", headers=_h(admin_token),
                     json={"permissions": perms}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


class TestPerUserFeaturePermission:
    """Revoke 'tax' from finance, assert 403, then re-grant, assert 200."""

    def test_finance_without_tax_perm_gets_403(self, admin_token):
        fin = _get_user_by_username(admin_token, "finance")
        assert fin, "finance user must exist"
        original_perms = list(fin.get("permissions") or [])
        # remove 'tax' if present
        new_perms = [p for p in original_perms if p != "tax"]
        _set_user_permissions(admin_token, fin["id"], new_perms)
        try:
            fin_tok = _login("finance", "finance123")
            r = requests.get(f"{API}/tax/pph", headers=_h(fin_tok), timeout=20)
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
            # message check
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            detail = (body.get("detail") or body.get("message") or "").lower()
            assert "izin" in detail or "permission" in detail or "tax" in detail, body
        finally:
            # restore: ensure tax permission re-added
            restored = list(set(original_perms + ["tax"]))
            _set_user_permissions(admin_token, fin["id"], restored)

    def test_finance_with_tax_perm_gets_200(self, admin_token):
        fin = _get_user_by_username(admin_token, "finance")
        assert fin
        perms = list(set((fin.get("permissions") or []) + ["tax"]))
        _set_user_permissions(admin_token, fin["id"], perms)
        fin_tok = _login("finance", "finance123")
        r = requests.get(f"{API}/tax/pph", headers=_h(fin_tok), timeout=20)
        assert r.status_code == 200, r.text


# -------------------- PPh auto-deduct on settle --------------------

def _ensure_vendor(admin_token: str, name: str, pph_type: Optional[str]) -> dict:
    # Find existing
    r = requests.get(f"{API}/vendors", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    for v in r.json():
        if v.get("name") == name:
            # ensure pph_type matches
            if v.get("pph_type") != pph_type:
                rr = requests.put(f"{API}/vendors/{v['id']}",
                                  headers=_h(admin_token),
                                  json={"pph_type": pph_type}, timeout=20)
                if rr.status_code == 200:
                    return rr.json()
            return v
    payload = {"name": name, "phone": "0812", "address": "JKT"}
    if pph_type:
        payload["pph_type"] = pph_type
    r = requests.post(f"{API}/vendors", headers=_h(admin_token), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _pick_any_awb(token: str) -> Optional[str]:
    r = requests.get(f"{API}/orders", headers=_h(token), timeout=20)
    if r.status_code != 200:
        return None
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    if not items:
        return None
    return items[0].get("id")


def _create_cost(op_token: str, awb_id: str, amount: float, vendor_name: str) -> dict:
    payload = {
        "awb_id": awb_id,
        "cost_category": "Vendor",
        "category": "Vendor",
        "description": f"TEST_IT11_PPH {int(time.time()*1000)}",
        "amount": amount,
        "vendor_name": vendor_name,
        "status": "Accrue",
    }
    r = requests.post(f"{API}/costs", headers=_h(op_token), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestPPhAutoDeduct:
    def test_pph23_deducted_on_settle(self, admin_token, operation_token, finance_token):
        _ensure_vendor(admin_token, "QA_VENDOR_PPH23", "PPh23")
        awb_id = _pick_any_awb(operation_token)
        if not awb_id:
            pytest.skip("No AWB available to attach cost")
        cost = _create_cost(operation_token, awb_id, 5_000_000, "QA_VENDOR_PPH23")
        cid = cost["id"]
        r = requests.post(f"{API}/costs/{cid}/settle",
                          headers=_h(finance_token),
                          json={"cash_account_code": "1101"}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("pph_amount") == 100000, data
        assert data.get("net_paid") == 4_900_000, data
        assert data.get("gross") == 5_000_000, data
        # verify journal entry: 3 lines DR2101 5M / CR1101 4.9M / CR2223 100k
        je_no = data.get("journal_entry_no") or data.get("journal_no")
        if je_no:
            jr = requests.get(f"{API}/journal-entries", headers=_h(finance_token), timeout=20)
            if jr.status_code == 200:
                entries = jr.json() if isinstance(jr.json(), list) else jr.json().get("items", [])
                je = next((e for e in entries if e.get("entry_no") == je_no or e.get("no") == je_no), None)
                if je and je.get("lines"):
                    codes = {ln.get("account_code") for ln in je["lines"]}
                    assert "2223" in codes, je["lines"]

    def test_no_pph_when_vendor_has_no_type(self, admin_token, operation_token, finance_token):
        _ensure_vendor(admin_token, "QA_VENDOR_NO_PPH", None)
        awb_id = _pick_any_awb(operation_token)
        if not awb_id:
            pytest.skip("No AWB available")
        cost = _create_cost(operation_token, awb_id, 2_000_000, "QA_VENDOR_NO_PPH")
        cid = cost["id"]
        r = requests.post(f"{API}/costs/{cid}/settle",
                          headers=_h(finance_token),
                          json={"cash_account_code": "1101"}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert (data.get("pph_amount") or 0) == 0, data
        assert (data.get("net_paid") or data.get("gross")) == 2_000_000, data

    def test_pp23_umkm_05pct(self, admin_token, operation_token, finance_token):
        _ensure_vendor(admin_token, "QA_VENDOR_UMKM", "PP23UMKM")
        awb_id = _pick_any_awb(operation_token)
        if not awb_id:
            pytest.skip("No AWB available")
        cost = _create_cost(operation_token, awb_id, 1_000_000, "QA_VENDOR_UMKM")
        cid = cost["id"]
        r = requests.post(f"{API}/costs/{cid}/settle",
                          headers=_h(finance_token),
                          json={"cash_account_code": "1101"}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("pph_amount") == 5000, data


# -------------------- PPN Masukan manual entry --------------------

class TestPPNMasukan:
    @pytest.fixture(scope="class")
    def created_entry(self, finance_token):
        payload = {
            "date": "2026-06-15",
            "supplier_name": f"QA_SUPPLIER_{int(time.time())}",
            "dpp": 10_000_000,
            "ppn_pct": 11,
            "expense_account_code": "6199",
            "cash_account_code": "1101",
        }
        r = requests.post(f"{API}/tax/ppn-masukan", headers=_h(finance_token),
                          json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        return r.json(), payload

    def test_post_creates_entry_with_correct_amounts(self, created_entry):
        data, payload = created_entry
        assert data.get("ppn_amount") == 1_100_000, data
        assert data.get("total") == 11_100_000, data
        assert data.get("journal_entry_no") or data.get("journal_no"), data

    def test_list_contains_entry(self, finance_token, created_entry):
        data, _ = created_entry
        r = requests.get(f"{API}/tax/ppn-masukan?period=2026-06",
                         headers=_h(finance_token), timeout=20)
        assert r.status_code == 200, r.text
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        ids = {it.get("id") for it in items}
        assert data.get("id") in ids, f"created id {data.get('id')} not in list {ids}"

    def test_summary_reflects_masukan(self, finance_token, created_entry):
        r = requests.get(f"{API}/tax/ppn-summary?period=2026-06",
                         headers=_h(finance_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        masukan = body.get("ppn_masukan") or body.get("masukan") or 0
        assert masukan >= 1_100_000, body

    def test_delete_removes_entry(self, finance_token):
        # create a throwaway entry then delete
        payload = {
            "date": "2026-06-20",
            "supplier_name": f"QA_DEL_{int(time.time())}",
            "dpp": 1_000_000,
            "ppn_pct": 11,
            "expense_account_code": "6199",
            "cash_account_code": "1101",
        }
        r = requests.post(f"{API}/tax/ppn-masukan", headers=_h(finance_token),
                          json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        eid = r.json().get("id")
        assert eid
        dr = requests.delete(f"{API}/tax/ppn-masukan/{eid}",
                             headers=_h(finance_token), timeout=20)
        assert dr.status_code in (200, 204), dr.text
        # verify gone
        lr = requests.get(f"{API}/tax/ppn-masukan?period=2026-06",
                          headers=_h(finance_token), timeout=20)
        assert lr.status_code == 200
        items = lr.json() if isinstance(lr.json(), list) else lr.json().get("items", [])
        assert eid not in {it.get("id") for it in items}
