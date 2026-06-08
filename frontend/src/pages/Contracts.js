import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Table, Th, Td } from "../components/ui";
import { errMsg, fmtIDR } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";

const empty = { customer_id: "", origin: "", destination: "", price_per_kg: 0 };

export default function Contracts() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const [c, cu] = await Promise.all([api.get("/contracts"), api.get("/customers")]);
    setRows(c.data); setCustomers(cu.data);
  };
  useEffect(() => { load(); }, []);

  const cName = (id) => customers.find((c) => c.id === id)?.name || "-";

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/contracts", { ...form, price_per_kg: parseFloat(form.price_per_kg) });
      toast.success("Kontrak dibuat");
      setOpen(false); setForm(empty); load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus kontrak?")) return;
    await api.delete(`/contracts/${id}`); load();
  };

  return (
    <div data-testid="contracts-page">
      <PageHeader
        title="Master Kontrak"
        subtitle="Daftar tarif customer per rute (origin–destination)."
        action={<Button data-testid="add-contract-btn" onClick={() => setOpen(true)}><Plus size={16}/> Tambah Kontrak</Button>}
      />
      <Card>
        <Table>
          <thead><tr>
            <Th>Customer</Th><Th>Origin</Th><Th>Destination</Th><Th className="text-right">Tarif / Kg</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`contract-row-${r.id}`}>
                <Td><span className="font-semibold">{cName(r.customer_id)}</span></Td>
                <Td className="font-mono">{r.origin}</Td>
                <Td className="font-mono">{r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.price_per_kg)}</Td>
                <Td className="text-right"><button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button></Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500 py-8">Belum ada kontrak.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Tambah Kontrak</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Customer *</label>
                <Select data-testid="contract-customer-select" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
                  <option value="">— Pilih Customer —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Origin *</label>
                  <Input value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value.toUpperCase() })} required placeholder="CGK" /></div>
                <div><label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Destination *</label>
                  <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value.toUpperCase() })} required placeholder="DPS" /></div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Harga per Kg (IDR) *</label>
                <Input type="number" step="0.01" value={form.price_per_kg} onChange={(e) => setForm({ ...form, price_per_kg: e.target.value })} required />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
