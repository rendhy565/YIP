import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, FileMinus, Percent } from "lucide-react";

const PPH_TYPES = ["PPh21", "PPh23", "PPh25", "PPh4(2)", "PPh22"];

export default function TaxModule() {
  const [tab, setTab] = useState("ppn");
  const [period, setPeriod] = useState(currentMonth());
  const [ppn, setPpn] = useState(null);
  const [pph, setPph] = useState([]);
  const [form, setForm] = useState({ period_month: currentMonth(), pph_type: "PPh21", description: "", amount: 0 });

  useEffect(() => { api.get("/tax/ppn-summary", { params: { period } }).then((r) => setPpn(r.data)); }, [period]);
  useEffect(() => { api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data)); }, [period]);

  const submit = async () => {
    if (!form.amount) return toast.error("Jumlah wajib");
    try { await api.post("/tax/pph", { ...form, amount: Number(form.amount) }); toast.success("Tersimpan"); setForm({ ...form, amount: 0, description: "" }); api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data)); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    if (!window.confirm("Hapus catatan PPh?")) return;
    try { await api.delete(`/tax/pph/${id}`); toast.success("Dihapus"); api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data)); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const totalPph = pph.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="tax-page">
      <PageHeader title="Perpajakan" subtitle="Ringkasan PPN Keluaran/Masukan otomatis dari jurnal + catatan PPh manual." />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Periode</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}/></div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button onClick={() => setTab("ppn")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "ppn" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>PPN</button>
        <button onClick={() => setTab("pph")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "pph" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>PPh</button>
      </div>

      {tab === "ppn" && ppn && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Card className="p-3 bg-emerald-50 border-emerald-200"><div className="text-[10px] uppercase text-emerald-700 font-bold">PPN Keluaran</div><div className="font-mono font-bold text-xl text-emerald-800">{fmtIDR(ppn.ppn_keluaran)}</div></Card>
            <Card className="p-3 bg-blue-50 border-blue-200"><div className="text-[10px] uppercase text-blue-700 font-bold">PPN Masukan</div><div className="font-mono font-bold text-xl text-blue-800">{fmtIDR(ppn.ppn_masukan)}</div></Card>
            <Card className={`p-3 ${ppn.ppn_kurang_bayar > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50"}`}><div className="text-[10px] uppercase text-slate-600 font-bold">{ppn.ppn_kurang_bayar >= 0 ? "Kurang Bayar" : "Lebih Bayar"}</div><div className="font-mono font-bold text-xl">{fmtIDR(Math.abs(ppn.ppn_kurang_bayar))}</div></Card>
          </div>
          <Card className="mb-4">
            <div className="px-4 py-2 bg-emerald-100 text-emerald-900 font-bold">Detail PPN Keluaran</div>
            <Table>
              <thead><tr><Th>Tanggal</Th><Th>No Jurnal</Th><Th>Deskripsi</Th><Th className="text-right">Jumlah</Th></tr></thead>
              <tbody>
                {ppn.detail_keluaran.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-4">Tidak ada</Td></tr>}
                {ppn.detail_keluaran.map((d, i) => <tr key={i}><Td className="text-xs">{fmtDate(d.date)}</Td><Td className="font-mono text-xs">{d.entry_no}</Td><Td>{d.description}</Td><Td className="text-right font-mono">{fmtIDR(d.amount)}</Td></tr>)}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "pph" && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end justify-between gap-2">
            <h3 className="font-bold">Catatan PPh ({period})</h3>
            <div className="flex items-end gap-2 flex-wrap">
              <div><Label>Tipe</Label><Select value={form.pph_type} onChange={(e) => setForm({...form, pph_type: e.target.value})} className="w-32">{PPH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
              <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} className="w-48"/></div>
              <div><Label>Jumlah</Label><Input type="number" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-32"/></div>
              <Button variant="success" onClick={submit}><Plus size={13}/> Tambah</Button>
            </div>
          </div>
          <Table>
            <thead><tr><Th>Tanggal</Th><Th>Tipe</Th><Th>Deskripsi</Th><Th className="text-right">Jumlah</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {pph.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-6">Belum ada</Td></tr>}
              {pph.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">{fmtDate(r.created_at)}</Td>
                  <Td><span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] uppercase font-bold">{r.pph_type}</span></Td>
                  <Td>{r.description || "-"}</Td>
                  <Td className="text-right font-mono">{fmtIDR(r.amount)}</Td>
                  <Td className="text-right"><Button variant="ghost" onClick={() => del(r.id)}><Trash2 size={13}/></Button></Td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50"><Td colSpan={3}>TOTAL</Td><Td className="text-right font-mono">{fmtIDR(totalPph)}</Td><Td></Td></tr>
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
