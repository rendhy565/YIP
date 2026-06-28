import React, { useEffect, useState, useRef } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, Banknote, Receipt, Copy, ChevronDown, Check, Search } from "lucide-react";

const POSTING_BADGE = {
  cogs:    { label: "COGS",    cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  expense: { label: "EXPENSE", cls: "text-slate-700 bg-slate-50 border-slate-200" },
};

// ---------- CategoryCombobox: searchable dropdown with "+ Tambah baru" ----------
function CategoryCombobox({ value, onChange, categories, onCategoryCreated }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? categories.filter((c) => c.name.toLowerCase().includes(q))
    : categories;
  const exactExists = categories.some((c) => c.name.toLowerCase() === q);

  const selectedObj = categories.find((c) => c.name === value);

  const pick = (cat) => {
    onChange(cat.name);
    setOpen(false);
    setQuery("");
  };

  const createNew = async () => {
    if (!q || exactExists) return;
    setCreating(true);
    try {
      const r = await api.post("/expense-categories", { name: query.trim(), posting_type: "expense" });
      toast.success(`Kategori "${r.data.name}" ditambahkan`);
      onCategoryCreated && onCategoryCreated(r.data);
      onChange(r.data.name);
      setOpen(false);
      setQuery("");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        data-testid="category-combobox-trigger"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-slate-300 rounded-md bg-white text-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      >
        <span className={value ? "text-slate-900" : "text-slate-400"}>
          {value || "Pilih kategori..."}
        </span>
        {selectedObj && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${POSTING_BADGE[selectedObj.posting_type]?.cls}`}>
            {POSTING_BADGE[selectedObj.posting_type]?.label}
          </span>
        )}
        <ChevronDown size={14} className="text-slate-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col" data-testid="category-combobox-list">
          <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
              <input
                data-testid="category-search-input"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered.length === 1) pick(filtered[0]);
                    else if (q && !exactExists) createNew();
                  }
                }}
                placeholder="Cari atau ketik nama baru..."
                className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900/20"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && !q && (
              <div className="px-3 py-4 text-xs text-slate-400 text-center">Belum ada kategori</div>
            )}
            {filtered.map((cat) => (
              <button
                key={cat.id}
                type="button"
                data-testid={`category-option-${cat.name}`}
                onClick={() => pick(cat)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-left"
              >
                <span className="flex items-center gap-2">
                  {value === cat.name && <Check size={13} className="text-emerald-600" />}
                  <span className={value === cat.name ? "font-semibold" : ""}>{cat.name}</span>
                </span>
                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${POSTING_BADGE[cat.posting_type]?.cls}`}>
                  {POSTING_BADGE[cat.posting_type]?.label}
                </span>
              </button>
            ))}
            {q && !exactExists && (
              <button
                type="button"
                data-testid="category-create-new-btn"
                onClick={createNew}
                disabled={creating}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 border-t border-slate-100 font-medium disabled:opacity-50"
              >
                <Plus size={14} />
                {creating ? "Menambahkan..." : `Tambah kategori baru "${query.trim()}"`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Main page ----------
export default function FixedCosts() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [openCopy, setOpenCopy] = useState(false);
  const [copyTarget, setCopyTarget] = useState("");
  const [copyOverwrite, setCopyOverwrite] = useState(false);
  const [form, setForm] = useState({ category: "", description: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) });

  const load = () => api.get("/fixed-costs", { params: { month } }).then((r) => setRows(r.data));
  const loadCategories = () => api.get("/expense-categories").then((r) => setCategories(r.data));
  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { load(); }, [month]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.category) {
      toast.error("Pilih kategori dulu");
      return;
    }
    try {
      await api.post("/fixed-costs", { ...form, amount: parseFloat(form.amount) });
      toast.success("Expense ditambahkan");
      setOpen(false);
      setForm({ category: "", description: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) });
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus expense ini?")) return;
    try { await api.delete(`/fixed-costs/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const nextMonth = (ym) => {
    const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const openCopyDialog = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada expense untuk disalin di periode ini");
      return;
    }
    setCopyTarget(nextMonth(month));
    setCopyOverwrite(false);
    setOpenCopy(true);
  };

  const doCopy = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/fixed-costs/copy", {
        source_month: month, target_month: copyTarget, overwrite: copyOverwrite,
      });
      toast.success(`${r.data.copied} expense disalin ke ${r.data.target_month}`);
      setOpenCopy(false);
      setMonth(copyTarget);
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  // Resolve posting_type for each row via categories
  const catByName = Object.fromEntries(categories.map((c) => [c.name, c]));
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const totalCogs = rows.filter((r) => (r.posting_type || catByName[r.category]?.posting_type) === "cogs").reduce((s, r) => s + (r.amount || 0), 0);
  const totalExpense = total - totalCogs;
  const byCat = rows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + r.amount; return acc; }, {});

  return (
    <div data-testid="fixed-costs-page">
      <PageHeader
        title="Expense"
        subtitle="Biaya operasional bulanan. Kategori 'Operation' masuk COGS (mempengaruhi Gross Margin); kategori lain masuk Expense (di bawah Gross Margin)."
        action={
          <div className="flex flex-wrap gap-2">
            <Button data-testid="copy-fixed-cost-btn" variant="secondary" onClick={openCopyDialog}>
              <Copy size={16}/> Salin ke Bulan Berikutnya
            </Button>
            <Button data-testid="add-fixed-cost-btn" onClick={() => { setForm({ category: "", description: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) }); setOpen(true); }}>
              <Plus size={16}/> Tambah Expense
            </Button>
          </div>
        }
      />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label>Periode (YYYY-MM)</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-4 items-end">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-600">COGS (Operation)</div>
              <div data-testid="cogs-total" className="font-heading font-black text-xl text-emerald-700">{fmtIDR(totalCogs)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Expense (Operating)</div>
              <div data-testid="expense-total" className="font-heading font-black text-xl text-slate-800">{fmtIDR(totalExpense)}</div>
            </div>
            <div className="text-right border-l border-slate-200 pl-4">
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total {month}</div>
              <div data-testid="fixed-cost-total" className="font-heading font-black text-2xl text-red-700">{fmtIDR(total)}</div>
            </div>
          </div>
        </div>
      </Card>

      {Object.keys(byCat).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {Object.entries(byCat).map(([cat, amt]) => {
            const ptype = catByName[cat]?.posting_type || "expense";
            const borderCls = ptype === "cogs" ? "border-emerald-300" : "border-slate-200";
            return (
              <Card key={cat} className={`p-3 border-l-4 ${borderCls}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 truncate">{cat}</div>
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${POSTING_BADGE[ptype]?.cls}`}>
                    {POSTING_BADGE[ptype]?.label}
                  </span>
                </div>
                <div className="font-heading font-black text-lg text-slate-900">{fmtIDR(amt)}</div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>Periode</Th><Th>Kategori</Th><Th>Posting</Th><Th>Deskripsi</Th>
            <Th className="text-right">Jumlah</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const ptype = r.posting_type || catByName[r.category]?.posting_type || "expense";
              return (
                <tr key={r.id} data-testid={`fixed-cost-row-${r.id}`}>
                  <Td className="text-xs text-slate-700 font-mono">{r.expense_date || fmtDate(r.created_at)}</Td>
                  <Td className="font-mono text-xs">{r.period_month}</Td>
                  <Td>
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700 bg-slate-50 border-slate-200">
                      <Banknote size={11} className="mr-1"/>{r.category}
                    </span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${POSTING_BADGE[ptype]?.cls}`}>
                      {POSTING_BADGE[ptype]?.label}
                    </span>
                  </Td>
                  <Td className="text-slate-700 text-sm">{r.description || "-"}</Td>
                  <Td className="text-right font-mono font-semibold">{fmtIDR(r.amount)}</Td>
                  <Td className="text-right">
                    <button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">Belum ada expense untuk periode ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Tambah Expense</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Kategori *</Label>
                <CategoryCombobox
                  value={form.category}
                  onChange={(name) => setForm((s) => ({ ...s, category: name }))}
                  categories={categories}
                  onCategoryCreated={(cat) => setCategories((arr) => [...arr, cat])}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Kategori <strong>Operation</strong> → posting ke COGS (mengurangi Gross Margin). Lainnya → Expense.
                </div>
              </div>
              <div>
                <Label>Tanggal Expense *</Label>
                <Input data-testid="expense-date-input" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
              </div>
              <div>
                <Label>Jumlah (IDR) *</Label>
                <Input data-testid="fixed-cost-amount-input" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Sewa kantor Juni 2026" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-fixed-cost-btn" type="submit"><Receipt size={14}/> Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {openCopy && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Salin Expense</h3>
              <button onClick={() => setOpenCopy(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Akan menyalin <strong>{rows.length} item</strong> expense dari <span className="font-mono font-bold">{month}</span> ke periode tujuan.
            </p>
            <form onSubmit={doCopy} className="space-y-3">
              <div>
                <Label>Periode Tujuan *</Label>
                <Input data-testid="copy-target-month-input" type="month" value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)} required />
              </div>
              <label className="flex items-start gap-2 p-3 rounded border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  data-testid="copy-overwrite-toggle"
                  type="checkbox"
                  checked={copyOverwrite}
                  onChange={(e) => setCopyOverwrite(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-semibold text-slate-800">Hapus dulu item di periode tujuan</div>
                  <div className="text-[11px] text-slate-500">Jika belum dicentang, item baru ditambahkan (mungkin menghasilkan duplikat).</div>
                </div>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenCopy(false)}>Batal</Button>
                <Button data-testid="confirm-copy-btn" type="submit"><Copy size={14}/> Salin Sekarang</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
