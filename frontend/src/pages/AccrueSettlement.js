import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { CheckCircle2, Wallet, Search, Undo2 } from "lucide-react";
import FilterPresets from "../components/FilterPresets";
import Pagination, { usePagination } from "../components/Pagination";

export default function AccrueSettlement() {
  const [rows, setRows] = useState([]);
  const [paidRows, setPaidRows] = useState([]);
  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState("");
  const [filterMode, setFilterMode] = useState("AND");

  const [qPaid, setQPaid] = useState("");

  const load = () => {
    Promise.all([
      api.get("/costs", { params: { payment_type: "Accrue", is_settled: false } }),
      api.get("/costs", { params: { payment_type: "Cash", cost_category: "Vendor" } }),
    ]).then(([a, p]) => {
      setRows(a.data);
      setPaidRows(p.data);
    });
  };
  useEffect(() => { load(); }, []);

  const settle = async (id) => {
    if (!window.confirm("Tandai hutang vendor ini sebagai PAID (lunas)?")) return;
    try { await api.post(`/costs/${id}/settle`); toast.success("Hutang ditandai Paid"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const reclass = async (id) => {
    if (!window.confirm("Reclass Paid kembali ke Hutang (revisi/salah post)?")) return;
    try { await api.post(`/costs/${id}/reclass-to-accrue`); toast.success("Direclass ke Hutang"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const vendors = useMemo(() => Array.from(new Set([...rows, ...paidRows].map((r) => r.vendor_name).filter(Boolean))).sort(), [rows, paidRows]);

  const filtered = useMemo(() => {
    const qStr = q.trim().toLowerCase();
    const fns = [];
    if (qStr) fns.push((r) => `${r.awb_number || ""} ${r.vendor_name || ""} ${r.description || ""}`.toLowerCase().includes(qStr));
    if (vendor) fns.push((r) => r.vendor_name === vendor);
    if (fns.length === 0) return rows;
    return rows.filter((r) => filterMode === "AND" ? fns.every((f) => f(r)) : fns.some((f) => f(r)));
  }, [rows, q, vendor, filterMode]);

  const paidFiltered = useMemo(() => {
    const s = qPaid.trim().toLowerCase();
    if (!s) return paidRows;
    return paidRows.filter((r) => `${r.awb_number || ""} ${r.vendor_name || ""} ${r.description || ""}`.toLowerCase().includes(s));
  }, [paidRows, qPaid]);

  const pag = usePagination(filtered, { resetKey: `${q}|${vendor}|${filterMode}` });
  const pagPaid = usePagination(paidFiltered, { resetKey: qPaid });

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const paidTotal = paidRows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="accrue-settlement-page">
      <PageHeader title="Settle Hutang Vendor" subtitle="Update Hutang Vendor → Paid; daftar Paid Vendor dengan tombol Reclass untuk revisi." />

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
          <div className="ml-auto text-xs text-slate-500">{filtered.length} dari {rows.length} hutang</div>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Hutang Vendor Belum Dibayar (Accrue)</h3></div>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th className="text-right">Jumlah</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`accrue-row-${r.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td>{r.vendor_name || "-"}</Td>
                <Td className="text-slate-600 text-sm">{r.description || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right">
                  <Button data-testid={`settle-btn-${r.id}`} variant="success" onClick={() => settle(r.id)}>
                    <CheckCircle2 size={14}/> Paid
                  </Button>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-10">Tidak ada hutang vendor.</Td></tr>}
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
    </div>
  );
}
