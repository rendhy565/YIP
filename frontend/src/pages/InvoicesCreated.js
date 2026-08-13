import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { FileText, Printer, Download, CheckSquare, Square, Search, FileSpreadsheet, X, Upload, Save, Pencil } from "lucide-react";
import { useCan } from "../lib/useCan";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function InvoicesCreated() {
  const canCancel = useCan("invoices_created", "cancel");
  const canImportNumbers = useCan("invoices_created", "import_numbers");
  const canExportFpk = useCan("invoices_created", "export_fpk");
  const canExportAr = useCan("invoices_created", "export_ar");
  const canBulkPrint = useCan("invoices_created", "bulk_print");
  const canSavePoNumber = useCan("invoices_created", "save_po_number");
  const canEditInvoiceNumber = useCan("invoices_created", "edit_invoice_number");
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [company, setCompany] = useState("");
  const [filterMode, setFilterMode] = useState("OR"); // "OR" | "AND"
  const [monthFilter, setMonthFilter] = useState("");
  const [selected, setSelected] = useState(new Set());
  // Bulk download (ZIP of individual PDFs)
  const [showBulkDl, setShowBulkDl] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkValidation, setBulkValidation] = useState(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [poEdit, setPoEdit] = useState({}); // { invoice_id: po_number_string }
  const [savingPo, setSavingPo] = useState({});
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // Invoice Number import (mark AWB as Invoiced/Paid)
  const [showInvNoImport, setShowInvNoImport] = useState(false);
  const [invNoFile, setInvNoFile] = useState(null);
  const [invNoImporting, setInvNoImporting] = useState(false);
  const [invNoResult, setInvNoResult] = useState(null);
  // Cancel confirmation modal
  const [cancelInv, setCancelInv] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Edit invoice number modal
  const [editInv, setEditInv] = useState(null);
  const [editInvNo, setEditInvNo] = useState("");
  const [savingInvNo, setSavingInvNo] = useState(false);

  const [printModal, setPrintModal] = useState(null); // { mode:'single'|'bulk', inv?, ids?, count? }
  const [printDate, setPrintDate] = useState("");
  const [printing, setPrinting] = useState(false);
  const toYMD = (d) => { try { return d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } };

  const saveInvoiceNumber = async () => {
    if (!editInv) return;
    const val = (editInvNo || "").trim();
    if (!val) { toast.error("Nomor invoice tidak boleh kosong"); return; }
    setSavingInvNo(true);
    try {
      await api.patch(`/invoices/${editInv.id}/invoice-number`, { invoice_number: val });
      toast.success("Nomor invoice diperbarui");
      setEditInv(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingInvNo(false); }
  };


  const COMPANY_OPTIONS = ["PT. Abirama Mitra Pradana", "PT. Abirama Mitra Pratama"];

  // Sync poEdit state with loaded invoices (po_number from backend)
  useEffect(() => {
    const map = {};
    for (const inv of invoices) map[inv.id] = inv.po_number || "";
    setPoEdit(map);
  }, [invoices]);

  const savePoNumber = async (invId) => {
    setSavingPo((s) => ({ ...s, [invId]: true }));
    try {
      await api.patch(`/invoices/${invId}/po-number`, { po_number: poEdit[invId] || null });
      toast.success("Nomor PO disimpan");
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingPo((s) => ({ ...s, [invId]: false })); }
  };

  const downloadPoTemplate = async () => {
    try {
      const r = await api.get("/invoices/po-number-template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = "Invoice_PO_Number_Template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template Excel terdownload");
    } catch (e) { toast.error(errMsg(e)); }
  };

  const submitImport = async () => {
    if (!importFile) { toast.error("Pilih file Excel dulu"); return; }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const r = await api.post("/invoices/import-po-numbers", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${r.data.updated_count} invoice diupdate${r.data.not_found_count > 0 ? `, ${r.data.not_found_count} tidak ditemukan` : ""}`);
      setShowImport(false);
      setImportFile(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setImporting(false); }
  };

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
  const invMonth = (i) => (i.invoice_date || i.first_printed_at || i.created_at || "").slice(0, 7);
  const monthOptions = useMemo(() => {
    const set = new Set();
    for (const i of invoices) { const m = invMonth(i); if (m) set.add(m); }
    const ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return Array.from(set).sort().reverse().map((m) => ({ value: m, label: `${ID[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}` }));
  }, [invoices]);

  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const activeFilters = [];
    if (qStr) activeFilters.push((i) => `${i.invoice_number || ""} ${i.awb_number || ""} ${i.customer_name || ""} ${i.company_name || ""}`.toLowerCase().includes(qStr));
    if (customerId) activeFilters.push((i) => i.customer_id === customerId);
    if (company) activeFilters.push((i) => i.company_name === company);
    if (monthFilter) activeFilters.push((i) => invMonth(i) === monthFilter);
    if (activeFilters.length === 0) return invoices;
    return invoices.filter((i) => filterMode === "AND" ? activeFilters.every((fn) => fn(i)) : activeFilters.some((fn) => fn(i)));
  }, [invoices, q, customerId, company, monthFilter, filterMode]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${company}|${monthFilter}|${filterMode}` });

  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.id)));
  };

  const cancelInvoice = (inv) => {
    setCancelInv(inv);
  };

  const confirmCancel = async () => {
    if (!cancelInv) return;
    setCancelling(true);
    try {
      const r = await api.post(`/invoices/${cancelInv.id}/cancel`);
      toast.success(`Invoice ${r.data.invoice_number} dibatalkan. ${r.data.awbs_reverted.length} AWB → Reconciled. ${r.data.journals_deleted} jurnal dihapus.`);
      setCancelInv(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setCancelling(false); }
  };

  const handlePrint = (inv) => {
    setPrintModal({ mode: "single", inv });
    setPrintDate(inv.invoice_date ? toYMD(inv.invoice_date) : toYMD());
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

  const exportFpk = async () => {
    const ids = targetIds();
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    try {
      const r = await api.post("/invoices/export-fpk", { invoice_ids: ids }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = `FPK_EMR_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`FPK (${ids.length} faktur) ter-export`);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const bulkPrint = () => {
    const ids = targetIds();
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    setPrintModal({ mode: "bulk", ids, count: ids.length });
    setPrintDate(toYMD());
  };

  const confirmPrint = async () => {
    if (!printModal) return;
    setPrinting(true);
    try {
      if (printModal.mode === "single") {
        const inv = printModal.inv;
        await api.post(`/invoices/${inv.id}/mark-printed`, { print_date: printDate, use_old_date: false });
        const r = await api.get(`/invoices/${inv.id}/pdf`, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
        window.open(url, "_blank");
        toast.success("Invoice dicetak — tanggal & jurnal disinkronkan");
      } else {
        const r = await api.post("/invoices/bulk-print-pdf", { invoice_ids: printModal.ids, print_date: printDate }, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
        window.open(url, "_blank");
        toast.success(`${printModal.count} invoice dicetak dalam 1 PDF`);
      }
      setPrintModal(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setPrinting(false); }
  };

  const openBulkDl = () => {
    const ids = selected.size > 0 ? Array.from(selected) : [];
    const nums = invoices.filter((i) => ids.includes(i.id)).map((i) => i.invoice_number);
    setBulkText(nums.join("\n"));
    setBulkValidation(null);
    setShowBulkDl(true);
  };
  const checkBulk = async () => {
    if (!bulkText.trim()) { toast.error("Masukkan nomor invoice dulu"); return; }
    setBulkChecking(true); setBulkValidation(null);
    try {
      const r = await api.post("/invoices/bulk-download/validate", { invoice_numbers: [bulkText] });
      setBulkValidation(r.data);
      if (r.data.found.length === 0) toast.error("Tidak ada nomor invoice yang cocok");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBulkChecking(false); }
  };
  const downloadBulk = async () => {
    setBulkDownloading(true);
    try {
      const r = await api.post("/invoices/bulk-download", { invoice_numbers: [bulkText] }, { responseType: "blob" });
      const found = r.headers["x-found-count"] || "";
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url; a.download = `Invoices_${found}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
      toast.success(`${found} invoice didownload (ZIP)`);
      setShowBulkDl(false);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBulkDownloading(false); }
  };

  return (
    <div data-testid="invoices-created-page">
      <PageHeader
        title="Invoice Tercetak"
        subtitle="Filter, print, export, dan import invoice yang sudah dibuat."
        action={
          <div className="flex gap-2 flex-wrap">
            {canImportNumbers && (
              <Button data-testid="import-invoice-no-btn" variant="secondary" onClick={() => { setShowInvNoImport(true); setInvNoFile(null); setInvNoResult(null); }}><Upload size={16}/> Import Invoice No (Mark Status)</Button>
            )}
            {canSavePoNumber && (
              <Button variant="secondary" onClick={() => setShowImport(true)}><Upload size={16}/> Import PO Number</Button>
            )}
            <Link to="/invoices">
              <Button variant="secondary"><FileText size={16}/> Ke Pembuatan Invoice</Button>
            </Link>
          </div>
        }
      />

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="invoices"
          mode={filterMode}
          setMode={setFilterMode}
          currentFilters={{ q, customerId, company, monthFilter }}
          onLoadPreset={(f) => { setQ(f.q || ""); setCustomerId(f.customerId || ""); setCompany(f.company || ""); setMonthFilter(f.monthFilter || ""); }}
          activeCount={[q.trim(), customerId, company, monthFilter].filter(Boolean).length}
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
          <div className="min-w-[200px]">
            <Label>Filter Bulan (Tgl Invoice)</Label>
            <Select data-testid="invoice-month-filter" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">Semua Bulan</option>
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
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
            {canSavePoNumber && (
              <Button data-testid="import-po-btn" variant="secondary" onClick={() => setShowImport(true)}>
                <Upload size={14}/> Import PO Number
              </Button>
            )}
            {canExportAr && (
              <Button data-testid="export-report-ar-from-invoices-btn" variant="secondary" onClick={exportReportAr}>
                <FileSpreadsheet size={14}/> Export REPORT AR (filter)
              </Button>
            )}
            {canExportFpk && (
              <Button data-testid="export-fpk-btn" variant="secondary" onClick={exportFpk} className="!bg-amber-50 !text-amber-900 hover:!bg-amber-100 !border-amber-300">
                <FileSpreadsheet size={14}/> Export FPK (Faktur Pajak)
              </Button>
            )}
            {canBulkPrint && (
              <>
              <Button data-testid="bulk-print-pdf-btn" variant="secondary" onClick={bulkPrint}>
                <Printer size={14}/> Print to PDF ({selected.size || filtered.length})
              </Button>
              <Button data-testid="bulk-download-zip-btn" variant="secondary" onClick={openBulkDl} className="!bg-purple-50 !text-purple-800 hover:!bg-purple-100 !border-purple-300">
                <Download size={14}/> Bulk Download ZIP
              </Button>
              </>
            )}
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll}>
                {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>No. Invoice</Th><Th>No. PO</Th><Th>AWB</Th><Th>Company</Th><Th>Customer</Th><Th>Tanggal</Th>
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
                <Td className="font-mono font-semibold">
                  <div className="flex items-center gap-1">
                    <span data-testid={`invoice-number-${i.id}`}>{i.invoice_number}</span>
                    {canEditInvoiceNumber && (
                      <button
                        data-testid={`edit-invoice-number-${i.id}`}
                        onClick={() => { setEditInv(i); setEditInvNo(i.invoice_number || ""); }}
                        title="Edit Nomor Invoice"
                        className="p-1 rounded text-slate-400 hover:text-blue-700 hover:bg-blue-50"
                      >
                        <Pencil size={12}/>
                      </button>
                    )}
                  </div>
                </Td>
                <Td className="whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Input
                      data-testid={`po-input-${i.id}`}
                      value={poEdit[i.id] || ""}
                      onChange={(e) => setPoEdit({ ...poEdit, [i.id]: e.target.value })}
                      placeholder="No. PO"
                      disabled={!canSavePoNumber}
                      className="!h-8 !text-xs !w-28"
                    />
                    {canSavePoNumber && (poEdit[i.id] || "") !== (i.po_number || "") && (
                      <button data-testid={`save-po-${i.id}`} onClick={() => savePoNumber(i.id)} disabled={savingPo[i.id]} title="Simpan No PO" className="p-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                        <Save size={12}/>
                      </button>
                    )}
                  </div>
                </Td>
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
                    {canCancel && i.awb_status !== "Paid" && (
                      <Button variant="secondary" data-testid={`cancel-invoice-${i.id}`} onClick={() => cancelInvoice(i)} className="!bg-rose-50 !text-rose-700 hover:!bg-rose-100 !border-rose-200">
                        <X size={14}/> Cancel
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={10} className="text-center text-slate-500 py-10">Tidak ada invoice untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-invoices"/>
      </Card>

      {/* IMPORT PO NUMBER MODAL */}
      {showImport && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="import-po-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><Upload className="inline mr-2" size={18}/>Import Nomor PO</h3>
              <button onClick={() => { setShowImport(false); setImportFile(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs">
                <p className="font-semibold text-blue-900 mb-1">Cara pakai:</p>
                <ol className="list-decimal pl-4 space-y-0.5 text-blue-800">
                  <li>Download template Excel di bawah</li>
                  <li>Isi kolom A (Invoice Number) & B (PO Number)</li>
                  <li>Upload file di bawah, klik Import</li>
                </ol>
              </div>
              <Button data-testid="download-po-template-btn" variant="secondary" onClick={downloadPoTemplate} className="w-full">
                <Download size={14}/> Download Template Excel
              </Button>
              <div>
                <Label>Pilih file Excel (.xlsx) *</Label>
                <input
                  data-testid="import-po-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                />
                {importFile && <p className="text-[11px] text-slate-600 mt-1">File: {importFile.name}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => { setShowImport(false); setImportFile(null); }}>Batal</Button>
              <Button data-testid="confirm-import-po-btn" onClick={submitImport} disabled={importing || !importFile}>
                {importing ? "Memproses..." : (<><Upload size={14}/> Import</>)}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Invoice Number Import Modal — marks AWB as Invoiced/Paid */}
      {showInvNoImport && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-heading font-bold text-xl">Import Invoice Number</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Format kolom: <code className="bg-slate-100 px-1 rounded">Invoice Number</code>, <code className="bg-slate-100 px-1 rounded">AWB Number</code>, <code className="bg-slate-100 px-1 rounded">Status</code> (Invoiced/Paid), <code className="bg-slate-100 px-1 rounded">Paid Date</code> (opt).
                </p>
              </div>
              <button onClick={() => { setShowInvNoImport(false); setInvNoFile(null); setInvNoResult(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="space-y-3">
              <Button data-testid="download-invno-template-btn" variant="secondary" onClick={async () => {
                try {
                  const r = await api.get("/invoices/import-numbers-template", { responseType: "blob" });
                  const url = window.URL.createObjectURL(new Blob([r.data]));
                  const a = document.createElement("a"); a.href = url;
                  a.download = "Template_Import_Invoice_Number.xlsx";
                  document.body.appendChild(a); a.click(); a.remove();
                  window.URL.revokeObjectURL(url);
                  toast.success("Template terdownload");
                } catch (e) { toast.error(errMsg(e)); }
              }} className="w-full"><Download size={14}/> Download Template Excel</Button>

              <input
                data-testid="inv-no-file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => { setInvNoFile(e.target.files?.[0] || null); setInvNoResult(null); }}
                className="block w-full text-sm border border-slate-300 rounded p-2"
              />

              {invNoResult && (
                <div className="border border-emerald-300 bg-emerald-50 rounded p-3 text-sm space-y-1">
                  <div className="font-bold text-emerald-900">✓ Import Selesai</div>
                  <div>✓ <strong>{invNoResult.marked_invoiced}</strong> AWB di-mark Invoiced</div>
                  <div>✓ <strong>{invNoResult.marked_paid}</strong> AWB di-mark Paid</div>
                  {invNoResult.skipped > 0 && <div className="text-amber-700">⚠ {invNoResult.skipped} baris di-skip</div>}
                  {invNoResult.errors?.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-red-700 text-xs">
                        {invNoResult.errors.length + (invNoResult.errors_truncated || 0)} error
                        {invNoResult.errors_truncated > 0 && ` (menampilkan ${invNoResult.errors.length} pertama, ${invNoResult.errors_truncated} lainnya tidak ditampilkan)`}
                      </summary>
                      <ul className="text-xs list-disc pl-5 max-h-60 overflow-y-auto">
                        {invNoResult.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-700">
                <strong>Cara kerja:</strong>
                <ul className="list-disc pl-5 mt-1">
                  <li>Status = &quot;Invoiced&quot; → set AWB status Invoiced + simpan Invoice Number</li>
                  <li>Status = &quot;Paid&quot; → set AWB status Paid + tanggal bayar</li>
                  <li>Matching by AWB Number (case-insensitive)</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => { setShowInvNoImport(false); setInvNoFile(null); setInvNoResult(null); }}>Tutup</Button>
              <Button
                data-testid="confirm-import-invno-btn"
                onClick={async () => {
                  if (!invNoFile) { toast.error("Pilih file"); return; }
                  setInvNoImporting(true);
                  try {
                    const fd = new FormData();
                    fd.append("file", invNoFile);
                    const r = await api.post("/invoices/import-numbers", fd, { headers: { "Content-Type": "multipart/form-data" } });
                    setInvNoResult(r.data);
                    toast.success(`${r.data.marked_invoiced} Invoiced + ${r.data.marked_paid} Paid`);
                    load();
                  } catch (e) { toast.error(errMsg(e)); }
                  finally { setInvNoImporting(false); }
                }}
                disabled={invNoImporting || !invNoFile}
              >
                {invNoImporting ? "Memproses..." : <><Upload size={14}/> Import</>}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Cancel Invoice Confirmation Modal */}
      {cancelInv && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="cancel-invoice-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <X size={20}/>
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-bold text-xl">Batalkan Invoice?</h3>
                <p className="text-xs text-slate-500 mt-1">Aksi ini tidak dapat dibatalkan setelah konfirmasi.</p>
              </div>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs space-y-1 mb-4">
              <div><strong>Invoice:</strong> <span className="font-mono">{cancelInv.invoice_number}</span></div>
              <div><strong>AWB:</strong> <span className="font-mono">{(cancelInv.awb_numbers || [cancelInv.awb_number]).join(", ")}</span></div>
              <div><strong>Grand Total:</strong> {fmtIDR(cancelInv.grand_total)}</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-[11px] text-amber-900 mb-4">
              <strong>Efek:</strong>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                <li>AWB kembali ke status <strong>RECONCILED</strong> (siap dibuat invoice ulang)</li>
                <li>Jurnal Piutang &amp; PPN dihapus (akunting dibalik)</li>
                <li>Tidak bisa dilakukan jika sudah ada pembayaran (Paid)</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="secondary" type="button" onClick={() => setCancelInv(null)} disabled={cancelling}>Batal</Button>
              <Button data-testid="confirm-cancel-invoice-btn" onClick={confirmCancel} disabled={cancelling} className="!bg-rose-600 !text-white hover:!bg-rose-700 !border-rose-600">
                <X size={14}/> {cancelling ? "Memproses..." : "Ya, Batalkan Invoice"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Invoice Number Modal */}
      {editInv && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="edit-invoice-number-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><Pencil className="inline mr-2" size={18}/>Edit Nomor Invoice</h3>
              <button onClick={() => setEditInv(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-600">
                <div><strong>AWB:</strong> <span className="font-mono">{(editInv.awb_numbers || [editInv.awb_number]).join(", ")}</span></div>
                <div><strong>Customer:</strong> {editInv.customer_name || "—"}</div>
              </div>
              <div>
                <Label>Nomor Invoice *</Label>
                <Input
                  data-testid="edit-invoice-number-input"
                  value={editInvNo}
                  onChange={(e) => setEditInvNo(e.target.value)}
                  placeholder="contoh: INV-202606-0001"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") saveInvoiceNumber(); }}
                />
                <p className="text-[11px] text-slate-500 mt-1">Nomor invoice dokumen akan berubah + memo jurnal terkait ikut disinkronkan.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setEditInv(null)} disabled={savingInvNo}>Batal</Button>
              <Button data-testid="confirm-edit-invoice-number-btn" onClick={saveInvoiceNumber} disabled={savingInvNo || !editInvNo.trim()}>
                <Save size={14}/> {savingInvNo ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Bulk Download ZIP Modal */}
      {showBulkDl && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="bulk-download-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><Download className="inline mr-2" size={18}/>Bulk Download Invoice (ZIP)</h3>
              <button onClick={() => setShowBulkDl(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <p className="text-xs text-slate-500 mb-2">Tempel nomor-nomor invoice yang mau di-download. Pemisah bebas (baris baru, koma, titik-koma, spasi). Hasil: 1 file PDF per invoice (cover + lampiran, 2 halaman), diberi nama = nomor invoice, semua dibungkus dalam 1 ZIP.</p>
            <textarea
              data-testid="bulk-download-textarea"
              value={bulkText}
              onChange={(e) => { setBulkText(e.target.value); setBulkValidation(null); }}
              rows={7}
              className="w-full border border-slate-300 rounded p-2 text-sm font-mono"
              placeholder={"INV/AR-EMR/0526/00859\nINV/AR-EMR/0526/00860\n..."}
            />
            {bulkValidation && (
              <div className="mt-3 text-sm space-y-2" data-testid="bulk-download-validation">
                <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-900">
                  <strong>{bulkValidation.found.length}</strong> invoice ditemukan &amp; siap didownload.
                </div>
                {bulkValidation.missing.length > 0 && (
                  <div className="rounded bg-rose-50 border border-rose-200 px-3 py-2 text-rose-900 max-h-32 overflow-auto">
                    <strong>{bulkValidation.missing.length}</strong> tidak ditemukan (dilewati): <span className="font-mono text-xs">{bulkValidation.missing.join(", ")}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setShowBulkDl(false)} disabled={bulkDownloading}>Tutup</Button>
              {!bulkValidation || bulkValidation.found.length === 0 ? (
                <Button data-testid="bulk-download-check-btn" onClick={checkBulk} disabled={bulkChecking || !bulkText.trim()}>
                  <Search size={14}/> {bulkChecking ? "Mengecek..." : "Cek Nomor Invoice"}
                </Button>
              ) : (
                <Button data-testid="bulk-download-confirm-btn" onClick={downloadBulk} disabled={bulkDownloading}>
                  <Download size={14}/> {bulkDownloading ? "Menyiapkan ZIP..." : `Download ${bulkValidation.found.length} Invoice`}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Print Invoice — Date Picker Modal (single & bulk) */}
      {printModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="print-date-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><Printer className="inline mr-2" size={18}/>
                {printModal.mode === "single" ? "Cetak Invoice" : `Cetak ${printModal.count} Invoice (1 PDF)`}
              </h3>
              <button onClick={() => setPrintModal(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              {printModal.mode === "single" && (
                <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-600">
                  <div><strong>Invoice:</strong> <span className="font-mono">{printModal.inv?.invoice_number}</span></div>
                  <div><strong>Customer:</strong> {printModal.inv?.customer_name || "—"}</div>
                </div>
              )}
              <div>
                <Label>Tanggal Invoice *</Label>
                <Input
                  data-testid="print-date-input"
                  type="date"
                  value={printDate}
                  onChange={(e) => setPrintDate(e.target.value)}
                  autoFocus
                />
                <p className="text-[11px] text-slate-500 mt-1">Tanggal ini dipakai di dokumen PDF (Date & Due Date +30 hari) <strong>dan</strong> disinkronkan ke tanggal jurnal Piutang/PPN.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setPrintModal(null)} disabled={printing}>Batal</Button>
              <Button data-testid="confirm-print-btn" onClick={confirmPrint} disabled={printing || !printDate}>
                <Printer size={14}/> {printing ? "Menyiapkan PDF..." : "Cetak PDF"}
              </Button>
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}
