import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, Banknote, Receipt } from "lucide-react";

const CATEGORY_COLORS = {
  Gaji: "text-blue-700 bg-blue-50 border-blue-200",
  Sewa: "text-purple-700 bg-purple-50 border-purple-200",
  Utilities: "text-teal-700 bg-teal-50 border-teal-200",
  Marketing: "text-pink-700 bg-pink-50 border-pink-200",
  Administrasi: "text-amber-700 bg-amber-50 border-amber-200",
  Lainnya: "text-slate-700 bg-slate-50 border-slate-200",
};

export default function FixedCosts() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "Gaji", description: "", amount: "", period_month: currentMonth() });

  const load = () => api.get("/fixed-costs", { params: { month } }).then((r) => setRows(r.data));
  useEffect(() => { api.get("/fixed-costs/categories").then((r) => setCategories(r.data)); }, []);
  useEffect(() => { load(); }, [month]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/fixed-costs", { ...form, amount: parseFloat(form.amount) });
      toast.success("Biaya tetap ditambahkan");
      setOpen(false);
      setForm({ category: "Gaji", description: "", amount: "", period_month: month });
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus biaya tetap ini?")) return;
    try { await api.delete(`/fixed-costs/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const byCat = rows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + r.amount; return acc; }, {});

  return (
    <div data-testid="fixed-costs-page">
      <PageHeader
        title="Biaya Tetap (Fixed Cost / Overhead)"
        subtitle="Biaya operasional bulanan di luar AWB. Akan mengurangi Gross Margin di Laporan Laba Rugi."
        action={
          <Button data-testid="add-fixed-cost-btn" onClick={() => { setForm({ category: "Gaji", description: "", amount: "", period_month: month }); setOpen(true); }}>
            <Plus size={16}/> Tambah Biaya Tetap
          </Button>
        }
      />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label>Periode (YYYY-MM)</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total Biaya Tetap {month}</div>
            <div data-testid="fixed-cost-total" className="font-heading font-black text-2xl text-red-700">{fmtIDR(total)}</div>
          </div>
        </div>
      </Card>

      {Object.keys(byCat).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {Object.entries(byCat).map(([cat, amt]) => (
            <Card key={cat} className={`p-3 border-l-4 ${CATEGORY_COLORS[cat]?.split(" ")[2] || "border-slate-200"}`}>
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">{cat}</div>
              <div className="font-heading font-black text-lg text-slate-900 mt-1">{fmtIDR(amt)}</div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>Periode</Th><Th>Kategori</Th><Th>Deskripsi</Th>
            <Th className="text-right">Jumlah</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`fixed-cost-row-${r.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="font-mono text-xs">{r.period_month}</Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${CATEGORY_COLORS[r.category] || "text-slate-700 bg-slate-50 border-slate-200"}`}>
                    <Banknote size={11} className="mr-1"/>{r.category}
                  </span>
                </Td>
                <Td className="text-slate-700 text-sm">{r.description || "-"}</Td>
                <Td className="text-right font-mono font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right">
                  <button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-10">Belum ada biaya tetap untuk periode ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Tambah Biaya Tetap</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Kategori *</Label>
                <Select data-testid="fixed-cost-category-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div>
                <Label>Periode (YYYY-MM) *</Label>
                <Input type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} required />
              </div>
              <div>
                <Label>Jumlah (IDR) *</Label>
                <Input data-testid="fixed-cost-amount-input" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Gaji bulan Juni 2026" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-fixed-cost-btn" type="submit"><Receipt size={14}/> Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
