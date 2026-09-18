import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, Button, StatusBadge } from "./ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { X, FileText } from "lucide-react";
import { toast } from "sonner";

const Info = ({ label, value, mono }) => (
  <div>
    <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 font-bold">{label}</div>
    <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value ?? "—"}</div>
  </div>
);

export default function InvoiceDetailModal({ invoiceId, invoiceNumber, onClose }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get(`/invoices/${invoiceId}/full`)
      .then((r) => { if (alive) setD(r.data); })
      .catch((e) => { toast.error(errMsg(e)); onClose(); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [invoiceId]); // eslint-disable-line

  const inv = d?.invoice || {};
  const awbs = d?.awbs || [];
  const cust = d?.customer || {};
  const sumDpp = awbs.reduce((s, a) => s + (Number(a.total_tariff) || 0), 0);
  const sumTax = awbs.reduce((s, a) => s + (Number(a.tax_amount) || 0), 0);
  const grand = sumDpp + sumTax;

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="invoice-detail-modal">
      <Card className="w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-heading font-bold text-xl text-slate-900"><FileText className="inline mr-2" size={18}/>Detail Invoice</h3>
            <p className="text-xs text-slate-500 mt-1">No. Invoice <span className="font-mono font-bold">{invoiceNumber || inv.invoice_number}</span></p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" data-testid="invoice-detail-close"><X size={18}/></button>
        </div>

        {loading || !d ? (
          <div className="py-10 text-center text-slate-500 text-sm">Memuat detail...</div>
        ) : (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Info label="No. Invoice" value={inv.invoice_number} mono />
              <Info label="No. PO" value={inv.po_number || "—"} mono />
              <Info label="Tgl Invoice" value={inv.invoice_date ? fmtDate(inv.invoice_date) : "—"} />
              <Info label="Status" value={<StatusBadge status={inv.status} />} />
              <Info label="Customer" value={cust.name} />
              <Info label="NPWP" value={cust.npwp || "—"} mono />
              <Info label="Perusahaan" value={(d.company && d.company.name) || (d.awb && d.awb.company_name)} />
              <Info label="Jumlah AWB" value={`${awbs.length} AWB`} />
            </div>

            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 mb-1">Rincian AWB</div>
            <div className="border border-slate-200 rounded-lg overflow-auto max-h-[45vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="p-2 text-left">No. AWB</th>
                    <th className="p-2 text-left">Rute</th>
                    <th className="p-2 text-left">Barang</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Tarif/Kg</th>
                    <th className="p-2 text-right">DPP</th>
                    <th className="p-2 text-right">PPN</th>
                    <th className="p-2 text-right">Grand</th>
                  </tr>
                </thead>
                <tbody>
                  {awbs.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="p-2 font-mono">{a.awb_number}</td>
                      <td className="p-2">{a.origin} → {a.destination}</td>
                      <td className="p-2">{a.goods_content || "—"}</td>
                      <td className="p-2 text-right">{a.qty_kg ? Number(a.qty_kg).toLocaleString("id-ID") : "—"}</td>
                      <td className="p-2 text-right">{a.tariff_per_kg ? fmtIDR(a.tariff_per_kg) : "—"}</td>
                      <td className="p-2 text-right">{fmtIDR(a.total_tariff)}</td>
                      <td className="p-2 text-right">{fmtIDR(a.tax_amount)}</td>
                      <td className="p-2 text-right font-semibold">{fmtIDR((Number(a.total_tariff) || 0) + (Number(a.tax_amount) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold">
                  <tr className="border-t-2 border-slate-300">
                    <td className="p-2" colSpan={5}>Total</td>
                    <td className="p-2 text-right font-mono">{fmtIDR(sumDpp)}</td>
                    <td className="p-2 text-right font-mono">{fmtIDR(sumTax)}</td>
                    <td className="p-2 text-right font-mono text-blue-700" data-testid="invoice-detail-grand">{fmtIDR(grand)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-3 mt-3 border-t">
          <Button variant="secondary" onClick={onClose} data-testid="invoice-detail-close-btn">Tutup</Button>
        </div>
      </Card>
    </div>
  );
}
