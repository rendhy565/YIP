"""Server-side Invoice PDF renderer (xhtml2pdf, pure-python, Docker-safe).
Menghasilkan PDF 2 halaman: Hal.1 = Cover Invoice, Hal.2 = Lampiran Invoice.
Dipakai untuk fitur Bulk Download (banyak invoice → ZIP)."""
import io
import html as _html
from datetime import datetime, timedelta
from xhtml2pdf import pisa

BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
         "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def _fmt_idr(n):
    try:
        return "Rp " + f"{int(round(float(n or 0))):,}".replace(",", ".")
    except Exception:
        return "Rp 0"


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.strptime(str(s)[:10], "%Y-%m-%d")
        except Exception:
            return None


def _id_date(d):
    dt = _parse_dt(d) if not isinstance(d, datetime) else d
    if not dt:
        return ""
    return f"{dt.day} {BULAN[dt.month - 1]} {dt.year}"


def _terbilang(n):
    n = int(round(n))
    if n < 0:
        return "Minus " + _terbilang(-n)
    a = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"]
    if n < 12:
        return a[n] if n > 0 else "Nol"
    if n < 20:
        return _terbilang(n - 10) + " Belas"
    if n < 100:
        return _terbilang(n // 10) + " Puluh" + ("" if n % 10 == 0 else " " + _terbilang(n % 10))
    if n < 200:
        return "Seratus" + ("" if n == 100 else " " + _terbilang(n - 100))
    if n < 1000:
        return _terbilang(n // 100) + " Ratus" + ("" if n % 100 == 0 else " " + _terbilang(n % 100))
    if n < 2000:
        return "Seribu" + ("" if n == 1000 else " " + _terbilang(n - 1000))
    if n < 1_000_000:
        return _terbilang(n // 1000) + " Ribu" + ("" if n % 1000 == 0 else " " + _terbilang(n % 1000))
    if n < 1_000_000_000:
        return _terbilang(n // 1_000_000) + " Juta" + ("" if n % 1_000_000 == 0 else " " + _terbilang(n % 1_000_000))
    return _terbilang(n // 1_000_000_000) + " Miliar" + ("" if n % 1_000_000_000 == 0 else " " + _terbilang(n % 1_000_000_000))


def _esc(s):
    return _html.escape(str(s)) if s is not None else ""


def _render_invoice_inner(data, override_date=None, only=None):
    invoice = data["invoice"]
    awb = data.get("awb") or {}
    awbs = data.get("awbs") or ([awb] if awb else [])
    customer = data.get("customer") or {}
    company = data.get("company") or {}

    if override_date:
        inv_dt = _parse_dt(override_date) or datetime.now()
    else:
        inv_dt = _parse_dt(invoice.get("invoice_date") or invoice.get("first_printed_at") or invoice.get("created_at")) or datetime.now()
    due_dt = inv_dt + timedelta(days=30)

    sub_total = sum(float(a.get("total_tariff") or 0) for a in awbs)
    ppn_amt = sum(float(a.get("tax_amount") or 0) for a in awbs)
    # PPN % diturunkan dari nominal pajak sebenarnya (bukan tax_percentage yg mungkin ter-hardcode).
    # Pajak Rp 0 -> 0%; ada pajak -> persen riil sesuai nominal.
    ppn_pct = round(ppn_amt / sub_total * 100, 2) if (sub_total > 0 and ppn_amt > 0) else 0
    pct_label = (f"{ppn_pct:.2f}".rstrip("0").rstrip(".")) if ppn_pct else "0"
    sub_after_tax = sub_total + ppn_amt
    asuransi = sum(float(a.get("received_asuransi_amount") or 0) for a in awbs)
    polis = sum(float(a.get("received_polis_amount") or 0) for a in awbs)
    spsi = sum(float(a.get("spsi_amount") or 0) for a in awbs if a.get("spsi_enabled"))
    forklift = sum(float(a.get("sewa_forklift_amount") or 0) for a in awbs if a.get("sewa_forklift_enabled"))
    grand_total = sub_after_tax + asuransi + polis + spsi + forklift

    logo = company.get("logo_b64") or ""
    if logo and not logo.startswith("data:"):
        logo = "data:image/png;base64," + logo
    logo_html = f'<img src="{logo}" style="height:95px;" />' if logo else ""

    kop_lines = []
    if company.get("kop_address"):
        kop_lines.append(_esc(company["kop_address"]))
    contact = []
    if company.get("kop_phone"):
        contact.append("Telp: " + _esc(company["kop_phone"]))
    if company.get("kop_email"):
        contact.append("Email: " + _esc(company["kop_email"]))
    if contact:
        kop_lines.append(" &middot; ".join(contact))
    if company.get("kop_website"):
        kop_lines.append("Website: " + _esc(company["kop_website"]))
    if company.get("kop_tagline"):
        kop_lines.append(f'<i>{_esc(company["kop_tagline"])}</i>')
    kop_html = "<br/>".join(kop_lines)

    # Cover item rows
    rows = [f'<tr><td style="border:1px solid #333;padding:6px;">1.</td>'
            f'<td style="border:1px solid #333;padding:6px;"><b>Biaya Pengiriman Barang {len(awbs)} AWB</b></td>'
            f'<td style="border:1px solid #333;padding:6px;" align="right">{_fmt_idr(sub_total)}</td></tr>']
    idx = 2
    for label, amt in [("Asuransi", asuransi), ("Polis", polis), ("SPSI", spsi), ("Sewa Forklift", forklift)]:
        if amt > 0:
            rows.append(f'<tr><td style="border:1px solid #333;padding:6px;">{idx}.</td>'
                        f'<td style="border:1px solid #333;padding:6px;">{label}</td>'
                        f'<td style="border:1px solid #333;padding:6px;" align="right">{_fmt_idr(amt)}</td></tr>')
            idx += 1
    items_html = "".join(rows)

    # Summary rows
    def srow(label, val, bold=False, grey=False):
        st = 'font-weight:bold;' if bold else ''
        bg = 'background-color:#F2F2F2;' if grey else ''
        return (f'<tr style="{bg}"><td style="padding:3px;{st}">{label}</td>'
                f'<td style="padding:3px;{st}" width="30">Rp.</td>'
                f'<td style="padding:3px;{st}" align="right">{val}</td></tr>')

    summary_html = (
        srow("Jumlah", _fmt_idr(sub_total)) +
        srow(f"&gt;&gt; PPN {pct_label}%", _fmt_idr(ppn_amt)) +
        srow("Sub Total", _fmt_idr(sub_after_tax), bold=True) +
        srow("&gt;&gt; Asuransi", _fmt_idr(asuransi) if asuransi > 0 else "-") +
        srow("&gt;&gt; Polis", _fmt_idr(polis) if polis > 0 else "-") +
        srow("&gt;&gt; Adm", "-") +
        srow("&gt;&gt; Materai", "-") +
        (srow("&gt;&gt; SPSI", _fmt_idr(spsi)) if spsi > 0 else "") +
        (srow("&gt;&gt; Sewa Forklift", _fmt_idr(forklift)) if forklift > 0 else "") +
        srow("TOTAL", _fmt_idr(grand_total), bold=True, grey=True)
    )

    po_html = ('<tr><td width="72" nowrap><b>No. PO</b></td><td width="10">:</td>'
               f'<td>{_esc(invoice.get("po_number"))}</td></tr>'
               if invoice.get("po_number") else "")

    # Lampiran rows (template detail: 15 kolom)
    lamp_rows = ""
    tot_harga = tot_bongkar = tot_asur = tot_polis = tot_jumlah = 0.0
    for i, a in enumerate(awbs, 1):
        harga = float(a.get("total_tariff") or 0)
        bongkar = (float(a.get("spsi_amount") or 0) if a.get("spsi_enabled") else 0) + \
                  (float(a.get("sewa_forklift_amount") or 0) if a.get("sewa_forklift_enabled") else 0)
        asur = float(a.get("received_asuransi_amount") or 0)
        pol = float(a.get("received_polis_amount") or 0)
        jumlah = harga + bongkar + asur + pol
        tot_harga += harga; tot_bongkar += bongkar; tot_asur += asur; tot_polis += pol; tot_jumlah += jumlah
        koli = a.get("koli_count")
        awbno = "AR-" + str(a.get("awb_number") or "")
        _q = a.get("qty_kg")
        qty_str = str(int(_q)) if isinstance(_q, (int, float)) and float(_q).is_integer() else _esc(_q)
        c = 'style="border:1px solid #999;padding:2px;font-size:6px;word-break:break-word;"'
        cr = 'style="border:1px solid #999;padding:2px;font-size:6px;" align="right"'
        lamp_rows += (
            f'<tr>'
            f'<td width="3%" {cr}>{i}</td>'
            f'<td width="7%" {c}>{_id_date(a.get("created_at"))}</td>'
            f'<td width="6%" {c}>{_esc(a.get("status_pengiriman") or "")}</td>'
            f'<td width="8%" {c}>{_esc(awbno)}</td>'
            f'<td width="9%" {c}>{_esc(a.get("origin"))}</td>'
            f'<td width="9%" {c}>{_esc(a.get("destination"))}</td>'
            f'<td width="9%" {c}>{_esc(a.get("fleet_type") or a.get("mode") or "")}</td>'
            f'<td width="5%" {cr}>{qty_str}</td>'
            f'<td width="5%" {cr}>{_esc(koli) if koli not in (None, "") else ""}</td>'
            f'<td width="9%" {cr}>{_fmt_idr(harga)}</td>'
            f'<td width="7%" {cr}>{_fmt_idr(bongkar) if bongkar > 0 else "-"}</td>'
            f'<td width="6%" {cr}>{_fmt_idr(asur) if asur > 0 else "-"}</td>'
            f'<td width="5%" {cr}>{_fmt_idr(pol) if pol > 0 else "-"}</td>'
            f'<td width="8%" {cr}><b>{_fmt_idr(jumlah)}</b></td>'
            f'<td width="4%" {c}>{_esc(a.get("nopol") or "")}</td>'
            f'</tr>'
        )

    # Blok total lampiran (kanan bawah)
    def lrow(label, val, bold=False, grey=False):
        st = 'font-weight:bold;' if bold else ''
        bg = 'background-color:#EEE;' if grey else ''
        return (f'<tr style="{bg}"><td style="padding:2px 6px;{st}">{label}</td>'
                f'<td style="padding:2px 6px;{st}" width="26">IDR</td>'
                f'<td style="padding:2px 6px;{st}" align="right">{val}</td></tr>')
    lamp_totals = (
        lrow("TOTAL", _fmt_idr(sub_total)) +
        lrow(f"PPN {pct_label}%", _fmt_idr(ppn_amt)) +
        lrow("SUB TOTAL", _fmt_idr(sub_after_tax), bold=True) +
        lrow("MATERAI", "-") +
        lrow("ASURANSI", _fmt_idr(tot_asur) if tot_asur > 0 else "-") +
        lrow("POLIS", _fmt_idr(tot_polis) if tot_polis > 0 else "-") +
        lrow("ADM. LAIN", "-") +
        lrow("LAIN-LAIN", _fmt_idr(tot_bongkar) if tot_bongkar > 0 else "-") +
        lrow("GRAND TOTAL", _fmt_idr(grand_total), bold=True, grey=True)
    )

    page1 = f"""
<!-- PAGE 1: COVER -->
<div>
  <table width="100%"><tr>
    <td width="110" valign="middle">{logo_html}</td>
    <td align="center" valign="middle">
      <div style="font-size:21px;font-weight:bold;color:#1e3a8a;">{_esc((company.get('name') or 'PT. Abirama Mitra').upper())}</div>
      <div style="font-size:9px;color:#333;margin-top:3px;">{kop_html}</div>
    </td>
    <td width="110">&nbsp;</td>
  </tr></table>

  <div class="band" style="margin-top:10px;margin-bottom:14px;">INVOICE</div>

  <table width="100%"><tr>
    <td width="55%" valign="top">
      <div style="font-size:9px;color:#555;text-transform:uppercase;">To:</div>
      <div style="font-size:12px;font-weight:bold;">{_esc(customer.get('name') or awb.get('company_name') or '')}</div>
      <div style="color:#333;">{_esc(customer.get('address') or '')}</div>
      {f'<div style="color:#333;">NPWP: {_esc(customer.get("npwp"))}</div>' if customer.get('npwp') else ''}
      <div style="margin-top:6px;">Attn : <b>{_esc(customer.get('attn') or awb.get('consignee') or customer.get('pic_name') or '')}</b></div>
    </td>
    <td width="45%" valign="top">
      <table width="100%" cellspacing="0" cellpadding="0">
        <tr><td width="72" nowrap><b>Invoice No</b></td><td width="10">:</td><td><b>{_esc(invoice.get('invoice_number'))}</b></td></tr>
        {po_html}
        <tr><td width="72" nowrap><b>Date</b></td><td width="10">:</td><td>{_id_date(inv_dt)}</td></tr>
        <tr><td width="72" nowrap><b>Due Date</b></td><td width="10">:</td><td>{_id_date(due_dt)}</td></tr>
      </table>
    </td>
  </tr></table>

  <table width="100%" style="margin-top:10px;border:1px solid #333;">
    <thead><tr class="dark">
      <td style="border:1px solid #333;padding:6px;" width="40" align="center">No</td>
      <td style="border:1px solid #333;padding:6px;" align="center">DESCRIPTION</td>
      <td style="border:1px solid #333;padding:6px;" width="150" align="center">AMOUNT</td>
    </tr></thead>
    <tbody>{items_html}</tbody>
  </table>

  <table width="100%" style="margin-top:12px;"><tr>
    <td width="50%" valign="top">
      <div style="font-weight:bold;">Terbilang</div>
      <div style="font-style:italic;margin-top:6px;">{_terbilang(grand_total)} Rupiah</div>
    </td>
    <td width="50%" valign="top">
      <table width="100%">{summary_html}</table>
    </td>
  </tr></table>

  <table width="100%" style="margin-top:24px;"><tr>
    <td width="50%" valign="top">
      <table width="100%" style="border:1px solid #333;"><tr><td style="padding:8px;" align="center">
        <div style="font-weight:bold;">BANK ADDRESS</div>
        <div style="font-size:9px;color:#555;">Account Rupiah ( IDR )</div>
        <div class="dark" style="margin-top:8px;padding:8px;font-size:18px;font-weight:bold;">{_esc(company.get('bank_name'))}</div>
        <div style="font-size:9px;color:#555;">PT. Bank {_esc(company.get('bank_name'))} (Persero)</div>
        <div style="text-align:left;margin-top:8px;">A/N : {_esc(company.get('bank_holder'))}<br/>A/C : {_esc(company.get('bank_account') or '________________________')}</div>
      </td></tr></table>
    </td>
    <td width="50%" valign="top" style="padding-left:14px;">
      <div style="text-align:left;">Jakarta, {_id_date(inv_dt)}</div>
      <br/><br/><br/><br/><br/><br/>
      <div style="text-align:center;font-weight:bold;">( {_esc(company.get('signer') or '...........................')} )</div>
      <div style="text-align:left;font-size:8px;color:#555;margin-top:6px;">
        <b>{_esc(company.get('name'))}</b><br/>{_esc(company.get('address') or '')}
        {f"<br/>NPWP: {_esc(company.get('npwp'))}" if company.get('npwp') else ''}
      </div>
    </td>
  </tr></table>
</div>"""

    page2 = f"""
<!-- PAGE 2: LAMPIRAN (detail per template) -->
<div>
  <table width="100%"><tr>
    <td width="60%" valign="top">
      <div style="font-size:9px;color:#555;text-transform:uppercase;font-weight:bold;">Bill To:</div>
      <div style="font-size:11px;font-weight:bold;">{_esc((customer.get('name') or awb.get('company_name') or '').upper())}</div>
      <div style="color:#333;">{_esc(customer.get('address') or '')}</div>
      {f'<div style="color:#333;">NPWP: {_esc(customer.get("npwp"))}</div>' if customer.get('npwp') else ''}
      <div style="margin-top:4px;">UP: <b>{_esc(customer.get('attn') or awb.get('consignee') or customer.get('pic_name') or '')}</b></div>
    </td>
    <td width="40%" valign="top" align="right">
      {logo_html}
      <div style="font-size:16px;font-weight:bold;color:#1e3a8a;margin-top:4px;">INVOICE</div>
      <div style="font-size:10px;font-weight:bold;">{_esc(invoice.get('invoice_number'))}</div>
    </td>
  </tr></table>

  <table width="100%" style="margin-top:10px;border:1px solid #999;table-layout:fixed;">
    <thead><tr class="dark">
      <td width="3%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">NO.</td>
      <td width="7%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">PICK UP DATE</td>
      <td width="6%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">SERVICE</td>
      <td width="8%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">NO AWB</td>
      <td width="9%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">ORIGIN</td>
      <td width="9%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">DESTINATION</td>
      <td width="9%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">TRANSPORT</td>
      <td width="5%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">QTY</td>
      <td width="5%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">KOLI</td>
      <td width="9%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">HARGA PENGIRIMAN (Rp)</td>
      <td width="7%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">BIAYA BONGKAR MUAT</td>
      <td width="6%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">ASURANSI</td>
      <td width="5%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">POLIS</td>
      <td width="8%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;" align="right">JUMLAH</td>
      <td width="4%" style="border:1px solid #333;padding:2px;font-size:5.5px;word-break:break-word;">KET</td>
    </tr></thead>
    <tbody>{lamp_rows}</tbody>
  </table>

  <table width="100%" style="margin-top:10px;"><tr>
    <td width="58%" valign="top">
      <div style="font-size:8px;color:#777;">Lampiran ini merupakan bagian yang tidak terpisahkan dari Invoice No. {_esc(invoice.get('invoice_number'))}.</div>
    </td>
    <td width="42%" valign="top">
      <table width="100%" style="font-size:9px;">{lamp_totals}</table>
    </td>
  </tr></table>
</div>"""

    if only == "lampiran":
        return page2
    if only == "cover":
        return page1
    return page1 + '\n<div style="page-break-before: always;"></div>\n' + page2


_STYLE = """<style>
@page { size: A4; margin: 12mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color:#111; }
.band { background-color:#7F7F7F; color:#fff; text-align:center; padding:8px; font-size:22px; font-weight:bold; letter-spacing:2px; }
.dark { background-color:#595959; color:#fff; }
table { border-collapse: collapse; }
</style>"""


def render_invoice_html(data, override_date=None, only=None):
    return f'<html><head><meta charset="utf-8"/>{_STYLE}</head><body>{_render_invoice_inner(data, override_date, only=only)}</body></html>'


def render_invoice_pdf(data, override_date=None):
    html = render_invoice_html(data, override_date=override_date)
    buf = io.BytesIO()
    result = pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError("Gagal render PDF invoice")
    buf.seek(0)
    return buf.read()


def render_lampiran_pdf(data, override_date=None):
    """Render HANYA halaman Lampiran (page 2) invoice — tanpa cover."""
    html = render_invoice_html(data, override_date=override_date, only="lampiran")
    buf = io.BytesIO()
    result = pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError("Gagal render PDF lampiran")
    buf.seek(0)
    return buf.read()


def render_invoices_pdf_combined(list_data):
    """Gabungkan banyak invoice (cover + lampiran) menjadi SATU file PDF."""
    blocks = [_render_invoice_inner(d) for d in list_data]
    joined = '<div style="page-break-before: always;"></div>'.join(blocks)
    html = f'<html><head><meta charset="utf-8"/>{_STYLE}</head><body>{joined}</body></html>'
    buf = io.BytesIO()
    result = pisa.CreatePDF(src=html, dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError("Gagal render PDF invoice gabungan")
    buf.seek(0)
    return buf.read()
