import React, { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Table, Th, Td } from "../components/ui";
import { fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Upload, Plus, Trash2, Save, X, Download, FileSpreadsheet, Calendar as CalIcon } from "lucide-react";

const STATUS_OPTIONS = ["Hadir", "Sakit", "Izin", "Alfa"];
const STATUS_COLORS = {
  Hadir: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Sakit: "bg-orange-100 text-orange-800 border-orange-300",
  Izin: "bg-blue-100 text-blue-800 border-blue-300",
  Alfa: "bg-red-100 text-red-800 border-red-300",
};

export default function Attendance() {
  const [emps, setEmps] = useState([]);
  const [rows, setRows] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [empFilter, setEmpFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ employee_id: "", date: "", status: "Hadir", check_in: "", check_out: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month };
      if (empFilter !== "all") params.employee_id = empFilter;
      const [attRes, empRes] = await Promise.all([
        api.get("/hr/attendance", { params }),
        emps.length ? Promise.resolve({ data: emps }) : api.get("/hr/employees"),
      ]);
      setRows(attRes.data);
      if (!emps.length) setEmps(empRes.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [month, empFilter, emps]);

  useEffect(() => { load(); }, [load]);

  const empName = (id) => {
    const e = emps.find((x) => x.id === id);
    return e ? e.full_name : "-";
  };

  const submitAdd = async () => {
    if (!form.employee_id || !form.date || !form.status) return toast.error("Karyawan, tanggal, status wajib");
    try {
      await api.post("/hr/attendance", form);
      toast.success("Absensi tersimpan");
      setShowAdd(false);
      setForm({ employee_id: "", date: "", status: "Hadir", check_in: "", check_out: "", note: "" });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus absensi ini?")) return;
    try { await api.delete(`/hr/attendance/${id}`); toast.success("Terhapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/hr/attendance/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setImportResult(data);
      toast.success(`${data.imported} baris ter-import`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const downloadTemplate = () => {
    // XLSX template — bisa di-copas dari Excel lain
    const header = ["employee_id", "nik", "nama", "tanggal", "status", "check_in", "check_out", "note"];
    const sample = [
      ["", "", "Contoh Nama", "2026-02-15", "Hadir", "08:30", "17:30", ""],
      ["", "", "Contoh Nama", "2026-02-16", "Alfa", "", "", "Tanpa kabar"],
      ["", "", "Contoh Nama", "2026-02-17", "Sakit", "", "", "Surat dokter"],
    ];
    const aoa = [header, ...sample];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Kolom lebar biar rapi saat dibuka
    ws["!cols"] = [
      { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
    ];
    // Format tanggal sebagai text supaya tidak diparse Excel jadi angka
    for (let r = 1; r < aoa.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
      if (cell) cell.t = "s";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Absensi");
    // Sheet #2: petunjuk singkat
    const guide = [
      ["PETUNJUK PENGISIAN TEMPLATE ABSENSI"],
      [""],
      ["Kolom", "Wajib?", "Keterangan"],
      ["employee_id", "Salah satu", "ID internal karyawan (dari sistem)"],
      ["nik", "Salah satu", "NIK karyawan (kalau tidak pakai employee_id)"],
      ["nama", "Salah satu", "Nama lengkap (fallback kalau NIK/ID kosong)"],
      ["tanggal", "Wajib", "Format YYYY-MM-DD (contoh 2026-02-15)"],
      ["status", "Wajib", "Hadir / Sakit / Izin / Alfa / Cuti / Libur"],
      ["check_in", "Opsional", "Jam masuk HH:MM (contoh 08:30)"],
      ["check_out", "Opsional", "Jam pulang HH:MM (contoh 17:30)"],
      ["note", "Opsional", "Catatan tambahan"],
      [""],
      ["Tips:", "Boleh copy-paste dari Excel/Sheets lain — pastikan header persis sama."],
    ];
    const wsGuide = XLSX.utils.aoa_to_sheet(guide);
    wsGuide["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk");

    XLSX.writeFile(wb, "template-absensi.xlsx");
  };

  // Summary counts
  const summary = { Hadir: 0, Sakit: 0, Izin: 0, Alfa: 0 };
  rows.forEach((r) => { if (summary[r.status] != null) summary[r.status]++; });

  return (
    <div className="space-y-4" data-testid="attendance-page">
      <PageHeader title="Absensi" subtitle="Kelola & import data absensi karyawan per bulan" />

      {/* Filters + Actions */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Periode Bulan</label>
            <Input data-testid="att-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40"/>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Karyawan</label>
            <Select data-testid="att-emp-filter" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="w-64">
              <option value="all">Semua Karyawan</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </div>
          <div className="flex-1"/>
          <Button variant="secondary" onClick={downloadTemplate} data-testid="att-download-template">
            <Download size={14}/> Template
          </Button>
          <Button variant="secondary" onClick={() => setShowImport(true)} data-testid="att-import-btn">
            <Upload size={14}/> Import
          </Button>
          <Button onClick={() => { setShowAdd(true); setForm({ ...form, date: `${month}-01` }); }} data-testid="att-add-btn">
            <Plus size={14}/> Tambah
          </Button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          {STATUS_OPTIONS.map((s) => (
            <div key={s} className={`px-3 py-1.5 rounded-md border text-xs font-bold ${STATUS_COLORS[s]}`}>
              {s}: <span className="ml-1">{summary[s]}</span>
            </div>
          ))}
          <div className="px-3 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-xs font-bold text-slate-700">
            Total: {rows.length}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="text-center py-8 text-slate-500">Memuat…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            <CalIcon size={32} className="mx-auto mb-2 text-slate-300"/>
            <p>Belum ada absensi untuk periode ini.</p>
            <p className="text-xs mt-1">Klik Import untuk upload file Excel/CSV, atau Tambah manual.</p>
          </div>
        ) : (
          <Table>
            <thead><tr>
              <Th>Tanggal</Th>
              <Th>Karyawan</Th>
              <Th>Status</Th>
              <Th>Check In</Th>
              <Th>Check Out</Th>
              <Th>Catatan</Th>
              <Th className="text-right">Aksi</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`att-row-${r.id}`} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{fmtDate(r.date)}</Td>
                  <Td className="font-semibold">{empName(r.employee_id)}</Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[r.status] || ""}`}>
                      {r.status}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">{r.check_in || "-"}</Td>
                  <Td className="font-mono text-xs">{r.check_out || "-"}</Td>
                  <Td className="text-xs text-slate-600">{r.note || "-"}</Td>
                  <Td className="text-right">
                    <Button variant="danger" onClick={() => del(r.id)} data-testid={`att-del-${r.id}`}>
                      <Trash2 size={13}/>
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-attendance-modal">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-lg">Tambah Absensi</h3>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Karyawan *</label>
                <Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} data-testid="add-emp">
                  <option value="">— Pilih —</option>
                  {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Tanggal *</label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="add-date"/>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Status *</label>
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} data-testid="add-status">
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              {form.status === "Hadir" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Check In</label>
                    <Input type="time" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })}/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Check Out</label>
                    <Input type="time" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })}/>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Catatan</label>
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="opsional..."/>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Batal</Button>
              <Button onClick={submitAdd} data-testid="add-submit"><Save size={13}/> Simpan</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="import-modal">
          <Card className="w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-lg">Import Absensi</h3>
              <button onClick={() => { setShowImport(false); setImportResult(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            {!importResult && (
              <>
                <div className="text-sm text-slate-700 space-y-2 mb-4">
                  <p>Upload file <b>Excel (.xlsx)</b> atau <b>CSV</b> dengan format kolom:</p>
                  <div className="bg-slate-50 border rounded p-3 text-xs font-mono">
                    <div><b>Format A:</b> employee_id / nik / nama, tanggal, status</div>
                    <div className="mt-1"><b>Format B:</b> employee_id / nik / nama, tanggal, check_in, check_out</div>
                    <div className="mt-1 text-slate-500">(status akan di-derive dari check_in kalau format B)</div>
                  </div>
                  <p className="text-xs">Status yang dikenali: <b>Hadir / Sakit / Izin / Alfa</b> (bisa H/S/I/A juga).</p>
                  <p className="text-xs">Karyawan dicocokkan by <b>employee_id → NIK → Nama</b>. Baris duplikat (employee+date) akan di-overwrite.</p>
                </div>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-6 hover:bg-slate-50 cursor-pointer">
                  <FileSpreadsheet size={32} className="text-slate-400 mb-2"/>
                  <span className="text-sm font-semibold">Pilih File</span>
                  <span className="text-xs text-slate-500 mt-1">.xlsx atau .csv</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImport}
                    disabled={importing}
                    data-testid="import-file"
                  />
                </label>
                {importing && <div className="mt-3 text-center text-slate-500 text-sm">Mengimport...</div>}
              </>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded">
                  <div className="font-bold text-emerald-800">✅ {importResult.imported} baris berhasil di-import</div>
                </div>
                {importResult.skipped_count > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                    <div className="font-bold text-amber-800 mb-2">⚠️ {importResult.skipped_count} baris di-skip</div>
                    <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                      {(importResult.skipped_details || []).map((s, i) => (
                        <li key={i} className="text-amber-700">
                          Baris {s.row}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <Button onClick={() => { setShowImport(false); setImportResult(null); }}>Selesai</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
