"""Iteration 31: PPh21 opt-in per employee (pph21_active flag)."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

PERIOD = "2026-07"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def abidin(h):
    r = requests.get(f"{BASE_URL}/api/hr/employees", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    emps = r.json()
    match = [e for e in emps if "abidin" in (e.get("full_name") or "").lower()]
    assert match, "Employee 'Abidin' not found in seed"
    return match[0]


class TestPph21ActiveField:
    def test_employees_list_has_pph21_active_field(self, h):
        r = requests.get(f"{BASE_URL}/api/hr/employees", headers=h, timeout=30)
        assert r.status_code == 200
        emps = r.json()
        assert len(emps) > 0
        # All employees should expose pph21_active (missing → treated as False).
        # We assert type-safety when present; missing is tolerated but reported.
        missing = [e.get("full_name") for e in emps if "pph21_active" not in e]
        for e in emps:
            if "pph21_active" in e:
                assert isinstance(e["pph21_active"], bool)
        # At least the field should surface on legacy records via Pydantic default.
        # Report as soft-fail: employees missing the field indicates response omits defaults.
        assert not missing, f"pph21_active field missing on employees: {missing}"

    def test_baseline_all_inactive_returns_zero(self, h):
        # Verify baseline: /hr/pph21 for 2026-07 has total_pph21 == 0 & slips == []
        r = requests.get(f"{BASE_URL}/api/hr/pph21", headers=h, timeout=60)
        assert r.status_code == 200, r.text
        periods = r.json()
        p = next((x for x in periods if x.get("period_month") == PERIOD), None)
        # If the period exists it must have zero when all employees inactive
        if p is not None:
            assert p["total_pph21"] == 0, f"Baseline expected 0 pph21, got {p['total_pph21']}, slips={p['slips']}"
            assert p["slips"] == [], f"Baseline expected empty slips, got {p['slips']}"


class TestEnableAbidinFlow:
    """Toggle Abidin's pph21_active on, verify inclusion, then revert."""

    def test_enable_and_verify_persistence(self, h, abidin):
        eid = abidin["id"]
        # Build full payload matching EmployeeIn required fields
        payload = {**abidin}
        payload.pop("id", None)
        payload.pop("_id", None)
        payload["pph21_active"] = True
        if not payload.get("ptkp_status") or payload["ptkp_status"] == "TK/0":
            payload["ptkp_status"] = "K/1"
        r = requests.put(f"{BASE_URL}/api/hr/employees/{eid}", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/hr/employees", headers=h, timeout=30)
        assert r2.status_code == 200
        got = next((e for e in r2.json() if e["id"] == eid), None)
        assert got is not None
        assert got["pph21_active"] is True
        assert got["ptkp_status"] == "K/1"

    def test_pph21_list_includes_only_abidin(self, h, abidin):
        r = requests.get(f"{BASE_URL}/api/hr/pph21", headers=h, timeout=60)
        assert r.status_code == 200
        periods = r.json()
        p = next((x for x in periods if x.get("period_month") == PERIOD), None)
        assert p is not None, f"Period {PERIOD} not found; available: {[x.get('period_month') for x in periods]}"
        assert len(p["slips"]) == 1, f"Expected 1 slip, got {len(p['slips'])}: {[s['employee_name'] for s in p['slips']]}"
        slip = p["slips"][0]
        assert slip["employee_id"] == abidin["id"]
        assert slip["pph21"] > 0, f"Expected pph21>0 got {slip['pph21']}"
        assert slip.get("ter_category"), "ter_category missing"
        assert slip["ptkp_status"] == "K/1"
        # TER category B for K/1 & 15M ≈ 6% → 900_000
        assert slip["ter_category"] == "B", f"expected TER B, got {slip['ter_category']}"
        assert p["total_pph21"] == slip["pph21"]

    def test_nett_unchanged_in_payroll_slip(self, h, abidin):
        # Fetch the payroll doc for the period and verify Abidin's net = gross - kasbon (unaffected by pph21)
        r = requests.get(f"{BASE_URL}/api/hr/payroll", headers=h, timeout=60)
        assert r.status_code == 200
        docs = r.json()
        pdoc = next((d for d in docs if d.get("period_month") == PERIOD), None)
        assert pdoc is not None, f"Payroll for {PERIOD} not found"
        slip = next((s for s in pdoc["slips"] if s["employee_id"] == abidin["id"]), None)
        assert slip is not None
        expected_net = round(slip["gross"] - slip.get("potongan_kasbon", 0), 2)
        assert slip["net"] == expected_net, f"net {slip['net']} != gross-kasbon {expected_net}"
        # NETT method: pph21 (whether stored on slip or computed on-the-fly by /hr/pph21)
        # must NOT reduce net. Legacy slip.pph21 may be 0 if payroll was calculated before
        # activation; recalculated pph21 is exposed via /api/hr/pph21 endpoint.
        assert slip["net"] > 0

    def test_revert_abidin_inactive(self, h, abidin):
        eid = abidin["id"]
        payload = {**abidin}
        payload.pop("id", None)
        payload.pop("_id", None)
        payload["pph21_active"] = False
        # keep original ptkp
        r = requests.put(f"{BASE_URL}/api/hr/employees/{eid}", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        # verify list now excludes everyone again
        r2 = requests.get(f"{BASE_URL}/api/hr/pph21", headers=h, timeout=60)
        assert r2.status_code == 200
        p = next((x for x in r2.json() if x.get("period_month") == PERIOD), None)
        if p is not None:
            assert p["total_pph21"] == 0
            assert p["slips"] == []
