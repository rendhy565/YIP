import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import MonthPicker from "../components/MonthPicker";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Download, FileClock, ReceiptText, AlertTriangle, Loader2, ChevronDown } from "lucide-react";
import Pagination, { usePagination } from "../components/Pagination";
import * as XLSX from "xlsx";

export default function ReceivablePipeline() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState({ open: [], ny_po: [], invoiced: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null); // 'open' | 'ny_po' | 'invoiced' | null

  const load = () => {
    setLoading(true);
    const params = {};
    if (month) params.month = month;
    api.get("/reports/receivable-pipeline", { params })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [month]); // eslint-disable-line

  const s = data.summary || {};
  const openPag = usePagination(data.open || [], { resetKey: `${month}|${(data.open || []).length}` });
  const nyPag = usePagination(data.ny_po || [], { resetKey: `${month}|${(data.ny_po || []).length}` });
  const invPag = usePagination(data.invoiced || [], { resetKey: `${month}|${(data.invoiced || []).length}` });
  const monthLabel = month
    ? new Date(month + "-01").toLocaleDateString("id-ID", { month: "long", year: "numeric" })
    : "Semua Bulan";

  const exportXLS = () => {
    const wb = XLSX.utils.book_new();
    const op = XLSX.utils.json_to_sheet((data.open || []).map((r) => ({
      "No AWB": r.awb_number, "Customer": r.customer_name || "-",
      "Rute": `${r.origin || ""}→${r.destination || ""}`,
      "Tgl Order": r.ref_date ? fmtDate(r.ref_date) : "-",
      "Umur (hari)": r.age_days ?? "-", "Nilai": r.value,
    })));
    XLSX.utils.book_append_sheet(wb, op, "Sedang Berjalan");
    const ny = XLSX.utils.json_to_sheet((data.ny_po || []).map((r) => ({
      "No AWB": r.awb_number, "Customer": r.customer_name || "-",
      "Rute": `${r.origin || ""}→${r.destination || ""}`,
      "Keterangan": r.sub || "-",
      "Tgl Reconcile": r.ref_date ? fmtDate(r.ref_date) : "-",
      "Umur (hari)": r.age_days ?? "-", "Nilai": r.value,
    })));
    XLSX.utils.book_append_sheet(wb, ny, "NY-PO Belum Invoice");
    const iv = XLSX.utils.json_to_sheet((data.invoiced || []).map((r) => ({
      "No AWB": r.awb_number, "Customer": r.customer_name || "-",
      "No Invoice": r.invoice_number || "-",
      "Tgl Print": r.ref_date ? fmtDate(r.ref_date) : "-",
      "Umur (hari)": r.age_days ?? "-", "Nilai": r.value,
    })));
    XLSX.utils.book_append_sheet(wb, iv, "Invoiced Belum Bayar");
    XLSX.writeFile(wb, `Pipeline_Penerimaan_${month || "semua"}.xlsx`);
  };

  const cards = [
    {
      key: "open", label: "Sedang Berjalan (Open)", icon: FileClock,
      color: "slate", accent: "border-slate-400", ic: "text-slate-500",
      total: s.open_total, count: s.open_count, note: "AWB masih berjalan · umur dari tgl order",
    },
    {
      key: "ny_po", label: "NY-PO — Belum Invoice", icon: AlertTriangle,
      color: "amber", accent: "border-amber-400", ic: "text-amber-600",
      total: s.ny_po_total, count: s.ny_po_count, note: "Reconciled/invoice belum diprint · umur dari tgl reconcile",
    },
    {
      key: "invoiced", label: "Invoiced — Belum Dibayar", icon: ReceiptText,
      color: "blue", accent: "border-blue-400", ic: "text-blue-600",
      total: s.invoiced_total, count: s.invoiced_count, note: "Sudah diprint, belum bayar · umur dari tgl print",
    },
  ];

  return (
    <div data-testid="receivable-pipeline-page">
      <PageHeader
        title="Pipeline Penerimaan Kas"
        subtitle="Tiga tahap piutang: pekerjaan berjalan (Open), belum invoice (NY-PO), dan sudah invoice belum dibayar. Filter bulan mengikuti TANGGAL ORDER; umur (aging) tetap dihitung dari titik masing-masing. Klik kartu untuk melihat detailnya."
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Filter Bulan (tgl order)</div>
          <MonthPicker value={month} onChange={setMonth} allowEmpty />
        </div>
        <Button data-testid="pipeline-export-btn" variant="secondary" onClick={exportXLS}><Download size={14}/> Export Excel</Button>
        {loading && <span className="text-xs text-slate-400 inline-flex items-center gap-1 pb-2"><Loader2 size={13} className="animate-spin"/> memuat…</span>}
        <span className="ml-auto text-xs text-slate-500 pb-2">Menampilkan: <b className="text-slate-700">{monthLabel}</b></span>
      </div>

      {/* Summary cards (clickable) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {cards.map((c) => {
          const isActive = active === c.key;
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`pipeline-summary-${c.key}`}
              onClick={() => setActive(isActive ? null : c.key)}
              className={`text-left transition-all duration-200 rounded-xl ${isActive ? "ring-2 ring-offset-1 ring-slate-800" : ""}`}
            >
              <Card className={`p-4 border-l-4 ${c.accent} h-full hover:shadow-md transition-shadow`}>
                <div className={`flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold ${c.ic} mb-1`}>
                  <c.icon size={13}/> {c.label}
                </div>
                <div className="font-heading font-black text-2xl text-slate-800">{fmtIDR(c.total || 0)}</div>
                <div className="text-xs text-slate-500 mt-1">{c.count || 0} AWB · {c.note}</div>
                <div className={`mt-2 text-[11px] font-semibold inline-flex items-center gap-1 ${isActive ? "text-slate-800" : "text-slate-400"}`}>
                  {isActive ? "Sembunyikan detail" : "Klik untuk lihat detail"}
                  <ChevronDown size={13} className={`transition-transform ${isActive ? "rotate-180" : ""}`}/>
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="mb-3 text-xs text-slate-500">
        Total potensi cash in ({monthLabel}): <b className="text-emerald-700">{fmtIDR(s.grand_total || 0)}</b>
      </div>

      {/* Detail tables — only render when a card is clicked */}
      {active === "open" && (
        <Card className="p-0 overflow-hidden" data-testid="pipeline-detail-open">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <FileClock size={14} className="text-slate-500"/>
            <span className="font-bold text-sm text-slate-800">Sedang Berjalan / Open</span>
            <span className="text-xs text-slate-500 ml-1">— umur dihitung dari tanggal order dibuat</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>No AWB</Th><Th>Customer</Th><Th>Rute</Th><Th>Tgl Order</Th><Th className="text-right">Umur</Th><Th className="text-right">Nilai</Th>
              </tr></thead>
              <tbody>
                {openPag.paged.map((r) => (
                  <tr key={r.awb_id} data-testid={`open-row-${r.awb_number}`}>
                    <Td className="font-mono font-bold">{r.awb_number}</Td>
                    <Td>{r.customer_name || "-"}</Td>
                    <Td className="text-xs text-slate-500">{r.origin}→{r.destination}</Td>
                    <Td>{r.ref_date ? fmtDate(r.ref_date) : "-"}</Td>
                    <Td className="text-right">{r.age_days != null ? `${r.age_days} hr` : "-"}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(r.value)}</Td>
                  </tr>
                ))}
                {(data.open || []).length === 0 && (
                  <tr><Td colSpan={6} className="text-center text-slate-400 py-6">{loading ? "Memuat..." : "Tidak ada AWB berjalan di bulan ini."}</Td></tr>
                )}
              </tbody>
            </Table>
          </div>
          <Pagination {...openPag} testid="pagination-pipeline-open"/>
        </Card>
      )}

      {active === "ny_po" && (
        <Card className="p-0 overflow-hidden" data-testid="pipeline-detail-ny_po">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-600"/>
            <span className="font-bold text-sm text-amber-800">NY-PO — Belum Invoice</span>
            <span className="text-xs text-amber-600 ml-1">— Reconciled belum invoice + invoice belum diprint · umur dari tgl reconcile</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>No AWB</Th><Th>Customer</Th><Th>Rute</Th><Th>Keterangan</Th><Th>Tgl Reconcile</Th><Th className="text-right">Umur</Th><Th className="text-right">Nilai</Th>
              </tr></thead>
              <tbody>
                {nyPag.paged.map((r) => (
                  <tr key={r.awb_id} data-testid={`nypo-row-${r.awb_number}`}>
                    <Td className="font-mono font-bold">{r.awb_number}</Td>
                    <Td>{r.customer_name || "-"}</Td>
                    <Td className="text-xs text-slate-500">{r.origin}→{r.destination}</Td>
                    <Td>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${r.sub === "Invoice belum diprint" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
                        {r.sub || "Belum Invoice"}
                      </span>
                    </Td>
                    <Td>{r.ref_date ? fmtDate(r.ref_date) : "-"}</Td>
                    <Td className="text-right">{r.age_days != null ? `${r.age_days} hr` : "-"}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(r.value)}</Td>
                  </tr>
                ))}
                {(data.ny_po || []).length === 0 && (
                  <tr><Td colSpan={7} className="text-center text-slate-400 py-6">{loading ? "Memuat..." : "Tidak ada AWB Not Yet PO di bulan ini."}</Td></tr>
                )}
              </tbody>
            </Table>
          </div>
          <Pagination {...nyPag} testid="pagination-pipeline-nypo"/>
        </Card>
      )}

      {active === "invoiced" && (
        <Card className="p-0 overflow-hidden" data-testid="pipeline-detail-invoiced">
          <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
            <ReceiptText size={14} className="text-blue-600"/>
            <span className="font-bold text-sm text-blue-800">Invoiced — Belum Dibayar</span>
            <span className="text-xs text-blue-600 ml-1">— sudah diprint, piutang berjalan · umur dari tgl print</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>No AWB</Th><Th>Customer</Th><Th>No Invoice</Th><Th>Tgl Print</Th><Th className="text-right">Umur</Th><Th className="text-right">Nilai</Th>
              </tr></thead>
              <tbody>
                {invPag.paged.map((r) => (
                  <tr key={r.awb_id} data-testid={`invoiced-row-${r.awb_number}`}>
                    <Td className="font-mono font-bold">{r.awb_number}</Td>
                    <Td>{r.customer_name || "-"}</Td>
                    <Td className="font-mono text-xs">{r.invoice_number || "-"}</Td>
                    <Td>{r.ref_date ? fmtDate(r.ref_date) : "-"}</Td>
                    <Td className="text-right">{r.age_days != null ? `${r.age_days} hr` : "-"}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(r.value)}</Td>
                  </tr>
                ))}
                {(data.invoiced || []).length === 0 && (
                  <tr><Td colSpan={6} className="text-center text-slate-400 py-6">{loading ? "Memuat..." : "Tidak ada invoice belum dibayar di bulan ini."}</Td></tr>
                )}
              </tbody>
            </Table>
          </div>
          <Pagination {...invPag} testid="pagination-pipeline-invoiced"/>
        </Card>
      )}

      {!active && (
        <Card className="p-8 text-center text-slate-400 text-sm" data-testid="pipeline-no-selection">
          Klik salah satu kartu ringkasan di atas untuk menampilkan tabel detailnya.
        </Card>
      )}
    </div>
  );
}
