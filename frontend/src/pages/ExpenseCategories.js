import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, Banknote, Edit2, Lock, Search } from "lucide-react";

const POSTING_BADGE = {
  cogs:    { label: "COGS",    cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  expense: { label: "EXPENSE", cls: "text-slate-700 bg-slate-50 border-slate-200" },
};

export default function ExpenseCategories() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);  // null = new, obj = edit
  const [form, setForm] = useState({ name: "", posting_type: "expense" });

  const { user: authUser } = useAuth();
  const userRole = authUser?.role || "";
  const canEdit = userRole === "finance" || userRole === "administrator";

  const load = () => api.get("/expense-categories?include_usage=true").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", posting_type: "expense" });
    setOpen(true);
  };

  const openEdit = (r) => {
    if (r.is_system) { toast.error("Kategori sistem tidak bisa diubah"); return; }
    setEditing(r);
    setForm({ name: r.name, posting_type: r.posting_type });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Nama wajib"); return; }
    try {
      if (editing) {
        await api.put(`/expense-categories/${editing.id}`, form);
        toast.success("Kategori diupdate");
      } else {
        await api.post("/expense-categories", form);
        toast.success("Kategori ditambahkan");
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const del = async (r) => {
    if (r.is_system) { toast.error("Kategori sistem tidak bisa dihapus"); return; }
    if (r.in_use_count > 0) { toast.error(`Kategori dipakai oleh ${r.in_use_count} expense. Pindahkan dulu.`); return; }
    if (!window.confirm(`Hapus kategori "${r.name}"?`)) return;
    try {
      await api.delete(`/expense-categories/${r.id}`);
      toast.success("Dihapus");
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const cogsCount = rows.filter((r) => r.posting_type === "cogs").length;
  const expCount = rows.filter((r) => r.posting_type === "expense").length;

  return (
    <div data-testid="expense-categories-page">
      <PageHeader
        title="Master Kategori Expense"
        subtitle="Atur kategori expense beserta posting akuntingnya. Kategori 'COGS' (mis. Operation, Marketing) mempengaruhi Gross Margin; 'EXPENSE' mempengaruhi Net Profit."
        action={canEdit && (
          <Button data-testid="add-category-btn" onClick={openNew}><Plus size={16}/> Tambah Kategori</Button>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Card className="p-3 border-l-4 border-emerald-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-600">COGS Categories</div>
          <div className="font-heading font-black text-2xl text-emerald-700">{cogsCount}</div>
          <div className="text-[11px] text-slate-500">Posting ke akun 5XXX (HPP)</div>
        </Card>
        <Card className="p-3 border-l-4 border-slate-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Expense Categories</div>
          <div className="font-heading font-black text-2xl text-slate-800">{expCount}</div>
          <div className="text-[11px] text-slate-500">Posting ke akun 6XXX (Operating)</div>
        </Card>
        <Card className="p-3 border-l-4 border-blue-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-500">Total Kategori</div>
          <div className="font-heading font-black text-2xl text-blue-700">{rows.length}</div>
          <div className="text-[11px] text-slate-500">Sistem + Custom</div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-3 text-slate-400"/>
            <input
              data-testid="category-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kategori..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900/20"
            />
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th>Nama</Th><Th>Posting Type</Th><Th>Akun (COA)</Th>
            <Th className="text-center">Tipe</Th>
            <Th className="text-right">Dipakai</Th><Th></Th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} data-testid={`category-row-${r.name}`}>
                <Td><div className="font-semibold flex items-center gap-1.5">{r.name} {r.is_system && <Lock size={11} className="text-slate-400" title="Sistem"/>}</div></Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${POSTING_BADGE[r.posting_type]?.cls}`}>
                    {POSTING_BADGE[r.posting_type]?.label}
                  </span>
                </Td>
                <Td className="font-mono text-sm">{r.account_code}</Td>
                <Td className="text-center">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${r.is_system ? "bg-slate-100 text-slate-600 border-slate-300" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                    {r.is_system ? "Sistem" : "Custom"}
                  </span>
                </Td>
                <Td className="text-right text-sm">
                  {r.in_use_count > 0 ? (
                    <span className="font-semibold">{r.in_use_count}</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </Td>
                <Td className="text-right">
                  {canEdit && !r.is_system && (
                    <div className="inline-flex gap-1">
                      <button data-testid={`edit-cat-${r.name}`} onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit"><Edit2 size={13}/></button>
                      <button data-testid={`delete-cat-${r.name}`} onClick={() => del(r)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Hapus" disabled={r.in_use_count > 0}><Trash2 size={13}/></button>
                    </div>
                  )}
                  {r.is_system && (
                    <span className="text-[10px] text-slate-400 italic">terkunci</span>
                  )}
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-8">Tidak ada kategori.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">{editing ? "Edit Kategori" : "Tambah Kategori"}</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Nama Kategori *</Label>
                <Input data-testid="category-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mis. Service Kendaraan" required autoFocus/>
              </div>
              <div>
                <Label>Posting Type *</Label>
                <div className="flex gap-2 mt-1">
                  <label className={`flex-1 flex items-center gap-2 p-2 border rounded cursor-pointer text-sm ${form.posting_type === "expense" ? "border-slate-900 bg-slate-50 font-semibold" : "border-slate-200 hover:border-slate-300"}`}>
                    <input data-testid="posting-type-expense" type="radio" checked={form.posting_type === "expense"} onChange={() => setForm({ ...form, posting_type: "expense" })}/>
                    <div>
                      <div>Expense (6XXX)</div>
                      <div className="text-[10px] text-slate-500">Di bawah Gross Margin</div>
                    </div>
                  </label>
                  <label className={`flex-1 flex items-center gap-2 p-2 border rounded cursor-pointer text-sm ${form.posting_type === "cogs" ? "border-emerald-700 bg-emerald-50 font-semibold" : "border-slate-200 hover:border-slate-300"}`}>
                    <input data-testid="posting-type-cogs" type="radio" checked={form.posting_type === "cogs"} onChange={() => setForm({ ...form, posting_type: "cogs" })}/>
                    <div>
                      <div>COGS (5102)</div>
                      <div className="text-[10px] text-slate-500">Masuk Gross Margin</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
                <Banknote size={12} className="inline mr-1"/>
                {form.posting_type === "cogs"
                  ? "Akan posting ke akun 5102 (Beban Operasional Pengiriman) — sama dengan Operation."
                  : editing ? "Akun expense saat ini akan dipertahankan (62XX)." : "Akun baru di range 62XX akan auto-dibuat."}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-category-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
