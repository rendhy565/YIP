import React, { useEffect, useState, useMemo } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Trash2, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import NumberInput from "../components/NumberInput";
import Pagination, { usePagination } from "../components/Pagination";

const CATEGORIES = ["Operational", "Lintas", "Umum", "Kantor", "Lainnya"];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const empty = { category: "Operational", amount: "", description: "", expense_date: todayStr(), cash_account_code: "1101" };

export default function PettyCash() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.number, r.category, r.description, r.cash_account_code]
      .some((v) => (v || "").toString().toLowerCase().includes(s)));
  }, [rows, q]);
  const pag = usePagination(filtered, { resetKey: q });

  const load = async () => {
    const [pc, accs] = await Promise.all([
      api.get("/petty-cash"),
      api.get("/accounts"),
    ]);
    setRows(pc.data);
    setAccounts((accs.data || []).filter((a) => a.is_cash));
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error("Nominal harus > 0"); return; }
    setSaving(true);
    try {
      await api.post("/petty-cash", {
        category: form.category,
        amount: parseFloat(form.amount),
        description: form.description,
        expense_date: form.expense_date,
        cash_account_code: form.cash_account_code,
      });
      toast.success("Petty cash dicatat sebagai HPP / Operation (direct cost)");
      setShow(false); setForm(empty); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const del = async (id, number) => {
    if (!window.confirm(`PERINGATAN: Menghapus petty cash ${number}\n\nEfek:\n• Jurnal HPP/Cash akan DIHAPUS (akunting dibalik)\n\nLanjutkan?`)) return;
    try { await api.delete(`/petty-cash/${id}`); toast.success("Dihapus + jurnal dibalik"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="petty-cash-page">
      <PageHeader
        title="Petty Cash / Panjar Non-AWB"
        subtitle="Expense Lintas / Operational / Umum / Kantor — TANPA AWB. Semua tercatat sebagai HPP (direct cost) ke Beban Operasional Pengiriman (5102)."
        action={<Button data-testid="add-petty-cash-btn" onClick={() => { setForm({ ...empty, expense_date: todayStr() }); setShow(true); }}><Plus size={16}/> Catat Pengeluaran</Button>}
      />

      <Card className="p-5 mb-5 bg-amber-50 border-amber-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-amber-700 text-white flex items-center justify-center"><Wallet size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-amber-700">Total Petty Cash</div>
            <div className="font-heading font-black text-3xl text-amber-900">{fmtIDR(total)}</div>
          </div>
          <div className="ml-auto text-sm text-amber-700">{rows.length} entri</div>
        </div>
      </Card>

      <Card>
        <div className="p-3 border-b border-slate-200 flex items-center gap-2">
          <Input data-testid="petty-search" placeholder="Cari no / kategori / deskripsi..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md"/>
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} dari {rows.length} entri</span>
        </div>
        <Table>
          <thead><tr>
            <Th>No.</Th><Th>Tanggal</Th><Th>Kategori</Th><Th>Deskripsi</Th>
            <Th className="text-right">Nominal</Th><Th>Sumber Kas</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`petty-row-${r.number}`}>
                <Td className="font-mono font-semibold">{r.number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.expense_date)}</Td>
                <Td><span className="text-[10px] uppercase font-bold bg-slate-100 text-slate-700 rounded px-1.5 py-0.5">{r.category}</span></Td>
                <Td className="text-xs">{r.description || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-xs font-mono">{r.cash_account_code}</Td>
                <Td className="text-right">
                  {(isAdmin || user?.role === "finance") && (
                    <button onClick={() => del(r.id, r.number)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                  )}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Belum ada petty cash.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-petty"/>
      </Card>

      {show && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-petty-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Catat Petty Cash</h3>
              <button onClick={() => setShow(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Kategori *</Label>
                <Select data-testid="petty-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">Semua kategori → masuk ke <strong>5102 Beban Operasional Pengiriman</strong> (HPP / Direct Cost)</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nominal (IDR) *</Label><NumberInput data-testid="petty-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required/></div>
                <div><Label>Tanggal</Label><Input data-testid="petty-date" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })}/></div>
              </div>
              <div>
                <Label>Sumber Kas/Bank</Label>
                <Select data-testid="petty-cash-acc" value={form.cash_account_code} onChange={(e) => setForm({ ...form, cash_account_code: e.target.value })}>
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </Select>
              </div>
              <div><Label>Deskripsi</Label><Input data-testid="petty-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Beli ATK kantor"/></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setShow(false)}>Batal</Button>
                <Button data-testid="save-petty-btn" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
