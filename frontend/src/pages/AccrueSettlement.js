import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { CheckCircle2, Wallet, Search, Undo2, BarChart3, ChevronDown, ChevronRight, FileSpreadsheet, Layers, CheckSquare, Square, Banknote, History, Trash2, X } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function AccrueSettlement() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [paidRows, setPaidRows] = useState([]);
  const [aging, setAging] = useState(null);
  const [showAging, setShowAging] = useState(true);
  const [agingExpanded, setAgingExpanded] = useState({});
  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [proGroup, setProGroup] = useState("");
  const [filterMode, setFilterMode] = useState("AND");
  const [selected, setSelected] = useState(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const [qPaid, setQPaid] = useState("");
  const [histRow, setHistRow] = useState(null);

  const remainingOf = (r) => Math.round(((r.amount || 0) - (r.paid_amount || 0)) * 100) / 100;

  const load = () => {
    Promise.all([
      api.get("/costs", { params: { payment_type: "Accrue", is_settled: false } }),
      api.get("/costs", { params: { payment_type: "Cash", cost_category: "Vendor" } }),
      api.get("/reports/vendor-aging"),
    ]).then(([a, p, ag]) => {
      setRows(a.data);
      setPaidRows(p.data);
      setAging(ag.data);
    });
  };

  const exportAging = async () => {
    try {
      const r = await api.get("/exports/vendor-aging", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url;
      const dstr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = `Vendor_Aging_${dstr}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Vendor Aging ter-export ke Excel");
    } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); }, []);

  const settle = async (id) => {
    if (!window.confirm("Lunasi seluruh SISA hutang vendor ini sekarang?")) return;
    try {
      const r = await api.post(`/costs/${id}/settle`);
      if (r.data && r.data.needs_confirmation) {
        if (!window.confirm(`⚠️ ${r.data.warning}`)) return;
        await api.post(`/costs/${id}/settle`, { force: true });
      }
      toast.success("Hutang lunas"); load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const payPartial = async (row) => {
    const remaining = remainingOf(row);
    const raw = window.prompt(`Bayar sebagian (DP/cicilan) untuk ${row.vendor_name || "vendor"}.\nSisa hutang: ${fmtIDR(remaining)}\n\nMasukkan jumlah BRUTO yang dibayar:`, String(remaining));
    if (raw === null) return;
    const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
    if (!amount || amount <= 0) { toast.error("Jumlah tidak valid"); return; }
    if (amount > remaining + 0.5) { toast.error(`Melebihi sisa hutang (${fmtIDR(remaining)})`); return; }
    try {
      const r = await api.post(`/costs/${row.id}/pay`, { amount });
      if (r.data && r.data.needs_confirmation) {
        if (!window.confirm(`⚠️ ${r.data.warning}`)) return;
        await api.post(`/costs/${row.id}/pay`, { amount, force: true });
      }
      const d = r.data || {};
      toast.success(d.fully_paid ? "Hutang lunas" : `Dibayar ${fmtIDR(amount)} — sisa ${fmtIDR(d.remaining ?? (remaining - amount))}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const voidPayment = async (cid, pid) => {
    if (!window.confirm("Batalkan pembayaran ini? Jurnal akan dibalik.")) return;
    try {
      await api.post(`/costs/${cid}/payments/${pid}/void`);
      toast.success("Pembayaran dibatalkan");
      setHistRow(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const reclass = async (id) => {
    if (!window.confirm("Reclass Paid kembali ke Hutang (revisi/salah post)?")) return;
    try { await api.post(`/costs/${id}/reclass-to-accrue`); toast.success("Direclass ke Hutang"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const vendors = useMemo(() => Array.from(new Set([...rows, ...paidRows].map((r) => r.vendor_name).filter(Boolean))).sort(), [rows, paidRows]);

  const MONTH_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const monthOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.created_at) set.add(String(r.created_at).slice(0, 7)); });
    return Array.from(set).sort().reverse().map((ym) => {
      const [y, m] = ym.split("-");
      return { value: ym, label: `${MONTH_ID[parseInt(m, 10) - 1]} ${y}` };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    let base = rows;
    if (proGroup) base = base.filter((r) => r.cost_group_id === proGroup);
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.vendor_name || ""} ${r.description || ""}`.toLowerCase().includes(qStr));
    if (vendor) fns.push((r) => r.vendor_name === vendor);
    if (monthFilter) fns.push((r) => String(r.created_at || "").slice(0, 7) === monthFilter);
    if (fns.length === 0) return base;
    return base.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [rows, q, vendor, monthFilter, filterMode, proGroup]);

  // Grup prorata yang ada di daftar hutang belum lunas (untuk filter cepat)
  const proGroups = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (r.is_prorata && r.cost_group_id) {
        const g = map.get(r.cost_group_id) || { id: r.cost_group_id, vendor: r.vendor_name || "-", n: 0, total: 0 };
        g.n += 1; g.total += remainingOf(r); map.set(r.cost_group_id, g);
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  // Bersihkan pilihan tiap kali filter berubah — bulk hanya mengenai yang terfilter
  useEffect(() => { setSelected(new Set()); }, [q, vendor, monthFilter, proGroup]);

  const selectableIds = filtered.map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    const n = new Set(selected);
    if (allSelected) selectableIds.forEach((id) => n.delete(id));
    else selectableIds.forEach((id) => n.add(id));
    setSelected(n);
  };

  const selectedRows = filtered.filter((r) => selected.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + remainingOf(r), 0);

  const bulkSettle = async () => {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Tandai ${ids.length} hutang vendor (total ${fmtIDR(selectedTotal)}) sebagai PAID?`)) return;
    setBulkSaving(true);
    try {
      const r = await api.post("/costs/bulk-settle", { cost_ids: ids });
      toast.success(`${r.data.settled_count} hutang di-settle${r.data.skipped_count ? `, ${r.data.skipped_count} di-skip` : ""}`);
      setSelected(new Set());
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBulkSaving(false); }
  };

  const bulkPayPercent = async () => {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;
    const raw = window.prompt(
      `Bayar PROPORSIONAL untuk ${ids.length} hutang terpilih (total sisa ${fmtIDR(selectedTotal)}).\n\n` +
      `Masukkan PERSENTASE yang dibayar (mis. 50 untuk 50% dari sisa masing-masing):`,
      "50"
    );
    if (raw === null) return;
    const pct = Number(String(raw).replace(/[^0-9.]/g, ""));
    if (!pct || pct <= 0 || pct > 100) { toast.error("Persentase harus 1-100"); return; }
    setBulkSaving(true);
    try {
      let r = await api.post("/costs/pay-bulk", { cost_ids: ids, mode: "percent", value: pct });
      if (r.data && r.data.needs_confirmation) {
        if (!window.confirm(`⚠️ ${r.data.warning}`)) { setBulkSaving(false); return; }
        r = await api.post("/costs/pay-bulk", { cost_ids: ids, mode: "percent", value: pct, force: true });
      }
      toast.success(`${r.data.count} hutang dibayar ${pct}% — total ${fmtIDR(r.data.total_paid)}`);
      setSelected(new Set());
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBulkSaving(false); }
  };

  const bulkPayAmount = async () => {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;
    const raw = window.prompt(
      `Bayar NOMINAL TOTAL untuk ${ids.length} hutang terpilih (total sisa ${fmtIDR(selectedTotal)}).\n\n` +
      `Nominal akan dibagi PROPORSIONAL sesuai sisa masing-masing hutang.\n` +
      `Masukkan total BRUTO yang dibayar:`,
      String(Math.round(selectedTotal))
    );
    if (raw === null) return;
    const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
    if (!amount || amount <= 0) { toast.error("Nominal tidak valid"); return; }
    if (amount > selectedTotal + 0.5) { toast.error(`Melebihi total sisa (${fmtIDR(selectedTotal)})`); return; }
    setBulkSaving(true);
    try {
      let r = await api.post("/costs/pay-bulk", { cost_ids: ids, mode: "amount", value: amount });
      if (r.data && r.data.needs_confirmation) {
        if (!window.confirm(`⚠️ ${r.data.warning}`)) { setBulkSaving(false); return; }
        r = await api.post("/costs/pay-bulk", { cost_ids: ids, mode: "amount", value: amount, force: true });
      }
      toast.success(`${r.data.count} hutang dibayar — total ${fmtIDR(r.data.total_paid)} (proporsional)`);
      setSelected(new Set());
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBulkSaving(false); }
  };

  const paidFiltered = useMemo(() => {
    const s = qPaid.trim().toLowerCase();
    if (!s) return paidRows;
    return paidRows.filter((r) => `${r.awb_number || ""} ${r.vendor_name || ""} ${r.description || ""}`.toLowerCase().includes(s));
  }, [paidRows, qPaid]);

  const pag = usePagination(filtered, { resetKey: `${q}|${vendor}|${monthFilter}|${filterMode}|${proGroup}` });
  const pagPaid = usePagination(paidFiltered, { resetKey: qPaid });

  const total = rows.reduce((s, r) => s + remainingOf(r), 0);
  const paidTotal = paidRows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="accrue-settlement-page">
      <PageHeader
        title="Settle Hutang Vendor"
        subtitle="Update Hutang Vendor → Paid; daftar Paid Vendor dengan tombol Reclass untuk revisi."
        action={
          <Button variant="secondary" data-testid="goto-prorata-btn" onClick={() => navigate("/costs?prorata=1")}>
            <Layers size={14}/> Prorata Vendor
          </Button>
        }
      />

      <Card className="p-5 mb-5 bg-orange-50 border-orange-200">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-10 w-10 rounded bg-orange-600 text-white flex items-center justify-center"><Wallet size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-orange-700">Total Hutang Belum Dibayar</div>
            <div className="font-heading font-black text-3xl text-orange-900">{fmtIDR(total)}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-700">Total Paid Vendor</div>
            <div className="font-heading font-bold text-xl text-emerald-700">{fmtIDR(paidTotal)}</div>
          </div>
        </div>
      </Card>

      {/* Vendor Aging — Embedded */}
      {aging && (
        <Card className="mb-5" data-testid="vendor-aging-section">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <BarChart3 size={16} className="text-purple-700"/>
            <h3 className="font-bold">Aging Hutang Vendor</h3>
            <span className="text-xs text-slate-500 ml-2">{aging.count_vendors} vendor outstanding</span>
            <div className="ml-auto flex gap-2">
              <button data-testid="export-aging-btn" onClick={exportAging} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-emerald-50">
                <FileSpreadsheet size={12}/> Export Excel
              </button>
              <button onClick={() => setShowAging(!showAging)} className="text-[11px] font-bold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
                {showAging ? "Sembunyikan" : "Tampilkan"}
              </button>
            </div>
          </div>
          {showAging && (
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <Card className="p-3 bg-blue-50 border-blue-200">
                  <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-blue-700">Total Outstanding</div>
                  <div className="font-heading font-black text-lg text-blue-900">{fmtIDR(aging.totals.total)}</div>
                </Card>
                <Card className="p-3 bg-emerald-50 border-emerald-200">
                  <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-emerald-700">0-30 hari</div>
                  <div className="font-heading font-black text-lg text-emerald-900">{fmtIDR(aging.totals["0-30"])}</div>
                </Card>
                <Card className="p-3 bg-yellow-50 border-yellow-200">
                  <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-yellow-700">31-60 hari</div>
                  <div className="font-heading font-black text-lg text-yellow-900">{fmtIDR(aging.totals["31-60"])}</div>
                </Card>
                <Card className="p-3 bg-orange-50 border-orange-200">
                  <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-orange-700">61-90 hari</div>
                  <div className="font-heading font-black text-lg text-orange-900">{fmtIDR(aging.totals["61-90"])}</div>
                </Card>
                <Card className="p-3 bg-rose-50 border-rose-200">
                  <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-rose-700">90+ hari (overdue)</div>
                  <div className="font-heading font-black text-lg text-rose-900">{fmtIDR(aging.totals["90+"])}</div>
                </Card>
              </div>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Vendor</th>
                      <th className="px-2 py-1.5 text-right">0-30</th>
                      <th className="px-2 py-1.5 text-right">31-60</th>
                      <th className="px-2 py-1.5 text-right">61-90</th>
                      <th className="px-2 py-1.5 text-right">90+</th>
                      <th className="px-2 py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.rows.map((r) => (
                      <React.Fragment key={r.vendor}>
                        <tr data-testid={`aging-row-${r.vendor}`} className="cursor-pointer hover:bg-slate-50 border-t border-slate-100" onClick={() => setAgingExpanded((s) => ({ ...s, [r.vendor]: !s[r.vendor] }))}>
                          <td className="px-2 py-1.5 font-semibold">
                            {agingExpanded[r.vendor] ? <ChevronDown size={11} className="inline mr-1"/> : <ChevronRight size={11} className="inline mr-1"/>}
                            {r.vendor} <span className="text-[10px] text-slate-400">({r.items.length})</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtIDR(r["0-30"])}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtIDR(r["31-60"])}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtIDR(r["61-90"])}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-rose-700 font-bold">{fmtIDR(r["90+"])}</td>
                          <td className="px-2 py-1.5 text-right font-bold">{fmtIDR(r.total)}</td>
                        </tr>
                        {agingExpanded[r.vendor] && r.items.map((it, idx) => (
                          <tr key={`${r.vendor}-${idx}`} className="bg-slate-50 text-xs">
                            <td colSpan={6} className="px-2 py-1">
                              <div className="flex items-center gap-3 text-slate-600 pl-6">
                                <span className="font-mono">{it.awb_number || "(no AWB)"}</span>
                                <span>·</span>
                                <span className="text-slate-500 truncate flex-1">{it.description}</span>
                                <span className="font-mono">{fmtIDR(it.amount)} <span className="text-[10px] text-slate-400">({it.days}h · {it.bucket})</span></span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                    {aging.rows.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400 text-xs">Tidak ada hutang vendor outstanding 🎉</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 mb-5">
        <FilterPresets
          storageKey="accrue"
          mode={filterMode}
          setMode={setFilterMode}
          currentFilters={{ q, vendor }}
          onLoadPreset={(f) => { setQ(f.q || ""); setVendor(f.vendor || ""); }}
          activeCount={[q.trim(), vendor].filter(Boolean).length}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label>Cari (AWB / Vendor / Deskripsi)</Label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <Input data-testid="accrue-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contoh: Trucking / Vendor A..." className="pl-9"/>
            </div>
          </div>
          <div className="min-w-[220px]">
            <Label>Filter Vendor</Label>
            <select data-testid="accrue-vendor-filter" value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-10 rounded border border-slate-300 px-3 text-sm bg-white w-full">
              <option value="">Semua Vendor</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="min-w-[190px]">
            <Label>Bulan (Tgl Biaya)</Label>
            <select data-testid="accrue-month-filter" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-10 rounded border border-slate-300 px-3 text-sm bg-white w-full">
              <option value="">Semua Bulan</option>
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {proGroups.length > 0 && (
            <div className="min-w-[280px]">
              <Label>Grup Prorata</Label>
              <select data-testid="accrue-prorata-filter" value={proGroup} onChange={(e) => setProGroup(e.target.value)} className="h-10 rounded border border-indigo-300 px-3 text-sm bg-indigo-50 w-full">
                <option value="">Semua ({proGroups.length} grup prorata)</option>
                {proGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.vendor} · {g.n} AWB · sisa {fmtIDR(g.total)}</option>
                ))}
              </select>
            </div>
          )}
          <div className="ml-auto text-xs text-slate-500">{filtered.length} dari {rows.length} hutang</div>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
          <h3 className="font-bold">Hutang Vendor Belum Dibayar (Accrue)</h3>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-600">{selected.size} terpilih · <span className="font-semibold">{fmtIDR(selectedTotal)}</span></span>
              <Button data-testid="accrue-bulk-pay-pct-btn" variant="secondary" disabled={bulkSaving} onClick={bulkPayPercent} title="Bayar sebagian proporsional berdasarkan PERSENTASE dari sisa tiap hutang">
                <Banknote size={14}/> Bayar %
              </Button>
              <Button data-testid="accrue-bulk-pay-amount-btn" variant="secondary" disabled={bulkSaving} onClick={bulkPayAmount} title="Bayar NOMINAL TOTAL, dibagi proporsional ke sisa tiap hutang terpilih">
                <Banknote size={14}/> Bayar Rp
              </Button>
              <Button data-testid="accrue-bulk-paid-btn" variant="success" disabled={bulkSaving} onClick={bulkSettle}>
                <CheckCircle2 size={14}/> {bulkSaving ? "Memproses..." : `Bulk Paid (${selected.size})`}
              </Button>
            </div>
          )}
        </div>
        <Table>
          <thead><tr>
            <Th><button onClick={toggleAll} data-testid="accrue-select-all">{allSelected ? <CheckSquare size={14}/> : <Square size={14}/>}</button></Th>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th className="text-right">Jumlah</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`accrue-row-${r.id}`} className={selected.has(r.id) ? "bg-emerald-50" : ""}>
                <Td><button onClick={() => toggle(r.id)} data-testid={`accrue-check-${r.id}`}>{selected.has(r.id) ? <CheckSquare size={14} className="text-emerald-600"/> : <Square size={14} className="text-slate-400"/>}</button></Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td>{r.vendor_name || "-"}</Td>
                <Td className="text-slate-600 text-sm">{r.description || "-"}</Td>
                <Td className="text-right">
                  <div className="font-semibold">{fmtIDR(r.amount)}</div>
                  {(r.paid_amount || 0) > 0 && (
                    <div className="text-[10px] leading-tight mt-0.5">
                      <span className="text-emerald-700">Terbayar {fmtIDR(r.paid_amount)}</span>
                      <span className="text-orange-700 font-bold"> · Sisa {fmtIDR(remainingOf(r))}</span>
                    </div>
                  )}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5 flex-wrap">
                    <Button data-testid={`pay-btn-${r.id}`} variant="secondary" onClick={() => payPartial(r)} title="Bayar sebagian (DP/cicilan)">
                      <Banknote size={14}/> Bayar
                    </Button>
                    <Button data-testid={`settle-btn-${r.id}`} variant="success" onClick={() => settle(r.id)} title="Lunasi seluruh sisa">
                      <CheckCircle2 size={14}/> Lunasi
                    </Button>
                    {(r.payments || []).length > 0 && (
                      <button data-testid={`history-btn-${r.id}`} onClick={() => setHistRow(r)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Riwayat pembayaran">
                        <History size={15}/>
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">Tidak ada hutang vendor.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-accrue"/>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          <h3 className="font-bold">Paid Vendor (untuk Revisi / Reclass)</h3>
          <span className="text-xs text-slate-500">{paidFiltered.length} dari {paidRows.length}</span>
          <div className="ml-auto min-w-[220px]">
            <Input data-testid="paid-search" value={qPaid} onChange={(e) => setQPaid(e.target.value)} placeholder="Cari AWB / Vendor / Deskripsi..."/>
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th>Cash Acc</Th><Th className="text-right">Jumlah</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pagPaid.paged.map((r) => (
              <tr key={r.id} data-testid={`paid-row-${r.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td>{r.vendor_name || "-"}</Td>
                <Td className="text-slate-600 text-sm">{r.description || "-"}</Td>
                <Td className="font-mono text-xs">{r.cash_account_code || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right">
                  <Button data-testid={`reclass-btn-${r.id}`} variant="secondary" onClick={() => reclass(r.id)}>
                    <Undo2 size={14}/> Reclass
                  </Button>
                </Td>
              </tr>
            ))}
            {paidFiltered.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">Belum ada Paid Vendor.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pagPaid} testid="pagination-paid"/>
      </Card>

      {histRow && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="payment-history-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-heading font-bold text-lg text-slate-900">Riwayat Pembayaran</h3>
              <button onClick={() => setHistRow(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="text-xs text-slate-500 mb-3">
              {histRow.vendor_name} · {histRow.awb_number} · Total {fmtIDR(histRow.amount)} · Sisa <span className="font-bold text-orange-700">{fmtIDR(remainingOf(histRow))}</span>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {(histRow.payments || []).map((p) => (
                <div key={p.pid} data-testid={`payment-item-${p.pid}`} className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{fmtIDR(p.amount)}
                      {p.pph_amount > 0 && <span className="text-[10px] text-slate-500 font-normal"> · PPh {fmtIDR(p.pph_amount)} · net {fmtIDR(p.net_paid)}</span>}
                    </div>
                    <div className="text-[10px] text-slate-400">{fmtDate(p.paid_at)} · Kas {p.cash_account_code}</div>
                  </div>
                  <button data-testid={`void-payment-${p.pid}`} onClick={() => voidPayment(histRow.id, p.pid)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Batalkan pembayaran">
                    <Trash2 size={14}/>
                  </button>
                </div>
              ))}
              {(histRow.payments || []).length === 0 && <div className="text-sm text-slate-500 text-center py-6">Belum ada pembayaran.</div>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
