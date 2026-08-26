import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import VendorSelect from "../components/VendorSelect";
import { errMsg, fmtIDR, fmtDate, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { Plus, Trash2, X, Wallet, Coins, Layers, RefreshCw, CheckSquare, Square, Search } from "lucide-react";
import NumberInput from "../components/NumberInput";
import Pagination, { usePagination } from "../components/Pagination";

export default function Costs() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [costs, setCosts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [open, setOpen] = useState(false);

  const isOp = user?.role === "operation";
  const isAdmin = user?.role === "administrator";
  const defaultCategory = isOp ? "Vendor" : "Operational";
  const canProrata = isOp || isAdmin;

  const [form, setForm] = useState({
    awb_id: "",
    cost_category: defaultCategory,
    amount: "",
    description: "",
    vendor_name: "",
  });

  // Prorata Vendor state
  const [proOpen, setProOpen] = useState(false);
  const [proForm, setProForm] = useState({ vendor_name: "", period_month: currentMonth(), total_amount: "", description: "", awb_ids: [] });
  const [proCandidates, setProCandidates] = useState([]);
  const [proBusy, setProBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [proSearch, setProSearch] = useState("");
  const [proInclInvoiced, setProInclInvoiced] = useState(false);
  const [proSelected, setProSelected] = useState({}); // id -> awb detail (persist across search)

  const loadGroups = () => api.get("/cost-groups").then((r) => setGroups(r.data || [])).catch(() => {});
  const loadVendors = () => api.get("/vendors").then((r) => setVendors(r.data || [])).catch(() => {});
  const load = async () => {
    const [o, c] = await Promise.all([api.get("/orders"), api.get("/costs")]);
    setOrders(o.data); setCosts(c.data);
    loadGroups();
    loadVendors();
  };
  useEffect(() => { load(); }, []);

  // Deep-link ?prorata=1 auto-open modal
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("prorata") === "1" && canProrata) {
      setProOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, canProrata, setSearchParams]);

  const loadProCandidates = () => {
    const search = proSearch.trim();
    const params = {};
    if (search) {
      params.q = search;
    } else {
      if (proForm.period_month) params.period_month = proForm.period_month;
      if (proInclInvoiced) params.include_invoiced = true;
    }
    api.get("/cost-groups/candidate-awbs", { params })
      .then((r) => setProCandidates(r.data || []))
      .catch(() => setProCandidates([]));
  };
  // Debounced reload on open / filter / search change
  useEffect(() => {
    if (!proOpen) return;
    const t = setTimeout(loadProCandidates, 300);
    return () => clearTimeout(t);
  }, [proOpen, proForm.period_month, proSearch, proInclInvoiced]); // eslint-disable-line

  const selectedList = useMemo(() => Object.values(proSelected), [proSelected]);
  const proTotalSelectedSales = useMemo(() => {
    return selectedList.reduce((s, a) => s + (Number(a.grand_total) || 0), 0);
  }, [selectedList]);

  const proPreview = useMemo(() => {
    const total = Number(proForm.total_amount) || 0;
    if (!total || proTotalSelectedSales <= 0) return [];
    let running = 0;
    return selectedList.map((a, i) => {
      const share = a.grand_total / proTotalSelectedSales;
      const amt = i === selectedList.length - 1
        ? +(total - running).toFixed(2)
        : +(total * share).toFixed(2);
      if (i !== selectedList.length - 1) running += amt;
      return { ...a, share_pct: +(share * 100).toFixed(2), amount: amt };
    });
  }, [proForm.total_amount, selectedList, proTotalSelectedSales]);

  const toggleProAwb = (a) => {
    setProSelected((m) => {
      const next = { ...m };
      if (next[a.id]) delete next[a.id]; else next[a.id] = a;
      setProForm((f) => ({ ...f, awb_ids: Object.keys(next) }));
      return next;
    });
  };

  const submitProrata = async (e) => {
    e.preventDefault();
    if (proForm.awb_ids.length < 2) return toast.error("Pilih minimal 2 AWB");
    if (!proForm.vendor_name.trim()) return toast.error("Nama vendor wajib diisi");
    if (!(Number(proForm.total_amount) > 0)) return toast.error("Total amount harus > 0");
    setProBusy(true);
    try {
      const r = await api.post("/cost-groups", {
        vendor_name: proForm.vendor_name.trim(),
        period_month: proForm.period_month,
        total_amount: Number(proForm.total_amount),
        awb_ids: proForm.awb_ids,
        description: proForm.description || null,
      });
      toast.success(`Prorata dibuat — ${r.data.children_created} baris cost di-generate`);
      setProOpen(false);
      setProForm({ vendor_name: "", period_month: currentMonth(), total_amount: "", description: "", awb_ids: [] });
      setProSelected({}); setProSearch(""); setProInclInvoiced(false);
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setProBusy(false); }
  };

  const refreshGroup = async (gid) => {
    try {
      const r = await api.post(`/cost-groups/${gid}/refresh`);
      toast.success(`Refreshed — ${r.data.children_recreated} baris di-recompute`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const deleteGroup = async (gid) => {
    if (!window.confirm("Hapus cost group beserta semua baris cost prorata di dalamnya?")) return;
    try {
      await api.delete(`/cost-groups/${gid}`);
      toast.success("Cost group dihapus");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/costs", { ...form, amount: parseFloat(form.amount) });
      toast.success("Biaya ditambahkan");
      setOpen(false); setForm({ awb_id: "", cost_category: defaultCategory, amount: "", description: "", vendor_name: "" });
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {    if (!window.confirm("Hapus biaya?")) return;
    try {
      const r = await api.delete(`/costs/${id}`);
      // Server returns ok=false + needs_confirmation when this is the LAST cost
      // on the AWB and revenue recognition would be reversed.
      if (r.data && r.data.needs_confirmation) {
        const ok = window.confirm(
          `⚠️ PERINGATAN PSAK 72\n\n${r.data.warning}\n\nApakah Anda yakin ingin melanjutkan?`
        );
        if (!ok) return;
        const r2 = await api.delete(`/costs/${id}?confirm=true`);
        if (r2.data && r2.data.reversal && r2.data.reversal.reversed) {
          toast.warning(r2.data.reversal.message, { duration: 6000 });
        } else {
          toast.success("Dihapus");
        }
        load();
        return;
      }
      if (r.data && r.data.reversal && r.data.reversal.reversed) {
        toast.warning(r.data.reversal.message, { duration: 6000 });
      } else {
        toast.success("Dihapus");
      }
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const costsPag = usePagination(costs, { resetKey: String(costs.length) });

  return (
    <div data-testid="costs-page">
      <PageHeader
        title="Plotting Biaya"
        subtitle={
          isOp
            ? "Modul 2 — Role Operation input biaya VENDOR (Accrue/Hutang). Prorata Vendor: 1 tagihan dibagi proporsional ke banyak AWB berdasarkan sales."
            : "Modul 2 — Role Finance input biaya OPERATIONAL & LINTAS (Cash)."
        }
        action={
          <div className="flex gap-2">
            {canProrata && (
              <Button data-testid="open-prorata-btn" variant="secondary" onClick={() => setProOpen(true)}>
                <Layers size={14}/> Prorata Vendor
              </Button>
            )}
            <Button data-testid="add-cost-btn" onClick={() => setOpen(true)}><Plus size={16}/> Tambah Biaya</Button>
          </div>
        }
      />

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-sm">Daftar Biaya per AWB</h3>
          <span className="text-xs text-slate-500">{costs.length} baris</span>
        </div>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Kategori</Th><Th>Tipe</Th>
            <Th>Vendor / Deskripsi</Th><Th className="text-right">Jumlah</Th><Th>Settle</Th><Th></Th>
          </tr></thead>
          <tbody>
            {costsPag.paged.map((c) => (
              <tr key={c.id} data-testid={`cost-row-${c.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(c.created_at)}</Td>
                <Td className="font-mono font-semibold">{c.awb_number}</Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase ${
                    c.cost_category === "Vendor" ? "text-orange-700" :
                    c.cost_category === "Operational" ? "text-teal-700" :
                    c.cost_category === "Marketing" ? "text-pink-700" : "text-indigo-700"
                  }`}>
                    {c.cost_category === "Vendor" ? <Wallet size={12}/> : <Coins size={12}/>}
                    {c.cost_category}
                  </span>
                </Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    c.payment_type === "Accrue" ? "bg-orange-100 text-orange-800 border-orange-200" : "bg-teal-100 text-teal-800 border-teal-200"
                  }`}>{c.payment_type === "Accrue" ? "Hutang" : "Cash"}</span>
                </Td>
                <Td>
                  <div className="text-sm">
                    {c.vendor_name || "-"}
                    {c.is_prorata && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0 rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold uppercase" title="Cost hasil prorata dari vendor bulk">
                        <Layers size={8} className="mr-0.5"/> Prorata {c.prorata_share_pct ? `${c.prorata_share_pct}%` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">{c.description || ""}</div>
                </Td>
                <Td className="text-right font-mono font-semibold">{fmtIDR(c.amount)}</Td>
                <Td>
                  <span className={`text-[10px] font-bold uppercase ${c.is_settled ? "text-emerald-700" : "text-slate-400"}`}>
                    {c.is_settled ? "Selesai" : "Pending"}
                  </span>
                </Td>
                <Td className="text-right">
                  {((isOp && c.cost_category === "Vendor") || isAdmin || (!isOp && !isAdmin)) && (
                    <button data-testid={`delete-cost-${c.id}`} onClick={() => del(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                  )}
                </Td>
              </tr>
            ))}
            {costs.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-8">Belum ada biaya.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...costsPag} testid="pagination-costs"/>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Tambah Biaya</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>AWB *</Label>
                <SearchableSelect
                  testid="cost-awb-select"
                  value={form.awb_id}
                  onChange={(v) => setForm({ ...form, awb_id: v })}
                  options={orders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name} · ${o.origin}→${o.destination}` }))}
                  placeholder="— Pilih AWB —"
                  emptyText="AWB tidak ditemukan"
                  required
                />
              </div>
              <div>
                <Label>Kategori Biaya *</Label>
                <Select data-testid="cost-category-select" value={form.cost_category} onChange={(e) => setForm({ ...form, cost_category: e.target.value })} required>
                  {isAdmin ? (
                    <>
                      <option value="Vendor">Vendor (Accrue / Hutang)</option>
                      <option value="Operational">Operational (Cash)</option>
                      <option value="Lintas">Lintas (Cash)</option>
                      <option value="Marketing">Marketing (COGS terpisah)</option>
                    </>
                  ) : isOp ? (
                    <option value="Vendor">Vendor (Accrue / Hutang)</option>
                  ) : (
                    <>
                      <option value="Operational">Operational (Cash)</option>
                      <option value="Lintas">Lintas (Cash)</option>
                      <option value="Marketing">Marketing (COGS terpisah)</option>
                    </>
                  )}
                </Select>
              </div>
              {form.cost_category === "Vendor" && (
                <div>
                  <Label>Nama Vendor</Label>
                  <VendorSelect
                    testid="cost-vendor-select"
                    value={form.vendor_name}
                    onChange={(v) => setForm({ ...form, vendor_name: v })}
                    vendors={vendors}
                    onVendorsChange={loadVendors}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Pilih dari master. Belum ada? Klik <b>+ Baru</b> — Finance akan set jenis PPh-nya.</p>
                </div>
              )}
              <div>
                <Label>Jumlah (IDR) *</Label>
                <NumberInput data-testid="cost-amount-input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Trucking ke gudang"/>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-cost-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* --- Prorata Vendor Groups Panel --- */}
      {groups.length > 0 && (
        <Card className="mt-5" data-testid="cost-groups-panel">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap bg-indigo-50">
            <Layers size={14} className="text-indigo-700"/>
            <h3 className="font-bold text-sm">Prorata Vendor — Cost Groups</h3>
            <span className="text-xs text-slate-500">{groups.length} group</span>
          </div>
          <div className="divide-y divide-slate-200">
            {groups.map((g) => (
              <div key={g.id} className="p-4" data-testid={`cost-group-${g.id}`}>
                <div className="flex flex-wrap items-start gap-3 mb-2">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-bold text-slate-900">{g.vendor_name}</div>
                    <div className="text-[11px] text-slate-500">
                      Periode {g.period_month} · {g.awb_count} AWB · {g.settled_count} settled
                      {g.description && ` · ${g.description}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold text-slate-500">Total Tagihan</div>
                    <div className="font-mono font-bold text-lg text-indigo-800">{fmtIDR(g.total_amount)}</div>
                  </div>
                  {canProrata && (
                    <div className="flex gap-1.5">
                      <Button variant="secondary" data-testid={`refresh-group-${g.id}`} onClick={() => refreshGroup(g.id)} disabled={g.settled_count > 0} title={g.settled_count > 0 ? "Ada child settled, batalkan settlement dulu" : "Recompute berdasarkan grand_total AWB saat ini"}>
                        <RefreshCw size={12}/> Refresh
                      </Button>
                      <button data-testid={`delete-group-${g.id}`} onClick={() => deleteGroup(g.id)} disabled={g.settled_count > 0} className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 disabled:cursor-not-allowed">
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  )}
                </div>
                <Table>
                  <thead><tr>
                    <Th>AWB</Th><Th className="text-right">Sales</Th><Th className="text-right">Share %</Th><Th className="text-right">Prorata Cost</Th><Th>Status</Th>
                  </tr></thead>
                  <tbody>
                    {(g.children || []).map((c) => (
                      <tr key={c.cost_id}>
                        <Td className="font-mono font-semibold text-xs">{c.awb_number}</Td>
                        <Td className="text-right font-mono text-xs">{fmtIDR(c.grand_total)}</Td>
                        <Td className="text-right font-mono text-xs text-indigo-700">{c.share_pct}%</Td>
                        <Td className="text-right font-mono font-bold text-rose-700">{fmtIDR(c.amount)}</Td>
                        <Td><span className={`text-[10px] font-bold uppercase ${c.is_settled ? "text-emerald-700" : "text-slate-400"}`}>{c.is_settled ? "Settled" : "Pending"}</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --- Prorata Modal --- */}
      {proOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between p-5 border-b border-slate-200">
              <div>
                <h3 className="font-heading font-bold text-xl inline-flex items-center gap-2"><Layers size={20} className="text-indigo-700"/> Prorata Vendor Cost</h3>
                <p className="text-xs text-slate-500 mt-0.5">1 tagihan vendor dibagi proporsional ke banyak AWB berdasarkan besaran sales (grand_total) tiap AWB.</p>
              </div>
              <button onClick={() => setProOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submitProrata} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Nama Vendor *</Label>
                  <VendorSelect
                    testid="pro-vendor-select"
                    value={proForm.vendor_name}
                    onChange={(v) => setProForm({ ...proForm, vendor_name: v })}
                    vendors={vendors}
                    onVendorsChange={loadVendors}
                    required
                  />
                </div>
                <div>
                  <Label>Periode Bulan *</Label>
                  <MonthPicker value={proForm.period_month} onChange={(v) => setProForm({ ...proForm, period_month: v, awb_ids: [] })}/>
                </div>
                <div>
                  <Label>Total Tagihan (IDR) *</Label>
                  <NumberInput data-testid="pro-total-amount" value={proForm.total_amount} onChange={(e) => setProForm({ ...proForm, total_amount: e.target.value })} required placeholder="10000000"/>
                </div>
              </div>
              <div>
                <Label>Keterangan (opsional)</Label>
                <Input value={proForm.description} onChange={(e) => setProForm({ ...proForm, description: e.target.value })} placeholder="Mis. Angkutan bulan Juli"/>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>Pilih AWB *  (minimal 2)</Label>
                  <div className="text-[11px] text-slate-500">{selectedList.length} dipilih · sales total {fmtIDR(proTotalSelectedSales)}</div>
                </div>

                {/* Search + toggle */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                    <Input
                      data-testid="pro-awb-search"
                      value={proSearch}
                      onChange={(e) => setProSearch(e.target.value)}
                      placeholder="Cari No AWB (semua status, termasuk Invoiced/Paid)…"
                      className="pl-9"
                    />
                  </div>
                  {!proSearch.trim() && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                      <input type="checkbox" data-testid="pro-incl-invoiced" checked={proInclInvoiced} onChange={(e) => setProInclInvoiced(e.target.checked)} className="accent-indigo-600"/>
                      Termasuk Invoiced/Paid
                    </label>
                  )}
                </div>

                {/* Chips of selected AWBs not currently visible in the list */}
                {selectedList.filter((a) => !proCandidates.some((c) => c.id === a.id)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedList.filter((a) => !proCandidates.some((c) => c.id === a.id)).map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-semibold">
                        {a.awb_number}
                        <button type="button" onClick={() => toggleProAwb(a)} className="hover:text-rose-600"><X size={11}/></button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="rounded border border-slate-200 max-h-[220px] overflow-y-auto">
                  {proCandidates.length === 0 && <div className="p-4 text-center text-sm text-slate-400 italic">{proSearch.trim() ? "AWB tidak ditemukan." : "Tidak ada AWB eligible di periode ini (grand_total > 0). Coba centang \"Termasuk Invoiced/Paid\" atau cari No AWB."}</div>}
                  {proCandidates.map((a) => {
                    const checked = !!proSelected[a.id];
                    const stColor = a.status === "Paid" ? "text-emerald-700" : a.status === "Invoiced" ? "text-blue-700" : "text-slate-500";
                    return (
                      <label key={a.id} className={`flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer ${checked ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleProAwb(a)} data-testid={`pro-awb-${a.awb_number}`} className="accent-indigo-600"/>
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-semibold text-sm">{a.awb_number}</div>
                          <div className="text-[11px] text-slate-500 truncate">{a.customer_name || "-"} · {a.origin}→{a.destination} · <span className={`font-semibold ${stColor}`}>{a.status}</span></div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-slate-500">Sales</div>
                          <div className="font-mono font-bold text-sm text-emerald-700">{fmtIDR(a.grand_total)}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {proPreview.length > 0 && (
                <div className="rounded border border-indigo-200 bg-indigo-50/50 p-3">
                  <div className="text-[11px] uppercase font-bold text-indigo-800 mb-2">Preview Prorata</div>
                  <Table>
                    <thead><tr>
                      <Th>AWB</Th><Th className="text-right">Sales</Th><Th className="text-right">Share %</Th><Th className="text-right">Porsi Cost</Th>
                    </tr></thead>
                    <tbody>
                      {proPreview.map((p) => (
                        <tr key={p.id}>
                          <Td className="font-mono text-xs">{p.awb_number}</Td>
                          <Td className="text-right font-mono text-xs">{fmtIDR(p.grand_total)}</Td>
                          <Td className="text-right font-mono text-xs text-indigo-700">{p.share_pct}%</Td>
                          <Td className="text-right font-mono font-bold text-rose-700">{fmtIDR(p.amount)}</Td>
                        </tr>
                      ))}
                      <tr className="bg-indigo-100">
                        <Td colSpan={3} className="text-right font-bold text-xs uppercase">Total</Td>
                        <Td className="text-right font-mono font-black text-indigo-900">{fmtIDR(proPreview.reduce((s,p) => s + p.amount, 0))}</Td>
                      </tr>
                    </tbody>
                  </Table>
                </div>
              )}
            </form>
            <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
              <Button variant="secondary" onClick={() => setProOpen(false)}>Batal</Button>
              <Button data-testid="save-prorata-btn" onClick={submitProrata} disabled={proBusy || proForm.awb_ids.length < 2}>
                {proBusy ? "Menyimpan..." : "Buat Prorata"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
