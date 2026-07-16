import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/useCan";
import { FilePlus2, CheckSquare, Square, FileSignature, FileText, ArrowRight, Search, X, Layers, Trash2 } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function Invoices() {
  const canCreate = useCan("invoices", "create");
  const { user } = useAuth();
  const [reconciled, setReconciled] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [selectedRec, setSelectedRec] = useState(new Set());
  // Filters
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [month, setMonth] = useState(""); // YYYY-MM — kosong = semua bulan
  const [filterMode, setFilterMode] = useState("AND");

  // Bulk-create popup: choose AWB groupings
  const [showBulk, setShowBulk] = useState(false);
  // groups: array of arrays of awb_ids. Initial: empty (all individuals)
  const [groups, setGroups] = useState([]); // [[awb_id_a, awb_id_b], ...]

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
    if (month) fns.push((r) => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return ym === month;
    });
    if (fns.length === 0) return reconciled;
    return reconciled.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [reconciled, q, customerId, month, filterMode]);

  const pag = usePagination(filtered, { resetKey: `${q}|${customerId}|${month}|${filterMode}` });

  // Daftar bulan (YYYY-MM) yang tersedia di data reconciled
  const monthOptions = useMemo(() => {
    const INDO = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const set = new Map();
    for (const r of reconciled) {
      if (!r.created_at) continue;
      const d = new Date(r.created_at);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!set.has(ym)) set.set(ym, `${INDO[d.getMonth()]} ${d.getFullYear()}`);
    }
    return [...set.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([value, label]) => ({ value, label }));
  }, [reconciled]);

  const createInvoice = async (awb_id) => {
    try { await api.post("/invoices", { awb_id }); toast.success("Invoice dibuat (nomor only — tanggal saat cetak)"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const openBulkPopup = () => {
    const ids = selectedRec.size > 0 ? Array.from(selectedRec) : filtered.map((r) => r.id);
    if (ids.length === 0) { toast.error("Tidak ada AWB siap invoice"); return; }
    setGroups([]);
    setShowBulk(true);
  };

  // For grouping popup: get target AWBs
  const targetAwbs = useMemo(() => {
    const ids = selectedRec.size > 0 ? Array.from(selectedRec) : filtered.map((r) => r.id);
    return ids.map((id) => reconciled.find((r) => r.id === id)).filter(Boolean);
  }, [selectedRec, filtered, reconciled]);

  // Ungrouped = those not in any group
  const ungroupedAwbs = useMemo(() => {
    const inGroups = new Set(groups.flat());
    return targetAwbs.filter((a) => !inGroups.has(a.id));
  }, [targetAwbs, groups]);

  const customerOfAwb = (awbId) => targetAwbs.find((a) => a.id === awbId)?.customer_id;

  const addToNewGroup = (awbId) => {
    setGroups([...groups, [awbId]]);
  };
  const addToGroup = (gIdx, awbId) => {
    // validate same customer
    const cust = customerOfAwb(groups[gIdx][0]);
    if (customerOfAwb(awbId) !== cust) {
      toast.error("AWB harus dari customer yang sama untuk digabung dalam 1 invoice");
      return;
    }
    setGroups(groups.map((g, i) => i === gIdx ? [...g, awbId] : g));
  };
  const removeFromGroup = (gIdx, awbId) => {
    const newG = groups.map((g, i) => i === gIdx ? g.filter((x) => x !== awbId) : g).filter((g) => g.length > 0);
    setGroups(newG);
  };
  const dropGroup = (gIdx) => {
    setGroups(groups.filter((_, i) => i !== gIdx));
  };

  const submitBulk = async () => {
    const ids = targetAwbs.map((a) => a.id);
    try {
      const r = await api.post("/invoices/bulk", { awb_ids: ids, grouped: groups.length > 0 ? groups : null });
      toast.success(`${r.data.created_count} invoice dibuat${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      setShowBulk(false);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const toggleRec = (id) => { const n = new Set(selectedRec); n.has(id) ? n.delete(id) : n.add(id); setSelectedRec(n); };
  const toggleAllRec = () => {
    if (selectedRec.size === filtered.length) setSelectedRec(new Set());
    else setSelectedRec(new Set(filtered.map((r) => r.id)));
  };

  const cName = (cid) => customers.find((c) => c.id === cid)?.name || cid;

  return (
    <div data-testid="invoices-page">
      <PageHeader
        title="Pembuatan Invoice"
        subtitle="Buat invoice dari AWB Reconciled. 1 invoice bisa multi-AWB (popup saat Bulk). Tanggal invoice diisi saat cetak pertama."
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
              currentFilters={{ q, customerId, month }}
              onLoadPreset={(f) => { setQ(f.q || ""); setCustomerId(f.customerId || ""); setMonth(f.month || ""); }}
              activeCount={[q.trim(), customerId, month].filter(Boolean).length}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[260px]">
                <Label>Cari (AWB / Customer / Rute)</Label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                  <Input data-testid="invoice-creation-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: AWB-..." className="pl-9"/>
                </div>
              </div>
              <div className="min-w-[180px]">
                <Label>Bulan Pickup</Label>
                <Select
                  data-testid="invoice-creation-month-filter"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  <option value="">Semua Bulan</option>
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
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
              {canCreate && (
                <Button data-testid="bulk-create-invoice-btn" onClick={openBulkPopup} disabled={filtered.length === 0}>
                  <Layers size={14}/> Bulk Create Invoice ({selectedRec.size || filtered.length})
                </Button>
              )}
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
                      {canCreate && (
                        <Button data-testid={`create-invoice-${r.id}`} onClick={() => createInvoice(r.id)}>
                          <FilePlus2 size={14}/> Buat
                        </Button>
                      )}
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

      {/* BULK CREATE POPUP — grouping multi-AWB → 1 invoice */}
      {showBulk && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="bulk-invoice-modal">
          <Card className="w-full max-w-4xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Bulk Create Invoice — Pilih Penggabungan</h3>
                <p className="text-xs text-slate-500 mt-1">Buat group untuk gabungkan beberapa AWB menjadi 1 invoice. AWB diluar group → 1 invoice per AWB. Syarat: customer harus sama dalam 1 group.</p>
              </div>
              <button onClick={() => setShowBulk(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            {/* Active Groups */}
            {groups.length > 0 && (
              <div className="space-y-3 mb-4">
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-blue-700">Group Invoice ({groups.length})</h4>
                {groups.map((g, gIdx) => {
                  const first = targetAwbs.find((a) => a.id === g[0]);
                  return (
                    <div key={gIdx} className="border border-blue-200 bg-blue-50/50 rounded p-3" data-testid={`group-${gIdx}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-bold text-blue-900">
                          Invoice #{gIdx + 1} — Customer: {first ? cName(first.customer_id) : "—"} ({g.length} AWB)
                        </div>
                        <button onClick={() => dropGroup(gIdx)} className="text-rose-600 hover:text-rose-800 text-xs inline-flex items-center gap-1"><Trash2 size={12}/> Hapus Group</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {g.map((awbId) => {
                          const a = targetAwbs.find((x) => x.id === awbId);
                          return (
                            <span key={awbId} className="inline-flex items-center gap-1 bg-white border border-blue-300 rounded px-2 py-1 text-xs font-mono" data-testid={`group-${gIdx}-awb-${awbId}`}>
                              {a?.awb_number}
                              <button onClick={() => removeFromGroup(gIdx, awbId)} className="ml-1 text-slate-400 hover:text-rose-600"><X size={10}/></button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ungrouped AWBs - selectable */}
            <div>
              <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">AWB belum di-group ({ungroupedAwbs.length}) — masing-masing → 1 invoice sendiri kecuali digabung</h4>
              <div className="border border-slate-200 rounded max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">AWB</th>
                      <th className="px-2 py-1 text-left">Customer</th>
                      <th className="px-2 py-1 text-right">Total</th>
                      <th className="px-2 py-1 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ungroupedAwbs.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100" data-testid={`bulk-awb-${a.id}`}>
                        <td className="px-2 py-1 font-mono font-semibold">{a.awb_number}</td>
                        <td className="px-2 py-1 text-xs">{a.customer_name}</td>
                        <td className="px-2 py-1 text-right text-xs">{fmtIDR(a.grand_total)}</td>
                        <td className="px-2 py-1 text-right">
                          <div className="inline-flex gap-1">
                            <button data-testid={`add-new-group-${a.id}`} onClick={() => addToNewGroup(a.id)} className="px-2 py-0.5 text-[10px] uppercase font-bold rounded bg-blue-100 text-blue-800 hover:bg-blue-200">
                              + Group Baru
                            </button>
                            {groups.map((g, gIdx) => {
                              const first = targetAwbs.find((x) => x.id === g[0]);
                              if (!first || first.customer_id !== a.customer_id) return null;
                              return (
                                <button key={gIdx} data-testid={`add-to-group-${gIdx}-${a.id}`} onClick={() => addToGroup(gIdx, a.id)} className="px-2 py-0.5 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200">
                                  → #{gIdx + 1}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {ungroupedAwbs.length === 0 && (
                      <tr><td colSpan={4} className="text-center text-slate-400 py-4 text-xs">Semua AWB sudah di-group</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs">
              <strong>{groups.length}</strong> group + <strong>{ungroupedAwbs.length}</strong> AWB individual = <strong>{groups.length + ungroupedAwbs.length}</strong> invoice akan dibuat
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setShowBulk(false)}>Batal</Button>
              <Button data-testid="confirm-bulk-create-btn" onClick={submitBulk}>
                <FileSignature size={14}/> Buat {groups.length + ungroupedAwbs.length} Invoice
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
