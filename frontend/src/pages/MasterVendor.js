import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { PPH_LABEL } from "../components/VendorSelect";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, AlertTriangle } from "lucide-react";

const empty = { name: "", npwp: "", pph_type: "", address: "", bank_account: "", notes: "" };

const PPH_OPTIONS = [
  { value: "", label: "Tidak dipotong (Non-PPh)" },
  { value: "PPh23", label: "PPh 23 — 2% (jasa, sewa)" },
  { value: "PPh15", label: "PPh 15 — 2% (pelayaran/penerbangan)" },
  { value: "PP23UMKM", label: "PPh Final UMKM (PP 23) — 0,5%" },
];

export default function MasterVendor() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [onlyReview, setOnlyReview] = useState(false);

  const load = () => api.get("/vendors").then((r) => setRows(r.data || [])).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const reviewCount = useMemo(() => rows.filter((r) => !r.pph_reviewed).length, [rows]);
  const shown = useMemo(() => (onlyReview ? rows.filter((r) => !r.pph_reviewed) : rows), [rows, onlyReview]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      // Simpan via master = tandai sudah ditinjau Finance
      const payload = { ...form, pph_type: form.pph_type || null, pph_reviewed: true };
      if (editId) await api.put(`/vendors/${editId}`, payload);
      else await api.post("/vendors", payload);
      toast.success(editId ? "Vendor diperbarui" : "Vendor dibuat");
      setOpen(false); setForm(empty); setEditId(null); load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus vendor ini?")) return;
    try { await api.delete(`/vendors/${id}`); toast.success("Dihapus"); load(); }
    catch (e2) { toast.error(errMsg(e2)); }
  };

  const editRow = (r) => {
    setForm({ name: r.name || "", npwp: r.npwp || "", pph_type: r.pph_type || "", address: r.address || "", bank_account: r.bank_account || "", notes: r.notes || "" });
    setEditId(r.id); setOpen(true);
  };

  return (
    <div data-testid="master-vendor-page">
      <PageHeader
        title="Master Vendor"
        subtitle="Finance mengelola klasifikasi PPh per vendor. PPh 23 dipotong otomatis saat Settle Hutang Vendor sesuai jenis di sini."
        action={
          <Button data-testid="add-vendor-btn" onClick={() => { setForm(empty); setEditId(null); setOpen(true); }}>
            <Plus size={16} /> Tambah Vendor
          </Button>
        }
      />

      {reviewCount > 0 && (
        <button
          data-testid="review-filter-toggle"
          onClick={() => setOnlyReview((v) => !v)}
          className={`mb-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${onlyReview ? "border-amber-400 bg-amber-100 text-amber-900" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}
        >
          <AlertTriangle size={15} />
          {reviewCount} vendor belum dikonfigurasi PPh {onlyReview ? "(klik untuk tampilkan semua)" : "(klik untuk filter)"}
        </button>
      )}

      <Card>
        <Table>
          <thead><tr>
            <Th>Nama</Th><Th>NPWP</Th><Th>Jenis PPh</Th><Th>Status</Th><Th>Rekening</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} data-testid={`vendor-row-${r.id}`}>
                <Td><span className="font-semibold">{r.name}</span></Td>
                <Td className="font-mono text-xs">{r.npwp || "-"}</Td>
                <Td>
                  {r.pph_type
                    ? <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800">{PPH_LABEL[r.pph_type] || r.pph_type}</span>
                    : <span className="text-xs text-slate-400">Non-PPh</span>}
                </Td>
                <Td>
                  {r.pph_reviewed
                    ? <span className="text-[10px] font-bold uppercase text-emerald-700">Ditinjau</span>
                    : <span data-testid={`vendor-review-badge-${r.id}`} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-700"><AlertTriangle size={11}/> Perlu Ditinjau</span>}
                </Td>
                <Td className="text-xs text-slate-500 max-w-[180px] truncate" title={r.bank_account}>{r.bank_account || "-"}</Td>
                <Td className="text-right">
                  <button data-testid={`edit-vendor-${r.id}`} onClick={() => editRow(r)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Pencil size={14} /></button>
                  <button data-testid={`delete-vendor-${r.id}`} onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600 ml-1"><Trash2 size={14} /></button>
                </Td>
              </tr>
            ))}
            {shown.length === 0 && <tr><Td className="text-slate-500 text-center py-8" colSpan={6}>{onlyReview ? "Tidak ada vendor yang perlu ditinjau." : "Belum ada vendor."}</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl text-slate-900">{editId ? "Edit" : "Tambah"} Vendor</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Nama Vendor *</Label>
                <Input data-testid="vendor-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Mis. PT. Truk Cepat" />
              </div>
              <div>
                <Label>Jenis PPh Potong *</Label>
                <Select data-testid="vendor-pph-select" value={form.pph_type} onChange={(e) => setForm({ ...form, pph_type: e.target.value })}>
                  {PPH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">Menyimpan di sini menandai vendor <b>sudah ditinjau</b> Finance. Potongan berlaku otomatis saat settle.</p>
              </div>
              <div>
                <Label>NPWP</Label>
                <Input data-testid="vendor-npwp-input" value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} placeholder="00.000.000.0-000.000" />
              </div>
              <div>
                <Label>Rekening Bank</Label>
                <Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} placeholder="Bank · No. Rek · a.n." />
              </div>
              <div>
                <Label>Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <Label>Catatan</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-vendor-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
