import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { FileText, Printer, FilePlus2, Download, CheckSquare, Square } from "lucide-react";
import * as XLSX from "xlsx";

export default function Invoices() {
  const { user } = useAuth();
  const [reconciled, setReconciled] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selected, setSelected] = useState(new Set());

  const load = async () => {
    const [rec, inv] = await Promise.all([
      api.get("/orders", { params: { status_v: "Reconciled" } }),
      api.get("/invoices"),
    ]);
    setReconciled(rec.data); setInvoices(inv.data); setSelected(new Set());
  };
  useEffect(() => { load(); }, []);

  const createInvoice = async (awb_id) => {
    try { await api.post("/invoices", { awb_id }); toast.success("Invoice dibuat"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const toggle = (id) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n);
  };
  const toggleAll = () => {
    if (selected.size === invoices.length) setSelected(new Set());
    else setSelected(new Set(invoices.map((r) => r.id)));
  };

  const bulkExport = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : invoices.map((i) => i.id);
    if (ids.length === 0) { toast.error("Tidak ada invoice"); return; }
    const wb = XLSX.utils.book_new();
    for (const id of ids) {
      try {
        const r = await api.get(`/invoices/${id}/full`);
        const { invoice, awb, customer, company } = r.data;
        const sheetData = [
          ["LAMPIRAN INVOICE", ""],
          ["No. Invoice", invoice.invoice_number],
          ["Tanggal", fmtDate(invoice.created_at)],
          [],
          ["Penerbit", company.name],
          ["NPWP", company.npwp],
          ["Alamat", company.address],
          [],
          ["Customer", customer?.name || ""],
          ["NPWP Customer", customer?.npwp || ""],
          ["Alamat Customer", customer?.address || ""],
          [],
          ["No. AWB", awb.awb_number],
          ["Origin", awb.origin],
          ["Destination", awb.destination],
          ["Item", awb.item_description],
          ["Goods Content", awb.goods_content],
          ["Qty (Kg)", awb.qty_kg],
          ["Tarif/Kg (IDR)", awb.tariff_per_kg],
          ["Total Tarif (IDR)", awb.total_tariff],
          [`PPN ${awb.tax_percentage}%`, awb.tax_amount],
          ["Grand Total (IDR)", awb.grand_total],
        ];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws["!cols"] = [{ wch: 24 }, { wch: 36 }];
        const sheetName = invoice.invoice_number.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      } catch (e) { /* skip */ }
    }
    XLSX.writeFile(wb, `Lampiran_Invoice_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Lampiran ter-export");
  };

  return (
    <div data-testid="invoices-page">
      <PageHeader title="Invoice" subtitle="Modul 5 — Buat invoice dari AWB Reconciled, cetak, dan export lampiran." />

      {user?.role === "operation" && (
        <Card className="mb-6">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
            <FilePlus2 size={16} className="text-blue-700"/>
            <h3 className="font-bold">AWB Reconciled — Siap Dibuat Invoice</h3>
            <span className="text-xs text-slate-500 ml-2">{reconciled.length} baris</span>
          </div>
          <Table>
            <thead><tr>
              <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
              <Th className="text-right">Grand Total</Th><Th className="text-right"></Th>
            </tr></thead>
            <tbody>
              {reconciled.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono font-semibold">{r.awb_number}</Td>
                  <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                  <Td>{r.customer_name}</Td>
                  <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                  <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                  <Td className="text-right">
                    <Button data-testid={`create-invoice-${r.id}`} onClick={() => createInvoice(r.id)}>
                      <FilePlus2 size={14}/> Buat Invoice
                    </Button>
                  </Td>
                </tr>
              ))}
              {reconciled.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-8">Tidak ada AWB Reconciled.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <FileText size={16} className="text-purple-700"/>
          <h3 className="font-bold">Daftar Invoice</h3>
          <span className="text-xs text-slate-500 ml-2">{invoices.length} baris</span>
          <div className="ml-auto">
            <Button data-testid="bulk-export-btn" variant="secondary" onClick={bulkExport} disabled={invoices.length === 0}>
              <Download size={14}/> Bulk Export Lampiran ({selected.size || invoices.length})
            </Button>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll}>
                {selected.size === invoices.length && invoices.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>No. Invoice</Th><Th>AWB</Th><Th>Customer</Th><Th>Tanggal</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`}>
                <Td>
                  <button onClick={() => toggle(i.id)}>
                    {selected.has(i.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
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
