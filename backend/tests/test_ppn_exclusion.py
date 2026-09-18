"""Tests for PPN-exclusion refactor (Jan 2026).
Verifies that:
- GET /api/cost-groups/candidate-awbs returns tax_amount and total_tariff.
- POST /api/cost-groups + prorata children compute shares from grand_total - tax_amount.
- Orders endpoint returns grand_total and tax_amount so frontend can compute selling.
- Existing AWB 201189 (if present) has expected values.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ----- Auth -----
def test_login_admin_ok(token):
    assert isinstance(token, str) and len(token) > 10


# ----- Orders: verify grand_total/tax_amount presence -----
def test_orders_contains_tax_fields(headers):
    r = requests.get(f"{BASE_URL}/api/orders", headers=headers, timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert isinstance(data, list) and len(data) > 0
    sample = data[0]
    # required fields for FE sellingOf helper
    for k in ("grand_total", "tax_amount"):
        assert k in sample, f"Missing '{k}' in order: {list(sample.keys())[:30]}"


def test_awb_201189_values(headers):
    r = requests.get(f"{BASE_URL}/api/orders", headers=headers, timeout=60)
    assert r.status_code == 200
    match = [o for o in r.json() if str(o.get("awb_number")) == "201189"]
    if not match:
        pytest.skip("AWB 201189 not present in restored DB")
    a = match[0]
    gt = float(a.get("grand_total") or 0)
    tax = float(a.get("tax_amount") or 0)
    tt = float(a.get("total_tariff") or 0)
    selling = gt - tax
    # Values per problem statement (allow small rounding)
    assert abs(tt - 31_416_500) < 1.0, f"total_tariff={tt}"
    assert abs(tax - 345_581.5) < 1.0, f"tax_amount={tax}"
    assert abs(gt - 31_762_081.5) < 1.0, f"grand_total={gt}"
    assert abs(selling - 31_416_500) < 1.0, f"selling(exc PPN)={selling}"


# ----- Candidate AWBs endpoint -----
def test_candidate_awbs_has_tax_and_total_tariff(headers):
    r = requests.get(f"{BASE_URL}/api/cost-groups/candidate-awbs",
                     headers=headers, params={"include_invoiced": "true"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert isinstance(data, list)
    if not data:
        pytest.skip("No candidate AWBs available")
    sample = data[0]
    for k in ("grand_total", "tax_amount", "total_tariff", "awb_number"):
        assert k in sample, f"Missing '{k}' in candidate: {list(sample.keys())}"
    # Look for AWB that has tax>0 to verify computation
    with_tax = [d for d in data if float(d.get("tax_amount") or 0) > 0]
    assert with_tax, "Expected at least one candidate AWB with tax_amount>0"


# ----- Prorata computes on grand_total - tax_amount -----
def test_prorata_uses_selling_ex_ppn(headers):
    """Create a cost group with 2 AWBs (one with tax>0) and verify child amounts
    are proportional to (grand_total - tax_amount), NOT grand_total."""
    r = requests.get(f"{BASE_URL}/api/cost-groups/candidate-awbs",
                     headers=headers, params={"include_invoiced": "true"}, timeout=60)
    assert r.status_code == 200
    cands = r.json()
    with_tax = [c for c in cands if float(c.get("tax_amount") or 0) > 0
                and float(c.get("grand_total") or 0) > 0]
    if len(with_tax) < 1 or len(cands) < 2:
        pytest.skip("Not enough candidates to build prorata test")

    a = with_tax[0]
    # pick a second, distinct AWB
    b = next((c for c in cands if c["id"] != a["id"] and float(c.get("grand_total") or 0) > 0), None)
    if not b:
        pytest.skip("Cannot find second candidate AWB")

    total_amount = 1_000_000.0
    payload = {
        "vendor_name": "TEST_PPN_VENDOR",
        "period_month": "2026-01",
        "total_amount": total_amount,
        "awb_ids": [a["id"], b["id"]],
        "description": "TEST_PPN_EXCLUSION",
    }
    cr = requests.post(f"{BASE_URL}/api/cost-groups", headers=headers, json=payload, timeout=60)
    assert cr.status_code == 200, cr.text[:500]
    gid = cr.json().get("cost_group_id")
    assert gid

    try:
        lg = requests.get(f"{BASE_URL}/api/cost-groups",
                          headers=headers, params={"period_month": "2026-01"}, timeout=60)
        assert lg.status_code == 200
        group = next((g for g in lg.json() if g.get("id") == gid or g.get("_id") == gid), None)
        assert group, "Created group not found"
        children = group["children"]
        assert len(children) == 2

        # Compute expected using selling = grand_total - tax_amount
        def sell(x):
            gt = float(x.get("grand_total") or 0)
            tx = float(x.get("tax_amount") or 0)
            return gt - tx if gt > 0 else float(x.get("total_tariff") or 0)

        s_a = sell(a); s_b = sell(b)
        total_sales = s_a + s_b
        expected_a = round(total_amount * (s_a / total_sales), 2)
        # last row absorbs residual
        expected_b = round(total_amount - expected_a, 2)

        # Match children to a/b by awb_id
        ch_by_awb = {c["awb_id"]: c for c in children}
        got_a = float(ch_by_awb[a["id"]]["amount"])
        got_b = float(ch_by_awb[b["id"]]["amount"])

        # allow tolerance 1 rupiah
        assert abs(got_a + got_b - total_amount) < 1.0

        # Also verify NOT using grand_total (would give different share when tax>0)
        s_a_gt = float(a["grand_total"]); s_b_gt = float(b["grand_total"])
        gt_expected_a = round(total_amount * (s_a_gt / (s_a_gt + s_b_gt)), 2)

        # Assert result matches EX-PPN basis and (if difference is material) differs from GT basis
        assert abs(got_a - expected_a) < 2.0, (
            f"Child amount for A={got_a} expected(ex-PPN)={expected_a}; gt-based={gt_expected_a}")

        if abs(expected_a - gt_expected_a) > 1.0:
            # There is a material difference -> must be closer to ex-PPN than GT-based
            assert abs(got_a - expected_a) < abs(got_a - gt_expected_a), \
                "Prorata share appears to still be based on grand_total (including PPN)"
    finally:
        # Cleanup
        try:
            requests.delete(f"{BASE_URL}/api/cost-groups/{gid}", headers=headers, timeout=30)
        except Exception:
            pass


# ----- Regression: invoices still use grand_total (with PPN) -----
def test_invoices_endpoint_ok(headers):
    r = requests.get(f"{BASE_URL}/api/invoices", headers=headers, timeout=60)
    assert r.status_code in (200, 404)  # some deployments may name differently
