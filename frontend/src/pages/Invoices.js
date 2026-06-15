import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { FileText, Printer, FilePlus2, Download, CheckSquare, Square, FileSignature } from "lucide-react";

export default function Invoices() {
  const { user } = useAuth();
  const [reconciled, setReconciled] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedRec, setSelectedRec] = useState(new Set());
  const [selectedInv, setSelectedInv] = useState(new Set());

  const load = async () => {
    const [rec, inv] = await Promise.all([
      api.get("/orders", { params: { status_v: "Reconciled" } }),
      api.get("/invoices"),
    ]);
    setReconciled(rec.data); setInvoices(inv.data);
    setSelectedRec(new Set()); setSelectedInv(new Set());
  };
  useEffect(() => { load(); }, []);

  const createInvoice = async (awb_id) => {
    try { await api.post("/invoices", { awb_id }); toast.success("Invoice dibuat"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const bulkCreateInvoices = async () => {
    const ids = selectedRec.size > 0 ? Array.from(selectedRec) : reconciled.map((r) => r.id);
    if (ids.length === 0) { toast.error("Tidak ada AWB siap invoice"); return; }
    try {
      const r = await api.post("/invoices/bulk", { awb_ids: ids });
      toast.success(`${r.data.created_count} invoice dibuat${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const toggleRec = (id) => { const n = new Set(selectedRec); n.has(id) ? n.delete(id) : n.add(id); setSelectedRec(n); };
  const toggleAllRec = () => {
    if (selectedRec.size === reconciled.length) setSelectedRec(new Set());
    else setSelectedRec(new Set(reconciled.map((r) => r.id)));
  };
  const toggleInv = (id) => { const n = new Set(selectedInv); n.has(id) ? n.delete(id) : n.add(id); setSelectedInv(n); };
  const toggleAllInv = () => {
    if (selectedInv.size === invoices.length) setSelectedInv(new Set());
    else setSelectedInv(new Set(invoices.map((i) => i.id)));
  };

  const bulkExport = async () => {
    const ids = selectedInv.size > 0 ? Array.from(selectedInv) : invoices.map((i) => i.id);
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    try {
      if (ids.length === 1) {
        const r = await api.get(`/exports/invoice/${ids[0]}`, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const inv = invoices.find((i) => i.id === ids[0]);
        const a = document.createElement("a"); a.href = url;
        a.download = `Invoice_${inv?.invoice_number || ids[0]}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
        toast.success("Invoice ter-export");
      } else {
        const r = await api.post(`/exports/invoices/bulk`, { invoice_ids: ids }, { responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement("a"); a.href = url;
        a.download = `Invoice_Bulk_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
        toast.success(`Bulk export ${ids.length} invoice`);
      }
    } catch (e) { toast.error(errMsg(e)); }
  };

  const bulkPrintPdf = () => {
    const ids = selectedInv.size > 0 ? Array.from(selectedInv) : invoices.map((i) => i.id);
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    // Open each invoice in new tab — user can save as PDF via browser
    ids.forEach((id) => window.open(`/arc/invoices/${id}/print`, "_blank"));
    toast.success(`${ids.length} invoice dibuka. Gunakan Ctrl+P → Save as PDF di tiap tab.`);
  };

  return (
    <div data-testid="invoices-page">
      <PageHeader title="Invoice" subtitle="Bulk create, print, dan export lampiran dari AWB Reconciled." />

      {(user?.role === "operation" || user?.role === "administrator") && (
        <Card className="mb-6">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <FilePlus2 size={16} className="text-blue-700"/>
            <h3 className="font-bold">AWB Reconciled — Siap Dibuat Invoice</h3>
            <span className="text-xs text-slate-500 ml-2">{reconciled.length} baris</span>
            <div className="ml-auto">
              <Button data-testid="bulk-create-invoice-btn" onClick={bulkCreateInvoices} disabled={reconciled.length === 0}>
                <FileSignature size={14}/> Bulk Create Invoice ({selectedRec.size || reconciled.length})
              </Button>
            </div>
          </div>
          <Table>
            <thead><tr>
              <Th>
                <button onClick={toggleAllRec}>
                  {selectedRec.size === reconciled.length && reconciled.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
                </button>
              </Th>
              <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
              <Th className="text-right">Grand Total</Th><Th className="text-right"></Th>
            </tr></thead>
            <tbody>
              {reconciled.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <button onClick={() => toggleRec(r.id)}>
                      {selectedRec.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                    </button>
                  </Td>
                  <Td className="font-mono font-semibold">{r.awb_number}</Td>
                  <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                  <Td>{r.customer_name}</Td>
                  <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                  <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                  <Td className="text-right">
                    <Button data-testid={`create-invoice-${r.id}`} onClick={() => createInvoice(r.id)}>
                      <FilePlus2 size={14}/> Buat
                    </Button>
                  </Td>
                </tr>
              ))}
              {reconciled.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Tidak ada AWB Reconciled.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <FileText size={16} className="text-purple-700"/>
          <h3 className="font-bold">Daftar Invoice</h3>
          <span className="text-xs text-slate-500 ml-2">{invoices.length} baris</span>
          <div className="ml-auto flex gap-2">
            <Button data-testid="bulk-print-pdf-btn" variant="secondary" onClick={bulkPrintPdf} disabled={invoices.length === 0}>
              <Printer size={14}/> Print to PDF ({selectedInv.size || invoices.length})
            </Button>
            <Button data-testid="bulk-export-btn" variant="secondary" onClick={bulkExport} disabled={invoices.length === 0}>
              <Download size={14}/> Export Excel ({selectedInv.size || invoices.length})
            </Button>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAllInv}>
                {selectedInv.size === invoices.length && invoices.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>No. Invoice</Th><Th>AWB</Th><Th>Customer</Th><Th>Tanggal</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`}>
                <Td>
                  <button onClick={() => toggleInv(i.id)}>
                    {selectedInv.has(i.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{i.invoice_number}</Td>
                <Td className="font-mono">{i.awb_number}</Td>
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
            {invoices.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-8">Belum ada invoice.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
