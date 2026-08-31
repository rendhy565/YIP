import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { FileSignature, Printer, Plus, Pencil, Trash2, X, ChevronDown, ChevronRight } from "lucide-react";
import ContractPrint from "../components/ContractPrint";
import NumberInput from "../components/NumberInput";

// Terbilang Rupiah (Indonesian number-to-words) — hasil bisa diedit user
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  const sat = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  const w = (x) => {
    if (x < 12) return sat[x];
    if (x < 20) return w(x - 10) + " belas";
    if (x < 100) return w(Math.floor(x / 10)) + " puluh" + (x % 10 ? " " + w(x % 10) : "");
    if (x < 200) return "seratus" + (x % 100 ? " " + w(x % 100) : "");
    if (x < 1000) return w(Math.floor(x / 100)) + " ratus" + (x % 100 ? " " + w(x % 100) : "");
    if (x < 2000) return "seribu" + (x % 1000 ? " " + w(x % 1000) : "");
    if (x < 1000000) return w(Math.floor(x / 1000)) + " ribu" + (x % 1000 ? " " + w(x % 1000) : "");
    if (x < 1000000000) return w(Math.floor(x / 1000000)) + " juta" + (x % 1000000 ? " " + w(x % 1000000) : "");
    if (x < 1000000000000) return w(Math.floor(x / 1000000000)) + " miliar" + (x % 1000000000 ? " " + w(x % 1000000000) : "");
    return w(Math.floor(x / 1000000000000)) + " triliun" + (x % 1000000000000 ? " " + w(x % 1000000000000) : "");
  };
  if (n === 0) return "Nol Rupiah";
  const s = w(n).replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + " Rupiah";
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "signed_user", label: "Signed User" },
  { value: "signed_direktur", label: "Signed Direktur" },
  { value: "signed_employee", label: "Signed Employee" },
  { value: "copied", label: "Copied" },
  { value: "archived", label: "Archived" },
];
const STATUS_LABEL = STATUS_OPTIONS.reduce((a, o) => ({ ...a, [o.value]: o.label }), {});
const STATUS_BADGE = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  signed_user: "bg-amber-50 text-amber-800 border-amber-200",
  signed_direktur: "bg-blue-50 text-blue-800 border-blue-200",
  signed_employee: "bg-indigo-50 text-indigo-800 border-indigo-200",
  copied: "bg-violet-50 text-violet-800 border-violet-200",
  archived: "bg-zinc-200 text-zinc-700 border-zinc-300",
  // legacy
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  expired: "bg-rose-50 text-rose-800 border-rose-200",
};

const blankForm = (employee_id = "") => ({
  employee_id,
  contract_no: "",
  contract_type: "PKWT",
  sign_place: "Kota Bekasi",
  sign_date: "",
  company_name: "PT. Abirama Mitra Pratama",
  rep_name: "",
  rep_position: "Direktur Utama",
  rep_address: "",
  emp_name: "",
  emp_ktp: "",
  emp_birth_place: "",
  emp_birth_date: "",
  emp_address: "",
  position: "",
  placement: "kantor operasional PT. Abirama Mitra Pratama wilayah Kota Bekasi",
  duration_text: "satu tahun",
  start_date: "",
  end_date: "",
  work_days_text: "6 (enam) hari kerja dalam 1 (satu) minggu",
  gaji_pokok: "",
  gaji_pokok_words: "",
  uang_makan: "",
  uang_makan_words: "",
  signer2_title: "Karyawan",
  notes: "",
  status: "draft",
});

export default function KontrakKerja() {
  const [rows, setRows] = useState([]); // [{employee, contracts, latest}]
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // contract id (null = create)
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [printData, setPrintData] = useState(null); // {contract, employee}
  const [expandedId, setExpandedId] = useState(null); // employee id for riwayat

  const load = () => {
    setLoading(true);
    api.get("/hr/contracts")
      .then((r) => setRows(r.data || []))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Buat kontrak baru untuk employee — prefill identitas dari master (boleh diubah)
  const openCreate = (emp) => {
    const f = blankForm(emp.id);
    f.emp_name = emp.full_name || "";
    f.emp_ktp = emp.nik || "";
    f.emp_birth_place = emp.tempat_lahir || "";
    f.emp_birth_date = emp.tanggal_lahir || "";
    f.emp_address = emp.alamat_ktp || emp.alamat_domisili || "";
    f.position = emp.position || "";
    f.gaji_pokok = emp.base_salary || "";
    f.gaji_pokok_words = emp.base_salary ? terbilang(emp.base_salary) : "";
    f.uang_makan = emp.meal_allowance || "";
    f.uang_makan_words = emp.meal_allowance ? terbilang(emp.meal_allowance) : "";
    setForm(f);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (contract) => {
    setForm({ ...blankForm(contract.employee_id), ...contract, gaji_pokok: contract.gaji_pokok ?? "", uang_makan: contract.uang_makan ?? "" });
    setEditingId(contract.id);
    setShowForm(true);
  };

  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const onGajiChange = (v) => setForm((s) => ({ ...s, gaji_pokok: v, gaji_pokok_words: v ? terbilang(v) : "" }));
  const onMakanChange = (v) => setForm((s) => ({ ...s, uang_makan: v, uang_makan_words: v ? terbilang(v) : "" }));

  const save = async () => {
    if (!form.employee_id) { toast.error("Karyawan tidak valid"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        gaji_pokok: Number(form.gaji_pokok) || 0,
        uang_makan: Number(form.uang_makan) || 0,
      };
      if (editingId) {
        await api.put(`/hr/contracts/${editingId}`, payload);
        toast.success("Kontrak kerja diperbarui");
      } else {
        await api.post("/hr/contracts", payload);
        toast.success("Kontrak kerja dibuat");
      }
      setShowForm(false);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const remove = async (contract) => {
    if (!window.confirm(`Hapus kontrak ${contract.contract_no || ""} untuk karyawan ini?`)) return;
    try {
      await api.delete(`/hr/contracts/${contract.id}`);
      toast.success("Kontrak dihapus");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const doPrint = (contract, employee) => setPrintData({ contract, employee });

  const updateStatus = async (contract, status) => {
    if (!contract?.id || status === contract.status) return;
    try {
      await api.put(`/hr/contracts/${contract.id}/status`, { status });
      toast.success(`Status → ${STATUS_LABEL[status] || status}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="kontrak-kerja-page">
      <PageHeader
        title="Kontrak Kerja"
        subtitle="Daftar karyawan beserta kontrak kerjanya (PKWT). Buat, edit, dan cetak kontrak sesuai template perusahaan."
      />

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <FileSignature size={16} className="text-blue-700" />
          <h3 className="font-bold">Daftar Karyawan & Kontrak</h3>
          <span className="text-xs text-slate-500 ml-2">{rows.length} karyawan</span>
        </div>
        <Table>
          <thead><tr>
            <Th>Karyawan</Th>
            <Th>Jabatan</Th>
            <Th>No. Kontrak</Th>
            <Th>Periode</Th>
            <Th>Status</Th>
            <Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {loading && <tr><Td colSpan={6} className="text-center text-slate-500 py-10">Memuat data…</Td></tr>}
            {!loading && rows.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-slate-500 py-10">Belum ada karyawan. Tambahkan karyawan di menu "Karyawan & Gaji" dulu.</Td></tr>
            )}
            {!loading && rows.map(({ employee, contracts, latest }) => {
              const expanded = expandedId === employee.id;
              return (
                <React.Fragment key={employee.id}>
                  <tr data-testid={`kontrak-row-${employee.id}`} className="hover:bg-slate-50">
                    <Td>
                      <div className="font-semibold">{employee.full_name}</div>
                      {employee.employee_no && <div className="text-[10px] font-mono text-slate-400">{employee.employee_no}</div>}
                    </Td>
                    <Td className="text-sm">{latest?.position || employee.position || <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-sm font-mono">{latest?.contract_no || <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-xs">
                      {latest?.start_date || latest?.end_date
                        ? `${latest?.start_date ? fmtDate(latest.start_date) : "…"} → ${latest?.end_date ? fmtDate(latest.end_date) : "…"}`
                        : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td>{latest ? <StatusSelect contract={latest} onChange={updateStatus} /> : <StatusBadge status={null} hasContract={false} />}</Td>
                    <Td className="text-right">
                      <div className="inline-flex gap-1.5 items-center">
                        {latest ? (
                          <>
                            {contracts.length > 0 && (
                              <button
                                onClick={() => setExpandedId(expanded ? null : employee.id)}
                                data-testid={`riwayat-toggle-${employee.id}`}
                                className="inline-flex items-center gap-0.5 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
                                title="Lihat riwayat kontrak"
                              >
                                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Riwayat ({contracts.length})
                              </button>
                            )}
                            <Button data-testid={`edit-contract-${employee.id}`} variant="secondary" onClick={() => openEdit(latest)}><Pencil size={13} /> Edit</Button>
                            <Button data-testid={`print-contract-${employee.id}`} onClick={() => doPrint(latest, employee)}><Printer size={13} /> Print</Button>
                            <Button data-testid={`new-contract-${employee.id}`} variant="ghost" onClick={() => openCreate(employee)} title="Buat kontrak baru / perpanjangan"><Plus size={13} /> Baru</Button>
                          </>
                        ) : (
                          <Button data-testid={`create-contract-${employee.id}`} onClick={() => openCreate(employee)}><Plus size={13} /> Buat Kontrak</Button>
                        )}
                      </div>
                    </Td>
                  </tr>

                  {expanded && contracts.map((ct) => (
                    <tr key={ct.id} data-testid={`riwayat-row-${ct.id}`} className="bg-slate-50">
                      <Td className="pl-8 text-xs text-slate-500">↳ Kontrak</Td>
                      <Td className="text-xs">{ct.position || <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-xs font-mono">{ct.contract_no || <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-xs">{ct.start_date ? fmtDate(ct.start_date) : "…"} → {ct.end_date ? fmtDate(ct.end_date) : "…"}</Td>
                      <Td><StatusSelect contract={ct} onChange={updateStatus} /></Td>
                      <Td className="text-right">
                        <div className="inline-flex gap-1.5">
                          <Button data-testid={`edit-riwayat-${ct.id}`} variant="secondary" onClick={() => openEdit(ct)}><Pencil size={13} /></Button>
                          <Button data-testid={`print-riwayat-${ct.id}`} onClick={() => doPrint(ct, employee)}><Printer size={13} /></Button>
                          <Button data-testid={`delete-riwayat-${ct.id}`} variant="ghost" onClick={() => remove(ct)}><Trash2 size={13} /></Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* FORM MODAL */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-start justify-center p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <Card className="max-w-3xl w-full my-4" data-testid="contract-form-modal">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 sticky top-0 bg-white">
              <FileSignature size={16} className="text-blue-700" />
              <h3 className="font-bold">{editingId ? "Edit Kontrak Kerja" : "Buat Kontrak Kerja"}</h3>
              <button onClick={() => setShowForm(false)} className="ml-auto p-1.5 hover:bg-slate-100 rounded" data-testid="contract-form-close"><X size={16} /></button>
            </div>

            <div className="p-4 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Info kontrak */}
              <Section title="Informasi Kontrak">
                <Grid>
                  <Field label="Jenis"><Select value={form.contract_type} onChange={(e) => setF("contract_type", e.target.value)}><option value="PKWT">PKWT</option><option value="PKWTT">PKWTT</option></Select></Field>
                  <Field label="No. Kontrak"><Input data-testid="c-no" value={form.contract_no} onChange={(e) => setF("contract_no", e.target.value)} placeholder="001/PKWT/AR/VII/2026" /></Field>
                  <Field label="Status"><Select value={form.status} onChange={(e) => setF("status", e.target.value)}>{STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
                  <Field label="Tempat Tanda Tangan"><Input value={form.sign_place} onChange={(e) => setF("sign_place", e.target.value)} /></Field>
                  <Field label="Tanggal Tanda Tangan"><Input type="date" value={form.sign_date || ""} onChange={(e) => setF("sign_date", e.target.value)} /></Field>
                </Grid>
              </Section>

              {/* Pihak Pertama */}
              <Section title="Pihak Pertama (Perusahaan)">
                <Grid>
                  <Field label="Nama Perusahaan"><Input value={form.company_name} onChange={(e) => setF("company_name", e.target.value)} /></Field>
                  <Field label="Nama Penandatangan"><Input data-testid="c-rep-name" value={form.rep_name} onChange={(e) => setF("rep_name", e.target.value)} placeholder="Amrullah" /></Field>
                  <Field label="Jabatan Penandatangan"><Input value={form.rep_position} onChange={(e) => setF("rep_position", e.target.value)} /></Field>
                  <Field label="Alamat Perusahaan" full><Input value={form.rep_address} onChange={(e) => setF("rep_address", e.target.value)} placeholder="Grand Galaxy City RSK 6/73 - Bekasi Selatan" /></Field>
                </Grid>
              </Section>

              {/* Pihak Kedua */}
              <Section title="Pihak Kedua (Karyawan)">
                <Grid>
                  <Field label="Nama"><Input data-testid="c-emp-name" value={form.emp_name} onChange={(e) => setF("emp_name", e.target.value)} /></Field>
                  <Field label="No. KTP"><Input value={form.emp_ktp} onChange={(e) => setF("emp_ktp", e.target.value)} /></Field>
                  <Field label="Tempat Lahir"><Input value={form.emp_birth_place} onChange={(e) => setF("emp_birth_place", e.target.value)} /></Field>
                  <Field label="Tanggal Lahir"><Input type="date" value={form.emp_birth_date || ""} onChange={(e) => setF("emp_birth_date", e.target.value)} /></Field>
                  <Field label="Alamat" full><Input value={form.emp_address} onChange={(e) => setF("emp_address", e.target.value)} /></Field>
                </Grid>
              </Section>

              {/* Isi kontrak */}
              <Section title="Isi Kontrak">
                <Grid>
                  <Field label="Jabatan / Posisi (Pasal 1)"><Input value={form.position} onChange={(e) => setF("position", e.target.value)} placeholder="Customer Service & Planning Operation" /></Field>
                  <Field label="Penempatan (Pasal 1)"><Input value={form.placement} onChange={(e) => setF("placement", e.target.value)} /></Field>
                  <Field label="Jangka Waktu (Pasal 2)"><Input value={form.duration_text} onChange={(e) => setF("duration_text", e.target.value)} placeholder="satu tahun" /></Field>
                  <Field label="Hari Kerja (Pasal 3)"><Input value={form.work_days_text} onChange={(e) => setF("work_days_text", e.target.value)} /></Field>
                  <Field label="Mulai (Pasal 2)"><Input type="date" value={form.start_date || ""} onChange={(e) => setF("start_date", e.target.value)} /></Field>
                  <Field label="Berakhir (Pasal 2)"><Input type="date" value={form.end_date || ""} onChange={(e) => setF("end_date", e.target.value)} /></Field>
                </Grid>
              </Section>

              {/* Upah */}
              <Section title="Upah & Tunjangan (Pasal 4)">
                <Grid>
                  <Field label="Gaji Pokok (Rp / bulan)"><NumberInput data-testid="c-gaji" value={form.gaji_pokok} onChange={(e) => onGajiChange(e.target.value)} /></Field>
                  <Field label="Terbilang Gaji Pokok" full><Input value={form.gaji_pokok_words} onChange={(e) => setF("gaji_pokok_words", e.target.value)} /></Field>
                  <Field label="Uang Makan (Rp / hari hadir)"><NumberInput value={form.uang_makan} onChange={(e) => onMakanChange(e.target.value)} /></Field>
                  <Field label="Terbilang Uang Makan" full><Input value={form.uang_makan_words} onChange={(e) => setF("uang_makan_words", e.target.value)} /></Field>
                </Grid>
              </Section>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end sticky bottom-0 bg-white">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              <Button data-testid="save-contract-btn" onClick={save} disabled={saving}>{saving ? "Menyimpan…" : (editingId ? "Simpan Perubahan" : "Simpan Kontrak")}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* PRINT MODAL */}
      {printData && (
        <ContractPrint contract={printData.contract} employee={printData.employee} onClose={() => setPrintData(null)} />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2 border-b border-slate-100 pb-1">{title}</div>
      {children}
    </div>
  );
}
function Grid({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, children, full }) {
  return <div className={full ? "md:col-span-2" : ""}><Label>{label}</Label>{children}</div>;
}
function StatusBadge({ status, hasContract }) {
  if (!hasContract) return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">Belum ada</span>;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[status] || STATUS_BADGE.draft}`}>{STATUS_LABEL[status] || status || "draft"}</span>;
}
function StatusSelect({ contract, onChange }) {
  const opts = STATUS_LABEL[contract.status]
    ? STATUS_OPTIONS
    : [{ value: contract.status, label: contract.status || "draft" }, ...STATUS_OPTIONS];
  return (
    <select
      data-testid={`status-select-${contract.id}`}
      value={contract.status || "draft"}
      onChange={(e) => onChange(contract, e.target.value)}
      title="Ganti status kontrak"
      className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase cursor-pointer outline-none focus:ring-2 focus:ring-blue-300 ${STATUS_BADGE[contract.status] || STATUS_BADGE.draft}`}
    >
      {opts.map((o) => <option key={o.value} value={o.value} className="bg-white text-slate-800 normal-case font-medium">{o.label}</option>)}
    </select>
  );
}
