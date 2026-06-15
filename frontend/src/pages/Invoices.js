import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { FilePlus2, CheckSquare, Square, FileSignature, FileText, ArrowRight } from "lucide-react";

export default function Invoices() {
  const { user } = useAuth();
  const [reconciled, setReconciled] = useState([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [selectedRec, setSelectedRec] = useState(new Set());

  const load = async () => {
    const [rec, inv] = await Promise.all([
      api.get("/orders", { params: { status_v: "Reconciled" } }),
      api.get("/invoices"),
    ]);
    setReconciled(rec.data);
    setCreatedCount(inv.data.length);
    setSelectedRec(new Set());
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

  return (
    <div data-testid="invoices-page">
      <PageHeader
        title="Pembuatan Invoice"
        subtitle="Buat invoice dari AWB Reconciled. Invoice tercetak ada di halaman terpisah."
        action={
          <Link to="/invoices/created">
            <Button data-testid="goto-invoices-created-btn" variant="secondary">
              <FileText size={16}/> Lihat Invoice Tercetak ({createdCount}) <ArrowRight size={14}/>
            </Button>
          </Link>
        }
      />

      {(user?.role === "operation" || user?.role === "administrator") && (
        <Card>
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
                    <button data-testid={`reconciled-toggle-${r.id}`} onClick={() => toggleRec(r.id)}>
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
              {reconciled.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">Tidak ada AWB Reconciled.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
