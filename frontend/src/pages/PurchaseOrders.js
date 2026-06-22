import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Trash2, FileSignature } from "lucide-react";
import { useAuth } from "../lib/auth";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const empty = { vendor_name: "", description: "", amount: "", awb_id: "", po_date: todayStr(), notes: "" };

export default function PurchaseOrders() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  // PO module: no POD (POD handled in Penerimaan Barang AWB)

  const load = async () => {
    const [po, os] = await Promise.all([api.get("/purchase-orders"), api.get("/orders")]);
    setRows(po.data);
    setAllOrders(os.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error("Nominal harus > 0"); return; }
    if (!form.vendor_name || !form.description) { toast.error("Vendor & Deskripsi wajib"); return; }
    setSaving(true);
    try {
      const payload = {
        vendor_name: form.vendor_name,
        description: form.description,
        amount: parseFloat(form.amount),
        awb_id: form.awb_id || null,
        po_date: form.po_date,
        notes: form.notes,
      };
      await api.post("/purchase-orders", payload);
      toast.success(form.awb_id ? "PO dibuat — cost otomatis ditambah ke AWB" : "PO dibuat (tanpa AWB)");
      setShow(false); setForm(empty); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const del = async (r) => {
    if (!window.confirm(
      `PERINGATAN: Menghapus PO ${r.number}\n\n` +
      `Efek:\n` +
      `${r.awb_id ? `• Cost vendor di AWB akan DIHAPUS\n• Jurnal akrual hutang dibalik\n` : ""}` +
      `• Tidak bisa jika cost sudah disettle\n\n` +
      `Lanjutkan?`
    )) return;
    try { await api.delete(`/purchase-orders/${r.id}`); toast.success("PO dihapus + akunting dibalik"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="po-page">
      <PageHeader
        title="PO / Surat Perintah Vendor (Manifest)"
        subtitle="Surat perintah ke vendor. Bisa dengan AWB (otomatis jadi cost) atau tanpa AWB (tercatat terpisah di table)."
        action={<Button data-testid="add-po-btn" onClick={() => { setForm({ ...empty, po_date: todayStr() }); setShow(true); }}><Plus size={16}/> Buat PO</Button>}
      />

      <Card className="p-5 bg-blue-50 border-blue-200 mb-5">
        <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-700">Total Nilai PO</div>
        <div className="font-heading font-black text-2xl text-blue-900">{fmtIDR(total)}</div>
        <div className="text-xs text-blue-700 mt-1">{rows.length} PO terbit</div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>No. PO</Th><Th>Tanggal</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th>AWB</Th><Th className="text-right">Nominal</Th>
            <Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`po-row-${r.number}`}>
                <Td className="font-mono font-semibold">{r.number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.po_date)}</Td>
                <Td className="font-semibold">{r.vendor_name}</Td>
                <Td className="text-xs">{r.description}</Td>
                <Td className="text-xs font-mono">
                  {r.awb_number ? <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">{r.awb_number}</span> : <span className="text-slate-400">— Non-AWB —</span>}
                </Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {(isAdmin || user?.role === "operation") && (
                    <button onClick={() => del(r)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                  )}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Belum ada PO.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {show && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-po-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><FileSignature className="inline mr-2" size={18}/>Buat PO Vendor</h3>
              <button onClick={() => setShow(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Vendor *</Label><Input data-testid="po-vendor" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} required/></div>
              <div><Label>Deskripsi Pekerjaan *</Label><Input data-testid="po-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="Mis. Trucking JKT-SBY 1 unit CDD"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nominal (IDR) *</Label><Input data-testid="po-amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required/></div>
                <div><Label>Tanggal PO</Label><Input data-testid="po-date" type="date" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })}/></div>
              </div>
              <div>
                <Label>AWB (opsional — kalau diisi, cost otomatis ke AWB)</Label>
                <SearchableSelect
                  testid="po-awb"
                  value={form.awb_id}
                  onChange={(v) => setForm({ ...form, awb_id: v })}
                  options={allOrders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name}` }))}
                  placeholder="— Tanpa AWB —"
                  emptyText="AWB tidak ditemukan"
                />
              </div>
              <div><Label>Catatan</Label><Input data-testid="po-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setShow(false)}>Batal</Button>
                <Button data-testid="save-po-btn" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Buat PO"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
