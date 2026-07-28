import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Edit2, PlayCircle, User, Users, Settings, Eye, FileSpreadsheet } from "lucide-react";
import { useAuth } from "../lib/auth";

const EMPTY_EMP = {
  employee_no: "",
  full_name: "", nickname: "", tempat_lahir: "", tanggal_lahir: "",
  status_pernikahan: "", jenis_kelamin: "",
  no_hp: "", alamat_ktp: "", alamat_domisili: "", nik: "", no_kk: "", npwp: "", email: "",
  kendaraan_operasional: "", sim_c: "", sim_a: "", sim_lain: "",
  bank_type: "", bank_account: "",
  emergency1_name: "", emergency1_phone: "", emergency1_relation: "", emergency1_address: "",
  emergency2_name: "", emergency2_phone: "", emergency2_relation: "", emergency2_address: "",
  family: [],
  position: "", bpjs_no: "", base_salary: 0, allowance: 0, meal_allowance: 0, gaji_lumpsum: false, join_date: "", active: true,
};

// Kolom yang bisa toggle di table karyawan (fixed cols not in this list)
const TOGGLABLE_COLS = [
  { key: "employee_no", label: "ID Karyawan" },
  { key: "gaji_lumpsum", label: "Lumpsum" },
  { key: "nickname", label: "Nama Panggilan" },
  { key: "tanggal_lahir", label: "Tanggal Lahir" },
  { key: "jenis_kelamin", label: "Jenis Kelamin" },
  { key: "status_pernikahan", label: "Status Pernikahan" },
  { key: "no_hp", label: "No. HP" },
  { key: "email", label: "Email" },
  { key: "alamat_ktp", label: "Alamat KTP" },
  { key: "alamat_domisili", label: "Alamat Domisili" },
  { key: "nik", label: "No. KTP (NIK)" },
  { key: "npwp", label: "NPWP" },
  { key: "kendaraan_operasional", label: "Kendaraan" },
  { key: "sim", label: "SIM (A/C/Lain)" },
  { key: "bank", label: "Bank & Rekening" },
  { key: "bpjs_no", label: "BPJS No." },
  { key: "join_date", label: "Tanggal Masuk" },
  { key: "meal_allowance", label: "Uang Makan/Hari" },
  { key: "allowance", label: "Tunjangan Lain" },
];

const DEFAULT_VISIBLE_COLS = ["employee_no", "nickname", "no_hp", "bank"];

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
  // Kolom visibility toggle (persisted in localStorage)
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem("arc-hr-emp-cols");
      return saved ? JSON.parse(saved) : DEFAULT_VISIBLE_COLS;
    } catch { return DEFAULT_VISIBLE_COLS; }
  });
  const [showColSettings, setShowColSettings] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("arc-hr-emp-cols", JSON.stringify(visibleCols)); } catch { /* ignore */ }
  }, [visibleCols]);
  const toggleCol = (key) => {
    setVisibleCols((v) => v.includes(key) ? v.filter((k) => k !== key) : [...v, key]);
  };

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
        meal_allowance: Number(form.meal_allowance || 0),
        gaji_lumpsum: !!form.gaji_lumpsum,
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
    if (!window.confirm(`Jalankan payroll periode ${period}? Akan auto-posting jurnal beban gaji.`)) return;
    try { await api.post("/hr/payroll/run", { period_month: period, cash_account_code: cashAcc }); toast.success("Payroll dijalankan"); setSim(null); loadPayrolls(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  // ---- SIMULATE payroll (read-only preview) ----
  const [sim, setSim] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const simulate = async () => {
    setSimLoading(true);
    setSim(null);
    try {
      const r = await api.post("/hr/payroll/simulate", { period_month: period });
      setSim(r.data);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSimLoading(false); }
  };
  const runFromSim = async () => {
    if (!sim) return;
    if (sim.already_executed) { toast.error(`Payroll periode ${period} sudah dijalankan sebelumnya`); return; }
    if (!window.confirm(`Konfirmasi jalankan payroll ${period}?\nTotal ${sim.slips.length} karyawan, gross ${sim.total_gross.toLocaleString("id-ID")}. Akan auto-posting jurnal beban gaji.`)) return;
    try {
      await api.post("/hr/payroll/run", { period_month: period, cash_account_code: cashAcc });
      toast.success("Payroll dijalankan & jurnal ter-post");
      setSim(null);
      loadPayrolls();
    } catch (e) { toast.error(errMsg(e)); }
  };
  // ---- Export Simulasi ke Excel ----
  const exportSimToExcel = () => {
    if (!sim) return;
    const header = [
      "No", "ID Karyawan", "Nama Karyawan", "Posisi", "Lumpsum",
      "Hari Kerja", "Hadir", "Sakit", "Izin", "Alfa (Total)", "Alfa (Manual)", "Missing (→ Alfa)",
      "Gaji Pokok", "Potongan Alfa", "Gaji Pokok Bersih",
      "Uang Makan/Hari", "Uang Makan Total",
      "Lembur (Jam)", "Lembur Total",
      "Gross (Net)",
    ];
    const rows = sim.slips.map((s, i) => [
      i + 1,
      s.employee_no || "",
      s.employee_name,
      s.position || "",
      s.gaji_lumpsum ? "YA" : "",
      s.working_days,
      s.hari_hadir,
      s.hari_sakit,
      s.hari_izin,
      s.hari_alfa,
      s.hari_alfa_manual ?? "",
      s.hari_missing_treated_alfa ?? 0,
      s.base_salary,
      s.deduction_alfa,
      s.gaji_pokok_net,
      s.meal_allowance_per_day,
      s.uang_makan,
      s.lembur_jam || 0,
      s.lembur_total || 0,
      s.gross,
    ]);
    // Total row
    const sum = (k) => sim.slips.reduce((a, s) => a + (Number(s[k]) || 0), 0);
    rows.push([
      "", "", "TOTAL", "", "", "", "", "", "", "", "", "",
      sum("base_salary"), sum("deduction_alfa"), sum("gaji_pokok_net"),
      "", sum("uang_makan"),
      sum("lembur_jam"), sum("lembur_total"),
      sim.total_gross,
    ]);
    // Sheet 1: Slips
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = [
      { wch: 4 }, { wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 9 },
      { wch: 8 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 14 },
      { wch: 10 }, { wch: 14 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Slip Payroll");
    // Sheet 2: Meta
    const meta = [
      ["SIMULASI PAYROLL — PREVIEW"],
      [""],
      ["Periode", period],
      ["Range Absensi", `${sim.period_start}  →  ${sim.period_end}`],
      ["Hari Kerja", sim.working_days],
      ["Jumlah Karyawan", sim.slips.length],
      ["Total Gross", sim.total_gross],
      ["Sudah Dijalankan?", sim.already_executed ? "YA (sudah ada payroll periode ini di DB)" : "Belum"],
      ["Waktu Simulasi", sim.simulated_at || new Date().toISOString()],
      [""],
      ["Catatan:", "File ini adalah PREVIEW — belum diposting ke jurnal akuntansi."],
      ["", "Untuk finalize: buka aplikasi → HR Payroll → klik Konfirmasi Jalankan."],
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(meta);
    wsMeta["!cols"] = [{ wch: 22 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, "Info");
    XLSX.writeFile(wb, `simulasi-payroll-${period}.xlsx`);
    toast.success("File Excel simulasi ter-download");
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
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowColSettings(true)} data-testid="hr-col-settings"><Settings size={14}/> Kolom</Button>
              <Button data-testid="hr-emp-add" onClick={openNew}><Plus size={14}/> Tambah</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
          <Table>
            <thead><tr>
              <Th>Nama Lengkap</Th>
              {visibleCols.map((k) => {
                const c = TOGGLABLE_COLS.find((x) => x.key === k);
                return c ? <Th key={k}>{c.label}</Th> : null;
              })}
              <Th>Posisi</Th>
              <Th className="text-right">Gaji Pokok</Th>
              <Th>Status</Th>
              <Th className="text-right">Aksi</Th>
            </tr></thead>
            <tbody>
              {emps.length === 0 && <tr><Td colSpan={4 + visibleCols.length} className="text-center text-slate-400 py-6">Belum ada karyawan</Td></tr>}
              {emps.map((e) => (
                <tr key={e.id}>
                  <Td className="font-bold">{e.full_name}</Td>
                  {visibleCols.map((k) => {
                    let content = "-";
                    if (k === "sim") {
                      const parts = [e.sim_a && `A:${e.sim_a}`, e.sim_c && `C:${e.sim_c}`, e.sim_lain && `Lain:${e.sim_lain}`].filter(Boolean);
                      content = parts.length ? parts.join(" ") : "-";
                    } else if (k === "bank") {
                      content = e.bank_type ? `${e.bank_type} ${e.bank_account || ""}` : "-";
                    } else if (k === "meal_allowance" || k === "allowance") {
                      content = e[k] ? fmtIDR(e[k]) : "-";
                    } else if (k === "jenis_kelamin") {
                      content = e[k] === "L" ? "Laki-laki" : e[k] === "P" ? "Perempuan" : "-";
                    } else if (k === "gaji_lumpsum") {
                      content = e.gaji_lumpsum
                        ? <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">LUMPSUM</span>
                        : "-";
                    } else {
                      content = e[k] || "-";
                    }
                    const isMono = ["no_hp", "nik", "npwp", "bpjs_no"].includes(k);
                    return <Td key={k} className={`text-xs${isMono ? " font-mono" : ""}`}>{content}</Td>;
                  })}
                  <Td>{e.position || "-"}</Td>
                  <Td className="text-right font-mono">{fmtIDR(e.base_salary)}</Td>
                  <Td><span className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold ${e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{e.active ? "Aktif" : "Nonaktif"}</span></Td>
                  <Td className="text-right"><div className="flex gap-1 justify-end"><Button data-testid={`hr-emp-edit-${e.id}`} variant="secondary" onClick={() => openEdit(e)}><Edit2 size={13}/></Button><Button variant="danger" onClick={() => del(e.id)}><Trash2 size={13}/></Button></div></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          </div>
        </Card>
      )}

      {/* ========== COLUMN VISIBILITY MODAL ========== */}
      {showColSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" data-testid="hr-col-modal">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-heading font-bold text-lg">Atur Kolom Tabel</h3>
              <button type="button" onClick={() => setShowColSettings(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="p-5 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-slate-500 mb-3">Kolom <b>Nama, Posisi, Gaji Pokok, Status, Aksi</b> selalu tampil. Pilih kolom tambahan yang ingin ditampilkan:</p>
              <div className="space-y-2">
                {TOGGLABLE_COLS.map((c) => (
                  <label key={c.key} className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm ${visibleCols.includes(c.key) ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50 border border-slate-200"}`}>
                    <input
                      type="checkbox"
                      data-testid={`col-toggle-${c.key}`}
                      checked={visibleCols.includes(c.key)}
                      onChange={() => toggleCol(c.key)}
                    />
                    <span className="font-medium">{c.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between">
                <Button variant="secondary" onClick={() => setVisibleCols(DEFAULT_VISIBLE_COLS)}>Reset Default</Button>
                <Button onClick={() => setShowColSettings(false)}>Selesai</Button>
              </div>
            </div>
          </Card>
        </div>
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
                  <div><Label>ID Karyawan / No. Pegawai</Label><Input data-testid="emp-employee-no" value={form.employee_no} onChange={(e) => setForm({ ...form, employee_no: e.target.value })} placeholder="Mis. EMP-001 (opsional)"/></div>
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
                  <div><Label>Uang Makan / Hari (IDR)</Label><Input type="number" value={form.meal_allowance} onChange={(e) => setForm({ ...form, meal_allowance: e.target.value })} placeholder="Mis. 25000"/></div>
                  <div><Label>Tunjangan Lain (IDR)</Label><Input type="number" value={form.allowance} onChange={(e) => setForm({ ...form, allowance: e.target.value })}/></div>
                  <div><Label>Status</Label>
                    <Select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                      <option value="1">Aktif</option>
                      <option value="0">Nonaktif</option>
                    </Select>
                  </div>
                </div>
                {/* Override Gaji Lumpsum */}
                <div className="mt-3 border border-amber-200 rounded p-3 bg-amber-50/60">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      data-testid="emp-gaji-lumpsum"
                      checked={!!form.gaji_lumpsum}
                      onChange={(e) => setForm({ ...form, gaji_lumpsum: e.target.checked })}
                    />
                    <span className="text-sm">
                      <b className="text-amber-900">💰 Gaji Lumpsum</b>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Kalau dicentang, <b>Gaji Pokok tidak dipotong</b> meskipun ada Alfa/absen kosong.
                        Uang Makan & Lembur tetap dihitung sesuai kehadiran.
                        Cocok untuk direksi, kontraktor, atau posisi dengan gaji tetap.
                      </div>
                    </span>
                  </label>
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
            <div className="flex items-end gap-2 flex-wrap">
              <div><Label>Periode</Label><Input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setSim(null); }} className="w-40"/></div>
              <div><Label>Bayar dari</Label>
                <Select value={cashAcc} onChange={(e) => setCashAcc(e.target.value)} className="w-48">
                  {cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                </Select>
              </div>
              <Button data-testid="hr-simulate-payroll" variant="secondary" onClick={simulate} disabled={simLoading}>
                <Eye size={14}/> {simLoading ? "Menghitung..." : "Simulasi"}
              </Button>
              <Button data-testid="hr-run-payroll" variant="success" onClick={runPayroll}><PlayCircle size={14}/> Jalankan</Button>
            </div>
          </div>

          {/* Simulation Preview Panel */}
          {sim && (
            <div className="border-b-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50" data-testid="sim-preview">
              <div className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <div className="font-bold text-blue-900 flex items-center gap-2"><Eye size={16}/> Simulasi Payroll — Preview (belum diposting)</div>
                  <div className="text-xs text-slate-600 mt-1">
                    Periode: <span className="font-mono font-bold">{sim.period_start} → {sim.period_end}</span>
                    {" · "}Hari kerja: <b>{sim.working_days}</b>
                    {" · "}Karyawan: <b>{sim.slips.length}</b>
                    {" · "}Total gross: <b>{fmtIDR(sim.total_gross)}</b>
                  </div>
                  {sim.already_executed && (
                    <div className="text-xs text-rose-700 font-bold mt-1">⚠️ Periode ini SUDAH pernah dijalankan. Hapus dulu payroll lama sebelum re-run.</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setSim(null)}><X size={13}/> Tutup Preview</Button>
                  <Button variant="secondary" onClick={exportSimToExcel} data-testid="sim-export-excel">
                    <FileSpreadsheet size={14}/> Export Excel
                  </Button>
                  <Button variant="success" onClick={runFromSim} disabled={sim.already_executed} data-testid="sim-confirm-run">
                    <PlayCircle size={14}/> Konfirmasi Jalankan
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <thead><tr>
                    <Th>Karyawan</Th>
                    <Th>Posisi</Th>
                    <Th className="text-right">Hadir/Kerja</Th>
                    <Th className="text-right">Sakit/Izin/Alfa</Th>
                    <Th className="text-right">Gaji Pokok</Th>
                    <Th className="text-right">Uang Makan</Th>
                    <Th className="text-right">Lembur</Th>
                    <Th className="text-right">Gross (Net)</Th>
                  </tr></thead>
                  <tbody>
                    {sim.slips.map((s, i) => (
                      <tr key={i} className="hover:bg-white/60">
                        <Td>
                          {s.employee_name}
                          {s.employee_no && <div className="text-[10px] text-slate-500 font-mono">{s.employee_no}</div>}
                          {s.gaji_lumpsum && <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold" title="Gaji Pokok tidak dipotong Alfa">LUMPSUM</span>}
                        </Td>
                        <Td className="text-xs">{s.position || "-"}</Td>
                        <Td className="text-right font-mono text-xs">{s.hari_hadir}/{s.working_days}</Td>
                        <Td className="text-right font-mono text-xs">
                          {s.hari_sakit}/{s.hari_izin}/{s.hari_alfa}
                          {(s.hari_missing_treated_alfa || 0) > 0 && (
                            <div className="text-[9px] text-amber-700" title="Hari kerja tanpa record → dianggap Alfa">
                              +{s.hari_missing_treated_alfa} missing
                            </div>
                          )}
                        </Td>
                        <Td className="text-right font-mono">
                          {fmtIDR(s.gaji_pokok_net)}
                          {s.deduction_alfa > 0 && <div className="text-[9px] text-rose-600">-{fmtIDR(s.deduction_alfa)} alfa</div>}
                        </Td>
                        <Td className="text-right font-mono">{fmtIDR(s.uang_makan)}</Td>
                        <Td className="text-right font-mono">
                          {(s.lembur_total || 0) > 0
                            ? <span>{fmtIDR(s.lembur_total)}<div className="text-[9px] text-slate-500">{s.lembur_jam}j</div></span>
                            : <span className="text-slate-400">-</span>}
                        </Td>
                        <Td className="text-right font-mono font-bold">{fmtIDR(s.gross)}</Td>
                      </tr>
                    ))}
                    <tr className="bg-blue-100 font-bold">
                      <Td colSpan={7} className="text-right">TOTAL GROSS</Td>
                      <Td className="text-right font-mono">{fmtIDR(sim.total_gross)}</Td>
                    </tr>
                  </tbody>
                </Table>
              </div>
              <div className="px-4 py-2 text-[10px] text-slate-500 italic border-t border-blue-200">
                💡 Simulasi ini <b>tidak menyentuh database</b>. Ubah absensi/master karyawan lalu klik Simulasi lagi untuk refresh. Klik <b>Konfirmasi Jalankan</b> saat sudah OK.
              </div>
            </div>
          )}
          {payrolls.length === 0 && <div className="p-6 text-center text-slate-400">Belum ada payroll dijalankan</div>}
          {payrolls.map((p) => (
            <div key={p.id} className="border-b border-slate-200 last:border-0">
              <div className="px-4 py-3 bg-slate-50 flex justify-between items-center">
                <div><div className="font-bold">Periode {p.period_month}</div><div className="text-xs text-slate-500">{(p.slips || []).length} slip · Total: {fmtIDR(p.total_gross)}</div></div>
                <Button variant="danger" onClick={() => delPayroll(p.id)}><Trash2 size={13}/></Button>
              </div>
              <Table>
                <thead><tr>
                  <Th>Karyawan</Th>
                  <Th>Posisi</Th>
                  <Th className="text-right">Hadir/Kerja</Th>
                  <Th className="text-right">Gaji Pokok</Th>
                  <Th className="text-right">Uang Makan</Th>
                  <Th className="text-right">Lembur</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Net</Th>
                </tr></thead>
                <tbody>
                  {(p.slips || []).map((s, i) => (
                    <tr key={i}>
                      <Td>{s.employee_name}{s.employee_no ? <div className="text-[10px] text-slate-500 font-mono">{s.employee_no}</div> : null}</Td>
                      <Td className="text-xs">{s.position || "-"}</Td>
                      <Td className="text-right font-mono text-xs">{s.hari_hadir || 0}/{s.working_days || 0}</Td>
                      <Td className="text-right font-mono">{fmtIDR(s.gaji_pokok_net != null ? s.gaji_pokok_net : s.base_salary)}</Td>
                      <Td className="text-right font-mono">{fmtIDR(s.uang_makan || 0)}</Td>
                      <Td className="text-right font-mono">
                        {(s.lembur_total || 0) > 0 ? (
                          <span>{fmtIDR(s.lembur_total)}<div className="text-[10px] text-slate-500">{s.lembur_jam}j</div></span>
                        ) : "-"}
                      </Td>
                      <Td className="text-right font-mono">{fmtIDR(s.gross)}</Td>
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
