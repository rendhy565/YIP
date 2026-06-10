import React, { useEffect, useState, useMemo } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label } from "../components/ui";
import { fmtIDR } from "../lib/utils";
import { TrendingUp, DollarSign, Package, AlertCircle, Filter, RotateCcw, ChevronLeft, ChevronRight, Download, Trash2, MinusCircle, Bookmark, Share2, Plus, Globe, Lock, X } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { errMsg } from "../lib/utils";

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7"];

const fmtMillion = (v) => v >= 1_000_000_000 ? `${(v/1_000_000_000).toFixed(2)} M` : v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)} jt` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "-";

const STATUS_COLORS = {
  Open: "bg-slate-100 text-slate-700",
  Reconciled: "bg-amber-100 text-amber-800",
  Invoiced: "bg-blue-100 text-blue-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Drop: "bg-rose-100 text-rose-800 line-through",
};

export default function AnalyticsDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  // Filters
  const [filters, setFilters] = useState({
    period_from: "",
    period_to: "",
    customer_id: "",
    region: "",
    status: "",
    fleet_type: "",
    armada_type: "",
  });
  const [search, setSearch] = useState("");
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [appliedSearch, setAppliedSearch] = useState("");

  // Master data for filter dropdowns
  const [customers, setCustomers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [fleetTypes, setFleetTypes] = useState([]);
  const [armadaTypes, setArmadaTypes] = useState([]);

  // Dashboard data
  const [dash, setDash] = useState(null);

  // Detail table
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Initial master data
  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data || []));
    api.get("/masters/regions").then((r) => setRegions(r.data || []));
    api.get("/masters/fleet-types").then((r) => setFleetTypes(r.data || []));
    api.get("/masters/armada-types").then((r) => setArmadaTypes(r.data || []));
  }, []);

  // Load dashboard whenever applied filters change
  useEffect(() => {
    const params = {};
    Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.get("/analytics/dashboard", { params }).then((r) => setDash(r.data));
  }, [appliedFilters]);

  // Load detail rows whenever filters/page/sort change
  useEffect(() => {
    const params = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
    Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params[k] = v; });
    if (appliedSearch) params.search = appliedSearch;
    api.get("/analytics/awbs-detail", { params }).then((r) => {
      setRows(r.data.rows || []);
      setTotal(r.data.total || 0);
    });
  }, [appliedFilters, appliedSearch, page, pageSize, sortBy, sortDir]);

  const apply = () => { setPage(1); setAppliedFilters({ ...filters }); setAppliedSearch(search); };
  const reset = () => {
    const blank = { period_from: "", period_to: "", customer_id: "", region: "", status: "", fleet_type: "", armada_type: "" };
    setFilters(blank); setSearch(""); setAppliedFilters(blank); setAppliedSearch(""); setPage(1);
    setActiveViewId(null);
  };

  // ============ SAVED VIEWS ============
  const [savedViews, setSavedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewShared, setNewViewShared] = useState(false);

  const loadSavedViews = () => {
    api.get("/analytics/saved-views").then((r) => setSavedViews(r.data || [])).catch(() => {});
  };

  useEffect(() => { loadSavedViews(); }, []);

  // Apply view: copy its filters + search into local state and trigger fetch
  const applyView = (view) => {
    const f = view.filters || {};
    const next = {
      period_from: f.period_from || "",
      period_to: f.period_to || "",
      customer_id: f.customer_id || "",
      region: f.region || "",
      status: f.status || "",
      fleet_type: f.fleet_type || "",
      armada_type: f.armada_type || "",
    };
    const s = f.search || "";
    setFilters(next); setSearch(s);
    setAppliedFilters(next); setAppliedSearch(s);
    setPage(1); setActiveViewId(view.id);
    toast.success(`View "${view.name}" diterapkan`);
  };

  // On mount: deep-link via ?view={id}
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vid = params.get("view");
    if (vid) {
      api.get(`/analytics/saved-views/${vid}`).then((r) => applyView(r.data)).catch(() => {
        toast.error("View tidak ditemukan atau Anda tidak punya akses");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCurrentView = async () => {
    const name = newViewName.trim();
    if (!name) { toast.error("Nama view wajib diisi"); return; }
    try {
      const payload = {
        name,
        filters: { ...filters, search },
        is_shared: newViewShared,
      };
      const r = await api.post("/analytics/saved-views", payload);
      toast.success(`View "${r.data.name}" disimpan`);
      setShowSaveModal(false); setNewViewName(""); setNewViewShared(false);
      setActiveViewId(r.data.id);
      loadSavedViews();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const toggleShareView = async (view) => {
    try {
      const r = await api.patch(`/analytics/saved-views/${view.id}`, { is_shared: !view.is_shared });
      toast.success(r.data.is_shared ? `View "${r.data.name}" sekarang shared` : `View "${r.data.name}" sekarang private`);
      loadSavedViews();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const deleteView = async (view) => {
    if (!window.confirm(`Hapus saved view "${view.name}"?`)) return;
    try {
      await api.delete(`/analytics/saved-views/${view.id}`);
      toast.success(`View "${view.name}" dihapus`);
      if (activeViewId === view.id) setActiveViewId(null);
      loadSavedViews();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const copyShareLink = (view) => {
    const url = `${window.location.origin}/analytics?view=${view.id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link disalin ke clipboard"),
      () => toast.error("Gagal copy link")
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const sortCol = (col) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  // === Actions: Drop status (any user) + Delete (admin only) + Export Excel ===
  const exportExcel = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params.append(k, v); });
      if (appliedSearch) params.append("search", appliedSearch);
      const resp = await api.get(`/analytics/awbs-detail/export?${params.toString()}`, { responseType: "blob" });
      const blob = new Blob([resp.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ARC_AWB_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Export ${total} baris berhasil`);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const dropAwb = async (awb) => {
    if (!window.confirm(`Tandai AWB ${awb.awb_number} sebagai DROP? AWB akan tetap tercatat tapi tidak ditagih.`)) return;
    try {
      await api.patch(`/orders/${awb.id}/status`, { status: "Drop" });
      toast.success(`AWB ${awb.awb_number} di-drop`);
      // Reload list
      const params = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params[k] = v; });
      if (appliedSearch) params.search = appliedSearch;
      api.get("/analytics/awbs-detail", { params }).then((r) => { setRows(r.data.rows || []); setTotal(r.data.total || 0); });
    } catch (e) { toast.error(errMsg(e)); }
  };

  const deleteAwb = async (awb) => {
    if (!window.confirm(`HAPUS PERMANEN AWB ${awb.awb_number}? Semua biaya, invoice, dan jurnal terkait akan ikut terhapus. Tindakan ini TIDAK BISA di-undo.`)) return;
    try {
      const r = await api.delete(`/orders/${awb.id}`);
      const d = r.data.deleted;
      toast.success(`AWB ${d.awb} dihapus (${d.costs} biaya, ${d.invoices} invoice, ${d.journals} jurnal terhapus)`);
      const params = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params[k] = v; });
      if (appliedSearch) params.search = appliedSearch;
      api.get("/analytics/awbs-detail", { params }).then((r) => { setRows(r.data.rows || []); setTotal(r.data.total || 0); });
    } catch (e) { toast.error(errMsg(e)); }
  };

  const k = dash?.kpis || {};

  return (
    <div data-testid="analytics-page">
      <PageHeader title="Dashboard Analitik" subtitle="KPI · Tren bulanan · Breakdown wilayah/customer/armada · Tabel detail per AWB. Multi-filter di semua dimensi." />

      {/* SAVED VIEWS BAR */}
      <Card className="mb-3">
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
          <Bookmark size={16} className="text-amber-600"/>
          <h3 className="font-bold text-sm">Saved Views</h3>
          <div className="text-xs text-slate-500">{savedViews.length} tersimpan</div>
          <Button
            data-testid="save-view-btn"
            variant="secondary"
            onClick={() => { setNewViewName(""); setNewViewShared(false); setShowSaveModal(true); }}
            className="ml-2"
          >
            <Plus size={13}/> Simpan View Sekarang
          </Button>
          {activeViewId && (
            <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded font-medium">
              Aktif: {savedViews.find((v) => v.id === activeViewId)?.name || "?"}
            </span>
          )}
        </div>
        {savedViews.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {savedViews.map((v) => (
              <div
                key={v.id}
                data-testid={`saved-view-${v.id}`}
                className={`group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                  activeViewId === v.id
                    ? "bg-blue-50 border-blue-300 text-blue-800"
                    : "bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
                }`}
              >
                <button
                  data-testid={`apply-view-${v.id}`}
                  onClick={() => applyView(v)}
                  className="font-semibold inline-flex items-center gap-1"
                  title={v.is_mine ? "View kamu" : `Shared oleh @${v.owner_username}`}
                >
                  {v.is_shared ? <Globe size={11} className="text-emerald-600"/> : <Lock size={11} className="text-slate-400"/>}
                  {v.name}
                  {!v.is_mine && <span className="text-[9px] text-slate-400 font-normal">@{v.owner_username}</span>}
                </button>
                <button
                  data-testid={`copy-link-${v.id}`}
                  onClick={() => copyShareLink(v)}
                  className="p-0.5 hover:text-blue-700"
                  title="Copy share link"
                ><Share2 size={11}/></button>
                {v.is_mine && (
                  <>
                    <button
                      data-testid={`toggle-share-${v.id}`}
                      onClick={() => toggleShareView(v)}
                      className="p-0.5 hover:text-emerald-700"
                      title={v.is_shared ? "Jadikan private" : "Share ke semua user"}
                    >{v.is_shared ? <Lock size={11}/> : <Globe size={11}/>}</button>
                    <button
                      data-testid={`delete-view-${v.id}`}
                      onClick={() => deleteView(v)}
                      className="p-0.5 hover:text-rose-700"
                      title="Hapus view"
                    ><X size={11}/></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SAVE VIEW MODAL */}
      {showSaveModal && (
        <div
          data-testid="save-view-modal"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSaveModal(false); }}
        >
          <Card className="max-w-md w-full">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <Bookmark size={16} className="text-amber-600"/>
              <h3 className="font-bold">Simpan View Baru</h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <Label>Nama View</Label>
                <Input
                  data-testid="view-name-input"
                  autoFocus
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                  placeholder="cth: AWB Jakarta Bulan Ini Belum Bayar"
                  maxLength={80}
                />
              </div>
              <div>
                <Label>Filter yang akan disimpan:</Label>
                <div className="text-xs bg-slate-50 rounded p-2 font-mono text-slate-700 max-h-32 overflow-y-auto">
                  {Object.entries({ ...filters, search }).filter(([_, v]) => v).map(([k, v]) => (
                    <div key={k}><span className="text-slate-500">{k}:</span> {v}</div>
                  ))}
                  {Object.values({ ...filters, search }).every((v) => !v) && (
                    <div className="text-slate-400 italic">(tidak ada filter — akan simpan view "Semua Data")</div>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-testid="view-shared-checkbox"
                  type="checkbox"
                  checked={newViewShared}
                  onChange={(e) => setNewViewShared(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">
                  <Globe size={12} className="inline text-emerald-600"/> Share ke semua user
                </span>
              </label>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowSaveModal(false)}>Batal</Button>
              <Button data-testid="confirm-save-view-btn" onClick={saveCurrentView}>
                <Bookmark size={13}/> Simpan
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* FILTER BAR */}
      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Filter size={16} className="text-blue-700"/>
          <h3 className="font-bold">Filter</h3>
          <div className="ml-auto flex gap-2">
            <Button data-testid="analytics-reset-btn" variant="ghost" onClick={reset}><RotateCcw size={13}/> Reset</Button>
            <Button data-testid="analytics-apply-btn" onClick={apply}><Filter size={13}/> Terapkan</Button>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div><Label>Tanggal Dari</Label><Input type="date" value={filters.period_from} onChange={(e) => setFilters({...filters, period_from: e.target.value})}/></div>
          <div><Label>Tanggal Sampai</Label><Input type="date" value={filters.period_to} onChange={(e) => setFilters({...filters, period_to: e.target.value})}/></div>
          <div>
            <Label>Customer</Label>
            <Select value={filters.customer_id} onChange={(e) => setFilters({...filters, customer_id: e.target.value})}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Wilayah</Label>
            <Select value={filters.region} onChange={(e) => setFilters({...filters, region: e.target.value})}>
              <option value="">Semua Wilayah</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={filters.status} onChange={(e) => setFilters({...filters, status: e.target.value})}>
              <option value="">Semua Status</option>
              <option value="Open">Open</option>
              <option value="Reconciled">Reconciled</option>
              <option value="Invoiced">Invoiced</option>
              <option value="Paid">Paid</option>
              <option value="Drop">Drop</option>
            </Select>
          </div>
          <div>
            <Label>Jenis Armada</Label>
            <Select value={filters.fleet_type} onChange={(e) => setFilters({...filters, fleet_type: e.target.value})}>
              <option value="">Semua</option>
              {fleetTypes.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </div>
          <div>
            <Label>Tipe Armada</Label>
            <Select value={filters.armada_type} onChange={(e) => setFilters({...filters, armada_type: e.target.value})}>
              <option value="">Semua</option>
              {armadaTypes.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
          <div>
            <Label>Cari (AWB / WO / Invoice / Tujuan)</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="cth: 205771 atau JKT"/>
          </div>
        </div>
      </Card>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
        <Kpi label="Total AWB" value={k.total_awbs ?? 0} icon={<Package size={16}/>} color="blue"/>
        <Kpi label="Total Selling" value={"Rp " + fmtMillion(k.total_selling || 0)} icon={<DollarSign size={16}/>} color="emerald"/>
        <Kpi label="Total Inv + PPN" value={"Rp " + fmtMillion(k.total_inv || 0)} icon={<DollarSign size={16}/>} color="cyan"/>
        <Kpi label="Total Biaya" value={"Rp " + fmtMillion(k.total_costs || 0)} icon={<DollarSign size={16}/>} color="orange"/>
        <Kpi label={`Gross Margin (${(k.margin_pct ?? 0).toFixed(1)}%)`} value={"Rp " + fmtMillion(k.gross_margin || 0)} icon={<TrendingUp size={16}/>} color="purple"/>
        <Kpi label="Piutang (Belum Bayar)" value={"Rp " + fmtMillion(k.unpaid_amount || 0)} icon={<AlertCircle size={16}/>} color="rose"/>
      </div>

      {/* CHARTS — row 1: monthly trend + status pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold">Tren Bulanan (Selling vs Biaya vs Margin)</h3>
            <div className="text-xs text-slate-500">{(dash?.monthly_series || []).length} bulan</div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={dash?.monthly_series || []} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                <XAxis dataKey="month" tick={{ fontSize: 11 }}/>
                <YAxis tickFormatter={fmtMillion} tick={{ fontSize: 11 }}/>
                <Tooltip formatter={(v) => "Rp " + Number(v).toLocaleString("id-ID")}/>
                <Legend wrapperStyle={{ fontSize: 11 }}/>
                <Bar dataKey="selling" name="Selling" fill="#2563eb" radius={[3,3,0,0]}/>
                <Bar dataKey="costs" name="Biaya" fill="#ef4444" radius={[3,3,0,0]}/>
                <Bar dataKey="margin" name="Margin" fill="#10b981" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-bold mb-2">Distribusi Status</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={dash?.status_breakdown || []}
                  dataKey="awbs" nameKey="label"
                  innerRadius={50} outerRadius={90} paddingAngle={2}
                  label={(e) => `${e.label}: ${e.awbs}`}
                  labelLine={false}
                >
                  {(dash?.status_breakdown || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                </Pie>
                <Tooltip formatter={(v) => v + " AWB"}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* CHARTS — row 2: region + top customer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="p-4">
          <h3 className="font-bold mb-2">Breakdown Wilayah (by Selling)</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={(dash?.region_breakdown || []).slice(0, 10)} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                <XAxis type="number" tickFormatter={fmtMillion} tick={{ fontSize: 11 }}/>
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={75}/>
                <Tooltip formatter={(v, n) => n === "selling" ? "Rp " + Number(v).toLocaleString("id-ID") : v}/>
                <Bar dataKey="selling" name="Selling" fill="#8b5cf6" radius={[0,3,3,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-bold mb-2">Top 10 Customer (by Selling)</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={(dash?.customer_breakdown || []).slice(0, 10)} layout="vertical" margin={{ top: 5, right: 20, left: 130, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                <XAxis type="number" tickFormatter={fmtMillion} tick={{ fontSize: 11 }}/>
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={125} tickFormatter={(t) => t.length > 22 ? t.slice(0,20)+"…" : t}/>
                <Tooltip formatter={(v, n) => n === "selling" ? "Rp " + Number(v).toLocaleString("id-ID") : v}/>
                <Bar dataKey="selling" name="Selling" fill="#06b6d4" radius={[0,3,3,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* DETAIL WIDE TABLE */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <h3 className="font-bold">Detail AWB</h3>
          <div className="text-xs text-slate-500 ml-2">{total.toLocaleString("id-ID")} baris</div>
          <Button data-testid="export-excel-btn" variant="secondary" onClick={exportExcel} disabled={total === 0}>
            <Download size={14}/> Export Excel
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Label className="m-0">Per page</Label>
            <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="w-24">
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </Select>
            <Button variant="ghost" onClick={() => setPage(Math.max(1, page-1))} disabled={page <= 1}><ChevronLeft size={14}/></Button>
            <div className="text-xs font-mono">Page {page} / {totalPages}</div>
            <Button variant="ghost" onClick={() => setPage(Math.min(totalPages, page+1))} disabled={page >= totalPages}><ChevronRight size={14}/></Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-max text-sm">
            <thead className="bg-slate-100 text-slate-700 sticky top-0">
              <tr>
                <ColHead onClick={() => sortCol("awb_number")} sorted={sortBy === "awb_number" ? sortDir : null} sticky>AWB</ColHead>
                <ColHead>WO</ColHead>
                <ColHead onClick={() => sortCol("created_at")} sorted={sortBy === "created_at" ? sortDir : null}>Pickup</ColHead>
                <ColHead>Customer</ColHead>
                <ColHead>Wilayah</ColHead>
                <ColHead>Kota/Tujuan</ColHead>
                <ColHead>Tipe Armada</ColHead>
                <ColHead>Jenis Armada</ColHead>
                <ColHead>Vendor Utama</ColHead>
                <ColHead align="right">Item Lines</ColHead>
                <ColHead align="right">Kg</ColHead>
                <ColHead align="right" onClick={() => sortCol("total_tariff")} sorted={sortBy === "total_tariff" ? sortDir : null}>Selling</ColHead>
                <ColHead align="right">PPN</ColHead>
                <ColHead align="right" onClick={() => sortCol("grand_total")} sorted={sortBy === "grand_total" ? sortDir : null}>Inv+PPN</ColHead>
                <ColHead align="right">Cashback</ColHead>
                <ColHead align="right">PPh 2%</ColHead>
                <ColHead align="right">Total Biaya</ColHead>
                <ColHead align="right">Margin Rp</ColHead>
                <ColHead align="right">Margin %</ColHead>
                <ColHead>Status</ColHead>
                <ColHead>No Inv Eksternal</ColHead>
                <ColHead>Tgl Bayar</ColHead>
                <ColHead align="right">Aksi</ColHead>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={23} className="text-center text-slate-400 py-8">Tidak ada data</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} className="hover:bg-blue-50/40 border-b border-slate-100">
                  <td className="px-3 py-2 font-mono font-bold text-blue-700 sticky left-0 bg-white hover:bg-blue-50/40">{r.awb_number}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.wo_number || "-"}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.pickup_date)}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={r.customer_name}>{r.customer_name}</td>
                  <td className="px-3 py-2"><span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">{r.region || "-"}</span></td>
                  <td className="px-3 py-2">{r.destination_city || r.destination || "-"}</td>
                  <td className="px-3 py-2 text-xs">{r.armada_type || "-"}</td>
                  <td className="px-3 py-2 text-xs">{r.fleet_type || "-"}</td>
                  <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={r.vendor_name}>{r.vendor_name || "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.items_count}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{r.qty_kg || "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtIDR(r.selling)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtIDR(r.ppn)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{fmtIDR(r.inv_ppn)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-rose-700">{r.cashback ? fmtIDR(r.cashback) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-rose-700">{r.pph_final ? fmtIDR(r.pph_final) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-rose-700">{fmtIDR(r.total_costs)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${r.margin >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtIDR(r.margin)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold text-xs ${r.margin_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{r.margin_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2"><span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${STATUS_COLORS[r.status] || "bg-slate-100"}`}>{r.status}</span></td>
                  <td className="px-3 py-2 text-xs font-mono">{r.external_invoice || "-"}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.paid_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end whitespace-nowrap">
                      {r.status !== "Drop" && (
                        <button
                          data-testid={`drop-btn-${r.awb_number}`}
                          onClick={() => dropAwb(r)}
                          title="Drop AWB"
                          className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1"
                        ><MinusCircle size={11}/> Drop</button>
                      )}
                      {isAdmin && (
                        <button
                          data-testid={`delete-btn-${r.awb_number}`}
                          onClick={() => deleteAwb(r)}
                          title="Hapus permanen (admin only)"
                          className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 inline-flex items-center gap-1"
                        ><Trash2 size={11}/> Hapus</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, color = "blue" }) {
  const map = {
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    cyan: "bg-cyan-50 border-cyan-200 text-cyan-900",
    orange: "bg-orange-50 border-orange-200 text-orange-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  };
  return (
    <Card className={`p-3 ${map[color] || ""}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider font-bold opacity-70">{label}</div>
        <div className="opacity-60">{icon}</div>
      </div>
      <div className="font-mono font-black text-xl tracking-tight">{value}</div>
    </Card>
  );
}

function ColHead({ children, onClick, sorted, align, sticky }) {
  const arrow = sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "";
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${onClick ? "cursor-pointer hover:bg-slate-200" : ""} ${sticky ? "sticky left-0 bg-slate-100 z-10" : ""}`}
    >
      {children}{arrow && <span className="ml-1 text-blue-700">{arrow}</span>}
    </th>
  );
}
