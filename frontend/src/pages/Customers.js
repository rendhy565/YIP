import React, { useEffect, useState, useMemo } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Copy, Ticket } from "lucide-react";
import Pagination, { usePagination } from "../components/Pagination";

const empty = { name: "", company_details: "", address: "", npwp: "", tracking_code: "", attn: "", default_ppn_percentage: "" };

export default function Customers() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [applyingPpn, setApplyingPpn] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.name, r.company_details, r.npwp, r.address, r.tracking_code, r.attn]
      .some((v) => (v || "").toString().toLowerCase().includes(s)));
  }, [rows, q]);
  const pag = usePagination(filtered, { resetKey: q });

  const applyDefaultPpn = async () => {
    if (!editId) return;
    try {
      const chk = await api.post(`/customers/${editId}/apply-default-ppn?dry_run=true`);
      if (chk.data.affected_count === 0) {
        toast.info(`Semua AWB customer ini sudah PPN ${chk.data.default_ppn}%. Tidak ada yang perlu diubah.`);
        return;
      }
      const skip = chk.data.skipped_paid?.length ? ` (${chk.data.skipped_paid.length} AWB Paid dilewati)` : "";
      if (!window.confirm(`Terapkan PPN ${chk.data.default_ppn}% ke ${chk.data.affected_count} AWB customer ini? PPN & total dihitung ulang dan jurnal akuntansi ikut disesuaikan${skip}.`)) return;
      setApplyingPpn(true);
      const res = await api.post(`/customers/${editId}/apply-default-ppn`);
      toast.success(`${res.data.updated_count} AWB diperbarui ke PPN ${res.data.default_ppn}%${res.data.skipped_paid?.length ? `, ${res.data.skipped_paid.length} Paid dilewati` : ""}`);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setApplyingPpn(false); }
  };

  const load = () => api.get("/customers").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, tracking_code: (form.tracking_code || "").trim().toUpperCase() || null, default_ppn_percentage: (form.default_ppn_percentage === "" || form.default_ppn_percentage == null) ? null : parseFloat(form.default_ppn_percentage) };
      if (editId) await api.put(`/customers/${editId}`, payload);
      else await api.post("/customers", payload);
      toast.success(editId ? "Customer diperbarui" : "Customer dibuat");
      setOpen(false); setForm(empty); setEditId(null); load();
    } catch (e2) { toast.error(errMsg(e2)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus customer ini?")) return;
    try { await api.delete(`/customers/${id}`); toast.success("Dihapus"); load(); }
    catch (e2) { toast.error(errMsg(e2)); }
  };

  const copyCode = (code) => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => toast.success(`Kode ${code} disalin`));
  };

  return (
    <div data-testid="customers-page">
      <PageHeader
        title="Master Customer"
        subtitle="Kelola data pelanggan, NPWP, dan Tracking Code untuk website tracking public."
        action={
          <Button data-testid="add-customer-btn" onClick={() => { setForm(empty); setEditId(null); setOpen(true); }}>
            <Plus size={16} /> Tambah Customer
          </Button>
        }
      />

      <Card>
        <div className="p-3 border-b border-slate-200 flex items-center gap-2">
          <Input data-testid="customers-search" placeholder="Cari nama / NPWP / kode / alamat..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md"/>
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} dari {rows.length} customer</span>
        </div>
        <Table>
          <thead><tr>
            <Th>Nama</Th><Th>Tracking Code</Th><Th>Detail Perusahaan</Th><Th>NPWP</Th><Th>Alamat</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((r) => (
              <tr key={r.id} data-testid={`customer-row-${r.id}`}>
                <Td><span className="font-semibold">{r.name}</span></Td>
                <Td>
                  {r.tracking_code ? (
                    <div className="inline-flex items-center gap-1.5">
                      <Ticket size={12} className="text-indigo-600"/>
                      <span data-testid={`tracking-code-${r.id}`} className="font-mono font-bold text-indigo-700 text-xs bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                        {r.tracking_code}
                      </span>
                      <button onClick={() => copyCode(r.tracking_code)} data-testid={`copy-code-${r.id}`}
                        className="p-1 rounded hover:bg-slate-100 text-slate-500" title="Salin kode">
                        <Copy size={12}/>
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 italic">(belum di-set)</span>
                  )}
                </Td>
                <Td>{r.company_details || "-"}</Td>
                <Td className="font-mono text-xs">{r.npwp || "-"}</Td>
                <Td className="max-w-[240px] truncate" title={r.address}>{r.address || "-"}</Td>
                <Td className="text-right">
                  <button onClick={() => { setForm({ name: r.name, company_details: r.company_details || "", address: r.address || "", npwp: r.npwp || "", tracking_code: r.tracking_code || "", attn: r.attn || "", default_ppn_percentage: r.default_ppn_percentage ?? "" }); setEditId(r.id); setOpen(true); }}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600 ml-1">
                    <Trash2 size={14} />
                  </button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td className="text-slate-500 text-center py-8" colSpan={6}>Belum ada customer.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-customers"/>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl text-slate-900">{editId ? "Edit" : "Tambah"} Customer</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Nama *</label>
                <Input data-testid="customer-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">
                  Tracking Code <span className="text-slate-400 font-normal normal-case">— untuk website tracking customer</span>
                </label>
                <Input
                  data-testid="customer-tracking-code-input"
                  value={form.tracking_code}
                  onChange={(e) => setForm({ ...form, tracking_code: e.target.value.toUpperCase() })}
                  placeholder="Kosongkan untuk auto-generate (mis. ARC-BUDI-2024)"
                  className="font-mono"
                  maxLength={20}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Format: 6-20 karakter, hanya A-Z, 0-9, dan tanda hubung. Wajib unique. <b>Auto-generate</b> kalau dikosongkan.
                </p>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Detail Perusahaan</label>
                <Input value={form.company_details} onChange={(e) => setForm({ ...form, company_details: e.target.value })} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">NPWP</label>
                <Input value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Default PPN (%)</label>
                <Input data-testid="customer-default-ppn-input" type="number" step="0.01" value={form.default_ppn_percentage} onChange={(e) => setForm({ ...form, default_ppn_percentage: e.target.value })} placeholder="mis. 11 atau 1.1 — kosongkan jika tidak ada" />
                <p className="text-[11px] text-slate-500 mt-1">Dipakai sebagai PPN default saat input order & saat import massal (jika PPN AWB kosong).</p>
                {editId && (
                  <Button type="button" variant="secondary" data-testid="apply-default-ppn-btn" onClick={applyDefaultPpn} disabled={applyingPpn} className="mt-2 !bg-amber-50 !text-amber-900 hover:!bg-amber-100 !border-amber-300">
                    {applyingPpn ? "Menerapkan..." : "Terapkan Default PPN ke Semua AWB Customer Ini"}
                  </Button>
                )}
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Nama Attn</label>
                <Input data-testid="customer-attn-input" value={form.attn} onChange={(e) => setForm({ ...form, attn: e.target.value })} placeholder="Nama yang muncul di baris 'Attn' pada invoice" />
                <p className="text-[11px] text-slate-500 mt-1">Dipakai di baris <b>Attn</b> pada invoice cetak. Jika kosong, memakai nama consignee AWB.</p>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.08em] font-bold text-slate-500 mb-1.5">Alamat</label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
                <Button data-testid="save-customer-btn" type="submit">Simpan</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
