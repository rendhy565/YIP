import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { BadgeDollarSign, CheckCircle2, CheckSquare, Square, X, Search } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Payments() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(null); // "single" / "bulk"
  const [targetRow, setTargetRow] = useState(null);
  const [form, setForm] = useState({ payment_invoice_number: "", paid_date: todayStr() });
  const [saving, setSaving] = useState(false);
  // Filters
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customers, setCustomers] = useState([]);
  const [filterMode, setFilterMode] = useState("AND");

  const load = () => {
    Promise.all([
      api.get("/orders", { params: { status_v: "Invoiced" } }),
      api.get("/customers"),
    ]).then(([r, c]) => { setRows(r.data); setCustomers(c.data); setSelected(new Set()); });
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.customer_name || ""} ${r.origin || ""} ${r.destination || ""}`.toLowerCase().includes(qStr));
    if (customerId) fns.push((r) => r.customer_id === customerId);
    if (fns.length === 0) return rows;
    return rows.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [rows, q, customerId, filterMode]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${filterMode}` });

  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const openSingle = (r) => {
    setTargetRow(r);
    setForm({ payment_invoice_number: "", paid_date: todayStr() });
    setShowModal("single");
  };

  const openBulk = () => {
    if (selected.size === 0) { toast.error("Pilih minimal 1 AWB"); return; }
    setForm({ payment_invoice_number: "", paid_date: todayStr() });
    setShowModal("bulk");
  };

  const submitSingle = async () => {
    if (!targetRow) return;
    setSaving(true);
    try {
      await api.post(`/orders/${targetRow.id}/mark-paid`, {
        payment_invoice_number: form.payment_invoice_number || null,
        paid_date: form.paid_date || null,
      });
      toast.success(`AWB ${targetRow.awb_number} ditandai LUNAS`);
      setShowModal(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const submitBulk = async () => {
    setSaving(true);
    try {
      const r = await api.post("/payments/bulk-mark-paid", {
        awb_ids: Array.from(selected),
        payment_invoice_number: form.payment_invoice_number || null,
        paid_date: form.paid_date || null,
      });
      toast.success(`${r.data.paid_count} AWB ditandai LUNAS${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      setShowModal(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const total = rows.reduce((s, r) => s + (r.grand_total || 0), 0);
  const selectedTotal = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + (r.grand_total || 0), 0);

  return (
    <div data-testid="payments-page">
      <PageHeader title="Pembayaran (Closing)" subtitle="Tandai invoice LUNAS — single atau bulk. Wajib isi No. Invoice yang dibayar." />

      <Card className="p-5 mb-5 bg-purple-50 border-purple-200">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded bg-purple-700 text-white flex items-center justify-center"><BadgeDollarSign size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-purple-700">Outstanding Receivable</div>
            <div className="font-heading font-black text-3xl text-purple-900">{fmtIDR(total)}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {selected.size > 0 && (
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-purple-700">Selected</div>
                <div className="font-mono font-bold text-purple-900">{fmtIDR(selectedTotal)} · {selected.size} AWB</div>
              </div>
            )}
            <Button data-testid="bulk-mark-paid-btn" variant="success" onClick={openBulk} disabled={selected.size === 0}>
              <CheckCircle2 size={14}/> Bulk Mark Paid ({selected.size})
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="payments"
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
              <Input data-testid="payments-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: AWB-..." className="pl-9"/>
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label>Customer</Label>
            <select data-testid="payments-customer-filter" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10 rounded border border-slate-300 px-3 text-sm bg-white w-full">
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="ml-auto text-xs text-slate-500">{filtered.length} dari {rows.length} invoice</div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll}>
                {selected.size === rows.length && rows.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`payment-row-${r.id}`}>
                <Td>
                  <button onClick={() => toggle(r.id)}>
                    {selected.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">
                  <Button data-testid={`mark-paid-${r.id}`} variant="success" onClick={() => openSingle(r)}>
                    <CheckCircle2 size={14}/> Mark Paid
                  </Button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Tidak ada invoice menunggu pembayaran.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-payments"/>
      </Card>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="mark-paid-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Tandai LUNAS</h3>
                <p className="text-xs text-slate-500">
                  {showModal === "single"
                    ? `AWB ${targetRow?.awb_number} · ${fmtIDR(targetRow?.grand_total || 0)}`
                    : `${selected.size} AWB · Total ${fmtIDR(selectedTotal)}`}
                </p>
              </div>
              <button type="button" onClick={() => setShowModal(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>No. Invoice yang Dibayar *</Label>
                <Input data-testid="payment-invoice-number" value={form.payment_invoice_number} onChange={(e) => setForm({ ...form, payment_invoice_number: e.target.value })} placeholder="Nomor invoice eksternal/customer" required/>
              </div>
              <div>
                <Label>Tanggal Bayar</Label>
                <Input data-testid="payment-paid-date" type="date" value={form.paid_date} onChange={(e) => setForm({ ...form, paid_date: e.target.value })}/>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setShowModal(null)}>Batal</Button>
              <Button data-testid="confirm-mark-paid-btn" variant="success" onClick={showModal === "single" ? submitSingle : submitBulk} disabled={saving || !form.payment_invoice_number}>
                <CheckCircle2 size={14}/> {saving ? "Memproses..." : "Tandai LUNAS"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
