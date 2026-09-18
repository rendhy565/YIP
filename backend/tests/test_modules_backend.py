"""Backend tests for new modules: feature flags, accounting, HR, asset, tax, bank_recon."""
import os
import requests
import pytest
from datetime import datetime

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/")
API = f"{BASE_URL}/api"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_tok():
    return _login("admin", "admin123")


@pytest.fixture(scope="session")
def fin_tok():
    return _login("finance", "finance123")


@pytest.fixture(scope="session")
def op_tok():
    return _login("operation", "operation123")


def H(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------------- FEATURE FLAGS ----------------
class TestFeatureFlags:
    def test_list_returns_5_modules(self, op_tok):
        r = requests.get(f"{API}/feature-flags", headers=H(op_tok), timeout=20)
        assert r.status_code == 200
        flags = r.json()
        keys = {f["key"] for f in flags}
        assert {"accounting", "hr", "tax", "asset", "bank_recon"} <= keys

    def test_admin_can_toggle(self, admin_tok):
        # turn ON hr
        r = requests.put(f"{API}/feature-flags/hr", headers=H(admin_tok),
                         json={"enabled": True}, timeout=20)
        assert r.status_code == 200, r.text
        # verify
        flags = requests.get(f"{API}/feature-flags", headers=H(admin_tok)).json()
        hr = next(f for f in flags if f["key"] == "hr")
        assert hr["enabled"] is True

    def test_finance_cannot_toggle(self, fin_tok):
        r = requests.put(f"{API}/feature-flags/asset", headers=H(fin_tok),
                         json={"enabled": True}, timeout=20)
        assert r.status_code == 403

    def test_disabled_module_returns_503(self, admin_tok):
        # ensure bank_recon disabled
        requests.put(f"{API}/feature-flags/bank_recon", headers=H(admin_tok),
                     json={"enabled": False})
        r = requests.get(f"{API}/bank-recon", headers=H(admin_tok), timeout=20)
        assert r.status_code == 503
        body = r.json()
        # check Indonesian message
        msg = str(body)
        assert "dinonaktifkan" in msg.lower() or "bank_recon" in msg.lower()


# ---------------- ACCOUNTING ----------------
class TestAccounting:
    def test_chart_of_accounts(self, admin_tok):
        r = requests.get(f"{API}/accounts", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200
        accts = r.json()
        assert len(accts) >= 10
        codes = {a["code"] for a in accts}
        assert "1101" in codes  # Kas
        assert "4101" in codes  # Pendapatan

    def test_journal_list(self, admin_tok):
        r = requests.get(f"{API}/journal", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_ledger(self, admin_tok):
        r = requests.get(f"{API}/ledger", headers=H(admin_tok),
                         params={"account_code": "1101"}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        # ledger usually has lines + balance fields
        assert isinstance(d, (list, dict))

    def test_trial_balance(self, admin_tok):
        r = requests.get(f"{API}/reports/trial-balance", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200

    def test_balance_sheet_balanced(self, admin_tok):
        r = requests.get(f"{API}/reports/balance-sheet", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200
        d = r.json()
        # accept either 'balanced' or compute from totals
        if "balanced" in d:
            assert d["balanced"] is True, d
        else:
            # fallback: check totals close
            ta = d.get("total_assets") or 0
            tl = d.get("total_liabilities") or 0
            te = d.get("total_equity") or 0
            assert abs(ta - (tl + te)) < 1, d

    def test_income_statement(self, admin_tok):
        r = requests.get(f"{API}/reports/income-statement", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200

    def test_cash_flow(self, admin_tok):
        r = requests.get(f"{API}/reports/cash-flow", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200


# ---------------- MANUAL JOURNAL ----------------
class TestManualJournal:
    def test_unbalanced_rejected(self, admin_tok):
        payload = {
            "description": "TEST_unbalanced",
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "lines": [
                {"account_code": "1101", "debit": 1000, "credit": 0, "memo": "x"},
                {"account_code": "4101", "debit": 0, "credit": 500, "memo": "x"},
            ],
        }
        r = requests.post(f"{API}/journal", headers=H(admin_tok), json=payload, timeout=20)
        assert r.status_code in (400, 422), r.text

    def test_balanced_accepted(self, admin_tok):
        payload = {
            "description": "TEST_balanced_manual",
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "lines": [
                {"account_code": "1101", "debit": 1000, "credit": 0, "memo": "dr"},
                {"account_code": "4101", "debit": 0, "credit": 1000, "memo": "cr"},
            ],
        }
        r = requests.post(f"{API}/journal", headers=H(admin_tok), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("reference_type") in ("manual", None) or "manual" in str(j).lower()
        # GET /journal should include it
        all_j = requests.get(f"{API}/journal", headers=H(admin_tok)).json()
        descs = [x.get("description") for x in all_j]
        assert "TEST_balanced_manual" in descs


# ---------------- HR ----------------
class TestHR:
    def test_disabled_returns_503(self, admin_tok):
        # disable hr first
        requests.put(f"{API}/feature-flags/hr", headers=H(admin_tok),
                     json={"enabled": False})
        r = requests.get(f"{API}/hr/employees", headers=H(admin_tok), timeout=20)
        assert r.status_code == 503

    def test_enable_then_payroll_flow(self, admin_tok):
        # enable
        r = requests.put(f"{API}/feature-flags/hr", headers=H(admin_tok),
                         json={"enabled": True}, timeout=20)
        assert r.status_code == 200
        # list employees
        r = requests.get(f"{API}/hr/employees", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200
        # create 2 employees
        emp_ids = []
        for i, name in enumerate(["TEST_Andi", "TEST_Budi"]):
            payload = {
                "full_name": name, "base_salary": 5000000, "allowance": 500000,
            }
            r = requests.post(f"{API}/hr/employees", headers=H(admin_tok), json=payload, timeout=20)
            assert r.status_code == 200, r.text
            emp_ids.append(r.json()["id"])
        # run payroll — use unique period to avoid collisions from prior runs
        period = "2099-12"
        # cleanup any leftover payroll for this period
        existing_p = requests.get(f"{API}/hr/payroll", headers=H(admin_tok),
                                   params={"period": period}).json()
        for p in existing_p:
            requests.delete(f"{API}/hr/payroll/{p['id']}", headers=H(admin_tok))
        r = requests.post(f"{API}/hr/payroll/run", headers=H(admin_tok),
                          json={"period_month": period}, timeout=30)
        assert r.status_code == 200, r.text
        payroll = r.json()
        pid = payroll.get("id")
        assert pid
        # check auto-posted journal
        j = requests.get(f"{API}/journal", headers=H(admin_tok),
                         params={"reference_type": "payroll"}, timeout=20).json()
        assert any(x.get("reference_type") == "payroll" for x in j), "payroll journal not found"
        # delete payroll
        r = requests.delete(f"{API}/hr/payroll/{pid}", headers=H(admin_tok), timeout=20)
        assert r.status_code in (200, 204), r.text
        # journal should be cleaned up
        j2 = requests.get(f"{API}/journal", headers=H(admin_tok),
                          params={"reference_type": "payroll"}, timeout=20).json()
        # any payroll journals referencing pid should be gone
        remaining = [x for x in j2 if x.get("reference_id") == pid]
        assert len(remaining) == 0, f"residual payroll journals: {remaining}"


# ---------------- ASSET ----------------
class TestAsset:
    def test_asset_depreciation(self, admin_tok):
        # enable
        requests.put(f"{API}/feature-flags/asset", headers=H(admin_tok),
                     json={"enabled": True})
        payload = {
            "name": "TEST_Truck01", "cost": 120000000, "useful_life_months": 60,
            "acquisition_date": datetime.utcnow().strftime("%Y-%m-%d"),
        }
        r = requests.post(f"{API}/assets", headers=H(admin_tok), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        asset = r.json()
        aid = asset["id"]
        period = "2099-11"
        r = requests.post(f"{API}/assets/depreciate", headers=H(admin_tok),
                          json={"period_month": period}, timeout=30)
        assert r.status_code == 200, r.text
        # check accumulated_depreciation increased
        r = requests.get(f"{API}/assets", headers=H(admin_tok), timeout=20)
        assets = r.json()
        a = next(x for x in assets if x["id"] == aid)
        assert a.get("accumulated_depreciation", 0) > 0


# ---------------- TAX ----------------
class TestTax:
    def test_ppn_summary(self, admin_tok):
        requests.put(f"{API}/feature-flags/tax", headers=H(admin_tok), json={"enabled": True})
        period = datetime.utcnow().strftime("%Y-%m")
        r = requests.get(f"{API}/tax/ppn-summary", headers=H(admin_tok),
                         params={"period": period}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "ppn_keluaran" in d or "ppn_masukan" in d

    def test_pph_create(self, admin_tok):
        period = datetime.utcnow().strftime("%Y-%m")
        payload = {"period_month": period, "pph_type": "PPh21", "amount": 100000}
        r = requests.post(f"{API}/tax/pph", headers=H(admin_tok), json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text


# ---------------- BANK RECON ----------------
class TestBankRecon:
    def test_create_line_and_candidates(self, admin_tok):
        requests.put(f"{API}/feature-flags/bank_recon", headers=H(admin_tok),
                     json={"enabled": True})
        payload = {
            "bank_account_code": "1102",
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "description": "TEST_bank_line",
            "amount": 11100,
        }
        r = requests.post(f"{API}/bank-recon", headers=H(admin_tok), json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        bid = r.json().get("id")
        assert bid
        r = requests.get(f"{API}/bank-recon/candidates/{bid}", headers=H(admin_tok), timeout=20)
        assert r.status_code == 200, r.text
