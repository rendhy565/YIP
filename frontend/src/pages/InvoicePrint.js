import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../lib/api";
import { Button } from "../components/ui";
import { fmtIDR } from "../lib/utils";
import { Printer, ArrowLeft } from "lucide-react";

const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const fmtIdDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getDate()} ${ID_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

// Indonesian terbilang (number to words)
function terbilangId(n) {
  if (n < 0) return "Minus " + terbilangId(-n);
  const a = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
  if (n < 12) return n > 0 ? a[n] : "Nol";
  if (n < 20) return terbilangId(n - 10) + " Belas";
  if (n < 100) return terbilangId(Math.floor(n / 10)) + " Puluh" + (n % 10 === 0 ? "" : " " + terbilangId(n % 10));
  if (n < 200) return "Seratus" + (n === 100 ? "" : " " + terbilangId(n - 100));
  if (n < 1000) return terbilangId(Math.floor(n / 100)) + " Ratus" + (n % 100 === 0 ? "" : " " + terbilangId(n % 100));
  if (n < 2000) return "Seribu" + (n === 1000 ? "" : " " + terbilangId(n - 1000));
  if (n < 1_000_000) return terbilangId(Math.floor(n / 1000)) + " Ribu" + (n % 1000 === 0 ? "" : " " + terbilangId(n % 1000));
  if (n < 1_000_000_000) return terbilangId(Math.floor(n / 1_000_000)) + " Juta" + (n % 1_000_000 === 0 ? "" : " " + terbilangId(n % 1_000_000));
  return terbilangId(Math.floor(n / 1_000_000_000)) + " Miliar" + (n % 1_000_000_000 === 0 ? "" : " " + terbilangId(n % 1_000_000_000));
}

// Shared print styles. Inject once per page (root component).
export const InvoicePrintStyles = () => (
  <style>{`
    @media print {
      .no-print { display: none !important; }
      @page { size: A4; margin: 10mm; }
      .print-page { box-shadow: none !important; border: none !important; page-break-after: always; }
      .print-page:last-child { page-break-after: auto; }
    }
    .invoice-page { font-family: Calibri, 'Segoe UI', Arial, sans-serif; }
    .grey-band { background: #7F7F7F; color: #fff; }
    .dark-band { background: #595959; color: #fff; }
    .light-grey { background: #F2F2F2; }
  `}</style>
);

// Reusable body that renders both the invoice page and the lampiran page.
// Used by both single-invoice (InvoicePrint) and bulk-invoice (InvoicePrintBulk).
export function InvoicePrintBody({ data }) {
  const { invoice, awb, awbs, customer, company } = data;

  // Use invoice_date (set on first print) — fallback to created_at for back-compat
  const invDate = new Date(invoice.invoice_date || invoice.first_printed_at || invoice.created_at);
  const dueDate = new Date(invDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Multi-AWB aware: aggregate totals across all AWBs
  const awbList = (awbs && awbs.length > 0) ? awbs : [awb].filter(Boolean);
  const subTotal = awbList.reduce((s, a) => s + (a.total_tariff || 0), 0);
  const ppnAmt = awbList.reduce((s, a) => s + (a.tax_amount || 0), 0);
  const ppnPct = awb?.tax_percentage || 0;
  const subAfterTax = subTotal + ppnAmt;
  // For asuransi/polis use primary AWB (back-compat). When multi-AWB, sum across all.
  const asuransi = awbList.reduce((s, a) => s + (a.received_asuransi_amount || 0), 0);
  const polis = awbList.reduce((s, a) => s + (a.received_polis_amount || 0), 0);
  const spsi = awbList.reduce((s, a) => s + (a.spsi_enabled ? (a.spsi_amount || 0) : 0), 0);
  const forklift = awbList.reduce((s, a) => s + (a.sewa_forklift_enabled ? (a.sewa_forklift_amount || 0) : 0), 0);
  const grandTotal = subAfterTax + asuransi + polis + spsi + forklift;

  const logoSrc = company.logo_b64
    ? (company.logo_b64.startsWith("data:") ? company.logo_b64 : `data:image/png;base64,${company.logo_b64}`)
    : null;

  return (
    <>
      {/* PAGE 1: INVOICE (AR Cargo template) */}
      <div className="print-page invoice-page max-w-[210mm] mx-auto bg-white shadow border border-slate-200 p-8 mb-6">
        {/* Logo row */}
        <div className="flex items-start mb-2">
          <div className="w-32 h-20 flex items-center justify-start">
            {logoSrc ? <img src={logoSrc} alt="Logo" className="max-w-full max-h-full object-contain"/> : <span className="text-xs text-slate-300">[ LOGO ]</span>}
          </div>
        </div>

        {/* Grey INVOICE banner */}
        <div className="grey-band text-center py-3 mb-5 font-bold text-3xl tracking-wide">INVOICE</div>

        {/* "To" (Customer / Bill-to) on the LEFT + Meta (Invoice no, PO no, Date) on the RIGHT */}
        <div className="grid grid-cols-2 gap-6 mb-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">To:</div>
            <div className="font-bold text-base">{customer?.name || awb?.company_name || ""}</div>
            {customer?.address && <div className="whitespace-pre-line text-slate-700 mt-0.5">{customer.address}</div>}
            {customer?.npwp && <div className="text-slate-700 font-mono text-xs mt-0.5">NPWP: {customer.npwp}</div>}
            <div className="mt-2">
              <span className="text-slate-700">Attn :</span> <span className="font-semibold">{awb?.consignee || customer?.pic_name || ""}</span>
            </div>
          </div>
          <div className="text-sm">
            <div className="grid grid-cols-[110px_10px_1fr] gap-x-2 gap-y-0.5">
              <div className="font-semibold">Invoice No</div><div>:</div><div className="font-bold font-mono">{invoice.invoice_number}</div>
              {invoice.po_number && (
                <>
                  <div className="font-semibold">No. PO</div><div>:</div><div className="font-mono">{invoice.po_number}</div>
                </>
              )}
              <div className="font-semibold">Date</div><div>:</div><div>{fmtIdDate(invDate)}</div>
              <div className="font-semibold">Due Date</div><div>:</div><div>{fmtIdDate(dueDate)}</div>
            </div>
          </div>
        </div>

        {/* Items table — supports multi-AWB */}
        <table className="w-full text-sm border border-slate-700">
          <thead>
            <tr className="dark-band">
              <th className="p-2 border border-slate-700 w-12 text-center">No</th>
              <th className="p-2 border border-slate-700 text-center">DESCRIPTION</th>
              <th className="p-2 border border-slate-700 w-44 text-center">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {/* Cover row — describes the invoice (Biaya Pengiriman Barang sekian AWB). Detail per-AWB ada di Lampiran. */}
            <tr>
              <td className="p-2 border-l border-r border-slate-700 align-top">1.</td>
              <td className="p-2 border-l border-r border-slate-700">
                <div className="font-semibold">
                  Biaya Pengiriman Barang {awbList.length} AWB
                </div>
              </td>
              <td className="p-2 border-l border-r border-slate-700 text-right align-top font-mono">{fmtIDR(subTotal)}</td>
            </tr>
            {/* Addons rows */}
            {asuransi > 0 && (
              <tr>
                <td className="p-2 border-l border-r border-slate-700">2.</td>
                <td className="p-2 border-l border-r border-slate-700">Asuransi</td>
                <td className="p-2 border-l border-r border-slate-700 text-right font-mono">{fmtIDR(asuransi)}</td>
              </tr>
            )}
            {polis > 0 && (
              <tr>
                <td className="p-2 border-l border-r border-slate-700">{2 + (asuransi > 0 ? 1 : 0)}.</td>
                <td className="p-2 border-l border-r border-slate-700">Polis</td>
                <td className="p-2 border-l border-r border-slate-700 text-right font-mono">{fmtIDR(polis)}</td>
              </tr>
            )}
            {spsi > 0 && (
              <tr>
                <td className="p-2 border-l border-r border-slate-700">{2 + (asuransi > 0 ? 1 : 0) + (polis > 0 ? 1 : 0)}.</td>
                <td className="p-2 border-l border-r border-slate-700">SPSI</td>
                <td className="p-2 border-l border-r border-slate-700 text-right font-mono">{fmtIDR(spsi)}</td>
              </tr>
            )}
            {forklift > 0 && (
              <tr>
                <td className="p-2 border-l border-r border-slate-700">{2 + (asuransi > 0 ? 1 : 0) + (polis > 0 ? 1 : 0) + (spsi > 0 ? 1 : 0)}.</td>
                <td className="p-2 border-l border-r border-slate-700">Sewa Forklift</td>
                <td className="p-2 border-l border-r border-slate-700 text-right font-mono">{fmtIDR(forklift)}</td>
              </tr>
            )}
            {/* spacer + bottom border closing */}
            <tr><td colSpan={3} className="border-b border-slate-700 p-1"></td></tr>
          </tbody>
        </table>

        {/* Terbilang + Summary */}
        <div className="grid grid-cols-2 gap-6 mt-4">
          <div className="text-sm">
            <div className="font-semibold">Terbilang</div>
            <div className="italic mt-2 leading-relaxed">{terbilangId(Math.round(grandTotal))} Rupiah</div>
          </div>
          <div className="text-sm">
            <table className="w-full">
              <tbody>
                <tr><td className="py-1 text-slate-700">Jumlah</td><td className="py-1 w-8 text-slate-700">Rp.</td><td className="py-1 text-right font-mono">{fmtIDR(subTotal)}</td></tr>
                <tr><td className="py-1 text-slate-700 pl-3">{`>> PPN ${ppnPct}%`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">{fmtIDR(ppnAmt)}</td></tr>
                <tr><td className="py-1 text-slate-700 font-semibold">Sub Total</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono font-semibold">{fmtIDR(subAfterTax)}</td></tr>
                <tr><td className="py-1 text-slate-700 pl-3">{`>> Asuransi`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">{asuransi > 0 ? fmtIDR(asuransi) : "-"}</td></tr>
                <tr><td className="py-1 text-slate-700 pl-3">{`>> Polis`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">{polis > 0 ? fmtIDR(polis) : "-"}</td></tr>
                <tr><td className="py-1 text-slate-700 pl-3">{`>> Adm`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">-</td></tr>
                <tr><td className="py-1 text-slate-700 pl-3">{`>> Materai`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">-</td></tr>
                {spsi > 0 && <tr><td className="py-1 text-slate-700 pl-3">{`>> SPSI`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">{fmtIDR(spsi)}</td></tr>}
                {forklift > 0 && <tr><td className="py-1 text-slate-700 pl-3">{`>> Sewa Forklift`}</td><td className="py-1">Rp.</td><td className="py-1 text-right font-mono">{fmtIDR(forklift)}</td></tr>}
                <tr className="light-grey font-bold"><td className="py-2 px-1">TOTAL</td><td className="py-2">Rp.</td><td className="py-2 text-right font-mono">{fmtIDR(grandTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Bank box + Signature */}
        <div className="grid grid-cols-2 gap-6 mt-8 items-start">
          <div className="border border-slate-700 p-3 text-center text-sm" data-testid="bank-box">
            <div className="font-bold">BANK ADDRESS</div>
            <div className="text-xs text-slate-600">Account Rupiah ( IDR )</div>
            <div className="dark-band mt-3 py-3 text-2xl font-bold tracking-wide">{company.bank_name}</div>
            <div className="text-xs text-slate-600">PT. Bank {company.bank_name} (Persero)</div>
            <div className="mt-3 text-sm text-left grid grid-cols-[40px_1fr] gap-x-2">
              <div>A/N</div><div>: {company.bank_holder}</div>
              <div>A/C</div><div>: {company.bank_account || "________________________________"}</div>
            </div>
          </div>
          <div className="text-sm text-center">
            <div className="text-left">Jakarta,  {fmtIdDate(invDate)}</div>
            <div className="h-28"></div>
            <div className="font-bold">(  {company.signer || "..........................."}  )</div>
            {/* Issuer info (kecil, di bawah signature) */}
            <div className="text-left text-[10px] text-slate-600 mt-3 leading-snug">
              <div className="font-bold text-slate-800">{company.name}</div>
              {company.address && <div className="whitespace-pre-line">{company.address}</div>}
              {company.npwp && <div className="font-mono">NPWP: {company.npwp}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* PAGE 2: LAMPIRAN */}
      <div className="print-page invoice-page max-w-[210mm] mx-auto bg-white shadow border border-slate-200 p-8 mb-6">
        <h2 className="font-heading font-black text-2xl tracking-tight uppercase text-center mb-6">Lampiran Invoice</h2>
        <table className="w-full text-xs border border-slate-300">
          <thead>
            <tr className="dark-band">
              <th className="p-2 border border-slate-700 text-left">No. AWB</th>
              <th className="p-2 border border-slate-700 text-left">Tanggal</th>
              <th className="p-2 border border-slate-700 text-left">Origin</th>
              <th className="p-2 border border-slate-700 text-left">Tujuan</th>
              <th className="p-2 border border-slate-700 text-left">Goods</th>
              <th className="p-2 border border-slate-700 text-right">Qty</th>
              <th className="p-2 border border-slate-700 text-right">Tarif/Kg</th>
              <th className="p-2 border border-slate-700 text-right">Subtotal</th>
              <th className="p-2 border border-slate-700 text-right">PPN</th>
              <th className="p-2 border border-slate-700 text-right">Grand</th>
            </tr>
          </thead>
          <tbody>
            {awbList.map((a, idx) => (
              <tr key={a.id || idx}>
                <td className="p-2 border border-slate-300 font-mono">{a.awb_number}</td>
                <td className="p-2 border border-slate-300">{fmtIdDate(a.created_at)}</td>
                <td className="p-2 border border-slate-300">{a.origin}</td>
                <td className="p-2 border border-slate-300">{a.destination}</td>
                <td className="p-2 border border-slate-300">{a.goods_content}</td>
                <td className="p-2 border border-slate-300 text-right">{a.qty_kg}</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(a.tariff_per_kg)}</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(a.total_tariff)}</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(a.tax_amount)}</td>
                <td className="p-2 border border-slate-300 text-right font-bold">{fmtIDR((a.total_tariff || 0) + (a.tax_amount || 0))}</td>
              </tr>
            ))}
            {/* Total row */}
            {awbList.length > 1 && (
              <tr className="bg-slate-100 font-bold">
                <td colSpan={7} className="p-2 border border-slate-300 text-right">TOTAL ({awbList.length} AWB)</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(subTotal)}</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(ppnAmt)}</td>
                <td className="p-2 border border-slate-300 text-right">{fmtIDR(grandTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-3">Lampiran ini merupakan bagian yang tidak terpisahkan dari Invoice No. {invoice.invoice_number}.</p>
      </div>
    </>
  );
}

export default function InvoicePrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/invoices/${id}/full`).then(async (r) => {
      setData(r.data);
      // If not yet printed (print_count = 0 or no invoice_date), mark-printed
      const inv = r.data.invoice;
      if (!inv.invoice_date && (!inv.print_count || inv.print_count === 0)) {
        try {
          await api.post(`/invoices/${id}/mark-printed`, { use_old_date: false });
          // Re-fetch to update invoice_date
          const r2 = await api.get(`/invoices/${id}/full`);
          setData(r2.data);
        } catch (e) { /* ignore */ }
      }
    });
  }, [id]);

  if (!data) return <div className="p-10 text-center text-slate-500">Memuat...</div>;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <InvoicePrintStyles />
      <div className="max-w-[210mm] mx-auto px-4 mb-4 flex items-center gap-2 no-print">
        <Button variant="secondary" onClick={() => window.close()}><ArrowLeft size={14}/> Tutup</Button>
        <Button data-testid="print-now-btn" onClick={() => window.print()} className="ml-auto"><Printer size={14}/> Cetak Invoice + Lampiran</Button>
      </div>
      <InvoicePrintBody data={data} />
    </div>
  );
}
