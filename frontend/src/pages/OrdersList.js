import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Select, Input, Table, Th, Td, StatusBadge, Label, Button } from "../components/ui";
import { fmtIDR, fmtDate, fmtDateTime, errMsg } from "../lib/utils";
import { Trash2, MinusCircle, PackageCheck, X, Search, Download, MapPin } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/useCan";
import { toast } from "sonner";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";
import CostListModal from "../components/CostListModal";
import TrackingModal from "../components/TrackingModal";
import AwbDetailModal from "../components/AwbDetailModal";
import NumberInput from "../components/NumberInput";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WORK_TYPES = ["Kirim Barang", "Dismantle Barang", "Relokasi Barang"];
const MODES = ["Air", "Trucking", "Konsul"];

export default function OrdersList() {
  const { user } = useAuth();
  // const isAdmin = user?.role === "administrator"; // deprecated: use useCan() granular checks

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState(""); // YYYY-MM (kosong = semua bulan)
  const [filterMode, setFilterMode] = useState("AND"); // AND default for /orders (current behavior)

  // Receive modal
  const [recvFor, setRecvFor] = useState(null);
  const [recvForm, setRecvForm] = useState({
    received_date: todayStr(),
    received_by_name: "",
    polis_enabled: false,
    polis_amount: "",
    asuransi_enabled: false,
    asuransi_amount: "",
    spsi_enabled: false,
    spsi_amount: "",
    sewa_forklift_enabled: false,
    sewa_forklift_amount: "",
    work_type: "Kirim Barang",
    mode: "Trucking",
  });
  const [saving, setSaving] = useState(false);

  // POD modal — Tanda terima POD pada Penerimaan Barang AWB
  const [podFor, setPodFor] = useState(null);
  const [podForm, setPodForm] = useState({ pod_date: todayStr(), pod_notes: "", pod_signed_by: "" });
  const [savingPod, setSavingPod] = useState(false);

  // Cost popup — list & delete costs (uses shared component)
  const [costFor, setCostFor] = useState(null);

  // Tracking popup — posisi barang berjalan
  const [trackFor, setTrackFor] = useState(null);

  // AWB detail popup
  const [detailFor, setDetailFor] = useState(null);

  const load = () => {
    Promise.all([
      api.get("/orders"),
      api.get("/costs"),
    ]).then(([oRes, cRes]) => {
      // Sort by created_at down to millisecond — display only shows date
      const sorted = [...oRes.data].sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return tb - ta;
      });
      // Build cost map per AWB
      const cmap = {};
      for (const c of cRes.data) {
        if (!c.awb_id) continue;
        cmap[c.awb_id] = (cmap[c.awb_id] || 0) + (c.amount || 0);
      }
      const decorated = sorted.map((r) => ({ ...r, _total_cost: cmap[r.id] || 0 }));
      setRows(decorated);
    });
  };

  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Client-side filter with OR/AND mode (matches InvoicesCreated pattern)
  const filteredRows = React.useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.customer_name || ""} ${r.consignee || ""} ${r.reff_no || ""} ${r.origin || ""} ${r.destination || ""}`.toLowerCase().includes(qStr));
    if (status) fns.push((r) => r.status === status);
    if (customerId) fns.push((r) => r.customer_id === customerId);
    if (month) fns.push((r) => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return ym === month;
    });
    if (fns.length === 0) return rows;
    return rows.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [rows, q, status, customerId, month, filterMode]);

  const pag = usePagination(filteredRows, { resetKey: `${q}|${status}|${customerId}|${month}|${filterMode}` });

  // Daftar bulan (YYYY-MM) yang tersedia di data — di-generate dari created_at
  const monthOptions = React.useMemo(() => {
    const INDO = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const set = new Map();
    for (const r of rows) {
      if (!r.created_at) continue;
      const d = new Date(r.created_at);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!set.has(ym)) set.set(ym, `${INDO[d.getMonth()]} ${d.getFullYear()}`);
    }
    return [...set.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // terbaru dulu
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const dropOrder = async (r) => {
    if (!window.confirm(`Tandai AWB ${r.awb_number} sebagai DROP?`)) return;
    try { await api.patch(`/orders/${r.id}/status`, { status: "Drop" }); toast.success(`AWB ${r.awb_number} di-drop`); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const deleteOrder = async (r) => {
    if (!window.confirm(`HAPUS PERMANEN AWB ${r.awb_number}? Tindakan TIDAK BISA di-undo.`)) return;
    try {
      const res = await api.delete(`/orders/${r.id}`);
      const d = res.data.deleted;
      toast.success(`AWB ${d.awb} dihapus (${d.costs} biaya, ${d.invoices} invoice, ${d.journals} jurnal)`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openReceive = (r) => {
    setRecvFor(r);
    // Pre-fill: jika sudah pernah diterima, isi dari awb doc. Jika belum, pakai default order values.
    const isUpdate = !!r.received_at;
    const hasPolis = isUpdate
      ? !!(r.received_polis_amount && r.received_polis_amount > 0)
      : !!(r.polis_amount && r.polis_amount > 0);
    const hasAsuransi = isUpdate
      ? !!(r.received_asuransi_amount && r.received_asuransi_amount > 0)
      : !!(r.insurance_amount && r.insurance_amount > 0);
    const polisVal = isUpdate ? r.received_polis_amount : r.polis_amount;
    const asuVal = isUpdate ? r.received_asuransi_amount : r.insurance_amount;
    setRecvForm({
      received_date: isUpdate && r.received_at ? new Date(r.received_at).toISOString().slice(0, 10) : todayStr(),
      received_by_name: r.received_by_name || r.consignee || "",
      polis_enabled: hasPolis,
      polis_amount: hasPolis ? String(polisVal) : "",
      asuransi_enabled: hasAsuransi,
      asuransi_amount: hasAsuransi ? String(asuVal) : "",
      spsi_enabled: !!r.spsi_enabled,
      spsi_amount: r.spsi_amount ? String(r.spsi_amount) : "",
      sewa_forklift_enabled: !!r.sewa_forklift_enabled,
      sewa_forklift_amount: r.sewa_forklift_amount ? String(r.sewa_forklift_amount) : "",
      work_type: r.work_type || "Kirim Barang",
      mode: r.mode || (r.service === "AIR" ? "Air" : "Trucking"),
      received_notes: r.received_notes || "",
    });
  };

  const submitReceive = async () => {
    if (!recvFor) return;
    setSaving(true);
    try {
      const payload = {
        ...recvForm,
        polis_amount: recvForm.polis_enabled && recvForm.polis_amount !== "" ? parseFloat(recvForm.polis_amount) : null,
        asuransi_amount: recvForm.asuransi_enabled && recvForm.asuransi_amount !== "" ? parseFloat(recvForm.asuransi_amount) : null,
        spsi_amount: recvForm.spsi_enabled && recvForm.spsi_amount !== "" ? parseFloat(recvForm.spsi_amount) : null,
        sewa_forklift_amount: recvForm.sewa_forklift_enabled && recvForm.sewa_forklift_amount !== "" ? parseFloat(recvForm.sewa_forklift_amount) : null,
        received_notes: recvForm.received_notes || null,
      };
      await api.post(`/orders/${recvFor.id}/receive`, payload);
      toast.success(`Barang AWB ${recvFor.awb_number} ${recvFor.received_at ? "diupdate" : "ditandai DITERIMA"}`);
      setRecvFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const openPod = (r) => {
    setPodFor(r);
    setPodForm({
      pod_date: r.pod_received_at ? new Date(r.pod_received_at).toISOString().slice(0, 10) : todayStr(),
      pod_notes: r.pod_notes || "",
      pod_signed_by: r.pod_signed_by || r.consignee || "",
    });
  };
  const submitPod = async () => {
    if (!podFor) return;
    setSavingPod(true);
    try {
      await api.post(`/orders/${podFor.id}/receive-pod`, podForm);
      toast.success(`POD untuk AWB ${podFor.awb_number} ditandai diterima`);
      setPodFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingPod(false); }
  };

  const openCostList = (r) => setCostFor(r);

  // Granular per-feature permissions
  const canReceive = useCan("orders_list", "receive");
  const canPod = useCan("orders_list", "pod");
  const canEditReceive = useCan("orders_list", "edit_receive");
  const canEditPod = useCan("orders_list", "edit_pod");
  const canViewCost = useCan("orders_list", "view_cost");
  const canDrop = useCan("orders_list", "drop");
  const canDelete = useCan("orders_list", "delete");
  const canExportOpen = useCan("orders_list", "export_open");

  return (
    <div data-testid="orders-list-page">
      <PageHeader
        title="Daftar AWB"
        subtitle="Semua order. Tombol 'Terima Barang' untuk catat tanggal terima + biaya tambahan."
        action={
          canExportOpen && (
          <Button
            data-testid="export-open-awb-btn"
            variant="secondary"
            onClick={async () => {
              try {
                const url = `${process.env.REACT_APP_BACKEND_URL}/api/orders/export/open`;
                const token = localStorage.getItem("tms_token");
                const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                if (!resp.ok) throw new Error("Export gagal");
                const blob = await resp.blob();
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Open_AWB_${new Date().toISOString().slice(0,10)}.xlsx`;
                link.click();
                URL.revokeObjectURL(link.href);
              } catch (e) { alert("Export gagal: " + e.message); }
            }}
          >
            <Download size={14}/> Export Open AWB
          </Button>
          )
        }
      />

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="orders"
          mode={filterMode}
          setMode={setFilterMode}
          currentFilters={{ q, status, customerId, month }}
          onLoadPreset={(f) => { setQ(f.q || ""); setStatus(f.status || ""); setCustomerId(f.customerId || ""); setMonth(f.month || ""); }}
          activeCount={[q.trim(), status, customerId, month].filter(Boolean).length}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label>Cari (AWB / Customer / Consignee / Reff / Rute)</Label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <Input data-testid="orders-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: AWB-202606-0001 / JKT / Pak Andi..." className="pl-9"/>
            </div>
          </div>
          <div className="min-w-[180px]">
            <Label>Bulan Pickup</Label>
            <Select
              data-testid="filter-month-select"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">Semua Bulan</option>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label>Status</Label>
            <Select data-testid="filter-status-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua Status</option>
              <option value="Open">Open</option>
              <option value="Reconciled">Rekonsiliasi</option>
              <option value="Invoiced">Invoiced</option>
              <option value="Paid">Lunas</option>
              <option value="Drop">Drop</option>
            </Select>
          </div>
          <div className="min-w-[220px]">
            <Label>Customer</Label>
            <Select data-testid="filter-customer-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="text-xs text-slate-500 ml-auto">{filteredRows.length} dari {rows.length} baris</div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center gap-4">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500">Total Terfilter:</div>
          <div className="text-sm">
            <span className="text-slate-500 mr-1">Sales</span>
            <span className="font-mono font-bold text-emerald-700" data-testid="filtered-total-sales">
              {fmtIDR(filteredRows.reduce((s, r) => s + (Number(r.grand_total) || 0), 0))}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-slate-500 mr-1">Cost</span>
            <span className="font-mono font-bold text-rose-700" data-testid="filtered-total-cost">
              {fmtIDR(filteredRows.reduce((s, r) => s + (Number(r._total_cost) || 0), 0))}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-slate-500 mr-1">Margin</span>
            <span className="font-mono font-bold text-blue-700" data-testid="filtered-total-margin">
              {fmtIDR(filteredRows.reduce((s, r) => s + ((Number(r.grand_total) || 0) - (Number(r._total_cost) || 0)), 0))}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-slate-500 mr-1">Qty</span>
            <span className="font-mono font-bold text-slate-800" data-testid="filtered-total-qty">
              {filteredRows.reduce((s, r) => s + (Number(r.qty_kg) || 0), 0).toLocaleString("id-ID")} Kg
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tgl Pickup</Th><Th>Posisi Terakhir</Th><Th>Tgl Terima</Th><Th>Tgl POD</Th><Th>Customer</Th><Th>Rute</Th>
            <Th>Vendor #1</Th><Th>Vendor #2</Th><Th>Vendor #3</Th>
            <Th className="text-right">Qty (Kg)</Th><Th className="text-right">Selling</Th><Th className="text-right">Cost</Th>
            <Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`order-row-${r.id}`}>
                <Td>
                  <button
                    data-testid={`awb-detail-btn-${r.awb_number}`}
                    onClick={() => setDetailFor(r)}
                    title="Klik untuk lihat detail inputan AWB"
                    className="font-mono font-semibold text-blue-700 hover:underline cursor-pointer"
                  >{r.awb_number}</button>
                </Td>
                <Td className="text-slate-600 text-xs">{fmtDate(r.created_at)}</Td>
                <Td className="text-xs max-w-[220px]">
                  {r.latest_tracking ? (
                    <div>
                      <div className="text-slate-900 truncate" title={r.latest_tracking}>{r.latest_tracking}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{fmtDateTime(r.latest_tracking_at)}</div>
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-slate-600 text-xs">
                  {r.received_at ? (
                    canEditReceive ? (
                      <button data-testid={`edit-receive-${r.awb_number}`} onClick={() => openReceive(r)} className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline" title="Klik untuk edit data terima">
                        <PackageCheck size={11}/> {fmtDate(r.received_at)}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><PackageCheck size={11}/> {fmtDate(r.received_at)}</span>
                    )
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-slate-600 text-xs">
                  {r.pod_received_at ? (
                    canEditPod ? (
                      <button data-testid={`edit-pod-${r.awb_number}`} onClick={() => openPod(r)} className="inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline" title="Klik untuk edit POD">
                        <PackageCheck size={11}/> {fmtDate(r.pod_received_at)}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-blue-700 font-semibold"><PackageCheck size={11}/> {fmtDate(r.pod_received_at)}</span>
                    )
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td>{r.customer_name || "-"}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-xs">{r.vendor_1 || <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{r.vendor_2 || <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{r.vendor_3 || <span className="text-slate-400">—</span>}</Td>
                <Td className="text-right">{r.qty_kg}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td className="text-right">
                  {r._total_cost > 0 ? (
                    canViewCost ? (
                      <button
                        data-testid={`view-cost-${r.awb_number}`}
                        onClick={() => openCostList(r)}
                        title="Klik untuk lihat / hapus rincian cost"
                        className="font-mono font-bold text-rose-700 hover:underline cursor-pointer"
                      >
                        {fmtIDR(r._total_cost)}
                      </button>
                    ) : (
                      <span className="font-mono font-bold text-rose-700">{fmtIDR(r._total_cost)}</span>
                    )
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="text-right">
                  <div className="flex gap-1 justify-end whitespace-nowrap">
                    {/* Tracking — di kiri Terima. Locked bila sudah received atau status Drop */}
                    {r.status !== "Drop" && (
                      <button
                        data-testid={`tracking-btn-${r.awb_number}`}
                        onClick={() => setTrackFor(r)}
                        disabled={!!r.received_at}
                        title={r.received_at ? "Terkunci — barang sudah diterima" : "Update posisi barang berjalan"}
                        className={`px-2 py-1 text-[10px] uppercase font-bold rounded inline-flex items-center gap-1 ${
                          r.received_at
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-blue-100 text-blue-800 hover:bg-blue-200"
                        }`}
                      ><MapPin size={11}/> Tracking</button>
                    )}
                    {canReceive && !r.received_at && r.status !== "Drop" && (
                      <button
                        data-testid={`receive-btn-${r.awb_number}`}
                        onClick={() => openReceive(r)}
                        title="Tanda barang sudah diterima"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1"
                      ><PackageCheck size={11}/> Terima</button>
                    )}
                    {canPod && r.received_at && r.status !== "Drop" && (
                      <button
                        data-testid={`pod-btn-${r.awb_number}`}
                        onClick={() => openPod(r)}
                        title={r.pod_received_at ? "POD sudah diterima — klik untuk update" : "Tanda POD diterima dari consignee"}
                        className={`px-2 py-1 text-[10px] uppercase font-bold rounded inline-flex items-center gap-1 ${r.pod_received_at ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-blue-100 text-blue-800 hover:bg-blue-200"}`}
                      ><PackageCheck size={11}/> {r.pod_received_at ? "Update POD" : "Terima POD"}</button>
                    )}
                    {canDrop && r.status !== "Drop" && (
                      <button data-testid={`drop-order-btn-${r.awb_number}`} onClick={() => dropOrder(r)} title="Drop AWB"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1"
                      ><MinusCircle size={11}/> Drop</button>
                    )}
                    {canDelete && (
                      <button data-testid={`delete-order-btn-${r.awb_number}`} onClick={() => deleteOrder(r)} title="Hapus permanen"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 inline-flex items-center gap-1"
                      ><Trash2 size={11}/> Hapus</button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {filteredRows.length === 0 && <tr><Td colSpan={15} className="text-center text-slate-500 py-10">{rows.length === 0 ? "Tidak ada order." : "Tidak ada hasil cocok dengan filter."}</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-orders"/>
      </Card>

      {/* ========== RECEIVE (Tanggal Terima) MODAL ========== */}
      {recvFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="receive-modal">
          <Card className="w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl text-slate-900">Barang Diterima</h3>
                <p className="text-xs text-slate-500 mt-1">AWB <span className="font-mono font-bold">{recvFor.awb_number}</span> · {recvFor.customer_name}</p>
              </div>
              <button type="button" onClick={() => setRecvFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Tanggal Terima *</Label>
                <Input data-testid="receive-date" type="date" value={recvForm.received_date} onChange={(e) => setRecvForm({ ...recvForm, received_date: e.target.value })} required/>
              </div>
              <div>
                <Label>Nama Penerima *</Label>
                <Input data-testid="receive-name" value={recvForm.received_by_name} onChange={(e) => setRecvForm({ ...recvForm, received_by_name: e.target.value })} required placeholder="Nama orang yang menerima"/>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200">
              <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Penambah Nilai Invoice</h4>
              <p className="text-[11px] text-slate-500 mb-3">Checkbox default OFF. Aktif otomatis jika nilai sudah diisi di Input Order. Saat aktif, nilainya jadi penambah Grand Total invoice (realtime kalkulasi).</p>
              <div className="space-y-2">
                {/* Polis */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-polis-check" type="checkbox" checked={recvForm.polis_enabled} onChange={(e) => setRecvForm({ ...recvForm, polis_enabled: e.target.checked })}/>
                    <span className="font-semibold">Polis</span>
                  </label>
                  {recvForm.polis_enabled && (
                    <NumberInput data-testid="receive-polis-amount" placeholder="Nilai Polis (IDR)" value={recvForm.polis_amount} onChange={(e) => setRecvForm({ ...recvForm, polis_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* Asuransi */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-asuransi-check" type="checkbox" checked={recvForm.asuransi_enabled} onChange={(e) => setRecvForm({ ...recvForm, asuransi_enabled: e.target.checked })}/>
                    <span className="font-semibold">Asuransi</span>
                  </label>
                  {recvForm.asuransi_enabled && (
                    <NumberInput data-testid="receive-asuransi" placeholder="Nilai Asuransi (IDR)" value={recvForm.asuransi_amount} onChange={(e) => setRecvForm({ ...recvForm, asuransi_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* SPSI */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-spsi-check" type="checkbox" checked={recvForm.spsi_enabled} onChange={(e) => setRecvForm({ ...recvForm, spsi_enabled: e.target.checked })}/>
                    <span className="font-semibold">SPSI</span>
                  </label>
                  {recvForm.spsi_enabled && (
                    <NumberInput data-testid="receive-spsi-amount" placeholder="Nilai SPSI (IDR)" value={recvForm.spsi_amount} onChange={(e) => setRecvForm({ ...recvForm, spsi_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* Sewa Forklift */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-forklift-check" type="checkbox" checked={recvForm.sewa_forklift_enabled} onChange={(e) => setRecvForm({ ...recvForm, sewa_forklift_enabled: e.target.checked })}/>
                    <span className="font-semibold">Sewa Forklift</span>
                  </label>
                  {recvForm.sewa_forklift_enabled && (
                    <NumberInput data-testid="receive-forklift-amount" placeholder="Nilai Sewa Forklift (IDR)" value={recvForm.sewa_forklift_amount} onChange={(e) => setRecvForm({ ...recvForm, sewa_forklift_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
              </div>

              {/* Realtime calc summary */}
              {(() => {
                const polis = recvForm.polis_enabled ? (parseFloat(recvForm.polis_amount) || 0) : 0;
                const asuransi = recvForm.asuransi_enabled ? (parseFloat(recvForm.asuransi_amount) || 0) : 0;
                const spsi = recvForm.spsi_enabled ? (parseFloat(recvForm.spsi_amount) || 0) : 0;
                const forklift = recvForm.sewa_forklift_enabled ? (parseFloat(recvForm.sewa_forklift_amount) || 0) : 0;
                const penambah = polis + asuransi + spsi + forklift;
                const gt = (recvFor.grand_total || 0) + penambah;
                return (
                  <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs">
                    <div className="flex items-center justify-between"><span>Nilai AWB:</span><span className="font-mono">{fmtIDR(recvFor.grand_total)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Polis:</span><span className="font-mono">{fmtIDR(polis)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Asuransi:</span><span className="font-mono">{fmtIDR(asuransi)}</span></div>
                    <div className="flex items-center justify-between"><span>+ SPSI:</span><span className="font-mono">{fmtIDR(spsi)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Sewa Forklift:</span><span className="font-mono">{fmtIDR(forklift)}</span></div>
                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-blue-300 font-bold text-blue-900" data-testid="receive-total-preview">
                      <span>Total Invoice (preview):</span><span className="font-heading">{fmtIDR(gt)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200">
              <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Klasifikasi (untuk Report AR)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Jenis Pekerjaan *</Label>
                  <Select data-testid="receive-work-type" value={recvForm.work_type} onChange={(e) => setRecvForm({ ...recvForm, work_type: e.target.value })} required>
                    {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Moda *</Label>
                  <Select data-testid="receive-mode" value={recvForm.mode} onChange={(e) => setRecvForm({ ...recvForm, mode: e.target.value })} required>
                    {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </Select>
                </div>
              </div>
              <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-sm">
                <span className="text-slate-500">Nilai AWB (Grand Total) →</span>
                <span className="font-heading font-bold text-blue-700">{fmtIDR(recvFor.grand_total)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Nilai AWB akan masuk ke kolom <strong>{recvForm.work_type} → {recvForm.mode}</strong> di Report AR Excel.
              </p>
            </div>

            {/* Catatan — optional */}
            <div className="mt-4 pt-3 border-t border-slate-200">
              <Label>Catatan <span className="text-slate-400 text-[10px] ml-1">(opsional)</span></Label>
              <textarea
                data-testid="receive-notes"
                value={recvForm.received_notes || ""}
                onChange={(e) => setRecvForm({ ...recvForm, received_notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none"
                placeholder="Catatan tambahan saat terima barang (opsional)"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setRecvFor(null)}>Batal</Button>
              <Button data-testid="confirm-receive-btn" variant="success" onClick={submitReceive} disabled={saving || !recvForm.received_by_name}>
                <PackageCheck size={14}/> {saving ? "Memproses..." : (recvFor.received_at ? "Update Penerimaan" : "Tandai Diterima")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ========== POD MODAL — Terima POD pada Penerimaan Barang ========== */}
      {podFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="pod-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Terima POD</h3>
                <p className="text-xs text-slate-500">AWB {podFor.awb_number} · {podFor.customer_name}</p>
                {podFor.pod_received_at && (
                  <p className="text-[11px] text-blue-700 mt-1">Sudah ada POD diterima pada {fmtDate(podFor.pod_received_at)} — update akan menimpa.</p>
                )}
              </div>
              <button onClick={() => setPodFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div><Label>Tanggal POD *</Label><Input data-testid="pod-date" type="date" value={podForm.pod_date} onChange={(e) => setPodForm({ ...podForm, pod_date: e.target.value })}/></div>
              <div><Label>Tertanda (Nama Penanda Tangan POD)</Label><Input data-testid="pod-signed-by" value={podForm.pod_signed_by} onChange={(e) => setPodForm({ ...podForm, pod_signed_by: e.target.value })}/></div>
              <div><Label>Catatan POD</Label><Input data-testid="pod-notes" value={podForm.pod_notes} onChange={(e) => setPodForm({ ...podForm, pod_notes: e.target.value })}/></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setPodFor(null)}>Batal</Button>
              <Button data-testid="confirm-pod-btn" variant="success" onClick={submitPod} disabled={savingPod}>
                <PackageCheck size={14}/> {savingPod ? "Memproses..." : "Tandai POD Diterima"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ========== COST LIST POPUP — Reusable shared component ========== */}
      {costFor && (
        <CostListModal
          awb={costFor}
          onClose={() => setCostFor(null)}
          onChanged={load}
        />
      )}

      {/* ========== TRACKING POPUP — Posisi barang berjalan ========== */}
      {trackFor && (
        <TrackingModal
          awb={trackFor}
          onClose={() => setTrackFor(null)}
          onSaved={load}
        />
      )}

      {/* ========== AWB DETAIL POPUP ========== */}
      {detailFor && (
        <AwbDetailModal
          awbId={detailFor.id}
          awbNumber={detailFor.awb_number}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}
