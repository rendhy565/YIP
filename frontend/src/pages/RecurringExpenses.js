import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useAuth } from "../lib/auth";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, Repeat, AlertCircle, Pause, Play, Edit2 } from "lucide-react";

export default function RecurringExpenses() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "", category: "", amount: "", frequency: "monthly", execute_day: 1,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "", description: "", notify_enabled: true, auto_execute: true,
  });
  const [running, setRunning] = useState(false);

  const { user: authUser } = useAuth();
  const canEdit = authUser?.role === "finance" || authUser?.role === "administrator";

  const load = () => api.get("/recurring-expenses").then((r) => setRows(r.data));
  const loadCat = () => api.get("/expense-categories").then((r) => setCategories(r.data));
  useEffect(() => { load(); loadCat(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        execute_day: parseInt(form.execute_day, 10),
        end_date: form.end_date || null,
      };
      if (editing) {
        await api.put(`/recurring-expenses/${editing.id}`, {
          name: payload.name, amount: payload.amount, description: payload.description,
          notify_enabled: payload.notify_enabled, auto_execute: payload.auto_execute,
          end_date: payload.end_date,
        });
        toast.success("Recurring updated");
      } else {
        await api.post("/recurring-expenses", payload);
        toast.success("Recurring expense dibuat");
      }
      setOpen(false); setEditing(null);
      setForm({ ...form, name: "", amount: "", description: "" });
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      name: r.name, category: r.category, amount: r.amount, frequency: r.frequency,
      execute_day: r.execute_day || 1,
      start_date: (r.start_date || "").slice(0, 10),
      end_date: (r.end_date || "").slice(0, 10),
      description: r.description || "",
      notify_enabled: r.notify_enabled, auto_execute: r.auto_execute,
    });
    setOpen(true);
  };

  const del = async (id) => {
    if (!window.confirm("Hapus recurring expense ini?")) return;
    try { await api.delete(`/recurring-expenses/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const toggleActive = async (r) => {
    try {
      await api.put(`/recurring-expenses/${r.id}`, { active: !r.active });
      toast.success(r.active ? "Di-pause" : "Diaktifkan");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const runDue = async () => {
    if (!window.confirm("Jalankan semua recurring expense yang due sekarang?")) return;
    setRunning(true);
    try {
      const r = await api.post("/recurring-expenses/run-due");
      toast.success(`${r.data.expenses_created} expense dibuat, ${r.data.notifications_sent} notifikasi`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setRunning(false); }
  };

  return (
    <div data-testid="recurring-expenses-page">
      <PageHeader
        title="Recurring Expense (Cost Automatic)"
        subtitle="Buat template expense yang dieksekusi otomatis pada tanggal tertentu (bulanan/mingguan/harian). Auto-create record expense + notifikasi."
        action={canEdit && (
          <div className="flex gap-2">
            <Button data-testid="run-due-btn" variant="secondary" onClick={runDue} disabled={running}><Repeat size={14}/> {running ? "Running..." : "Run Due Now"}</Button>
            <Button data-testid="add-recurring-btn" onClick={() => { setEditing(null); setForm({ name: "", category: "", amount: "", frequency: "monthly", execute_day: 1, start_date: new Date().toISOString().slice(0,10), end_date: "", description: "", notify_enabled: true, auto_execute: true }); setOpen(true); }}>
              <Plus size={14}/> Tambah Recurring
            </Button>
          </div>
        )}
      />

      <Card>
        <Table>
          <thead><tr>
            <Th>Nama</Th><Th>Kategori</Th><Th>Frekuensi</Th>
            <Th className="text-right">Jumlah</Th>
            <Th>Next Due</Th><Th>Last Run</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`recurring-row-${r.name}`} className={r.active ? "" : "opacity-50"}>
                <Td><div className="font-semibold">{r.name}</div><div className="text-[10px] text-slate-500">{r.description}</div></Td>
                <Td><span className="text-xs">{r.category}</span></Td>
                <Td><span className="text-xs uppercase font-bold">{r.frequency}</span>{r.frequency === "monthly" && <span className="text-[10px] text-slate-500"> (tgl {r.execute_day})</span>}</Td>
                <Td className="text-right font-mono font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-xs">{r.next_due ? fmtDate(r.next_due) : "-"}</Td>
                <Td className="text-xs">{r.last_executed_at ? fmtDate(r.last_executed_at) : "-"}</Td>
                <Td>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${r.active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-300"}`}>
                    {r.active ? "Aktif" : "Pause"}
                  </span>
                  {r.auto_execute && <div className="text-[9px] text-blue-700 mt-0.5">Auto-execute</div>}
                  {r.notify_enabled && <div className="text-[9px] text-amber-700">Notify ON</div>}
                </Td>
                <Td className="text-right">
                  {canEdit && (
                    <div className="inline-flex gap-1">
                      <button onClick={() => toggleActive(r)} className="p-1.5 rounded hover:bg-slate-50 text-slate-600">
                        {r.active ? <Pause size={12}/> : <Play size={12}/>}
                      </button>
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Edit2 size={12}/></button>
                      <button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Belum ada recurring expense.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">{editing ? "Edit" : "Tambah"} Recurring Expense</h3>
              <button onClick={() => { setOpen(false); setEditing(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Nama *</Label><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required placeholder="Mis. Sewa Kantor Bulanan"/></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Kategori *</Label>
                  <select disabled={!!editing} value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} required className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                    <option value="">Pilih kategori</option>
                    {categories.map((c) => <option key={c.id} value={c.name}>{c.name} ({c.posting_type})</option>)}
                  </select>
                </div>
                <div><Label>Jumlah (IDR) *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} required/></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Frekuensi *</Label>
                  <select disabled={!!editing} value={form.frequency} onChange={(e) => setForm({...form, frequency: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                    <option value="monthly">Bulanan</option>
                    <option value="weekly">Mingguan</option>
                    <option value="daily">Harian</option>
                  </select>
                </div>
                {form.frequency === "monthly" && (
                  <div><Label>Tgl Eksekusi (1-31)</Label><Input type="number" min="1" max="31" disabled={!!editing} value={form.execute_day} onChange={(e) => setForm({...form, execute_day: e.target.value})}/></div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Mulai *</Label><Input type="date" disabled={!!editing} value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} required/></div>
                <div><Label>Berakhir (opsional)</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})}/></div>
              </div>
              <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})}/></div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-slate-50">
                  <input type="checkbox" checked={form.auto_execute} onChange={(e) => setForm({...form, auto_execute: e.target.checked})}/>
                  <div><div className="font-semibold">Auto-Execute</div><div className="text-[10px] text-slate-500">Sistem otomatis bikin expense saat due. Kalau OFF, hanya notifikasi reminder.</div></div>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-slate-50">
                  <input type="checkbox" checked={form.notify_enabled} onChange={(e) => setForm({...form, notify_enabled: e.target.checked})}/>
                  <div><div className="font-semibold">Notifikasi In-App</div><div className="text-[10px] text-slate-500">Kirim notif setiap kali eksekusi.</div></div>
                </label>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-800 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5"/>
                <div>Tekan tombol <strong>&quot;Run Due Now&quot;</strong> untuk eksekusi manual semua yang due (atau setup cron job memanggil <code>POST /api/recurring-expenses/run-due</code>).</div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => { setOpen(false); setEditing(null); }}>Batal</Button>
                <Button type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
