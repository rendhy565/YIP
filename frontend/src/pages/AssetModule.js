import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, PlayCircle, X } from "lucide-react";
import NumberInput from "../components/NumberInput";

export default function AssetModule() {
  const [tab, setTab] = useState("assets");
  const [assets, setAssets] = useState([]);
  const [runs, setRuns] = useState([]);
  const [period, setPeriod] = useState(currentMonth());
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", acquisition_date: new Date().toISOString().slice(0, 10), cost: 0, salvage_value: 0, useful_life_months: 60, notes: "" });

  const loadA = () => api.get("/assets").then((r) => setAssets(r.data));
  const loadR = () => api.get("/assets/depreciation-runs").then((r) => setRuns(r.data));
  useEffect(() => { loadA(); loadR(); }, []);

  const submit = async () => {
    if (!form.name || !form.cost) return toast.error("Nama & biaya perolehan wajib");
    try { await api.post("/assets", { ...form, cost: Number(form.cost), salvage_value: Number(form.salvage_value || 0), useful_life_months: Number(form.useful_life_months || 60) }); toast.success("Aset terdaftar"); setOpenForm(false); setForm({ name: "", category: "", acquisition_date: new Date().toISOString().slice(0, 10), cost: 0, salvage_value: 0, useful_life_months: 60, notes: "" }); loadA(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    if (!window.confirm("Hapus aset?")) return;
    try { await api.delete(`/assets/${id}`); toast.success("Dihapus"); loadA(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const runDepr = async () => {
    if (!window.confirm(`Jalankan depresiasi ${period}? Akan auto-jurnal Beban Penyusutan (6105) → Akumulasi (1502).`)) return;
    try { await api.post("/assets/depreciate", { period_month: period }); toast.success("Depresiasi selesai"); loadA(); loadR(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="asset-page">
      <PageHeader title="Aset Tetap & Depresiasi" subtitle="Master aset (PSAK 16). Penyusutan garis lurus bulanan dengan auto-jurnal." />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button onClick={() => setTab("assets")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "assets" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>Aset</button>
        <button onClick={() => setTab("runs")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "runs" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>Riwayat Depresiasi</button>
      </div>

      {tab === "assets" && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end justify-between gap-2">
            <h3 className="font-bold">Daftar Aset</h3>
            <div className="flex items-end gap-2">
              <div><Label>Periode Depresiasi</Label><MonthPicker value={period} onChange={setPeriod} className="w-56"/></div>
              <Button variant="success" onClick={runDepr}><PlayCircle size={14}/> Jalankan</Button>
              <Button onClick={() => setOpenForm(!openForm)}><Plus size={14}/> Tambah</Button>
            </div>
          </div>
          {openForm && (
            <div className="p-4 bg-blue-50/30 border-b border-slate-200">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Nama</Label><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}/></div>
                <div><Label>Kategori</Label><Input value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} placeholder="Kendaraan / Komputer / dll"/></div>
                <div><Label>Tgl Perolehan</Label><Input type="date" value={form.acquisition_date} onChange={(e) => setForm({...form, acquisition_date: e.target.value})}/></div>
                <div><Label>Umur (bulan)</Label><Input type="number" value={form.useful_life_months} onChange={(e) => setForm({...form, useful_life_months: e.target.value})}/></div>
                <div><Label>Harga Perolehan</Label><NumberInput value={form.cost} onChange={(e) => setForm({...form, cost: e.target.value})}/></div>
                <div><Label>Nilai Residu</Label><NumberInput value={form.salvage_value} onChange={(e) => setForm({...form, salvage_value: e.target.value})}/></div>
                <div className="md:col-span-2"><Label>Catatan</Label><Input value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}/></div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="ghost" onClick={() => setOpenForm(false)}>Batal</Button>
                <Button variant="success" onClick={submit}><Save size={14}/> Simpan</Button>
              </div>
            </div>
          )}
          <Table>
            <thead><tr><Th>Nama</Th><Th>Kategori</Th><Th>Tgl Perolehan</Th><Th className="text-right">Harga</Th><Th className="text-right">Umur</Th><Th className="text-right">Akumulasi</Th><Th className="text-right">Nilai Buku</Th><Th></Th></tr></thead>
            <tbody>
              {assets.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-400 py-6">Belum ada aset</Td></tr>}
              {assets.map((a) => {
                const nilaiBuku = (a.cost || 0) - (a.accumulated_depreciation || 0);
                return (
                  <tr key={a.id}>
                    <Td className="font-bold">{a.name}</Td>
                    <Td>{a.category || "-"}</Td>
                    <Td className="text-xs">{fmtDate(a.acquisition_date)}</Td>
                    <Td className="text-right font-mono">{fmtIDR(a.cost)}</Td>
                    <Td className="text-right text-xs">{a.depreciated_months}/{a.useful_life_months} bln</Td>
                    <Td className="text-right font-mono text-rose-700">{fmtIDR(a.accumulated_depreciation)}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(nilaiBuku)}</Td>
                    <Td><Button variant="ghost" onClick={() => del(a.id)}><Trash2 size={13}/></Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "runs" && (
        <Card>
          <Table>
            <thead><tr><Th>Periode</Th><Th>Tanggal Run</Th><Th className="text-right">Total Depresiasi</Th><Th>Detail</Th></tr></thead>
            <tbody>
              {runs.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-6">Belum ada</Td></tr>}
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono font-bold">{r.period_month}</Td>
                  <Td className="text-xs">{fmtDate(r.created_at)}</Td>
                  <Td className="text-right font-mono">{fmtIDR(r.total_amount)}</Td>
                  <Td className="text-xs text-slate-500">{(r.details || []).length} aset</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
