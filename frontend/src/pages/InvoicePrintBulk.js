import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../lib/api";
import { Button } from "../components/ui";
import { Printer, ArrowLeft } from "lucide-react";
import { InvoicePrintStyles, InvoicePrintBody } from "./InvoicePrint";

// Bulk-print page: reads ?ids=id1,id2,... from the query string, fetches the
// /invoices/:id/full payload for each, and stacks them in one document so the
// user can press Print once to save all selected invoices as a single PDF.
export default function InvoicePrintBulk() {
  const { search } = useLocation();
  const [items, setItems] = useState(null); // null = loading, [] = none / no ids

  useEffect(() => {
    const params = new URLSearchParams(search);
    const ids = (params.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
    Promise.all(ids.map((id) => api.get(`/invoices/${id}/full`).then((r) => r.data).catch(() => null)))
      .then((results) => setItems(results.filter(Boolean)));
  }, [search]);

  if (items === null) return <div className="p-10 text-center text-slate-500">Memuat...</div>;
  if (items.length === 0) return <div className="p-10 text-center text-slate-500">Tidak ada invoice yang dapat dimuat.</div>;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0" data-testid="invoice-print-bulk-page">
      <InvoicePrintStyles />
      <div className="max-w-[210mm] mx-auto px-4 mb-4 flex items-center gap-2 no-print">
        <Button variant="secondary" onClick={() => window.close()}><ArrowLeft size={14}/> Tutup</Button>
        <div className="text-sm text-slate-600">{items.length} invoice siap dicetak</div>
        <Button data-testid="print-now-bulk-btn" onClick={() => window.print()} className="ml-auto"><Printer size={14}/> Cetak Semua ({items.length})</Button>
      </div>
      {items.map((data) => (
        <InvoicePrintBody key={data.invoice.id} data={data} />
      ))}
    </div>
  );
}
