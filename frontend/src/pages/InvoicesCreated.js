import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { FileText, Printer, Download, CheckSquare, Square, Search, FileSpreadsheet } from "lucide-react";

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

  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.id)));
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
    ids.forEach((id) => window.open(`/arc/invoices/${id}/print`, "_blank"));
    toast.success(`${ids.length} invoice dibuka di tab baru. Ctrl+P → Save as PDF.`);
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
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Mode Filter:</span>
          <div className="inline-flex rounded border border-slate-300 overflow-hidden" data-testid="filter-mode-toggle">
            <button
              type="button"
              data-testid="filter-mode-or"
              onClick={() => setFilterMode("OR")}
              className={`px-3 py-1 text-xs font-bold uppercase ${filterMode === "OR" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >OR (cocok salah satu)</button>
            <button
              type="button"
              data-testid="filter-mode-and"
              onClick={() => setFilterMode("AND")}
              className={`px-3 py-1 text-xs font-bold uppercase border-l border-slate-300 ${filterMode === "AND" ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >AND (harus cocok semua)</button>
          </div>
          <span className="text-[11px] text-slate-500 ml-auto">
            {[q.trim() && "Cari", customerId && "Customer", company && "Company"].filter(Boolean).length > 0
              ? `${[q.trim() && "Cari", customerId && "Customer", company && "Company"].filter(Boolean).length} filter aktif`
              : "Tidak ada filter aktif"}
          </span>
        </div>
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
            <Button data-testid="export-invoice-excel-btn" variant="secondary" onClick={exportInvoiceExcel}>
              <Download size={14}/> Export Invoice Excel
            </Button>
            <Button data-testid="bulk-print-pdf-btn" variant="secondary" onClick={bulkPrint}>
              <Printer size={14}/> Print to PDF
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
            {filtered.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`}>
                <Td>
                  <button data-testid={`invoice-toggle-${i.id}`} onClick={() => toggle(i.id)}>
                    {selected.has(i.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{i.invoice_number}</Td>
                <Td className="font-mono">{i.awb_number}</Td>
                <Td className="text-xs">{i.company_name || <span className="text-slate-400">—</span>}</Td>
                <Td>{i.customer_name}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(i.created_at)}</Td>
                <Td className="text-right font-semibold">{fmtIDR(i.grand_total)}</Td>
                <Td><StatusBadge status={i.awb_status}/></Td>
                <Td className="text-right">
                  <Link to={`/invoices/${i.id}/print`} target="_blank">
                    <Button variant="secondary" data-testid={`print-invoice-${i.id}`}><Printer size={14}/> Print</Button>
                  </Link>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-10">Tidak ada invoice untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
