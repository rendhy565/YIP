import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import MonthPicker from "../components/MonthPicker";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Download, FileClock, ReceiptText, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

export default function ReceivablePipeline() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState({ ny_po: [], pymhd: [], summary: {} });
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    const params = {};
    if (month) params.month = month;
    api.get("/reports/receivable-pipeline", { params })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [month]);

  const s = data.summary || {};

  const exportXLS = () => {
    const wb = XLSX.utils.book_new();
    const ny = XLSX.utils.json_to_sheet((data.ny_po || []).map((r) => ({
      "No AWB": r.awb_number, "Customer": r.customer_name || "-",
      "Rute": `${r.origin || ""}→${r.destination || ""}`,
      "Tgl Reconcile": r.reconciled_at ? fmtDate(r.reconciled_at) : "-",
      "Umur (hari)": r.age_days ?? "-", "Nilai": r.value,
    })));
    XLSX.utils.book_append_sheet(wb, ny, "Not Yet PO");
    const py = XLSX.utils.json_to_sheet((data.pymhd || []).map((r) => ({
      "No AWB": r.awb_number, "Customer": r.customer_name || "-",
      "No Invoice": r.invoice_number || "-",
      "Tgl Invoice": r.invoiced_at ? fmtDate(r.invoiced_at) : "-",
      "Umur (hari)": r.age_days ?? "-", "Nilai": r.value,
    })));
    XLSX.utils.book_append_sheet(wb, py, "PYMHD");
    XLSX.writeFile(wb, `Pipeline_Penerimaan_${month || "semua"}.xlsx`);
  };

  return (
    <div data-testid="receivable-pipeline-page">
      <PageHeader
        title="Pipeline Penerimaan Kas"
        subtitle="Not Yet PO (selesai, belum invoice — menunggu PO customer) & PYMHD (sudah invoice, belum dibayar)."
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Filter Bulan</div>
          <MonthPicker value={month} onChange={setMonth} allowEmpty />
        </div>
        <Button data-testid="pipeline-export-btn" variant="secondary" onClick={exportXLS}><Download size={14}/> Export Excel</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Card className="p-4 border-l-4 border-amber-400" data-testid="pipeline-summary-nypo">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-amber-600 mb-1">
            <AlertTriangle size={13}/> Not Yet PO — Belum Invoice
          </div>
          <div className="font-heading font-black text-2xl text-slate-800">{fmtIDR(s.ny_po_total || 0)}</div>
          <div className="text-xs text-slate-500 mt-1">{s.ny_po_count || 0} AWB menunggu PO customer</div>
        </Card>
        <Card className="p-4 border-l-4 border-blue-400" data-testid="pipeline-summary-pymhd">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-blue-600 mb-1">
            <ReceiptText size={13}/> PYMHD — Invoice, Belum Dibayar
          </div>
          <div className="font-heading font-black text-2xl text-slate-800">{fmtIDR(s.pymhd_total || 0)}</div>
          <div className="text-xs text-slate-500 mt-1">{s.pymhd_count || 0} invoice berjalan</div>
        </Card>
        <Card className="p-4 border-l-4 border-emerald-400" data-testid="pipeline-summary-total">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-emerald-600 mb-1">
            <FileClock size={13}/> Total Potensi Cash In
          </div>
          <div className="font-heading font-black text-2xl text-slate-800">{fmtIDR(s.grand_total || 0)}</div>
          <div className="text-xs text-slate-500 mt-1">Gabungan pipeline</div>
        </Card>
      </div>

      {/* NY-PO table */}
      <Card className="p-0 mb-5 overflow-hidden">
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-600"/>
          <span className="font-bold text-sm text-amber-800">Not Yet PO (Selesai/Reconciled, Belum Invoice)</span>
          <span className="text-xs text-amber-600 ml-1">— bahan eskalasi ke customer untuk minta Nomor PO</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <thead><tr>
              <Th>No AWB</Th><Th>Customer</Th><Th>Rute</Th><Th>Tgl Reconcile</Th><Th className="text-right">Umur</Th><Th className="text-right">Nilai</Th>
            </tr></thead>
            <tbody>
              {(data.ny_po || []).map((r) => (
                <tr key={r.awb_id} data-testid={`nypo-row-${r.awb_number}`}>
                  <Td className="font-mono font-bold">{r.awb_number}</Td>
                  <Td>{r.customer_name || "-"}</Td>
                  <Td className="text-xs text-slate-500">{r.origin}→{r.destination}</Td>
                  <Td>{r.reconciled_at ? fmtDate(r.reconciled_at) : "-"}</Td>
                  <Td className="text-right">{r.age_days != null ? `${r.age_days} hr` : "-"}</Td>
                  <Td className="text-right font-mono font-bold">{fmtIDR(r.value)}</Td>
                </tr>
              ))}
              {(data.ny_po || []).length === 0 && (
                <tr><Td colSpan={6} className="text-center text-slate-400 py-6">{loading ? "Memuat..." : "Tidak ada AWB Not Yet PO."}</Td></tr>
              )}
            </tbody>
          </Table>
        </div>
      </Card>

      {/* PYMHD table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
          <ReceiptText size={14} className="text-blue-600"/>
          <span className="font-bold text-sm text-blue-800">PYMHD (Sudah Invoice, Belum Dibayar)</span>
          <span className="text-xs text-blue-600 ml-1">— piutang berjalan</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <thead><tr>
              <Th>No AWB</Th><Th>Customer</Th><Th>No Invoice</Th><Th>Tgl Invoice</Th><Th className="text-right">Umur</Th><Th className="text-right">Nilai</Th>
            </tr></thead>
            <tbody>
              {(data.pymhd || []).map((r) => (
                <tr key={r.awb_id} data-testid={`pymhd-row-${r.awb_number}`}>
                  <Td className="font-mono font-bold">{r.awb_number}</Td>
                  <Td>{r.customer_name || "-"}</Td>
                  <Td className="font-mono text-xs">{r.invoice_number || "-"}</Td>
                  <Td>{r.invoiced_at ? fmtDate(r.invoiced_at) : "-"}</Td>
                  <Td className="text-right">{r.age_days != null ? `${r.age_days} hr` : "-"}</Td>
                  <Td className="text-right font-mono font-bold">{fmtIDR(r.value)}</Td>
                </tr>
              ))}
              {(data.pymhd || []).length === 0 && (
                <tr><Td colSpan={6} className="text-center text-slate-400 py-6">{loading ? "Memuat..." : "Tidak ada invoice yang belum dibayar."}</Td></tr>
              )}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
