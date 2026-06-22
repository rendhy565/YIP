import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { FileText, Printer, Download, CheckSquare, Square, Search, FileSpreadsheet, X } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function InvoicesCreated() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [company, setCompany] = useState("");
  const [filterMode, setFilterMode] = useState("OR"); // "OR" | "AND"
  const [selected, setSelected] = useState(new Set());

  const COMPANY_OPTIONS = ["PT. Abirama Mitra Pradana", "PT. Abirama Mitra Pratama"];

  const load = async () => {
    const [inv, cs] = await Promise.all([api.get("/invoices"), api.get("/customers")]);
    setInvoices(inv.data); setCustomers(cs.data);
    setSelected(new Set());
  };
  useEffect(() => { load(); }, []);

  // Client-side filter — mode toggle OR / AND between search, customer, & company.
  // OR  : row passes if it matches ANY active filter (default).
  // AND : row passes only if it matches ALL active filters.
  // "Active" = filter has a non-empty value. When no filter active, show all.
  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const activeFilters = [];
    if (qStr) activeFilters.push((i) => `${i.invoice_number || ""} ${i.awb_number || ""} ${i.customer_name || ""} ${i.company_name || ""}`.toLowerCase().includes(qStr));
    if (customerId) activeFilters.push((i) => i.customer_id === customerId);
    if (company) activeFilters.push((i) => i.company_name === company);
    if (activeFilters.length === 0) return invoices;
    return invoices.filter((i) => filterMode === "AND" ? activeFilters.every((fn) => fn(i)) : activeFilters.some((fn) => fn(i)));
  }, [invoices, q, customerId, company, filterMode]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${company}|${filterMode}` });

  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.id)));
  };

  const cancelInvoice = async (inv) => {
    if (!window.confirm(
      `PERINGATAN: Membatalkan invoice ${inv.invoice_number}\n\n`+
      `Efek:\n`+
      `• AWB ${(inv.awb_numbers || [inv.awb_number]).join(", ")} kembali ke status RECONCILED (siap dibuat invoice ulang)\n`+
      `• Jurnal Piutang & PPN dihapus (akunting dibalik)\n`+
      `• Tidak bisa dilakukan jika sudah ada pembayaran (Paid)\n\n`+
      `Lanjutkan?`
    )) return;
    try {
      const r = await api.post(`/invoices/${inv.id}/cancel`);
      toast.success(`Invoice ${r.data.invoice_number} dibatalkan. ${r.data.awbs_reverted.length} AWB → Reconciled. ${r.data.journals_deleted} jurnal dihapus.`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const handlePrint = async (inv) => {
    // Warn if already printed
    if (inv.print_count > 0 && inv.invoice_date) {
      const printedDate = new Date(inv.invoice_date);
      const now = new Date();
      const sameMonth = printedDate.getMonth() === now.getMonth() && printedDate.getFullYear() === now.getFullYear();
      const dateLabel = printedDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
      let msg = `Invoice ini sudah pernah dicetak pada ${dateLabel}.\nApakah Anda mau cetak ulang?\n\n` +
                `OK = pakai tanggal LAMA (${dateLabel})\nCancel = pakai tanggal BARU (hari ini)`;
      if (!sameMonth) {
        msg = `⚠ PERINGATAN: Tanggal cetak lama (${dateLabel}) sudah LEWAT BULAN!\n\n` + msg;
      }
      const useOld = window.confirm(msg);
      try {
        await api.post(`/invoices/${inv.id}/mark-printed`, { use_old_date: useOld });
        window.open(`/arc/invoices/${inv.id}/print`, "_blank");
      } catch (e) { toast.error(errMsg(e)); }
    } else {
      // First print
      try {
        await api.post(`/invoices/${inv.id}/mark-printed`, { use_old_date: false });
        toast.success("Invoice dicetak — Piutang tercatat & tanggal invoice diset");
        window.open(`/arc/invoices/${inv.id}/print`, "_blank");
        load();
      } catch (e) { toast.error(errMsg(e)); }
    }
  };

  const targetIds = () => (selected.size > 0 ? Array.from(selected) : filtered.map((i) => i.id));

  const exportInvoiceExcel = async () => {
    const ids = targetIds();
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    try {
      if (ids.length === 1) {
        const r = await api.get(`/exports/invoice/${ids[0]}`, { responseType: "blob" });
        const inv = invoices.find((i) => i.id === ids[0]);
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement("a"); a.href = url;
        a.download = `Invoice_${inv?.invoice_number || ids[0]}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        const r = await api.post(`/exports/invoices/bulk`, { invoice_ids: ids }, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement("a"); a.href = url;
        a.download = `Invoice_Bulk_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
      }
      toast.success(`${ids.length} invoice ter-export`);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const exportReportAr = async () => {
    const ids = targetIds();
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    try {
      const r = await api.get("/exports/report-ar", { params: { invoice_ids: ids.join(",") }, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = `REPORT_AR_FILTERED_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("REPORT AR (filtered) ter-export");
    } catch (e) { toast.error(errMsg(e)); }
  };

  const bulkPrint = () => {
    const ids = targetIds();
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    // Open one combined tab containing every selected invoice. User presses
    // Ctrl+P once and gets a single merged PDF for all selections.
    window.open(`/arc/invoices/print-bulk?ids=${ids.join(",")}`, "_blank");
    toast.success(`${ids.length} invoice dibuka dalam 1 tab. Tekan Ctrl+P → Save as PDF.`);
  };

  return (
    <div data-testid="invoices-created-page">
      <PageHeader
        title="Invoice Tercetak"
        subtitle="Filter, print, dan export invoice yang sudah dibuat."
        action={
          <Link to="/invoices">
            <Button variant="secondary"><FileText size={16}/> Ke Pembuatan Invoice</Button>
          </Link>
        }
      />

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="invoices"
          mode={filterMode}
          setMode={setFilterMode}
          currentFilters={{ q, customerId, company }}
          onLoadPreset={(f) => { setQ(f.q || ""); setCustomerId(f.customerId || ""); setCompany(f.company || ""); }}
          activeCount={[q.trim(), customerId, company].filter(Boolean).length}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label>Cari (No. Invoice / AWB / Customer / Company)</Label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <Input data-testid="invoice-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: INV-202606-0001 atau AWB-..." className="pl-9"/>
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label>Filter Customer</Label>
            <Select data-testid="invoice-customer-filter" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="min-w-[240px]">
            <Label>Filter Company</Label>
            <Select data-testid="invoice-company-filter" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Semua Company</option>
              {COMPANY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="ml-auto text-xs text-slate-500">
            {filtered.length} dari {invoices.length} invoice {selected.size > 0 ? `· ${selected.size} dipilih` : ""}
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <h3 className="font-bold inline-flex items-center gap-2"><FileText size={16} className="text-purple-700"/> Daftar Invoice</h3>
          <div className="ml-auto flex gap-2 flex-wrap">
            <Button data-testid="export-report-ar-from-invoices-btn" variant="secondary" onClick={exportReportAr}>
              <FileSpreadsheet size={14}/> Export REPORT AR (filter)
            </Button>
            <Button data-testid="bulk-print-pdf-btn" variant="secondary" onClick={bulkPrint}>
              <Printer size={14}/> Print to PDF ({selected.size || filtered.length})
            </Button>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll}>
                {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>No. Invoice</Th><Th>AWB</Th><Th>Company</Th><Th>Customer</Th><Th>Tanggal</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`}>
                <Td>
                  <button data-testid={`invoice-toggle-${i.id}`} onClick={() => toggle(i.id)}>
                    {selected.has(i.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{i.invoice_number}</Td>
                <Td className="font-mono">
                  {i.awb_count > 1 ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-[10px] uppercase font-bold bg-purple-100 text-purple-800 rounded px-1.5 py-0.5">{i.awb_count} AWB</span>
                      <span className="text-xs text-slate-600" title={(i.awb_numbers || []).join(", ")}>
                        {(i.awb_numbers || [])[0]}{i.awb_count > 1 ? `...` : ""}
                      </span>
                    </span>
                  ) : i.awb_number}
                </Td>
                <Td className="text-xs">{i.company_name || <span className="text-slate-400">—</span>}</Td>
                <Td>{i.customer_name}</Td>
                <Td className="text-xs text-slate-600">
                  {i.invoice_date ? (
                    <span className="font-semibold text-blue-700">{fmtDate(i.invoice_date)}</span>
                  ) : (
                    <span className="text-amber-700">Belum dicetak</span>
                  )}
                </Td>
                <Td className="text-right font-semibold">{fmtIDR(i.grand_total)}</Td>
                <Td><StatusBadge status={i.awb_status}/></Td>
                <Td className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant={i.print_count > 0 ? "secondary" : "default"}
                      data-testid={`print-invoice-${i.id}`}
                      onClick={() => handlePrint(i)}
                      className={i.print_count > 0 ? "!bg-amber-100 !text-amber-900 hover:!bg-amber-200 !border-amber-300" : ""}
                    >
                      <Printer size={14}/> {i.print_count > 0 ? `Cetak Ulang (${i.print_count}x)` : "Cetak"}
                    </Button>
                    {i.awb_status !== "Paid" && (
                      <Button variant="secondary" data-testid={`cancel-invoice-${i.id}`} onClick={() => cancelInvoice(i)} className="!bg-rose-50 !text-rose-700 hover:!bg-rose-100 !border-rose-200">
                        <X size={14}/> Cancel
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-10">Tidak ada invoice untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-invoices"/>
      </Card>
    </div>
  );
}
