import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { errMsg, fmtIDR, fmtDate } from "../lib/utils";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { Plus, Trash2, X, Wallet, Coins } from "lucide-react";

export default function Costs() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [costs, setCosts] = useState([]);
  const [open, setOpen] = useState(false);

  const isOp = user?.role === "operation";
  const isAdmin = user?.role === "administrator";
  const defaultCategory = isOp ? "Vendor" : "Operational";

  const [form, setForm] = useState({
    awb_id: "",
    cost_category: defaultCategory,
    amount: "",
    description: "",
    vendor_name: "",
  });

  const load = async () => {
    const [o, c] = await Promise.all([api.get("/orders"), api.get("/costs")]);
    setOrders(o.data); setCosts(c.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/costs", { ...form, amount: parseFloat(form.amount) });
      toast.success("Biaya ditambahkan");
      setOpen(false); setForm({ awb_id: "", cost_category: defaultCategory, amount: "", description: "", vendor_name: "" });
      load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus biaya?")) return;
    try { await api.delete(`/costs/${id}`); toast.success("Dihapus"); load(); }
    catch (e2) { toast.error(errMsg(e2)); }
  };

  return (
    <div data-testid="costs-page">
      <PageHeader
        title="Plotting Biaya"
        subtitle={
          isOp
            ? "Modul 2 — Role Operation hanya bisa input biaya VENDOR (otomatis Accrue/Hutang)."
            : "Modul 2 — Role Finance hanya bisa input biaya OPERATIONAL & LINTAS (otomatis Cash)."
        }
        action={<Button data-testid="add-cost-btn" onClick={() => setOpen(true)}><Plus size={16}/> Tambah Biaya</Button>}
      />

      <Card>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Kategori</Th><Th>Tipe</Th>
            <Th>Vendor / Deskripsi</Th><Th className="text-right">Jumlah</Th><Th>Settle</Th><Th></Th>
          </tr></thead>
          <tbody>
            {costs.map((c) => (
              <tr key={c.id} data-testid={`cost-row-${c.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(c.created_at)}</Td>
                <Td className="font-mono font-semibold">{c.awb_number}</Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase ${
                    c.cost_category === "Vendor" ? "text-orange-700" :
                    c.cost_category === "Operational" ? "text-teal-700" :
                    c.cost_category === "Marketing" ? "text-pink-700" : "text-indigo-700"
                  }`}>
                    {c.cost_category === "Vendor" ? <Wallet size={12}/> : <Coins size={12}/>}
                    {c.cost_category}
                  </span>
                </Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    c.payment_type === "Accrue" ? "bg-orange-100 text-orange-800 border-orange-200" : "bg-teal-100 text-teal-800 border-teal-200"
                  }`}>{c.payment_type === "Accrue" ? "Hutang" : "Cash"}</span>
                </Td>
                <Td>
                  <div className="text-sm">{c.vendor_name || "-"}</div>
                  <div className="text-[11px] text-slate-500">{c.description || ""}</div>
                </Td>
                <Td className="text-right font-mono font-semibold">{fmtIDR(c.amount)}</Td>
                <Td>
                  <span className={`text-[10px] font-bold uppercase ${c.is_settled ? "text-emerald-700" : "text-slate-400"}`}>
                    {c.is_settled ? "Selesai" : "Pending"}
                  </span>
                </Td>
                <Td className="text-right">
                  {((isOp && c.cost_category === "Vendor") || isAdmin || (!isOp && !isAdmin)) && (
                    <button onClick={() => del(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                  )}
                </Td>
              </tr>
            ))}
            {costs.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-8">Belum ada biaya.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Tambah Biaya</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>AWB *</Label>
                <SearchableSelect
                  testid="cost-awb-select"
                  value={form.awb_id}
                  onChange={(v) => setForm({ ...form, awb_id: v })}
                  options={orders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name} · ${o.origin}→${o.destination}` }))}
                  placeholder="— Pilih AWB —"
                  emptyText="AWB tidak ditemukan"
                  required
                />
              </div>
              <div>
                <Label>Kategori Biaya *</Label>
                <Select data-testid="cost-category-select" value={form.cost_category} onChange={(e) => setForm({ ...form, cost_category: e.target.value })} required>
                  {isAdmin ? (
                    <>
                      <option value="Vendor">Vendor (Accrue / Hutang)</option>
                      <option value="Operational">Operational (Cash)</option>
                      <option value="Lintas">Lintas (Cash)</option>
                      <option value="Marketing">Marketing (COGS terpisah)</option>
                    </>
                  ) : isOp ? (
                    <option value="Vendor">Vendor (Accrue / Hutang)</option>
                  ) : (
                    <>
                      <option value="Operational">Operational (Cash)</option>
                      <option value="Lintas">Lintas (Cash)</option>
                      <option value="Marketing">Marketing (COGS terpisah)</option>
                    </>
                  )}
                </Select>
              </div>
              {form.cost_category === "Vendor" && (
                <div>
                  <Label>Nama Vendor</Label>
                  <Input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} placeholder="Mis. PT. Truk Cepat"/>
                </div>
              )}
              <div>
                <Label>Jumlah (IDR) *</Label>
                <Input data-testid="cost-amount-input" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Trucking ke gudang"/>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-cost-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
