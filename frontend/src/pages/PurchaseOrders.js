import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Trash2, FileSignature, PackageCheck } from "lucide-react";
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

  // POD modal
  const [podFor, setPodFor] = useState(null);
  const [podForm, setPodForm] = useState({ pod_date: todayStr(), pod_notes: "" });

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

  const openPod = (r) => { setPodFor(r); setPodForm({ pod_date: todayStr(), pod_notes: "" }); };
  const submitPod = async () => {
    try {
      await api.post(`/purchase-orders/${podFor.id}/receive-pod`, podForm);
      toast.success("POD diterima");
      setPodFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const openTotal = rows.filter((r) => r.status === "Open").reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="po-page">
      <PageHeader
        title="PO / Surat Perintah Vendor (Manifest)"
        subtitle="Surat perintah ke vendor. Bisa dengan AWB (otomatis jadi cost) atau tanpa AWB (tercatat terpisah di table)."
        action={<Button data-testid="add-po-btn" onClick={() => { setForm({ ...empty, po_date: todayStr() }); setShow(true); }}><Plus size={16}/> Buat PO</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card className="p-5 bg-blue-50 border-blue-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-700">Total Nilai PO</div>
          <div className="font-heading font-black text-2xl text-blue-900">{fmtIDR(total)}</div>
          <div className="text-xs text-blue-700 mt-1">{rows.length} PO terbit</div>
        </Card>
        <Card className="p-5 bg-amber-50 border-amber-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-amber-700">Outstanding (POD belum diterima)</div>
          <div className="font-heading font-black text-2xl text-amber-900">{fmtIDR(openTotal)}</div>
          <div className="text-xs text-amber-700 mt-1">{rows.filter((r) => r.status === "Open").length} PO</div>
        </Card>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>No. PO</Th><Th>Tanggal</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th>AWB</Th><Th className="text-right">Nominal</Th><Th>Status</Th>
            <Th>Tgl POD</Th><Th className="text-right">Aksi</Th>
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
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    r.status === "Received POD" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"
                  }`}>{r.status}</span>
                </Td>
                <Td className="text-xs text-slate-600">{r.pod_date ? fmtDate(r.pod_date) : "—"}</Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    {r.status === "Open" && (
                      <button data-testid={`receive-pod-${r.number}`} onClick={() => openPod(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1">
                        <PackageCheck size={11}/> Terima POD
                      </button>
                    )}
                    {(isAdmin || user?.role === "operation") && (
                      <button onClick={() => del(r)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-8">Belum ada PO.</Td></tr>}
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

      {podFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="pod-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Terima POD</h3>
                <p className="text-xs text-slate-500">{podFor.number} · {podFor.vendor_name}</p>
              </div>
              <button onClick={() => setPodFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div><Label>Tanggal POD *</Label><Input data-testid="pod-date" type="date" value={podForm.pod_date} onChange={(e) => setPodForm({ ...podForm, pod_date: e.target.value })}/></div>
              <div><Label>Catatan POD</Label><Input data-testid="pod-notes" value={podForm.pod_notes} onChange={(e) => setPodForm({ ...podForm, pod_notes: e.target.value })}/></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setPodFor(null)}>Batal</Button>
              <Button data-testid="confirm-pod-btn" variant="success" onClick={submitPod}>
                <PackageCheck size={14}/> Terima POD
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
