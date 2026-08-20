import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { BadgeDollarSign, CheckCircle2, CheckSquare, Square, X, Search, Plus, Trash2 } from "lucide-react";
import { useCan } from "../lib/useCan";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";
import NumberInput from "../components/NumberInput";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Payments() {
  const canMarkPaid = useCan("payments", "mark_paid");
  const canMarkPaidBulk = useCan("payments", "mark_paid_bulk");
  const canMultiPayment = useCan("payments", "multi_payment");
  const canDeleteReceipt = useCan("payments", "delete_receipt");
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
  const [monthFilter, setMonthFilter] = useState("");
  // Multi-receiver payment modal
  const [multiAwb, setMultiAwb] = useState(null);
  const [payments, setPayments] = useState({ receipts: [], grand_total: 0, total_paid: 0, remaining: 0, is_fully_paid: false });
  const [newPay, setNewPay] = useState({ amount: "", payment_date: todayStr(), payment_method: "Transfer", reference_no: "", notes: "" });

  const load = () => {
    Promise.all([
      api.get("/orders", { params: { status_v: "Invoiced,Paid" } }),
      api.get("/customers"),
    ]).then(([r, c]) => { setRows(r.data); setCustomers(c.data); setSelected(new Set()); });
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (multiAwb?.id) {
      api.get(`/orders/${multiAwb.id}/payments`).then((r) => setPayments(r.data)).catch(() => {});
    }
  }, [multiAwb]);

  const addPayment = async () => {
    if (!newPay.amount || parseFloat(newPay.amount) <= 0) { toast.error("Amount harus > 0"); return; }
    try {
      await api.post(`/orders/${multiAwb.id}/payments`, { ...newPay, amount: parseFloat(newPay.amount) });
      toast.success("Pembayaran ditambahkan");
      const r = await api.get(`/orders/${multiAwb.id}/payments`);
      setPayments(r.data);
      setNewPay({ amount: "", payment_date: todayStr(), payment_method: "Transfer", reference_no: "", notes: "" });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const delPayment = async (rid) => {
    if (!window.confirm("Hapus pembayaran ini?")) return;
    try {
      await api.delete(`/payment-receipts/${rid}`);
      const r = await api.get(`/orders/${multiAwb.id}/payments`);
      setPayments(r.data);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.invoice_number || ""} ${r.external_invoice_number || ""} ${r.customer_name || ""} ${r.origin || ""} ${r.destination || ""}`.toLowerCase().includes(qStr));
    if (customerId) fns.push((r) => r.customer_id === customerId);
    if (monthFilter) fns.push((r) => String(r.created_at || "").slice(0, 7) === monthFilter);
    if (fns.length === 0) return rows;
    return rows.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [rows, q, customerId, monthFilter, filterMode]);

  // Opsi bulan AWB (berdasarkan tanggal AWB / created_at), terbaru dulu
  const MONTH_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const monthOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.created_at) set.add(String(r.created_at).slice(0, 7)); });
    return Array.from(set).sort().reverse().map((ym) => {
      const [y, m] = ym.split("-");
      return { value: ym, label: `${MONTH_ID[parseInt(m, 10) - 1]} ${y}` };
    });
  }, [rows]);

  // Bersihkan pilihan tiap kali filter berubah — cegah bulk mengenai baris di luar filter
  useEffect(() => { setSelected(new Set()); }, [q, customerId, monthFilter]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${monthFilter}|${filterMode}` });

  // Baris yang bisa dipilih = HANYA hasil filter yang belum Paid
  const selectableRows = filtered.filter((r) => r.status !== "Paid");
  const selectableIds = selectableRows.map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    const n = new Set(selected);
    if (allSelected) selectableIds.forEach((id) => n.delete(id));
    else selectableIds.forEach((id) => n.add(id));
    setSelected(n);
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
      // Hanya AWB terpilih yang masih ada di hasil filter & belum Paid
      const ids = Array.from(selected).filter((id) => selectableRows.some((r) => r.id === id));
      const r = await api.post("/payments/bulk-mark-paid", {
        awb_ids: ids,
        payment_invoice_number: form.payment_invoice_number || null,
        paid_date: form.paid_date || null,
      });
      toast.success(`${r.data.paid_count} AWB ditandai LUNAS${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      setShowModal(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const revertPaid = async (r) => {
    if (!window.confirm(`Batalkan status LUNAS untuk AWB ${r.awb_number}? Jurnal penerimaan pembayaran akan dihapus dan status kembali ke Invoiced.`)) return;
    try {
      await api.post(`/orders/${r.id}/revert-paid`);
      toast.success(`AWB ${r.awb_number} dikembalikan ke Invoiced`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  // Outstanding hanya dari yg belum lunas (Invoiced); Paid hanya untuk display
  const total = rows.filter((r) => r.status !== "Paid").reduce((s, r) => s + (r.grand_total || 0), 0);
  const selectedTotal = rows.filter((r) => selected.has(r.id) && r.status !== "Paid").reduce((s, r) => s + (r.grand_total || 0), 0);

  return (
    <div data-testid="payments-page">
      <PageHeader title="Pembayaran (Closing)" subtitle="Tandai invoice LUNAS — single atau bulk. AWB yang sudah Paid tetap tampil dgn status Lunas untuk referensi." />

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
            {canMarkPaidBulk && (
              <Button data-testid="bulk-mark-paid-btn" variant="success" onClick={openBulk} disabled={selected.size === 0}>
                <CheckCircle2 size={14}/> Bulk Mark Paid ({selected.size})
              </Button>
            )}
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
          <div className="min-w-[200px]">
            <Label>Bulan AWB</Label>
            <select data-testid="payments-month-filter" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-10 rounded border border-slate-300 px-3 text-sm bg-white w-full">
              <option value="">Semua Bulan</option>
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
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
                {allSelected ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>AWB</Th><Th>Invoice No</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => {
              const isPaid = r.status === "Paid";
              return (
              <tr key={r.id} data-testid={`payment-row-${r.id}`} className={isPaid ? "bg-emerald-50/30" : ""}>
                <Td>
                  {isPaid ? (
                    <span className="inline-block w-4 h-4 text-slate-300" title="Sudah lunas — tidak perlu ditandai lagi"><Square size={14}/></span>
                  ) : (
                    <button onClick={() => toggle(r.id)}>
                      {selected.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                    </button>
                  )}
                </Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="font-mono text-xs">
                  {r.invoice_number ? (
                    <div>
                      <div className="text-slate-900 font-semibold">{r.invoice_number}</div>
                      {r.external_invoice_number && r.external_invoice_number !== r.invoice_number && (
                        <div className="text-[10px] text-slate-400">ext: {r.external_invoice_number}</div>
                      )}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">
                  {isPaid ? (
                    <div className="inline-flex gap-2 items-center justify-end">
                      <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">✓ Lunas</span>
                      {canMarkPaid && (
                        <Button data-testid={`revert-paid-${r.id}`} variant="secondary" onClick={() => revertPaid(r)} className="!bg-red-50 !text-red-700 hover:!bg-red-100 !border-red-200">
                          <X size={13}/> Batalkan Lunas
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="inline-flex gap-1 justify-end">
                      {canMultiPayment && (
                        <Button data-testid={`multi-payment-${r.id}`} variant="secondary" onClick={() => setMultiAwb(r)} className="!bg-amber-50 !text-amber-800 hover:!bg-amber-100 !border-amber-200">
                          <BadgeDollarSign size={14}/> Multi-Bayar
                        </Button>
                      )}
                      {canMarkPaid && (
                        <Button data-testid={`mark-paid-${r.id}`} variant="success" onClick={() => openSingle(r)}>
                          <CheckCircle2 size={14}/> Mark Paid
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
              );
            })}
            {rows.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-10">Tidak ada invoice menunggu pembayaran.</Td></tr>}
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
      {/* Multi-Receiver Payment Modal (multi partial payments per AWB) */}
      {multiAwb && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="multi-payment-modal">
          <Card className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-heading font-bold text-xl flex items-center gap-2"><BadgeDollarSign size={20}/> Multi-Bayar AWB {multiAwb.awb_number}</h3>
                <p className="text-xs text-slate-500 mt-1">Catat pembayaran parsial (multi-receiver). AWB otomatis berstatus Paid saat total = grand_total.</p>
              </div>
              <button onClick={() => setMultiAwb(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-2 rounded bg-slate-50 border border-slate-200">
                <div className="text-[10px] uppercase font-bold text-slate-500">Grand Total</div>
                <div className="font-mono font-bold">{fmtIDR(payments.grand_total)}</div>
              </div>
              <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
                <div className="text-[10px] uppercase font-bold text-emerald-700">Total Terbayar</div>
                <div className="font-mono font-bold text-emerald-800">{fmtIDR(payments.total_paid)}</div>
              </div>
              <div className={`p-2 rounded border ${payments.is_fully_paid ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <div className={`text-[10px] uppercase font-bold ${payments.is_fully_paid ? "text-emerald-700" : "text-amber-700"}`}>{payments.is_fully_paid ? "LUNAS" : "Sisa"}</div>
                <div className="font-mono font-bold">{payments.is_fully_paid ? "PAID" : fmtIDR(payments.remaining)}</div>
              </div>
            </div>

            <div className="border border-slate-200 rounded p-3 mb-3 bg-slate-50">
              <div className="text-xs font-bold mb-2 text-slate-700">Tambah Pembayaran Baru</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><Label className="!text-[10px]">Tanggal *</Label><Input data-testid="mp-date" type="date" value={newPay.payment_date} onChange={(e) => setNewPay({...newPay, payment_date: e.target.value})}/></div>
                <div><Label className="!text-[10px]">Nominal (IDR) *</Label><NumberInput data-testid="mp-amount" value={newPay.amount} onChange={(e) => setNewPay({...newPay, amount: e.target.value})} placeholder="0"/></div>
                <div><Label className="!text-[10px]">Metode</Label>
                  <select data-testid="mp-method" value={newPay.payment_method} onChange={(e) => setNewPay({...newPay, payment_method: e.target.value})} className="w-full px-2 py-2 border border-slate-300 rounded text-sm">
                    <option>Transfer</option><option>Cash</option><option>Cek</option><option>Giro</option><option>Lainnya</option>
                  </select>
                </div>
                <div><Label className="!text-[10px]">Ref/No. Bukti</Label><Input data-testid="mp-ref" value={newPay.reference_no} onChange={(e) => setNewPay({...newPay, reference_no: e.target.value})}/></div>
              </div>
              <div className="mt-2"><Label className="!text-[10px]">Catatan</Label><Input data-testid="mp-notes" value={newPay.notes} onChange={(e) => setNewPay({...newPay, notes: e.target.value})}/></div>
              <div className="mt-2 text-right">
                <Button data-testid="mp-add-btn" onClick={addPayment}><Plus size={14}/> Tambah Pembayaran</Button>
              </div>
            </div>

            <div className="text-xs font-bold mb-2 text-slate-700">Riwayat Pembayaran ({(payments.receipts || []).length})</div>
            <Table>
              <thead><tr><Th>Tanggal</Th><Th className="text-right">Nominal</Th><Th>Metode</Th><Th>Ref</Th><Th>Catatan</Th><Th></Th></tr></thead>
              <tbody>
                {(payments.receipts || []).map((p) => (
                  <tr key={p.id}>
                    <Td className="text-xs font-mono">{fmtDate(p.payment_date)}</Td>
                    <Td className="text-right font-mono font-semibold">{fmtIDR(p.amount)}</Td>
                    <Td className="text-xs">{p.payment_method}</Td>
                    <Td className="text-xs font-mono">{p.reference_no || "-"}</Td>
                    <Td className="text-xs text-slate-600">{p.notes || "-"}</Td>
                    <Td className="text-right">
                      {canDeleteReceipt && (
                        <button data-testid={`mp-del-${p.id}`} onClick={() => delPayment(p.id)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 size={12}/></button>
                      )}
                    </Td>
                  </tr>
                ))}
                {(payments.receipts || []).length === 0 && <tr><Td colSpan={6} className="text-center text-xs text-slate-400 py-6">Belum ada pembayaran.</Td></tr>}
              </tbody>
            </Table>

            <div className="flex justify-end pt-3 mt-3 border-t">
              <Button variant="secondary" onClick={() => setMultiAwb(null)}>Tutup</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
