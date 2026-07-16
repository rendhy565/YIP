import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Edit2, PlayCircle, User, Users } from "lucide-react";
import { useAuth } from "../lib/auth";

const EMPTY_EMP = {
  full_name: "", nickname: "", tempat_lahir: "", tanggal_lahir: "",
  status_pernikahan: "", jenis_kelamin: "",
  no_hp: "", alamat_ktp: "", alamat_domisili: "", nik: "", no_kk: "", npwp: "", email: "",
  kendaraan_operasional: "", sim_c: "", sim_a: "", sim_lain: "",
  bank_type: "", bank_account: "",
  emergency1_name: "", emergency1_phone: "", emergency1_relation: "", emergency1_address: "",
  emergency2_name: "", emergency2_phone: "", emergency2_relation: "", emergency2_address: "",
  family: [],
  position: "", bpjs_no: "", base_salary: 0, allowance: 0, join_date: "", active: true,
};

export default function HrPayroll() {
  const { user } = useAuth();
  const [tab, setTab] = useState("employees");
  const [emps, setEmps] = useState([]);
  const [payrolls, setPayrolls] = useState([]);
  const [period, setPeriod] = useState(currentMonth());
  const [editing, setEditing] = useState(null);           // null | "new" | employee id (untuk modal)
  const [form, setForm] = useState({ ...EMPTY_EMP });
  const [cashAcc, setCashAcc] = useState("1101");
  const [cashAccounts, setCashAccounts] = useState([]);

  const loadEmps = () => api.get("/hr/employees").then((r) => setEmps(r.data));
  const loadPayrolls = () => api.get("/hr/payroll").then((r) => setPayrolls(r.data));
  useEffect(() => { loadEmps(); loadPayrolls(); api.get("/accounts", { params: { is_cash: true } }).then((r) => setCashAccounts(r.data)); }, []);

  const openNew = () => { setEditing("new"); setForm({ ...EMPTY_EMP }); };
  const openEdit = (e) => { setEditing(e.id); setForm({ ...EMPTY_EMP, ...e, family: e.family || [] }); };
  const save = async () => {
    if (!form.full_name?.trim()) return toast.error("Nama Lengkap wajib diisi");
    try {
      const payload = {
        ...form,
        base_salary: Number(form.base_salary || 0),
        allowance: Number(form.allowance || 0),
        family: (form.family || []).filter((f) => (f.nama || "").trim() || (f.hubungan || "").trim()),
      };
      if (editing === "new") await api.post("/hr/employees", payload);
      else await api.put(`/hr/employees/${editing}`, payload);
      toast.success("Tersimpan"); setEditing(null); loadEmps();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    if (!window.confirm("Hapus karyawan?")) return;
    try { await api.delete(`/hr/employees/${id}`); toast.success("Dihapus"); loadEmps(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  // Family list helpers
  const addFamily = () => setForm({ ...form, family: [...(form.family || []), { hubungan: "", nama: "", alamat: "", no_hp: "", no_ktp: "" }] });
  const setFamily = (i, patch) => setForm({ ...form, family: form.family.map((f, idx) => idx === i ? { ...f, ...patch } : f) });
  const delFamily = (i) => setForm({ ...form, family: form.family.filter((_, idx) => idx !== i) });
  const runPayroll = async () => {
    if (!window.confirm(`Jalankan payroll bulan ${period}? Akan auto-posting jurnal beban gaji.`)) return;
    try { await api.post("/hr/payroll/run", { period_month: period, cash_account_code: cashAcc }); toast.success("Payroll dijalankan"); loadPayrolls(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const delPayroll = async (id) => {
    if (!window.confirm("Hapus batch payroll? Jurnal terkait juga akan dihapus.")) return;
    try { await api.delete(`/hr/payroll/${id}`); toast.success("Dihapus"); loadPayrolls(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="hr-page">
      <PageHeader title="HR & Payroll" subtitle="Master karyawan dan penggajian bulanan (auto-jurnal beban gaji 6101, PPh21 ke 2220)." />

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button data-testid="hr-tab-employees" onClick={() => setTab("employees")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "employees" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>Karyawan</button>
        <button data-testid="hr-tab-payroll" onClick={() => setTab("payroll")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "payroll" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>Payroll</button>
      </div>

      {tab === "employees" && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold">Master Karyawan</h3>
            <Button data-testid="hr-emp-add" onClick={openNew}><Plus size={14}/> Tambah</Button>
          </div>
          <Table>
            <thead><tr><Th>Nama Lengkap</Th><Th>Panggilan</Th><Th>No. HP</Th><Th>Posisi</Th><Th>Bank</Th><Th className="text-right">Gaji Pokok</Th><Th>Status</Th><Th className="text-right">Aksi</Th></tr></thead>
            <tbody>
              {emps.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-400 py-6">Belum ada karyawan</Td></tr>}
              {emps.map((e) => (
                <tr key={e.id}>
                  <Td className="font-bold">{e.full_name}</Td>
                  <Td>{e.nickname || "-"}</Td>
                  <Td className="font-mono text-xs">{e.no_hp || "-"}</Td>
                  <Td>{e.position || "-"}</Td>
                  <Td className="text-xs">{e.bank_type ? `${e.bank_type} ${e.bank_account || ""}` : "-"}</Td>
                  <Td className="text-right font-mono">{fmtIDR(e.base_salary)}</Td>
                  <Td><span className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold ${e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{e.active ? "Aktif" : "Nonaktif"}</span></Td>
                  <Td className="text-right"><div className="flex gap-1 justify-end"><Button data-testid={`hr-emp-edit-${e.id}`} variant="secondary" onClick={() => openEdit(e)}><Edit2 size={13}/></Button><Button variant="danger" onClick={() => del(e.id)}><Trash2 size={13}/></Button></div></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ========== EMPLOYEE MODAL — Full form (sesuai Form Data Karyawan AR) ========== */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" data-testid="hr-emp-modal">
          <Card className="w-full max-w-4xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-heading font-bold text-lg inline-flex items-center gap-2">
                <User size={18} className="text-blue-700"/>
                {editing === "new" ? "Tambah Karyawan" : "Edit Karyawan"}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* --- SECTION: Identitas --- */}
              <div>
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Identitas</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><Label>Nama Lengkap *</Label><Input data-testid="emp-full-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required/></div>
                  <div><Label>Nama Panggilan</Label><Input data-testid="emp-nickname" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })}/></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir} onChange={(e) => setForm({ ...form, tempat_lahir: e.target.value })}/></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir} onChange={(e) => setForm({ ...form, tanggal_lahir: e.target.value })}/></div>
                  <div><Label>Status Pernikahan</Label>
                    <Select value={form.status_pernikahan} onChange={(e) => setForm({ ...form, status_pernikahan: e.target.value })}>
                      <option value="">— Pilih —</option>
                      <option value="Lajang">Lajang</option>
                      <option value="Menikah">Menikah</option>
                      <option value="Cerai Hidup">Cerai Hidup</option>
                      <option value="Cerai Mati">Cerai Mati</option>
                    </Select>
                  </div>
                  <div><Label>Jenis Kelamin</Label>
                    <Select value={form.jenis_kelamin} onChange={(e) => setForm({ ...form, jenis_kelamin: e.target.value })}>
                      <option value="">— Pilih —</option>
                      <option value="L">Laki-laki</option>
                      <option value="P">Perempuan</option>
                    </Select>
                  </div>
                </div>
              </div>

              {/* --- SECTION: Kontak & Legal --- */}
              <div>
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Kontak &amp; Legal</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><Label>No. HP Aktif</Label><Input value={form.no_hp} onChange={(e) => setForm({ ...form, no_hp: e.target.value })} placeholder="0812-xxxx-xxxx"/></div>
                  <div><Label>Email Aktif</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></div>
                  <div className="md:col-span-2"><Label>Alamat KTP</Label><Input value={form.alamat_ktp} onChange={(e) => setForm({ ...form, alamat_ktp: e.target.value })}/></div>
                  <div className="md:col-span-2"><Label>Alamat Domisili</Label><Input value={form.alamat_domisili} onChange={(e) => setForm({ ...form, alamat_domisili: e.target.value })}/></div>
                  <div><Label>No. KTP</Label><Input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })}/></div>
                  <div><Label>No. KK</Label><Input value={form.no_kk} onChange={(e) => setForm({ ...form, no_kk: e.target.value })}/></div>
                  <div><Label>No. NPWP</Label><Input value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })}/></div>
                </div>
              </div>

              {/* --- SECTION: Logistik & Finansial --- */}
              <div>
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Logistik &amp; Finansial</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><Label>Kendaraan Operasional</Label><Input value={form.kendaraan_operasional} onChange={(e) => setForm({ ...form, kendaraan_operasional: e.target.value })} placeholder="Mis. Motor B 1234 XYZ"/></div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>SIM C</Label><Input value={form.sim_c} onChange={(e) => setForm({ ...form, sim_c: e.target.value })} placeholder="No. SIM"/></div>
                    <div><Label>SIM A</Label><Input value={form.sim_a} onChange={(e) => setForm({ ...form, sim_a: e.target.value })} placeholder="No. SIM"/></div>
                    <div><Label>SIM Lain</Label><Input value={form.sim_lain} onChange={(e) => setForm({ ...form, sim_lain: e.target.value })} placeholder="Jenis / No."/></div>
                  </div>
                  <div><Label>Bank</Label>
                    <Select value={form.bank_type} onChange={(e) => setForm({ ...form, bank_type: e.target.value })}>
                      <option value="">— Pilih Bank —</option>
                      <option value="BCA">BCA</option>
                      <option value="Mandiri">Mandiri</option>
                      <option value="BNI">BNI</option>
                      <option value="BRI">BRI</option>
                      <option value="Lainnya">Lainnya</option>
                    </Select>
                  </div>
                  <div><Label>No. Rekening</Label><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })}/></div>
                </div>
              </div>

              {/* --- SECTION: Kontak Darurat --- */}
              <div>
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Kontak Darurat</h4>
                <div className="rounded border border-slate-200 p-3 mb-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Kontak Darurat 1</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
                    <div><Label>Nama</Label><Input data-testid="emp-emergency1-name" value={form.emergency1_name} onChange={(e) => setForm({ ...form, emergency1_name: e.target.value })}/></div>
                    <div><Label>No. HP</Label><Input value={form.emergency1_phone} onChange={(e) => setForm({ ...form, emergency1_phone: e.target.value })}/></div>
                    <div><Label>Hubungan</Label><Input value={form.emergency1_relation} onChange={(e) => setForm({ ...form, emergency1_relation: e.target.value })} placeholder="Mis. Bapak, Kakak"/></div>
                  </div>
                  <div><Label>Alamat KTP</Label><Input data-testid="emp-emergency1-address" value={form.emergency1_address} onChange={(e) => setForm({ ...form, emergency1_address: e.target.value })}/></div>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Kontak Darurat 2</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
                    <div><Label>Nama</Label><Input data-testid="emp-emergency2-name" value={form.emergency2_name} onChange={(e) => setForm({ ...form, emergency2_name: e.target.value })}/></div>
                    <div><Label>No. HP</Label><Input value={form.emergency2_phone} onChange={(e) => setForm({ ...form, emergency2_phone: e.target.value })}/></div>
                    <div><Label>Hubungan</Label><Input value={form.emergency2_relation} onChange={(e) => setForm({ ...form, emergency2_relation: e.target.value })}/></div>
                  </div>
                  <div><Label>Alamat KTP</Label><Input data-testid="emp-emergency2-address" value={form.emergency2_address} onChange={(e) => setForm({ ...form, emergency2_address: e.target.value })}/></div>
                </div>
              </div>

              {/* --- SECTION: Data Keluarga --- */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 inline-flex items-center gap-1.5"><Users size={12}/> Data Keluarga</h4>
                  <Button data-testid="emp-add-family" variant="secondary" onClick={addFamily}><Plus size={12}/> Tambah Anggota</Button>
                </div>
                {(!form.family || form.family.length === 0) && <div className="text-xs text-slate-400 italic py-2">Belum ada anggota keluarga. Klik &quot;Tambah Anggota&quot;.</div>}
                {form.family && form.family.length > 0 && (
                  <Table>
                    <thead><tr><Th>Hubungan</Th><Th>Nama</Th><Th>Alamat</Th><Th>No. HP</Th><Th>No. KTP</Th><Th></Th></tr></thead>
                    <tbody>
                      {form.family.map((f, i) => (
                        <tr key={i}>
                          <Td><Input value={f.hubungan || ""} onChange={(e) => setFamily(i, { hubungan: e.target.value })} placeholder="Mis. Istri / Anak"/></Td>
                          <Td><Input value={f.nama || ""} onChange={(e) => setFamily(i, { nama: e.target.value })}/></Td>
                          <Td><Input value={f.alamat || ""} onChange={(e) => setFamily(i, { alamat: e.target.value })}/></Td>
                          <Td><Input value={f.no_hp || ""} onChange={(e) => setFamily(i, { no_hp: e.target.value })}/></Td>
                          <Td><Input value={f.no_ktp || ""} onChange={(e) => setFamily(i, { no_ktp: e.target.value })}/></Td>
                          <Td><button type="button" onClick={() => delFamily(i)} className="text-rose-600 hover:text-rose-800 p-1"><Trash2 size={13}/></button></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>

              {/* --- SECTION: Kepegawaian --- */}
              <div>
                <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Kepegawaian</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>Posisi / Jabatan</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}/></div>
                  <div><Label>No. BPJS</Label><Input value={form.bpjs_no} onChange={(e) => setForm({ ...form, bpjs_no: e.target.value })}/></div>
                  <div><Label>Tanggal Bergabung</Label><Input type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })}/></div>
                  <div><Label>Gaji Pokok (IDR)</Label><Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })}/></div>
                  <div><Label>Tunjangan (IDR)</Label><Input type="number" value={form.allowance} onChange={(e) => setForm({ ...form, allowance: e.target.value })}/></div>
                  <div><Label>Status</Label>
                    <Select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                      <option value="1">Aktif</option>
                      <option value="0">Nonaktif</option>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <Button variant="ghost" onClick={() => setEditing(null)}><X size={14}/> Batal</Button>
              <Button data-testid="hr-emp-save-btn" variant="success" onClick={save}><Save size={14}/> Simpan</Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "payroll" && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end justify-between gap-2">
            <h3 className="font-bold">Payroll Batch</h3>
            <div className="flex items-end gap-2">
              <div><Label>Periode</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40"/></div>
              <div><Label>Bayar dari</Label>
                <Select value={cashAcc} onChange={(e) => setCashAcc(e.target.value)} className="w-48">
                  {cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </Select>
              </div>
              <Button data-testid="hr-run-payroll" variant="success" onClick={runPayroll}><PlayCircle size={14}/> Jalankan</Button>
            </div>
          </div>
          {payrolls.length === 0 && <div className="p-6 text-center text-slate-400">Belum ada payroll dijalankan</div>}
          {payrolls.map((p) => (
            <div key={p.id} className="border-b border-slate-200 last:border-0">
              <div className="px-4 py-3 bg-slate-50 flex justify-between items-center">
                <div><div className="font-bold">Periode {p.period_month}</div><div className="text-xs text-slate-500">{(p.slips || []).length} slip · Total: {fmtIDR(p.total_gross)}</div></div>
                <Button variant="danger" onClick={() => delPayroll(p.id)}><Trash2 size={13}/></Button>
              </div>
              <Table>
                <thead><tr><Th>Karyawan</Th><Th>Posisi</Th><Th className="text-right">Gaji Pokok</Th><Th className="text-right">Tunjangan</Th><Th className="text-right">Gross</Th><Th className="text-right">PPh21</Th><Th className="text-right">Net</Th></tr></thead>
                <tbody>
                  {(p.slips || []).map((s, i) => (
                    <tr key={i}>
                      <Td>{s.employee_name}</Td>
                      <Td className="text-xs">{s.position || "-"}</Td>
                      <Td className="text-right font-mono">{fmtIDR(s.base_salary)}</Td>
                      <Td className="text-right font-mono">{fmtIDR(s.allowance)}</Td>
                      <Td className="text-right font-mono">{fmtIDR(s.gross)}</Td>
                      <Td className="text-right font-mono text-rose-700">{fmtIDR(s.pph21)}</Td>
                      <Td className="text-right font-mono font-bold">{fmtIDR(s.net)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
