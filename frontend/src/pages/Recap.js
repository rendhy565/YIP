import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Download, Undo2, CheckSquare, Square, Coins, ClipboardCheck, AlertCircle, Edit3, Save, X, FileSpreadsheet } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Recap() {
  const [openRows, setOpenRows] = useState([]);
  const [reconciledRows, setReconciledRows] = useState([]);
  const [costMap, setCostMap] = useState({}); // awb_id -> totalCost
  const [customers, setCustomers] = useState([]);
  const [month, setMonth] = useState(""); // empty = semua bulan
  const [customerId, setCustomerId] = useState("");
  const [filterMode, setFilterMode] = useState("AND"); // mode toggle for global filters
  const [selected, setSelected] = useState(new Set());
  const [selectedReconciled, setSelectedReconciled] = useState(new Set());

  // Per-table search bars (selection preserved across filter)
  const [qNoCost, setQNoCost] = useState("");
  const [qReady, setQReady] = useState("");
  const [qReconciled, setQReconciled] = useState("");

  // helper: filter rows by AWB or customer name
  const matchQ = (r, q) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return `${r.awb_number || ""} ${r.customer_name || ""} ${r.consignee || ""} ${r.reff_no || ""}`.toLowerCase().includes(s);
  };

  // Edit modal state
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Quick add cost modal
  const [costFor, setCostFor] = useState(null);
  const [costForm, setCostForm] = useState({ cost_category: "Vendor", amount: "", description: "", vendor_name: "" });
  const [savingCost, setSavingCost] = useState(false);

  const load = async () => {
    // Always fetch ALL — client-side AND/OR filter
    const [op, rc, costs] = await Promise.all([
      api.get("/orders", { params: { status_v: "Open" } }),
      api.get("/orders", { params: { status_v: "Reconciled" } }),
      api.get("/costs"),
    ]);
    const sortByDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    setOpenRows([...op.data].sort(sortByDate));
    setReconciledRows([...rc.data].sort(sortByDate));
    const cmap = {};
    for (const c of costs.data) {
      if (!c.awb_id) continue;
      cmap[c.awb_id] = (cmap[c.awb_id] || 0) + (c.amount || 0);
    }
    setCostMap(cmap);
    setSelected(new Set());
    setSelectedReconciled(new Set());
  };

  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Apply global filters (month + customer) with AND/OR mode
  const passGlobal = (r) => {
    const fns = [];
    if (month) {
      fns.push((x) => {
        if (!x.created_at) return false;
        const d = new Date(x.created_at);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return ym === month;
      });
    }
    if (customerId) fns.push((x) => x.customer_id === customerId);
    if (fns.length === 0) return true;
    return filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r));
  };

  // Split open rows: those WITH cost (ready to reconcile) and WITHOUT cost (need plotting)
  const { readyRows, noCostRows } = useMemo(() => {
    const ready = [];
    const noCost = [];
    for (const r of openRows) {
      if (!passGlobal(r)) continue;
      const c = costMap[r.id] || 0;
      const enriched = { ...r, _total_cost: c, _margin: (r.grand_total || 0) - c };
      if (c > 0) ready.push(enriched); else noCost.push(enriched);
    }
    return { readyRows: ready, noCostRows: noCost };
  // eslint-disable-next-line
  }, [openRows, costMap, month, customerId, filterMode]);

  // Reconciled rows after global filter
  const reconciledGlobal = useMemo(() => reconciledRows.filter(passGlobal),
    // eslint-disable-next-line
    [reconciledRows, month, customerId, filterMode]);

  // Filtered views (selection preserved on un-filtered sets)
  const noCostFiltered = useMemo(() => noCostRows.filter((r) => matchQ(r, qNoCost)), [noCostRows, qNoCost]);
  const readyFiltered = useMemo(() => readyRows.filter((r) => matchQ(r, qReady)), [readyRows, qReady]);
  const reconciledFiltered = useMemo(() => reconciledGlobal.filter((r) => matchQ(r, qReconciled)), [reconciledGlobal, qReconciled]);

  const pagNoCost = usePagination(noCostFiltered, { resetKey: `nocost|${qNoCost}|${month}|${customerId}|${filterMode}` });
  const pagReady = usePagination(readyFiltered, { resetKey: `ready|${qReady}|${month}|${customerId}|${filterMode}` });
  const pagReconciled = usePagination(reconciledFiltered, { resetKey: `rec|${qReconciled}|${month}|${customerId}|${filterMode}` });

  const toggle = (id) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n);
  };
  const toggleAll = () => {
    if (selected.size === readyRows.length) setSelected(new Set());
    else setSelected(new Set(readyRows.map((r) => r.id)));
  };

  const reconcileSelected = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : readyRows.map((r) => r.id);
    if (ids.length === 0) { toast.error("Tidak ada AWB siap rekonsiliasi"); return; }
    // Validate received_at first
    const notReceived = readyRows.filter((r) => ids.includes(r.id) && !r.received_at);
    if (notReceived.length > 0) {
      toast.error(`Barang belum diterima — tidak bisa direkonsiliasi: ${notReceived.slice(0, 3).map((r) => r.awb_number).join(", ")}${notReceived.length > 3 ? "..." : ""}`);
      return;
    }
    try {
      const r = await api.post("/orders/reconcile", { awb_ids: ids });
      toast.success(`${r.data.updated} AWB direkonsiliasi${r.data.skipped_no_cost ? ` (${r.data.skipped_no_cost} di-skip: belum ada cost)` : ""}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const revert = async (id) => {
    if (!window.confirm("PERINGATAN: Revert AWB ini ke status Open. Jika sudah ada cost/akuntansi, mereka tetap. Lanjutkan?")) return;
    try { await api.post(`/orders/${id}/revert-to-open`); toast.success("Direvert ke Open"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const toggleRec = (id) => {
    const n = new Set(selectedReconciled); n.has(id) ? n.delete(id) : n.add(id); setSelectedReconciled(n);
  };
  const toggleAllRec = () => {
    if (selectedReconciled.size === reconciledRows.length) setSelectedReconciled(new Set());
    else setSelectedReconciled(new Set(reconciledRows.map((r) => r.id)));
  };
  const bulkRevert = async () => {
    if (selectedReconciled.size === 0) { toast.error("Pilih minimal 1 AWB"); return; }
    if (!window.confirm(`Reject ${selectedReconciled.size} AWB kembali ke Open?`)) return;
    try {
      const r = await api.post("/orders/bulk-revert-to-open", { awb_ids: Array.from(selectedReconciled) });
      toast.success(`${r.data.updated} AWB direvert ke Open`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openEdit = (r) => {
    const isoDate = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : todayStr();
    setEditRow(r);
    setEditForm({
      awb_number: r.awb_number || "",
      reff_no: r.reff_no || "",
      pickup_date: isoDate,
      consignee: r.consignee || "",
      origin: r.origin || "",
      destination: r.destination || "",
      service: r.service || "",
      via: r.via || "",
      status_pengiriman: r.status_pengiriman || "",
      item_description: r.item_description || "",
      goods_content: r.goods_content || "",
      tariff_per_kg: r.tariff_per_kg ?? "",
      qty_kg: r.qty_kg ?? "",
      tax_percentage: r.tax_percentage ?? "",
      koli_count: r.koli_count ?? "",
      koli_qty_per: r.koli_qty_per || "",
      armada: r.armada || "",
      driver_name: r.driver_name || "",
      nopol: r.nopol || "",
    });
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      const payload = { ...editForm };
      ["tariff_per_kg", "qty_kg", "tax_percentage"].forEach((k) => {
        if (payload[k] !== "" && payload[k] !== null) payload[k] = parseFloat(payload[k]);
      });
      if (payload.koli_count !== "" && payload.koli_count !== null) payload.koli_count = parseInt(payload.koli_count, 10);
      Object.keys(payload).forEach((k) => { if (payload[k] === "" || payload[k] === null) delete payload[k]; });
      await api.patch(`/orders/${editRow.id}/extended`, payload);
      toast.success("AWB diperbarui");
      setEditRow(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const openCost = (r) => {
    setCostFor(r);
    setCostForm({ cost_category: "Vendor", amount: "", description: "", vendor_name: "" });
  };
  const saveCost = async () => {
    if (!costFor) return;
    setSavingCost(true);
    try {
      await api.post("/costs", {
        awb_id: costFor.id,
        cost_category: costForm.cost_category,
        amount: parseFloat(costForm.amount),
        description: costForm.description,
        vendor_name: costForm.vendor_name,
      });
      toast.success("Biaya ditambahkan");
      setCostFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingCost(false); }
  };

  return (
    <div data-testid="recap-page">
      <PageHeader
        title="Rekap & Rekonsiliasi"
        subtitle="2 tabel terpisah: AWB Open (tanpa cost — perlu plotting) & Ready to Reconcile (sudah ada cost)."
      />

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="recap"
          mode={filterMode}
          setMode={setFilterMode}
          currentFilters={{ month, customerId }}
          onLoadPreset={(f) => { setMonth(f.month || ""); setCustomerId(f.customerId || ""); }}
          activeCount={[month, customerId].filter(Boolean).length}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <Label>Bulan (YYYY-MM)</Label>
            <div className="flex gap-1">
              <select
                data-testid="recap-month-year"
                value={month ? month.split("-")[0] : ""}
                onChange={(e) => {
                  const y = e.target.value;
                  const m = month ? month.split("-")[1] : "01";
                  setMonth(y ? `${y}-${m}` : "");
                }}
                className="h-10 rounded border border-slate-300 px-2 text-sm bg-white"
              >
                <option value="">Thn</option>
                {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                data-testid="recap-month-month"
                value={month ? month.split("-")[1] : ""}
                onChange={(e) => {
                  const m = e.target.value;
                  const y = month ? month.split("-")[0] : String(new Date().getFullYear());
                  setMonth(m ? `${y}-${m}` : "");
                }}
                className="h-10 rounded border border-slate-300 px-2 text-sm bg-white flex-1"
              >
                <option value="">Semua Bulan</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => (
                  <option key={m} value={m}>{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][i]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label>Customer</Label>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button data-testid="export-report-ar-btn" variant="secondary" onClick={async () => {
              try {
                const params = {};
                if (month) params.month = month;
                if (customerId) params.customer_id = customerId;
                const r = await api.get("/exports/report-ar", { params, responseType: "blob" });
                const url = window.URL.createObjectURL(new Blob([r.data]));
                const a = document.createElement("a"); a.href = url;
                a.download = `REPORT_AR_${month || "ALL"}.xlsx`;
                document.body.appendChild(a); a.click(); a.remove();
                window.URL.revokeObjectURL(url);
                toast.success("Report AR ter-export");
              } catch (e) { toast.error(errMsg(e)); }
            }}>
              <FileSpreadsheet size={16}/> Export Report AR
            </Button>
            <Button data-testid="reconcile-selected-btn" onClick={reconcileSelected} disabled={readyRows.length === 0}>
              <Download size={16}/> Reconcile {selected.size > 0 ? `(${selected.size} dipilih)` : `(${readyRows.length} ready)`}
            </Button>
          </div>
        </div>
      </Card>

      {/* TABLE 1: Open without cost — needs plotting */}
      <Card className="mb-6" data-testid="table-open-no-cost">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <AlertCircle size={16} className="text-amber-600"/>
          <h3 className="font-bold">Open — Belum Ada Cost (Perlu Plotting Biaya)</h3>
          <span className="text-xs text-slate-500 ml-2">{noCostFiltered.length}/{noCostRows.length} baris</span>
          <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 bg-amber-100 rounded px-2 py-0.5 ml-2">Tidak bisa direkonsiliasi tanpa cost</span>
          <div className="ml-auto" style={{ minWidth: 240 }}>
            <Input data-testid="search-nocost" placeholder="Cari AWB / Customer / Reff..." value={qNoCost} onChange={(e) => setQNoCost(e.target.value)}/>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Reff</Th><Th>Customer</Th><Th>Consignee</Th>
            <Th>Rute</Th><Th>Service/Via</Th><Th className="text-right">Selling</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pagNoCost.paged.map((r) => (
              <tr key={r.id} data-testid={`open-nocost-row-${r.id}`}>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="text-xs">{r.reff_no || "-"}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="text-xs">{r.consignee || "-"}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-xs">{[r.service, r.via].filter(Boolean).join(" / ") || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    <button data-testid={`plot-cost-btn-${r.awb_number}`} onClick={() => openCost(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1">
                      <Coins size={11}/> Plot Biaya
                    </button>
                    <button data-testid={`edit-btn-${r.awb_number}`} onClick={() => openEdit(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1">
                      <Edit3 size={11}/> Edit
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
            {noCostFiltered.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-8">{qNoCost ? "Tidak ada hasil cocok dengan filter." : "Tidak ada AWB Open tanpa cost."}</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pagNoCost} testid="pagination-recap-nocost"/>
      </Card>

      {/* TABLE 2: Open with cost — ready to reconcile */}
      <Card className="mb-6" data-testid="table-ready-reconcile">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <ClipboardCheck size={16} className="text-emerald-700"/>
          <h3 className="font-bold">Ready to Reconcile — Sudah Ada Cost</h3>
          <span className="text-xs text-slate-500 ml-2">{readyFiltered.length}/{readyRows.length} baris{selected.size > 0 ? ` · ${selected.size} dipilih` : ""}</span>
          <div className="ml-auto" style={{ minWidth: 240 }}>
            <Input data-testid="search-ready" placeholder="Cari AWB / Customer / Reff..." value={qReady} onChange={(e) => setQReady(e.target.value)}/>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll}>
                {selected.size === readyRows.length && readyRows.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Reff</Th><Th>Customer</Th><Th>Consignee</Th>
            <Th>Rute</Th><Th>Svc/Via</Th><Th>Armada/Nopol</Th>
            <Th className="text-right">Selling</Th><Th className="text-right">Cost</Th><Th className="text-right">Margin</Th>
            <Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pagReady.paged.map((r) => (
              <tr key={r.id} data-testid={`ready-row-${r.id}`} className={!r.received_at ? "bg-amber-50/50" : ""}>
                <Td>
                  <button onClick={() => toggle(r.id)} disabled={!r.received_at} title={!r.received_at ? "Barang belum diterima — tidak bisa direkonsiliasi" : ""}>
                    {selected.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className={r.received_at ? "text-slate-400" : "text-slate-300"}/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">
                  {r.awb_number}
                  {!r.received_at && <span className="ml-1 text-[10px] uppercase font-bold text-amber-700 bg-amber-100 rounded px-1">belum diterima</span>}
                </Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="text-xs">{r.reff_no || "-"}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="text-xs">{r.consignee || "-"}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-xs">{[r.service, r.via].filter(Boolean).join(" / ") || "-"}</Td>
                <Td className="text-xs">{[r.armada, r.nopol].filter(Boolean).join(" · ") || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td className="text-right text-rose-700">{fmtIDR(r._total_cost)}</Td>
                <Td className={`text-right font-bold ${r._margin >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtIDR(r._margin)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    <button data-testid={`plot-more-cost-${r.awb_number}`} onClick={() => openCost(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-50 text-amber-800 hover:bg-amber-100 inline-flex items-center gap-1">
                      <Coins size={11}/> + Cost
                    </button>
                    <button data-testid={`edit-ready-btn-${r.awb_number}`} onClick={() => openEdit(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1">
                      <Edit3 size={11}/> Edit
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
            {readyFiltered.length === 0 && <tr><Td colSpan={13} className="text-center text-slate-500 py-8">{qReady ? "Tidak ada hasil cocok dengan filter." : "Belum ada AWB siap rekonsiliasi."}</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pagReady} testid="pagination-recap-ready"/>
      </Card>

      {/* TABLE 3: Already Reconciled */}
      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <Undo2 size={16} className="text-amber-600"/>
          <h3 className="font-bold">Sudah Reconciled — Tangani Reject</h3>
          <span className="text-xs text-slate-500 ml-2">{reconciledFiltered.length}/{reconciledRows.length} baris{selectedReconciled.size > 0 ? ` · ${selectedReconciled.size} dipilih` : ""}</span>
          <div style={{ minWidth: 240 }}>
            <Input data-testid="search-reconciled" placeholder="Cari AWB / Customer / Reff..." value={qReconciled} onChange={(e) => setQReconciled(e.target.value)}/>
          </div>
          <div className="ml-auto">
            <Button data-testid="bulk-revert-btn" variant="secondary" onClick={bulkRevert} disabled={selectedReconciled.size === 0}>
              <Undo2 size={14}/> Reject {selectedReconciled.size > 0 ? `(${selectedReconciled.size})` : "(pilih dulu)"} → Open
            </Button>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAllRec}>
                {selectedReconciled.size === reconciledRows.length && reconciledRows.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {pagReconciled.paged.map((r) => (
              <tr key={r.id} data-testid={`reconciled-row-${r.id}`}>
                <Td>
                  <button data-testid={`reconciled-toggle-${r.id}`} onClick={() => toggleRec(r.id)}>
                    {selectedReconciled.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">
                  <Button data-testid={`revert-btn-${r.id}`} variant="secondary" onClick={() => revert(r.id)}>
                    <Undo2 size={14}/> Reject
                  </Button>
                </Td>
              </tr>
            ))}
            {reconciledFiltered.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-8">{qReconciled ? "Tidak ada hasil cocok dengan filter." : "Tidak ada AWB Reconciled."}</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pagReconciled} testid="pagination-recap-reconciled"/>
      </Card>

      {/* EDIT MODAL */}
      {editRow && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="edit-awb-modal">
          <Card className="w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Edit AWB {editRow.awb_number}</h3>
              <button type="button" onClick={() => setEditRow(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>No. AWB</Label><Input value={editForm.awb_number} onChange={(e) => setEditForm({ ...editForm, awb_number: e.target.value })}/></div>
              <div><Label>Reff No</Label><Input value={editForm.reff_no} onChange={(e) => setEditForm({ ...editForm, reff_no: e.target.value })}/></div>
              <div><Label>Tgl Pickup</Label><Input type="date" value={editForm.pickup_date} onChange={(e) => setEditForm({ ...editForm, pickup_date: e.target.value })}/></div>
              <div><Label>Consignee</Label><Input value={editForm.consignee} onChange={(e) => setEditForm({ ...editForm, consignee: e.target.value })}/></div>
              <div><Label>Origin</Label><Input value={editForm.origin} onChange={(e) => setEditForm({ ...editForm, origin: e.target.value.toUpperCase() })}/></div>
              <div><Label>Destination</Label><Input value={editForm.destination} onChange={(e) => setEditForm({ ...editForm, destination: e.target.value.toUpperCase() })}/></div>
              <div>
                <Label>Service</Label>
                <Select value={editForm.service} onChange={(e) => setEditForm({ ...editForm, service: e.target.value })}>
                  <option value="">—</option>
                  {["LCL", "FCL", "LTL", "FTL", "AIR"].map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <Label>Via</Label>
                <Select value={editForm.via} onChange={(e) => setEditForm({ ...editForm, via: e.target.value })}>
                  <option value="">—</option>
                  <option value="D">Darat</option><option value="L">Laut</option><option value="U">Udara</option>
                </Select>
              </div>
              <div>
                <Label>Status Pengiriman</Label>
                <Select value={editForm.status_pengiriman} onChange={(e) => setEditForm({ ...editForm, status_pengiriman: e.target.value })}>
                  <option value="">— (blank, tidak ditampilkan) —</option>
                  <option value="Reguler">Reguler</option><option value="Project">Project</option>
                </Select>
              </div>
              <div className="md:col-span-3"><Label>Item</Label><Input value={editForm.item_description} onChange={(e) => setEditForm({ ...editForm, item_description: e.target.value })}/></div>
              <div className="md:col-span-3"><Label>Isi Barang</Label><Input value={editForm.goods_content} onChange={(e) => setEditForm({ ...editForm, goods_content: e.target.value })}/></div>
              <div><Label>Tarif/Kg</Label><Input type="number" step="0.01" value={editForm.tariff_per_kg} onChange={(e) => setEditForm({ ...editForm, tariff_per_kg: e.target.value })}/></div>
              <div><Label>Qty (Kg)</Label><Input type="number" step="0.01" value={editForm.qty_kg} onChange={(e) => setEditForm({ ...editForm, qty_kg: e.target.value })}/></div>
              <div><Label>PPN %</Label><Input type="number" step="0.01" value={editForm.tax_percentage} onChange={(e) => setEditForm({ ...editForm, tax_percentage: e.target.value })}/></div>
              <div><Label>Koli</Label><Input type="number" value={editForm.koli_count} onChange={(e) => setEditForm({ ...editForm, koli_count: e.target.value })}/></div>
              <div><Label>Isi/Koli</Label><Input value={editForm.koli_qty_per} onChange={(e) => setEditForm({ ...editForm, koli_qty_per: e.target.value })}/></div>
              <div><Label>Armada</Label><Input value={editForm.armada} onChange={(e) => setEditForm({ ...editForm, armada: e.target.value })}/></div>
              <div><Label>Driver</Label><Input value={editForm.driver_name} onChange={(e) => setEditForm({ ...editForm, driver_name: e.target.value })}/></div>
              <div><Label>Nopol</Label><Input value={editForm.nopol} onChange={(e) => setEditForm({ ...editForm, nopol: e.target.value.toUpperCase() })}/></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setEditRow(null)}>Batal</Button>
              <Button data-testid="save-edit-btn" onClick={saveEdit} disabled={saving}>
                <Save size={14}/> {saving ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* PLOT COST MODAL */}
      {costFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="plot-cost-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Plot Biaya</h3>
                <p className="text-xs text-slate-500">AWB {costFor.awb_number} · {costFor.customer_name}</p>
              </div>
              <button type="button" onClick={() => setCostFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Kategori</Label>
                <Select value={costForm.cost_category} onChange={(e) => setCostForm({ ...costForm, cost_category: e.target.value })}>
                  <option value="Vendor">Vendor (Accrue / Hutang)</option>
                  <option value="Operational">Operational (Cash)</option>
                  <option value="Lintas">Lintas (Cash)</option>
                  <option value="Marketing">Marketing (COGS terpisah)</option>
                </Select>
              </div>
              {costForm.cost_category === "Vendor" && (
                <div><Label>Vendor</Label><Input value={costForm.vendor_name} onChange={(e) => setCostForm({ ...costForm, vendor_name: e.target.value })}/></div>
              )}
              <div><Label>Jumlah</Label><Input type="number" step="0.01" value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} required /></div>
              <div><Label>Deskripsi</Label><Input value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}/></div>
              <p className="text-[11px] text-slate-500">Tip: Buka <Link to="/costs" className="underline text-blue-700">Plotting Biaya</Link> untuk batch input.</p>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setCostFor(null)}>Batal</Button>
              <Button data-testid="save-plot-cost-btn" onClick={saveCost} disabled={savingCost || !costForm.amount}>
                {savingCost ? "Menyimpan..." : "Simpan Biaya"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
