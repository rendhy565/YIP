import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { FilePlus2, CheckSquare, Square, FileSignature, FileText, ArrowRight, Search } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function Invoices() {
  const { user } = useAuth();
  const [reconciled, setReconciled] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [selectedRec, setSelectedRec] = useState(new Set());
  // Filters
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [filterMode, setFilterMode] = useState("AND");

  const load = async () => {
    const [rec, inv, cs] = await Promise.all([
      api.get("/orders", { params: { status_v: "Reconciled" } }),
      api.get("/invoices"),
      api.get("/customers"),
    ]);
    setReconciled(rec.data);
    setCreatedCount(inv.data.length);
    setCustomers(cs.data);
    setSelectedRec(new Set());
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.customer_name || ""} ${r.origin || ""} ${r.destination || ""}`.toLowerCase().includes(qStr));
    if (customerId) fns.push((r) => r.customer_id === customerId);
    if (fns.length === 0) return reconciled;
    return reconciled.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [reconciled, q, customerId, filterMode]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${filterMode}` });

  const createInvoice = async (awb_id) => {
    try { await api.post("/invoices", { awb_id }); toast.success("Invoice dibuat"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const bulkCreateInvoices = async () => {
    const ids = selectedRec.size > 0 ? Array.from(selectedRec) : filtered.map((r) => r.id);
    if (ids.length === 0) { toast.error("Tidak ada AWB siap invoice"); return; }
    try {
      const r = await api.post("/invoices/bulk", { awb_ids: ids });
      toast.success(`${r.data.created_count} invoice dibuat${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const toggleRec = (id) => { const n = new Set(selectedRec); n.has(id) ? n.delete(id) : n.add(id); setSelectedRec(n); };
  const toggleAllRec = () => {
    if (selectedRec.size === filtered.length) setSelectedRec(new Set());
    else setSelectedRec(new Set(filtered.map((r) => r.id)));
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
        <>
          <Card className="p-4 mb-5">
            <FilterPresets
              storageKey="invoice-creation"
              mode={filterMode}
              setMode={setFilterMode}
              currentFilters={{ q, customerId }}
              onLoadPreset={(f) => { setQ(f.q || ""); setCustomerId(f.customerId || ""); }}
              activeCount={[q.trim(), customerId].filter(Boolean).length}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[260px]">
                <Label>Cari (AWB / Customer / Rute)</Label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                  <Input data-testid="invoice-creation-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: AWB-..." className="pl-9"/>
                </div>
              </div>
              <div className="min-w-[220px]">
                <Label>Customer</Label>
                <select data-testid="invoice-creation-customer-filter" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10 rounded border border-slate-300 px-3 text-sm bg-white w-full">
                  <option value="">Semua Customer</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="ml-auto text-xs text-slate-500">{filtered.length} dari {reconciled.length} AWB</div>
            </div>
          </Card>

          <Card>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
              <FilePlus2 size={16} className="text-blue-700"/>
              <h3 className="font-bold">AWB Reconciled — Siap Dibuat Invoice</h3>
              <span className="text-xs text-slate-500 ml-2">{filtered.length} baris</span>
              <div className="ml-auto">
                <Button data-testid="bulk-create-invoice-btn" onClick={bulkCreateInvoices} disabled={filtered.length === 0}>
                  <FileSignature size={14}/> Bulk Create Invoice ({selectedRec.size || filtered.length})
                </Button>
              </div>
            </div>
            <Table>
              <thead><tr>
                <Th>
                  <button onClick={toggleAllRec}>
                    {selectedRec.size === filtered.length && filtered.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
                  </button>
                </Th>
                <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
                <Th className="text-right">Grand Total</Th><Th className="text-right"></Th>
              </tr></thead>
              <tbody>
                {pag.paged.map((r) => (
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
                {filtered.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">{reconciled.length === 0 ? "Tidak ada AWB Reconciled." : "Tidak ada hasil cocok dengan filter."}</Td></tr>}
              </tbody>
            </Table>
            <Pagination {...pag} testid="pagination-invoice-creation"/>
          </Card>
        </>
      )}
    </div>
  );
}
