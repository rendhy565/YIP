import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../lib/api";
import { Button } from "../components/ui";
import { fmtIDR, fmtDate } from "../lib/utils";
import { Printer, ArrowLeft } from "lucide-react";

const Section = ({ title, children }) => (
  <div className="print-page bg-white">
    <div className="max-w-3xl mx-auto p-8 border border-slate-300">
      <div className="text-center mb-6">
        <div className="font-heading font-black text-2xl tracking-tight uppercase">{title}</div>
      </div>
      {children}
    </div>
  </div>
);

const Row = ({ label, value }) => (
  <div className="flex border-b border-slate-200 py-1.5 text-sm">
    <div className="w-48 text-slate-500 font-semibold">{label}</div>
    <div className="flex-1 text-slate-900">{value || "-"}</div>
  </div>
);

export default function InvoicePrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/invoices/${id}/full`).then((r) => setData(r.data));
  }, [id]);

  if (!data) return <div className="p-10 text-center text-slate-500">Memuat...</div>;

  const { invoice, awb, customer, company } = data;

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="max-w-3xl mx-auto px-4 mb-4 flex items-center gap-2 no-print">
        <Button variant="secondary" onClick={() => window.close()}><ArrowLeft size={14}/> Tutup</Button>
        <Button data-testid="print-now-btn" onClick={() => window.print()} className="ml-auto"><Printer size={14}/> Cetak Semua (Invoice + Faktur + Lampiran + PO)</Button>
      </div>

      {/* INVOICE */}
      <Section title="Invoice">
        <div className="grid grid-cols-2 gap-6 mb-5">
          <div>
            <div className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-1">Dari</div>
            <div className="font-bold">{awb.company_name || company.name}</div>
            <div className="text-sm text-slate-600">{company.address}</div>
            <div className="text-sm text-slate-600 font-mono">NPWP: {company.npwp}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-1">Kepada</div>
            <div className="font-bold">{customer?.name}</div>
            <div className="text-sm text-slate-600">{customer?.address || "-"}</div>
            <div className="text-sm text-slate-600 font-mono">NPWP: {customer?.npwp || "-"}</div>
            {awb.consignee && <div className="text-sm text-slate-700 mt-1"><span className="font-semibold">Consignee:</span> {awb.consignee}</div>}
          </div>
        </div>
        <Row label="No. Invoice" value={<span className="font-mono font-bold">{invoice.invoice_number}</span>} />
        <Row label="Tanggal" value={fmtDate(invoice.created_at)} />
        <Row label="No. AWB" value={<span className="font-mono">{awb.awb_number}</span>} />
        {awb.reff_no && <Row label="Reff No" value={<span className="font-mono">{awb.reff_no}</span>} />}
        <Row label="Rute" value={`${awb.origin} → ${awb.destination}`} />
        {(awb.service || awb.via) && <Row label="Service / Via" value={[awb.service, awb.via].filter(Boolean).join(" / ")} />}
        {awb.status_pengiriman && <Row label="Status Pengiriman" value={awb.status_pengiriman} />}
        <Row label="Deskripsi" value={awb.item_description} />
        {(awb.koli_count || awb.koli_qty_per) && <Row label="Koli" value={`${awb.koli_count || "-"} koli · isi ${awb.koli_qty_per || "-"}`} />}
        {awb.insurance_enabled && (
          <Row label="Asuransi" value={`Polis: ${awb.insurance_policy || "-"} · Nilai: ${fmtIDR(awb.insurance_amount || 0)}`} />
        )}

        <table className="w-full mt-5 text-sm">
          <thead><tr className="bg-slate-100 text-xs uppercase">
            <th className="text-left p-2">Item</th>
            <th className="text-right p-2">Qty (Kg)</th>
            <th className="text-right p-2">Tarif/Kg</th>
            <th className="text-right p-2">Total</th>
          </tr></thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="p-2">{awb.goods_content}</td>
              <td className="p-2 text-right">{awb.qty_kg}</td>
              <td className="p-2 text-right">{fmtIDR(awb.tariff_per_kg)}</td>
              <td className="p-2 text-right">{fmtIDR(awb.total_tariff)}</td>
            </tr>
            <tr><td colSpan={3} className="p-2 text-right text-slate-600">Subtotal</td><td className="p-2 text-right">{fmtIDR(awb.total_tariff)}</td></tr>
            <tr><td colSpan={3} className="p-2 text-right text-slate-600">PPN {awb.tax_percentage}%</td><td className="p-2 text-right">{fmtIDR(awb.tax_amount)}</td></tr>
            <tr className="bg-slate-900 text-white"><td colSpan={3} className="p-2 text-right font-bold">GRAND TOTAL</td><td className="p-2 text-right font-bold">{fmtIDR(awb.grand_total)}</td></tr>
          </tbody>
        </table>

        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center"><div className="border-t border-slate-400 mt-16 pt-2 text-xs">Penerbit</div></div>
          <div className="text-center"><div className="border-t border-slate-400 mt-16 pt-2 text-xs">Diterima</div></div>
        </div>
      </Section>

      {/* FAKTUR PAJAK */}
      <Section title="Faktur Pajak">
        <Row label="Kode & No. Seri" value={<span className="font-mono">010.000-{invoice.invoice_number.replace(/[^0-9]/g, "").slice(-8).padStart(8, "0")}</span>} />
        <Row label="Pengusaha Kena Pajak" value={company.name} />
        <Row label="NPWP" value={<span className="font-mono">{company.npwp}</span>} />
        <Row label="Alamat" value={company.address} />
        <div className="my-4 border-t border-slate-300"/>
        <Row label="Pembeli BKP/JKP" value={customer?.name} />
        <Row label="NPWP Pembeli" value={<span className="font-mono">{customer?.npwp || "-"}</span>} />
        <Row label="Alamat Pembeli" value={customer?.address || "-"} />
        <div className="my-4 border-t border-slate-300"/>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-xs uppercase">
            <th className="text-left p-2">No.</th>
            <th className="text-left p-2">Nama BKP/JKP</th>
            <th className="text-right p-2">Harga Jual (Rp)</th>
          </tr></thead>
          <tbody>
            <tr className="border-b"><td className="p-2">1</td><td className="p-2">Jasa Pengangkutan {awb.origin}-{awb.destination} (AWB {awb.awb_number})</td><td className="p-2 text-right">{fmtIDR(awb.total_tariff)}</td></tr>
            <tr><td colSpan={2} className="p-2 text-right">Dasar Pengenaan Pajak</td><td className="p-2 text-right">{fmtIDR(awb.total_tariff)}</td></tr>
            <tr><td colSpan={2} className="p-2 text-right">PPN {awb.tax_percentage}%</td><td className="p-2 text-right font-bold">{fmtIDR(awb.tax_amount)}</td></tr>
          </tbody>
        </table>
      </Section>

      {/* LAMPIRAN */}
      <Section title="Lampiran Invoice">
        <table className="w-full text-xs border border-slate-300">
          <thead><tr className="bg-slate-100 uppercase">
            <th className="p-2 border border-slate-300 text-left">No. AWB</th>
            <th className="p-2 border border-slate-300 text-left">Tanggal</th>
            <th className="p-2 border border-slate-300 text-left">Origin</th>
            <th className="p-2 border border-slate-300 text-left">Dest</th>
            <th className="p-2 border border-slate-300 text-left">Goods</th>
            <th className="p-2 border border-slate-300 text-right">Qty</th>
            <th className="p-2 border border-slate-300 text-right">Tarif/Kg</th>
            <th className="p-2 border border-slate-300 text-right">Total</th>
            <th className="p-2 border border-slate-300 text-right">PPN</th>
            <th className="p-2 border border-slate-300 text-right">Grand</th>
          </tr></thead>
          <tbody>
            <tr>
              <td className="p-2 border border-slate-300 font-mono">{awb.awb_number}</td>
              <td className="p-2 border border-slate-300">{fmtDate(awb.created_at)}</td>
              <td className="p-2 border border-slate-300">{awb.origin}</td>
              <td className="p-2 border border-slate-300">{awb.destination}</td>
              <td className="p-2 border border-slate-300">{awb.goods_content}</td>
              <td className="p-2 border border-slate-300 text-right">{awb.qty_kg}</td>
              <td className="p-2 border border-slate-300 text-right">{fmtIDR(awb.tariff_per_kg)}</td>
              <td className="p-2 border border-slate-300 text-right">{fmtIDR(awb.total_tariff)}</td>
              <td className="p-2 border border-slate-300 text-right">{fmtIDR(awb.tax_amount)}</td>
              <td className="p-2 border border-slate-300 text-right font-bold">{fmtIDR(awb.grand_total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-3">Lampiran ini merupakan bagian yang tidak terpisahkan dari Invoice No. {invoice.invoice_number}.</p>
      </Section>

      {/* PO Placeholder */}
      <Section title="Purchase Order (Placeholder)">
        <p className="text-sm text-slate-600 mb-4">
          Lembar ini merupakan placeholder untuk Purchase Order dari pelanggan. Lampirkan PO asli dari {customer?.name} di sini saat dicetak.
        </p>
        <Row label="No. PO" value="________________________________" />
        <Row label="Tanggal PO" value="________________________________" />
        <Row label="Penanggung Jawab" value="________________________________" />
        <Row label="Catatan" value="________________________________" />
        <div className="mt-16 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center"><div className="border-t border-slate-400 mt-16 pt-2 text-xs">{customer?.name}</div></div>
          <div className="text-center"><div className="border-t border-slate-400 mt-16 pt-2 text-xs">{company.name}</div></div>
        </div>
      </Section>
    </div>
  );
}
