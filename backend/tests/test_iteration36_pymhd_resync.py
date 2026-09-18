"""
Tests for PYMHD journal re-sync on order tariff edit (iteration 36).
- PATCH /api/orders/{oid}/extended must re-sync the single 'awb_order_pymhd' journal
- Balance sheet account 1290 should be in the ~6.1B range
- Reconciled edits also re-sync
- Invoiced/Paid must be blocked (403)
"""
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
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _get_pymhd_journals(client, oid):
    """Fetch journal entries for the order and filter by reference_type."""
    # Try common endpoints
    for path in [f"/api/journals?reference_id={oid}", f"/api/journal-entries?reference_id={oid}",
                 f"/api/accounting/journals?reference_id={oid}"]:
        r = client.get(f"{BASE_URL}{path}")
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", data.get("data", []))
            return items
    return None


def test_balance_sheet_1290_in_range(client):
    r = client.get(f"{BASE_URL}/api/reports/balance-sheet")
    assert r.status_code == 200, r.text
    data = r.json()
    # Find 1290
    def walk(node, acc):
        if isinstance(node, dict):
            code = node.get("code") or node.get("account_code")
            if code == "1290":
                acc.append(node)
            for v in node.values():
                walk(v, acc)
        elif isinstance(node, list):
            for v in node:
                walk(v, acc)
    found = []
    walk(data, found)
    assert found, f"Account 1290 not found in balance sheet. Keys: {list(data.keys()) if isinstance(data, dict) else type(data)}"
    node = found[0]
    bal = node.get("balance") or node.get("amount") or node.get("total") or node.get("value") or 0
    print(f"\n>>> Account 1290 balance: {bal}")
    # Expect ~6.1 billion range (not tens of billions)
    assert 1_000_000_000 < abs(bal) < 15_000_000_000, f"1290 balance {bal} outside expected ~6.1B range"


def test_pymhd_resync_on_edit(client):
    # Find an Open, non-charter order
    r = client.get(f"{BASE_URL}/api/orders?status_v=Open&limit=100")
    assert r.status_code == 200, r.text
    payload = r.json()
    orders = payload if isinstance(payload, list) else payload.get("items", payload.get("data", []))
    assert orders, "No Open orders found"

    target = None
    for o in orders:
        if o.get("is_charter"):
            continue
        oid = o.get("id") or o.get("_id")
        if not oid:
            continue
        target = o
        break
    assert target, "No non-charter Open order found"

    oid = target.get("id") or target.get("_id")
    original_tariff = target.get("tariff_per_kg")
    original_qty = target.get("qty_kg")
    original_tax = target.get("tax_percentage", 0)
    original_total = target.get("total_tariff")
    print(f"\n>>> Target order {oid} AWB {target.get('awb_number')} original total_tariff={original_total}")

    # Verify starting state
    journals = _get_pymhd_journals(client, oid)
    if journals is None:
        pytest.skip("No accessible journal listing endpoint")
    pymhd = [j for j in journals if j.get("reference_type") == "awb_order_pymhd"]
    sales_accrued = [j for j in journals if j.get("reference_type") == "sales_accrued"]
    print(f">>> Initial PYMHD journals: {len(pymhd)}, sales_accrued: {len(sales_accrued)}")
    assert len(pymhd) == 1, f"Expected 1 PYMHD journal initially, got {len(pymhd)}"

    # PATCH with new values
    new_tariff = 10000
    new_qty = 5
    expected_total = 50000
    patch_body = {"tariff_per_kg": new_tariff, "qty_kg": new_qty, "tax_percentage": 0}
    r = client.patch(f"{BASE_URL}/api/orders/{oid}/extended", json=patch_body)
    assert r.status_code == 200, f"PATCH failed: {r.status_code} {r.text}"
    updated = r.json()
    assert updated.get("total_tariff") == expected_total, f"Expected total_tariff={expected_total}, got {updated.get('total_tariff')}"

    # Verify journal re-sync
    journals = _get_pymhd_journals(client, oid)
    pymhd = [j for j in journals if j.get("reference_type") == "awb_order_pymhd"]
    sales_accrued = [j for j in journals if j.get("reference_type") == "sales_accrued"]
    print(f">>> Post-edit PYMHD journals: {len(pymhd)}, sales_accrued: {len(sales_accrued)}")
    assert len(pymhd) == 1, f"Expected exactly 1 PYMHD journal after edit, got {len(pymhd)}"
    assert len(sales_accrued) == 0, f"Expected 0 sales_accrued journals, got {len(sales_accrued)}"

    # Check debit 1290 and credit 2390
    lines = pymhd[0].get("lines") or pymhd[0].get("entries") or []
    debit_1290 = 0
    credit_2390 = 0
    for ln in lines:
        code = ln.get("account_code") or ln.get("account")
        if code == "1290":
            debit_1290 += float(ln.get("debit", 0) or 0)
        if code == "2390":
            credit_2390 += float(ln.get("credit", 0) or 0)
    print(f">>> DR 1290={debit_1290}, CR 2390={credit_2390}")
    assert debit_1290 == expected_total, f"DR 1290 = {debit_1290}, expected {expected_total}"
    assert credit_2390 == expected_total, f"CR 2390 = {credit_2390}, expected {expected_total}"

    # Restore original
    restore = {"tariff_per_kg": original_tariff, "qty_kg": original_qty, "tax_percentage": original_tax}
    r = client.patch(f"{BASE_URL}/api/orders/{oid}/extended", json=restore)
    assert r.status_code == 200, f"Restore PATCH failed: {r.status_code} {r.text}"
    restored = r.json()
    assert abs((restored.get("total_tariff") or 0) - (original_total or 0)) < 1, \
        f"Restored total_tariff {restored.get('total_tariff')} != original {original_total}"

    # Confirm resynced back
    journals = _get_pymhd_journals(client, oid)
    pymhd = [j for j in journals if j.get("reference_type") == "awb_order_pymhd"]
    assert len(pymhd) == 1
    lines = pymhd[0].get("lines") or pymhd[0].get("entries") or []
    dr = sum(float(ln.get("debit", 0) or 0) for ln in lines if (ln.get("account_code") or ln.get("account")) == "1290")
    assert abs(dr - (original_total or 0)) < 1, f"After restore DR 1290={dr}, expected {original_total}"


def test_reconciled_edit_resync(client):
    r = client.get(f"{BASE_URL}/api/orders?status_v=Reconciled&limit=50")
    if r.status_code != 200:
        pytest.skip(f"Cannot list Reconciled orders: {r.status_code}")
    payload = r.json()
    orders = payload if isinstance(payload, list) else payload.get("items", payload.get("data", []))
    target = None
    for o in orders:
        if o.get("is_charter"):
            continue
        target = o
        break
    if not target:
        pytest.skip("No Reconciled non-charter order available")

    oid = target.get("id") or target.get("_id")
    original = {"tariff_per_kg": target.get("tariff_per_kg"), "qty_kg": target.get("qty_kg"),
                "tax_percentage": target.get("tax_percentage", 0)}
    original_total = target.get("total_tariff")
    print(f"\n>>> Reconciled target {oid} original total_tariff={original_total}")

    r = client.patch(f"{BASE_URL}/api/orders/{oid}/extended",
                     json={"tariff_per_kg": 10000, "qty_kg": 5, "tax_percentage": 0})
    assert r.status_code == 200, f"PATCH Reconciled: {r.status_code} {r.text}"
    assert r.json().get("total_tariff") == 50000

    journals = _get_pymhd_journals(client, oid)
    pymhd = [j for j in journals if j.get("reference_type") == "awb_order_pymhd"]
    sales_accrued = [j for j in journals if j.get("reference_type") == "sales_accrued"]
    print(f">>> Reconciled post-edit PYMHD={len(pymhd)} sales_accrued={len(sales_accrued)}")
    assert len(pymhd) == 1
    assert len(sales_accrued) == 0

    lines = pymhd[0].get("lines") or pymhd[0].get("entries") or []
    dr = sum(float(ln.get("debit", 0) or 0) for ln in lines if (ln.get("account_code") or ln.get("account")) == "1290")
    assert dr == 50000

    # Restore
    r = client.patch(f"{BASE_URL}/api/orders/{oid}/extended", json=original)
    assert r.status_code == 200


def test_invoiced_paid_protected(client):
    for status in ("Invoiced", "Paid"):
        r = client.get(f"{BASE_URL}/api/orders?status_v={status}&limit=10")
        if r.status_code != 200:
            continue
        payload = r.json()
        orders = payload if isinstance(payload, list) else payload.get("items", payload.get("data", []))
        if not orders:
            continue
        o = orders[0]
        oid = o.get("id") or o.get("_id")
        r = client.patch(f"{BASE_URL}/api/orders/{oid}/extended",
                         json={"tariff_per_kg": 12345, "qty_kg": 1, "tax_percentage": 0})
        print(f"\n>>> PATCH {status} order {oid} -> {r.status_code}")
        assert r.status_code == 403, f"Expected 403 for {status}, got {r.status_code}: {r.text[:200]}"
        return
    pytest.skip("No Invoiced/Paid orders to verify guard")
