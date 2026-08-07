"""Iteration 30: Amortization marker, Receivable pipeline, PPh21 features."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# --- Amortization marker in P&L ---
class TestPnLAmort:
    def test_pnl_returns_amort_breakdown_keys(self, h):
        # Wide date range to catch active amortizations
        r = requests.get(f"{BASE_URL}/api/reports/profit-loss",
                         params={"start_date": "2026-01-01", "end_date": "2026-12-31"},
                         headers=h, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "amort_breakdown" in data, f"missing amort_breakdown in {list(data.keys())}"
        assert "amort_cogs_breakdown" in data
        assert isinstance(data["amort_breakdown"], dict)
        assert isinstance(data["amort_cogs_breakdown"], dict)
        # sanity: values numeric
        for k, v in data["amort_breakdown"].items():
            assert isinstance(v, (int, float)), f"non-numeric amort value {k}={v}"
        for k, v in data["amort_cogs_breakdown"].items():
            assert isinstance(v, (int, float))
        print(f"amort_breakdown keys: {list(data['amort_breakdown'].keys())}")
        print(f"amort_cogs_breakdown keys: {list(data['amort_cogs_breakdown'].keys())}")


# --- Receivable pipeline report ---
class TestReceivablePipeline:
    def test_pipeline_shape(self, h):
        r = requests.get(f"{BASE_URL}/api/reports/receivable-pipeline",
                         headers=h, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("ny_po", "pymhd", "summary"):
            assert k in d, f"missing {k}"
        s = d["summary"]
        for k in ("ny_po_count", "ny_po_total", "pymhd_count", "pymhd_total", "grand_total"):
            assert k in s
            assert isinstance(s[k], (int, float))
        # rows shape
        if d["ny_po"]:
            row = d["ny_po"][0]
            for k in ("awb_number", "customer_name", "value"):
                assert k in row, f"ny_po row missing {k}: {row}"
        if d["pymhd"]:
            row = d["pymhd"][0]
            for k in ("awb_number", "customer_name", "value"):
                assert k in row
        print(f"pipeline summary: {s}")
        assert s["ny_po_count"] > 0 or s["pymhd_count"] > 0

    def test_pipeline_month_filter(self, h):
        r = requests.get(f"{BASE_URL}/api/reports/receivable-pipeline",
                         params={"month": "2026-07"}, headers=h, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "summary" in d


# --- PPh21 employee ptkp_status field ---
class TestEmployeePTKP:
    def test_employee_ptkp_field_persists(self, h):
        emps = requests.get(f"{BASE_URL}/api/hr/employees", headers=h, timeout=30)
        assert emps.status_code == 200
        lst = emps.json()
        assert lst, "no employees"
        emp = lst[0]
        emp_id = emp["id"]
        original = emp.get("ptkp_status")
        # set to K/1
        payload = {**emp, "ptkp_status": "K/1"}
        # remove id field for PUT body if API rejects
        payload.pop("id", None)
        r = requests.put(f"{BASE_URL}/api/hr/employees/{emp_id}", json=payload, headers=h, timeout=30)
        assert r.status_code in (200, 204), r.text
        got = requests.get(f"{BASE_URL}/api/hr/employees", headers=h, timeout=30).json()
        found = next((e for e in got if e["id"] == emp_id), None)
        assert found and found.get("ptkp_status") == "K/1", f"ptkp_status did not persist: {found}"
        # restore
        if original:
            payload["ptkp_status"] = original
            requests.put(f"{BASE_URL}/api/hr/employees/{emp_id}", json=payload, headers=h, timeout=30)


# --- PPh21 list and structure ---
class TestPPh21List:
    def test_pph21_list(self, h):
        r = requests.get(f"{BASE_URL}/api/hr/pph21", headers=h, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list) and d, f"expected non-empty list, got {d}"
        period = d[0]
        for k in ("payroll_id", "period_month", "total_pph21", "status", "slips"):
            assert k in period, f"missing {k} in period"
        assert period["status"] in ("unpaid", "paid", "none")
        if period["slips"]:
            slip = period["slips"][0]
            for k in ("employee_name", "ptkp_status", "ter_category", "ter_rate", "pph21_bruto", "pph21"):
                assert k in slip, f"slip missing {k}: {slip}"
        print(f"pph21 first period: id={period['payroll_id']} month={period['period_month']} total={period['total_pph21']} status={period['status']} slips={len(period['slips'])}")

    def test_pph21_ter_tk0_zero_low_bruto(self, h):
        """TER category A / TK/0 monthly bruto <= 5.4M => 0% => pph21=0."""
        d = requests.get(f"{BASE_URL}/api/hr/pph21", headers=h, timeout=60).json()
        found_case = False
        for period in d:
            for slip in period["slips"]:
                if slip.get("ptkp_status") == "TK/0" and slip.get("pph21_bruto", 0) <= 5_400_000:
                    assert slip["pph21"] == 0, f"expected 0 pph21 for TK/0 low bruto: {slip}"
                    found_case = True
        print(f"TK/0 low-bruto verified cases: {found_case}")
