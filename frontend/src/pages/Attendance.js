import React, { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Table, Th, Td } from "../components/ui";
import { fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Upload, Plus, Trash2, Save, X, Download, FileSpreadsheet, Calendar as CalIcon, Settings as SettingsIcon } from "lucide-react";

const STATUS_OPTIONS = ["Hadir", "Sakit", "Izin", "Alfa", "Libur", "Off"];
const STATUS_COLORS = {
  Hadir: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Sakit: "bg-orange-100 text-orange-800 border-orange-300",
  Izin: "bg-blue-100 text-blue-800 border-blue-300",
  Alfa: "bg-red-100 text-red-800 border-red-300",
  Libur: "bg-purple-100 text-purple-800 border-purple-300",
  Off: "bg-slate-100 text-slate-700 border-slate-300",
};

const DAYS_ID = [
  { key: "mon", label: "Senin" }, { key: "tue", label: "Selasa" }, { key: "wed", label: "Rabu" },
  { key: "thu", label: "Kamis" }, { key: "fri", label: "Jumat" }, { key: "sat", label: "Sabtu" }, { key: "sun", label: "Minggu" },
];

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

  // ---- Attendance config + Public holidays ----
  const [showSettings, setShowSettings] = useState(false);
  const [cfg, setCfg] = useState({ work_days: ["mon","tue","wed","thu","fri"], work_hour_in: "08:30", work_hour_out: "17:30", weekend_status: "Off", holiday_status: "Libur", auto_detect_on_import: true });
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "", note: "" });
  const [savingCfg, setSavingCfg] = useState(false);
  const [importingPreset, setImportingPreset] = useState(false);
  const [presetYear, setPresetYear] = useState(new Date().getFullYear());
  const [presetIncludeCuti, setPresetIncludeCuti] = useState(true);

  const loadSettings = async () => {
    try {
      const [cfgRes, hRes] = await Promise.all([
        api.get("/hr/attendance-config"),
        api.get("/hr/public-holidays", { params: { month } }),
      ]);
      setCfg({ ...cfg, ...cfgRes.data });
      setHolidays(hRes.data || []);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      await api.put("/hr/attendance-config", cfg);
      toast.success("Setting jam kerja tersimpan");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingCfg(false); }
  };
  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name) { toast.error("Tanggal & nama wajib"); return; }
    try {
      await api.post("/hr/public-holidays", newHoliday);
      toast.success("Hari libur ditambahkan");
      setNewHoliday({ date: "", name: "", note: "" });
      const hRes = await api.get("/hr/public-holidays", { params: { month } });
      setHolidays(hRes.data || []);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const delHoliday = async (id) => {
    if (!window.confirm("Hapus tanggal merah ini?")) return;
    try {
      await api.delete(`/hr/public-holidays/${id}`);
      toast.success("Terhapus");
      const hRes = await api.get("/hr/public-holidays", { params: { month } });
      setHolidays(hRes.data || []);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const importPreset = async () => {
    if (!window.confirm(
      `Impor semua tanggal merah Indonesia ${presetYear}${presetIncludeCuti ? " + cuti bersama" : ""}?\n\n` +
      `Tanggal yang sudah ada tidak akan diubah (hanya insert yang belum terdaftar).`
    )) return;
    setImportingPreset(true);
    try {
      const r = await api.post("/hr/public-holidays/preset", {
        year: parseInt(presetYear),
        include_cuti_bersama: presetIncludeCuti,
        overwrite: false,
      });
      const d = r.data;
      toast.success(
        `✅ Kalender ${d.year}: ${d.inserted} ditambahkan, ${d.skipped_existing} sudah ada` +
        (d.updated > 0 ? `, ${d.updated} di-update` : "")
      );
      // Reload
      const hRes = await api.get("/hr/public-holidays");   // load all so user bisa lihat semua bulan
      setHolidays(hRes.data || []);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setImportingPreset(false); }
  };
  const toggleWorkDay = (k) => {
    const set = new Set(cfg.work_days || []);
    if (set.has(k)) set.delete(k); else set.add(k);
    setCfg({ ...cfg, work_days: Array.from(set) });
  };
  const openSettings = () => { setShowSettings(true); loadSettings(); };

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
          <Button variant="secondary" onClick={openSettings} data-testid="att-settings-btn">
            <SettingsIcon size={14}/> Setting
          </Button>
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
                {(importResult.auto_detected_weekend > 0 || importResult.auto_detected_holiday > 0) && (
                  <div className="p-3 bg-purple-50 border border-purple-200 rounded">
                    <div className="font-bold text-purple-800 mb-1">🤖 Auto-Detected</div>
                    <ul className="text-xs space-y-0.5">
                      {importResult.auto_detected_holiday > 0 && (
                        <li>• {importResult.auto_detected_holiday} baris ditandai <b>Libur</b> (tanggal merah)</li>
                      )}
                      {importResult.auto_detected_weekend > 0 && (
                        <li>• {importResult.auto_detected_weekend} baris ditandai <b>Off</b> (Sabtu/Minggu / non-workday)</li>
                      )}
                    </ul>
                    <p className="text-[10px] text-slate-500 mt-1">Auto-detect hanya berlaku untuk baris yang kolom statusnya kosong di file. Kalau tidak mau, matikan di Setting.</p>
                  </div>
                )}
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

      {/* ===== Settings Modal (Jam Kerja + Hari Libur) ===== */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="attendance-settings-modal">
          <Card className="w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Setting Absensi</h3>
                <p className="text-xs text-slate-500">Konfigurasi hari kerja, jam kerja default, dan daftar tanggal merah</p>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            {/* Jam Kerja Config */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 mb-4">
              <h4 className="font-bold text-sm mb-3">🕒 Jam Kerja & Hari Kerja Default</h4>
              <div className="mb-3">
                <label className="text-xs font-bold text-slate-600 mb-1 block">Hari Kerja</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_ID.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => toggleWorkDay(d.key)}
                      data-testid={`workday-${d.key}`}
                      className={`px-3 py-1.5 text-xs rounded border font-semibold ${(cfg.work_days || []).includes(d.key) ? "bg-emerald-100 border-emerald-400 text-emerald-800" : "bg-white border-slate-300 text-slate-500"}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Klik untuk toggle. Hari yang tidak dipilih akan dianggap non-workday (default status {`"Off"`}).</p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Jam Masuk</label>
                  <Input type="time" value={cfg.work_hour_in} onChange={(e) => setCfg({ ...cfg, work_hour_in: e.target.value })} data-testid="work-hour-in"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Jam Pulang</label>
                  <Input type="time" value={cfg.work_hour_out} onChange={(e) => setCfg({ ...cfg, work_hour_out: e.target.value })} data-testid="work-hour-out"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Status untuk Weekend/Non-Workday</label>
                  <Select value={cfg.weekend_status} onChange={(e) => setCfg({ ...cfg, weekend_status: e.target.value })}>
                    <option value="Off">Off</option>
                    <option value="Libur">Libur</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Status untuk Tanggal Merah</label>
                  <Select value={cfg.holiday_status} onChange={(e) => setCfg({ ...cfg, holiday_status: e.target.value })}>
                    <option value="Libur">Libur</option>
                    <option value="Off">Off</option>
                  </Select>
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={cfg.auto_detect_on_import} onChange={(e) => setCfg({ ...cfg, auto_detect_on_import: e.target.checked })} data-testid="auto-detect-toggle" className="mt-0.5"/>
                <span>
                  <b>Auto-detect saat import.</b> Kalau kolom status di file kosong, sistem otomatis:
                  <ul className="list-disc ml-4 mt-0.5 text-slate-600">
                    <li>Tanggal Sabtu/Minggu (atau non-workday) → status {`"${cfg.weekend_status}"`}</li>
                    <li>Tanggal merah nasional → status {`"${cfg.holiday_status}"`}</li>
                  </ul>
                </span>
              </label>
              <div className="mt-3 flex justify-end">
                <Button onClick={saveCfg} disabled={savingCfg} data-testid="save-cfg-btn"><Save size={12} className="mr-1"/> {savingCfg ? "Menyimpan..." : "Simpan Setting"}</Button>
              </div>
            </div>

            {/* Public Holidays List */}
            <div className="border border-slate-200 rounded-lg p-4">
              {/* Quick preset importer */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded p-3 mb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-bold text-sm text-purple-900">🇮🇩 Preset Kalender Libur Nasional Indonesia</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">Impor otomatis 17 libur nasional (opsional + 8 cuti bersama) dari SKB 3 Menteri. Tanggal yang sudah ada tidak diubah.</div>
                  </div>
                </div>
                <div className="flex items-end gap-2 mt-2">
                  <div className="w-24">
                    <label className="text-[10px] font-bold text-slate-600 block">Tahun</label>
                    <Input type="number" min="2020" max="2030" value={presetYear} onChange={(e) => setPresetYear(e.target.value)} data-testid="preset-year"/>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer flex-1 pb-2">
                    <input type="checkbox" checked={presetIncludeCuti} onChange={(e) => setPresetIncludeCuti(e.target.checked)} data-testid="preset-include-cuti"/>
                    <span>Sertakan cuti bersama (8 tanggal)</span>
                  </label>
                  <Button onClick={importPreset} disabled={importingPreset} data-testid="import-preset-btn">
                    <Download size={12} className="mr-1"/> {importingPreset ? "Mengimpor..." : `Impor ${presetYear}`}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm">🎉 Tanggal Merah / Hari Libur Nasional</h4>
                <span className="text-[10px] text-slate-500">Bulan {month}</span>
              </div>
              <div className="grid grid-cols-12 gap-2 mb-2">
                <Input type="date" className="col-span-3" value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} data-testid="hol-date"/>
                <Input className="col-span-5" placeholder="Nama libur (mis. Hari Raya Idul Fitri)" value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} data-testid="hol-name"/>
                <Input className="col-span-3" placeholder="Catatan (opsional)" value={newHoliday.note} onChange={(e) => setNewHoliday({ ...newHoliday, note: e.target.value })} data-testid="hol-note"/>
                <Button className="col-span-1" onClick={addHoliday} data-testid="add-hol-btn"><Plus size={14}/></Button>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {holidays.length === 0 && <p className="text-xs text-slate-500 italic py-2 text-center">Belum ada tanggal merah untuk bulan {month}. Tambahkan di atas.</p>}
                {holidays.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 bg-purple-50 border border-purple-200 rounded text-xs" data-testid={`hol-${h.date}`}>
                    <span className="font-mono font-bold text-purple-800">{h.date}</span>
                    <span className="flex-1">{h.name}</span>
                    {h.note && <span className="text-slate-500 italic">{h.note}</span>}
                    <button onClick={() => delHoliday(h.id)} className="p-1 rounded hover:bg-red-100 text-red-600" data-testid={`del-hol-${h.date}`}><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">💡 Tip: filter list di atas berdasarkan bulan {month}. Ganti dropdown bulan di atas halaman untuk lihat/tambah libur bulan lain.</p>
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="secondary" onClick={() => setShowSettings(false)}>Tutup</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
