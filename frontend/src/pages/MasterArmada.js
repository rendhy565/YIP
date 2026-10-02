import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, Truck, Edit2, Search, ArrowUp, ArrowDown, CheckCircle2, Circle } from "lucide-react";

export default function MasterArmada() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, obj = edit
  const [form, setForm] = useState({ name: "", active: true });
  const [savingOrder, setSavingOrder] = useState(false);

  const load = () => api.get("/masters/armada?include_inactive=true").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", active: true });
    setOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({ name: r.name, active: r.active !== false });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Nama armada wajib diisi"); return; }
    try {
      if (editing) {
        await api.put(`/masters/armada/${editing.id}`, { name: form.name.trim(), active: form.active });
        toast.success("Armada diupdate");
      } else {
        await api.post("/masters/armada", { name: form.name.trim(), active: form.active });
        toast.success("Armada ditambahkan");
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const toggleActive = async (r) => {
    try {
      await api.put(`/masters/armada/${r.id}`, { active: !(r.active !== false) });
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const del = async (r) => {
    if (!window.confirm(`Hapus armada "${r.name}"? Order lama yang sudah memakai nilai ini tidak terpengaruh.`)) return;
    try {
      await api.delete(`/masters/armada/${r.id}`);
      toast.success("Dihapus");
      load();
    } catch (err) { toast.error(errMsg(err)); }
  };

  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setRows(next);
    setSavingOrder(true);
    try {
      await api.post("/masters/armada/reorder", { ids: next.map((r) => r.id) });
    } catch (err) {
      toast.error(errMsg(err));
      load();
    } finally {
      setSavingOrder(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const activeCount = rows.filter((r) => r.active !== false).length;
  const reorderable = !q; // move buttons only when unfiltered (order reflects full list)

  return (
    <div data-testid="master-armada-page">
      <PageHeader
        title="Master Armada"
        subtitle="Kelola daftar armada yang tampil di dropdown Input Order (Armada Request Customer & Armada Pickup Internal). Satu daftar dipakai untuk keduanya."
        action={(
          <Button data-testid="add-armada-btn" onClick={openNew}><Plus size={16}/> Tambah Armada</Button>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Card className="p-3 border-l-4 border-emerald-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-600">Armada Aktif</div>
          <div className="font-heading font-black text-2xl text-emerald-700">{activeCount}</div>
          <div className="text-[11px] text-slate-500">Tampil di dropdown Input Order</div>
        </Card>
        <Card className="p-3 border-l-4 border-slate-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Non-Aktif</div>
          <div className="font-heading font-black text-2xl text-slate-800">{rows.length - activeCount}</div>
          <div className="text-[11px] text-slate-500">Disembunyikan dari dropdown</div>
        </Card>
        <Card className="p-3 border-l-4 border-blue-300">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-500">Total</div>
          <div className="font-heading font-black text-2xl text-blue-700">{rows.length}</div>
          <div className="text-[11px] text-slate-500">Semua armada</div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-3 text-slate-400"/>
            <input
              data-testid="armada-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari armada..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900/20"
            />
          </div>
        </div>
        <Table>
          <thead><tr>
            <Th className="w-20 text-center">Urut</Th>
            <Th>Nama Armada</Th>
            <Th className="text-center">Status</Th>
            <Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} data-testid={`armada-row-${r.name}`}>
                <Td className="text-center">
                  <div className="inline-flex flex-col">
                    <button
                      data-testid={`armada-up-${r.name}`}
                      onClick={() => move(i, -1)}
                      disabled={!reorderable || i === 0 || savingOrder}
                      className="p-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                      title={reorderable ? "Naik" : "Hapus pencarian untuk mengurutkan"}
                    ><ArrowUp size={13}/></button>
                    <button
                      data-testid={`armada-down-${r.name}`}
                      onClick={() => move(i, 1)}
                      disabled={!reorderable || i === filtered.length - 1 || savingOrder}
                      className="p-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                      title={reorderable ? "Turun" : "Hapus pencarian untuk mengurutkan"}
                    ><ArrowDown size={13}/></button>
                  </div>
                </Td>
                <Td>
                  <div className="font-semibold flex items-center gap-1.5">
                    <Truck size={13} className="text-slate-400"/>{r.name}
                  </div>
                </Td>
                <Td className="text-center">
                  <button
                    data-testid={`armada-toggle-${r.name}`}
                    onClick={() => toggleActive(r)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${r.active !== false ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-300"}`}
                    title="Klik untuk ubah status"
                  >
                    {r.active !== false ? <CheckCircle2 size={11}/> : <Circle size={11}/>}
                    {r.active !== false ? "Aktif" : "Non-aktif"}
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="inline-flex gap-1">
                    <button data-testid={`edit-armada-${r.name}`} onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Edit"><Edit2 size={13}/></button>
                    <button data-testid={`delete-armada-${r.name}`} onClick={() => del(r)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Hapus"><Trash2 size={13}/></button>
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-500 py-8">Tidak ada armada.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">{editing ? "Edit Armada" : "Tambah Armada"}</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Nama Armada *</Label>
                <Input data-testid="armada-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mis. TRUCKING CHARTER CDD" required autoFocus/>
              </div>
              <label className="flex items-center gap-2 p-2 border border-slate-200 rounded cursor-pointer text-sm">
                <input data-testid="armada-active-input" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/>
                <div>
                  <div className="font-semibold">Aktif</div>
                  <div className="text-[10px] text-slate-500">Jika non-aktif, armada tidak muncul di dropdown Input Order.</div>
                </div>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-armada-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
