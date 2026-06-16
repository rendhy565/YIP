"""Iteration-11 backend regression tests.

Covers:
- ReceiveAwbIn.polis_enabled / asuransi_enabled flags semantics
  * polis_enabled=False -> received_polis_amount = 0 (even if amount sent)
  * polis_enabled=True  -> received_polis_amount = supplied amount
  * Missing polis_enabled key -> defaults to False (backward compat)
- GET /api/invoices/{iid}/full returns extended company fields:
  signer, bank_name, bank_holder, bank_account, logo_b64
"""
import os
import time
from typing import Dict, Tuple

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


def _login(u: str, p: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token() -> str:
    return _login("admin", "admin123")


@pytest.fixture(scope="session")
def operation_token() -> str:
    return _login("operation", "operation123")


@pytest.fixture(scope="session")
def finance_token() -> str:
    return _login("finance", "finance123")


def _h(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def seed_customer(operation_token) -> str:
    r = requests.get(f"{API}/customers", headers=_h(operation_token), timeout=20)
    assert r.status_code == 200
    for c in r.json():
        if c.get("name", "").startswith("TEST_IT11"):
            return c["id"]
    payload = {"name": f"TEST_IT11_CUST_{int(time.time())}", "phone": "0812",
               "address": "Jakarta", "npwp": "", "is_corporate": True}
    r = requests.post(f"{API}/customers", headers=_h(operation_token), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _create_order(op_token: str, cust_id: str, polis: float = 0, asur: float = 0) -> dict:
    payload = {
        "customer_id": cust_id, "item_description": "TEST_IT11",
        "goods_content": "Box", "origin": "Jakarta", "destination": "Surabaya",
        "tariff_per_kg": 1000, "qty_kg": 10, "tax_percentage": 11,
        "company_name": "PT. Abirama Mitra Pradana", "service": "AIR", "via": "U",
        "insurance_enabled": polis > 0 or asur > 0,
        "polis_amount": polis or None, "insurance_amount": asur or None,
    }
    r = requests.post(f"{API}/orders", headers=_h(op_token), json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


# --- Tests --------------------------------------------------------------------

class TestReceiveEnableFlags:
    def test_polis_disabled_zero_even_if_amount_sent(self, operation_token, seed_customer):
        o = _create_order(operation_token, seed_customer)
        oid = o["id"]
        body = {
            "received_by_name": "T_IT11",
            "polis_enabled": False, "polis_amount": 20000,
            "asuransi_enabled": False, "asuransi_amount": 50000,
            "work_type": "Kirim Barang", "mode": "Air",
        }
        r = requests.post(f"{API}/orders/{oid}/receive", headers=_h(operation_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("received_polis_amount") == 0, f"expected 0 polis, got {data.get('received_polis_amount')}"
        assert data.get("received_asuransi_amount") == 0, f"expected 0 asuransi, got {data.get('received_asuransi_amount')}"

    def test_polis_enabled_amount_preserved(self, operation_token, seed_customer):
        o = _create_order(operation_token, seed_customer)
        oid = o["id"]
        body = {
            "received_by_name": "T_IT11",
            "polis_enabled": True, "polis_amount": 20000,
            "asuransi_enabled": True, "asuransi_amount": 50000,
            "work_type": "Kirim Barang", "mode": "Air",
        }
        r = requests.post(f"{API}/orders/{oid}/receive", headers=_h(operation_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("received_polis_amount") == 20000
        assert data.get("received_asuransi_amount") == 50000

    def test_missing_enable_keys_default_false(self, operation_token, seed_customer):
        """Backward-compat: if polis_enabled/asuransi_enabled keys are absent,
        defaults to False so amounts are NOT saved."""
        o = _create_order(operation_token, seed_customer)
        oid = o["id"]
        body = {
            "received_by_name": "T_IT11",
            "polis_amount": 99999,  # should be ignored
            "asuransi_amount": 88888,
            "work_type": "Kirim Barang", "mode": "Air",
        }
        r = requests.post(f"{API}/orders/{oid}/receive", headers=_h(operation_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("received_polis_amount") == 0, data
        assert data.get("received_asuransi_amount") == 0, data

    def test_mixed_polis_on_asuransi_off(self, operation_token, seed_customer):
        o = _create_order(operation_token, seed_customer)
        oid = o["id"]
        body = {
            "received_by_name": "T_IT11",
            "polis_enabled": True, "polis_amount": 12345,
            "asuransi_enabled": False, "asuransi_amount": 99999,
            "work_type": "Kirim Barang", "mode": "Air",
        }
        r = requests.post(f"{API}/orders/{oid}/receive", headers=_h(operation_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("received_polis_amount") == 12345
        assert data.get("received_asuransi_amount") == 0


def _ensure_invoice(op: str, fin: str, cust: str) -> Tuple[str, str]:
    o = _create_order(op, cust, polis=20000, asur=100000)
    oid = o["id"]
    r = requests.post(f"{API}/orders/{oid}/receive", headers=_h(op),
                      json={"received_by_name": "T_IT11",
                            "polis_enabled": True, "polis_amount": 20000,
                            "asuransi_enabled": True, "asuransi_amount": 100000,
                            "spsi_enabled": True, "spsi_amount": 30000,
                            "sewa_forklift_enabled": True, "sewa_forklift_amount": 20000,
                            "work_type": "Kirim Barang", "mode": "Air"}, timeout=20)
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/orders/reconcile", headers=_h(op),
                      json={"awb_ids": [oid]}, timeout=20)
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/invoices", headers=_h(op),
                      json={"awb_id": oid}, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"], oid


class TestInvoiceFullExtendedCompany:
    def test_full_returns_extended_company_fields(self, operation_token, finance_token, admin_token, seed_customer):
        inv_id, _ = _ensure_invoice(operation_token, finance_token, seed_customer)
        r = requests.get(f"{API}/invoices/{inv_id}/full", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "company" in body, body.keys()
        company = body["company"]
        # All extended keys must exist
        for key in ["name", "npwp", "address", "signer", "bank_name", "bank_holder", "bank_account", "logo_b64"]:
            assert key in company, f"company.{key} missing; got keys={list(company.keys())}"
        # bank_name default 'Mandiri' (if no per-issuer setting)
        assert company["bank_name"], "bank_name should be non-empty (default 'Mandiri')"
        # logo_b64 may be empty string but key must be present
        assert isinstance(company["logo_b64"], str)
