import React, { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Table, Th, Td } from "../components/ui";
import { fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Upload, Plus, Trash2, Save, X, Download, FileSpreadsheet, Calendar as CalIcon, Settings as SettingsIcon, Edit2, UserPlus } from "lucide-react";
import NumberInput from "../components/NumberInput";

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

const MONTH_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// Build 24 periode selector options (12 lalu + 12 depan) berdasarkan cutoff.
// Konvensi: periode YYYY-MM = (cutoff+1) bulan SEBELUMNYA → cutoff bulan ini.
// Contoh cutoff=25, "Juli 2026" = 26 Jun → 25 Jul.
function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function buildPeriodOptions(cutoffDay) {
  const today = new Date();
  const opts = [];
  for (let offset = -12; offset <= 11; offset++) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1; // 1..12
    const value = `${y}-${String(m).padStart(2, "0")}`;
    const monthName = MONTH_ID[m - 1];
    let label;
    if (cutoffDay > 0) {
      // End = cutoffDay di bulan periode
      const endDate = new Date(y, m - 1, cutoffDay);
      // Start = cutoffDay+1 di bulan sebelumnya
      const startDate = new Date(y, m - 2, cutoffDay + 1);
      const fmt = (dt) => `${dt.getDate()} ${MONTH_ID[dt.getMonth()].slice(0, 3)}`;
      const yrTag = startDate.getFullYear() !== endDate.getFullYear() ? ` ${startDate.getFullYear()}` : "";
      label = `${monthName} ${y}  (${fmt(startDate)}${yrTag} → ${fmt(endDate)})`;
    } else {
      label = `${monthName} ${y}`;
    }
    opts.push({ value, label });
  }
  return opts;
}

export default function Attendance() {
  const [emps, setEmps] = useState([]);
  const [rows, setRows] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [empFilter, setEmpFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);  // null | attendance-id (untuk edit modal)
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState("merge");   // merge | overwrite
  const [pendingFile, setPendingFile] = useState(null);
  const [preview, setPreview] = useState(null);            // dry-run result
  const [form, setForm] = useState({ employee_id: "", date: "", status: "Hadir", check_in: "", check_out: "", note: "", overtime_hours: 0, overtime_rate: 0 });
  // Selection for bulk delete
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  // ---- Attendance config + Public holidays ----
  const [showSettings, setShowSettings] = useState(false);
  const [cfg, setCfg] = useState({ work_days: ["mon","tue","wed","thu","fri"], work_hour_in: "08:30", work_hour_out: "17:30", weekend_status: "Off", holiday_status: "Libur", auto_detect_on_import: true, work_schedule: {}, late_threshold_minutes: 5, payroll_cutoff_day: 25 });
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
  // Load config on mount so cutoff label & filter work correctly
  useEffect(() => {
    api.get("/hr/attendance-config").then((r) => setCfg((c) => ({ ...c, ...r.data }))).catch(() => {});
  }, []);

  const empName = (id) => {
    const e = emps.find((x) => x.id === id);
    return e ? e.full_name : "-";
  };

  const submitAdd = async () => {
    if (!form.employee_id || !form.date || !form.status) return toast.error("Karyawan, tanggal, status wajib");
    try {
      const payload = {
        ...form,
        overtime_hours: Number(form.overtime_hours || 0),
        overtime_rate: Number(form.overtime_rate || 0),
      };
      if (editingId) {
        await api.put(`/hr/attendance/${editingId}`, payload);
        toast.success("Absensi diperbarui");
      } else {
        await api.post("/hr/attendance", payload);
        toast.success("Absensi tersimpan");
      }
      setShowAdd(false);
      setEditingId(null);
      setForm({ employee_id: "", date: "", status: "Hadir", check_in: "", check_out: "", note: "", overtime_hours: 0, overtime_rate: 0 });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      employee_id: row.employee_id || "",
      date: row.date || "",
      status: row.status || "Hadir",
      check_in: row.check_in || "",
      check_out: row.check_out || "",
      note: row.note || "",
      overtime_hours: row.overtime_hours || 0,
      overtime_rate: row.overtime_rate || 0,
    });
    setShowAdd(true);
  };

  const del = async (id) => {
    if (!window.confirm("Hapus absensi ini?")) return;
    try { await api.delete(`/hr/attendance/${id}`); toast.success("Terhapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  // Bulk selection helpers
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length && rows.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  };
  const clearSelection = () => setSelectedIds(new Set());
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Hapus ${selectedIds.size} baris absensi terpilih? Aksi ini tidak dapat dibatalkan.`)) return;
    setDeleting(true);
    try {
      const r = await api.post("/hr/attendance/bulk-delete", { ids: Array.from(selectedIds) });
      toast.success(`${r.data.deleted} baris terhapus`);
      clearSelection();
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setDeleting(false); }
  };
  // Reset selection ketika data reload (setelah filter change)
  useEffect(() => { setSelectedIds(new Set()); }, [rows.length, month, empFilter]);

  // Auto-fill Alfa untuk semua hari kerja tanpa absen
  const [autoFilling, setAutoFilling] = useState(false);
  const autoFillAlfa = async () => {
    if (!window.confirm(
      `Isi otomatis absensi = "Alfa" untuk semua HARI KERJA di periode ${month} yang belum ada record?\n\n` +
      `• Skip weekend/non-workday & tanggal merah\n` +
      `• Skip yang sudah punya record (tidak overwrite)\n` +
      `• Nanti Anda bisa edit ke Sakit/Izin/Cuti dll di list`
    )) return;
    setAutoFilling(true);
    try {
      const r = await api.post("/hr/attendance/auto-fill-alfa", { period_month: month });
      const d = r.data;
      toast.success(
        `✅ ${d.inserted} Alfa dibuat untuk ${d.employees_targeted} karyawan × ${d.workdays_in_period} hari kerja. Skip existing: ${d.skipped_existing}, holiday: ${d.skipped_holiday}`
      );
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setAutoFilling(false); }
  };

  const resetImport = () => { setImportResult(null); setPreview(null); setPendingFile(null); };

  // Step 1: pilih file → dry-run untuk preview konflik
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
    setImporting(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/hr/attendance/import?mode=${importMode}&dry_run=true`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(data);
    } catch (err) {
      toast.error(errMsg(err));
      setPendingFile(null);
    } finally {
      setImporting(false);
    }
  };

  // Step 2: konfirmasi → import beneran
  const doImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      const { data } = await api.post(`/hr/attendance/import?mode=${importMode}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setImportResult(data);
      setPreview(null);
      setPendingFile(null);
      toast.success(`${data.imported} baris ter-import (${data.mode === "merge" ? "Merge" : "Timpa Total"})`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    // XLSX template — bisa di-copas dari Excel lain
    const header = ["employee_no", "employee_id", "nik", "nama", "tanggal", "status", "check_in", "check_out", "overtime_hours", "overtime_rate", "note"];
    const sample = [
      ["EMP-001", "", "", "Contoh Nama", "2026-02-15", "Hadir", "08:30", "17:30", 0, 0, ""],
      ["EMP-001", "", "", "Contoh Nama", "2026-02-16", "Alfa", "", "", 0, 0, "Tanpa kabar"],
      ["EMP-001", "", "", "Contoh Nama", "2026-02-17", "Sakit", "", "", 0, 0, "Surat dokter"],
      ["EMP-002", "", "", "Contoh Lembur", "2026-02-18", "Hadir", "08:30", "20:00", 2.5, 30000, "Lembur closing"],
    ];
    const aoa = [header, ...sample];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Kolom lebar biar rapi saat dibuka
    ws["!cols"] = [
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
    ];
    // Format tanggal sebagai text supaya tidak diparse Excel jadi angka
    for (let r = 1; r < aoa.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
      if (cell) cell.t = "s";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Absensi");
    // Sheet #2: petunjuk singkat
    const guide = [
      ["PETUNJUK PENGISIAN TEMPLATE ABSENSI"],
      [""],
      ["Kolom", "Wajib?", "Keterangan"],
      ["employee_no", "Salah satu", "ID Karyawan manual (mis. EMP-001)"],
      ["employee_id", "Salah satu", "ID internal karyawan dari sistem"],
      ["nik", "Salah satu", "NIK karyawan (kalau tidak pakai employee_no/id)"],
      ["nama", "Salah satu", "Nama lengkap (fallback terakhir)"],
      ["tanggal", "Wajib", "Format YYYY-MM-DD (contoh 2026-02-15)"],
      ["status", "Wajib", "Hadir / Sakit / Izin / Alfa / Cuti / Libur"],
      ["check_in", "Opsional", "Jam masuk HH:MM (contoh 08:30)"],
      ["check_out", "Opsional", "Jam pulang HH:MM (contoh 17:30)"],
      ["overtime_hours", "Opsional", "Jumlah jam lembur (mis. 2.5)"],
      ["overtime_rate", "Opsional", "Tarif lembur per jam dalam IDR (mis. 30000)"],
      ["note", "Opsional", "Catatan tambahan"],
      [""],
      ["Tips:", "Boleh copy-paste dari Excel/Sheets lain — pastikan header persis sama."],
      ["Auto:", "Kalau status kosong, sistem akan auto-detect weekend / tanggal merah."],
      ["Late:", "Kalau check_in > jam kerja + threshold (setting), akan ditandai TELAT."],
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
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Periode {cfg.payroll_cutoff_day > 0 && <span className="text-blue-700 normal-case font-medium">(cutoff tgl {cfg.payroll_cutoff_day})</span>}
            </label>
            <Select data-testid="att-month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-72">
              {buildPeriodOptions(Number(cfg.payroll_cutoff_day || 0)).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
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
          <Button variant="secondary" onClick={autoFillAlfa} disabled={autoFilling} data-testid="att-autofill-btn" title="Isi Alfa otomatis untuk hari kerja yang belum ada absen">
            <UserPlus size={14}/> {autoFilling ? "Mengisi..." : "Auto-Isi Alfa"}
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="danger" onClick={bulkDelete} disabled={deleting} data-testid="att-bulk-delete-btn">
              <Trash2 size={14}/> Hapus Terpilih ({selectedIds.size})
            </Button>
          )}
          <Button onClick={() => { setEditingId(null); setShowAdd(true); setForm({ employee_id: "", date: todayISO(), status: "Hadir", check_in: "", check_out: "", note: "", overtime_hours: 0, overtime_rate: 0 }); }} data-testid="att-add-btn">
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
              <Th className="w-8">
                <input
                  type="checkbox"
                  data-testid="att-select-all"
                  checked={rows.length > 0 && selectedIds.size === rows.length}
                  ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < rows.length; }}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </Th>
              <Th>Tanggal</Th>
              <Th>Karyawan</Th>
              <Th>Status</Th>
              <Th>Check In</Th>
              <Th>Check Out</Th>
              <Th className="text-right">Lembur</Th>
              <Th>Flag</Th>
              <Th>Catatan</Th>
              <Th className="text-right">Aksi</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`att-row-${r.id}`} className={`hover:bg-slate-50 ${selectedIds.has(r.id) ? "bg-blue-50/60" : ""}`}>
                  <Td>
                    <input
                      type="checkbox"
                      data-testid={`att-select-${r.id}`}
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      aria-label={`Select ${r.date}`}
                    />
                  </Td>
                  <Td className="font-mono text-xs">{fmtDate(r.date)}</Td>
                  <Td className="font-semibold">{empName(r.employee_id)}</Td>
                  <Td>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[r.status] || ""}`}>
                      {r.status}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">{r.check_in || "-"}</Td>
                  <Td className="font-mono text-xs">{r.check_out || "-"}</Td>
                  <Td className="text-right font-mono text-xs">
                    {(r.overtime_hours || 0) > 0
                      ? <span>{r.overtime_hours}j × {(r.overtime_rate || 0).toLocaleString("id-ID")}</span>
                      : <span className="text-slate-400">-</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.is_late && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold" title={`Telat ${r.late_minutes || 0} menit`}>TELAT{r.late_minutes ? ` ${r.late_minutes}m` : ""}</span>}
                      {r.is_under_hours && <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[9px] font-bold" title={`Kerja ${r.worked_minutes || 0}m dari ${r.required_minutes || 0}m`}>KURANG JAM</span>}
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-600">{r.note || "-"}</Td>
                  <Td className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="secondary" onClick={() => openEdit(r)} data-testid={`att-edit-${r.id}`}>
                        <Edit2 size={13}/>
                      </Button>
                      <Button variant="danger" onClick={() => del(r.id)} data-testid={`att-del-${r.id}`}>
                        <Trash2 size={13}/>
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Add/Edit Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-attendance-modal">
          <Card className="w-full max-w-md p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-lg">{editingId ? "Edit Absensi" : "Tambah Absensi"}</h3>
              <button onClick={() => { setShowAdd(false); setEditingId(null); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Karyawan *</label>
                <Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} data-testid="add-emp">
                  <option value="">— Pilih —</option>
                  {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.employee_no ? ` (${e.employee_no})` : ""}</option>)}
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
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Check In</label>
                      <Input type="time" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} data-testid="add-check-in"/>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Check Out</label>
                      <Input type="time" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} data-testid="add-check-out"/>
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded p-3 bg-slate-50/50">
                    <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Lembur (opsional)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Jam Lembur</label>
                        <Input type="number" step="0.5" min="0" value={form.overtime_hours} onChange={(e) => setForm({ ...form, overtime_hours: e.target.value })} placeholder="0" data-testid="add-ot-hours"/>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Tarif per Jam (IDR)</label>
                        <NumberInput value={form.overtime_rate} onChange={(e) => setForm({ ...form, overtime_rate: e.target.value })} placeholder="Mis. 30000" data-testid="add-ot-rate"/>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Total lembur = jam × tarif. Diinput manual per hari.</p>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Catatan</label>
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="opsional..."/>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setShowAdd(false); setEditingId(null); }}>Batal</Button>
              <Button onClick={submitAdd} data-testid="add-submit"><Save size={13}/> {editingId ? "Update" : "Simpan"}</Button>
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
              <button onClick={() => { setShowImport(false); resetImport(); }} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            {!importResult && !preview && (
              <>
                <div className="text-sm text-slate-700 space-y-2 mb-4">
                  <p>Upload file <b>Excel (.xlsx)</b> atau <b>CSV</b> dengan format kolom:</p>
                  <div className="bg-slate-50 border rounded p-3 text-xs font-mono">
                    <div><b>Format A:</b> employee_id / nik / nama, tanggal, status</div>
                    <div className="mt-1"><b>Format B:</b> employee_id / nik / nama, tanggal, check_in, check_out</div>
                    <div className="mt-1 text-slate-500">(status akan di-derive dari check_in kalau format B)</div>
                  </div>
                  <p className="text-xs">Karyawan dicocokkan by <b>employee_id → NIK → Nama</b>.</p>
                </div>

                {/* Mode toggle */}
                <div className="mb-4" data-testid="import-mode">
                  <div className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Mode Import</div>
                  <label className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer mb-2 ${importMode === "merge" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                    <input type="radio" name="impmode" className="mt-1" checked={importMode === "merge"} onChange={() => setImportMode("merge")} data-testid="mode-merge"/>
                    <div>
                      <div className="text-sm font-bold text-slate-800">Merge (aman) — pertahankan data lama <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded ml-1">Direkomendasikan</span></div>
                      <div className="text-xs text-slate-600">Field yang tidak ada di file (mis. jam pulang / lembur yang sudah Anda input) <b>tidak akan hilang</b>.</div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer ${importMode === "overwrite" ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}>
                    <input type="radio" name="impmode" className="mt-1" checked={importMode === "overwrite"} onChange={() => setImportMode("overwrite")} data-testid="mode-overwrite"/>
                    <div>
                      <div className="text-sm font-bold text-slate-800">Timpa Total</div>
                      <div className="text-xs text-slate-600">Ganti seluruh data pada tanggal itu sesuai file. Field yang kosong di file <b>akan menghapus</b> data lama.</div>
                    </div>
                  </label>
                </div>

                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-6 hover:bg-slate-50 cursor-pointer">
                  <FileSpreadsheet size={32} className="text-slate-400 mb-2"/>
                  <span className="text-sm font-semibold">Pilih File</span>
                  <span className="text-xs text-slate-500 mt-1">.xlsx atau .csv</span>
                  <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFilePick} disabled={importing} data-testid="import-file"/>
                </label>
                {importing && <div className="mt-3 text-center text-slate-500 text-sm">Menganalisa file...</div>}
              </>
            )}

            {/* PREVIEW / KONFIRMASI (hasil dry-run) */}
            {preview && !importResult && (
              <div className="space-y-3" data-testid="import-preview">
                <div className="p-3 bg-slate-50 border rounded text-sm">
                  Mode: <b>{preview.mode === "merge" ? "Merge (aman)" : "Timpa Total"}</b> · Akan meng-import <b>{preview.imported}</b> baris
                  {preview.skipped_count > 0 && <> · <span className="text-amber-700">{preview.skipped_count} di-skip</span></>}
                </div>
                {preview.conflict_count > 0 ? (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded" data-testid="import-conflicts">
                    <div className="font-bold text-rose-800 mb-2">⚠️ {preview.conflict_count} data yang sudah ada akan {preview.mode === "merge" ? "berubah" : "hilang/berubah"}:</div>
                    <ul className="text-xs space-y-1 max-h-52 overflow-y-auto">
                      {preview.conflicts.map((c, i) => (
                        <li key={i} className="text-rose-700 border-b border-rose-100 pb-1">
                          <b>{c.employee_name}</b> · {c.date} · {c.field}: <span className="font-mono">{String(c.old)}</span> → <span className="font-mono">{String(c.new)}</span>
                        </li>
                      ))}
                    </ul>
                    {preview.mode === "overwrite" && <p className="text-[11px] text-rose-600 mt-2 font-semibold">Gunakan mode <b>Merge</b> kalau Anda tidak ingin data lama hilang.</p>}
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800 font-semibold">✅ Aman — tidak ada data lama yang hilang/berubah.</div>
                )}
                <div className="flex justify-between gap-2 pt-3 border-t">
                  <Button variant="secondary" onClick={resetImport} disabled={importing}>Kembali</Button>
                  <Button onClick={doImport} disabled={importing} data-testid="import-confirm">
                    {importing ? "Mengimport..." : (preview.conflict_count > 0 ? "Tetap Lanjutkan Import" : "Konfirmasi Import")}
                  </Button>
                </div>
              </div>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded">
                  <div className="font-bold text-emerald-800">✅ {importResult.imported} baris ter-import ({importResult.mode === "merge" ? "Merge" : "Timpa Total"})</div>
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
                  <Button onClick={() => { setShowImport(false); resetImport(); }}>Selesai</Button>
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
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Jam Masuk Default</label>
                  <Input type="time" value={cfg.work_hour_in} onChange={(e) => setCfg({ ...cfg, work_hour_in: e.target.value })} data-testid="work-hour-in"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Jam Pulang Default</label>
                  <Input type="time" value={cfg.work_hour_out} onChange={(e) => setCfg({ ...cfg, work_hour_out: e.target.value })} data-testid="work-hour-out"/>
                </div>
              </div>
              {/* --- Jam Kerja Per-Hari (Flexible) --- */}
              <div className="mb-3 border border-slate-200 rounded p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-slate-600">Jam Kerja Per Hari (opsional override)</div>
                  <span className="text-[10px] text-slate-400">Kosongkan → pakai default di atas</span>
                </div>
                <div className="space-y-1.5">
                  {DAYS_ID.filter((d) => (cfg.work_days || []).includes(d.key)).map((d) => {
                    const sched = (cfg.work_schedule || {})[d.key] || {};
                    return (
                      <div key={d.key} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3 text-xs font-semibold">{d.label}</div>
                        <div className="col-span-4">
                          <Input type="time" placeholder={cfg.work_hour_in} value={sched.in || ""} onChange={(e) => setCfg({ ...cfg, work_schedule: { ...(cfg.work_schedule || {}), [d.key]: { ...sched, in: e.target.value } } })} data-testid={`sched-in-${d.key}`}/>
                        </div>
                        <div className="col-span-4">
                          <Input type="time" placeholder={cfg.work_hour_out} value={sched.out || ""} onChange={(e) => setCfg({ ...cfg, work_schedule: { ...(cfg.work_schedule || {}), [d.key]: { ...sched, out: e.target.value } } })} data-testid={`sched-out-${d.key}`}/>
                        </div>
                        <div className="col-span-1 text-right">
                          {(sched.in || sched.out) && (
                            <button type="button" title="Reset ke default" onClick={() => { const ws = { ...(cfg.work_schedule || {}) }; delete ws[d.key]; setCfg({ ...cfg, work_schedule: ws }); }} className="text-slate-400 hover:text-red-600 p-1">
                              <X size={12}/>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* --- Late threshold + Cutoff --- */}
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Batas Toleransi Telat (menit)</label>
                  <Input type="number" min="0" value={cfg.late_threshold_minutes} onChange={(e) => setCfg({ ...cfg, late_threshold_minutes: Number(e.target.value) })} data-testid="late-threshold"/>
                  <p className="text-[10px] text-slate-500 mt-0.5">Check-in melampaui jam masuk + threshold → ditandai TELAT.</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">Cutoff Payroll (tanggal)</label>
                  <Input type="number" min="1" max="31" value={cfg.payroll_cutoff_day} onChange={(e) => setCfg({ ...cfg, payroll_cutoff_day: Number(e.target.value) })} data-testid="payroll-cutoff-day"/>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Periode <b>YYYY-MM</b> = tanggal (cutoff+1) bulan itu s/d cutoff bulan berikutnya.<br/>
                    Contoh cutoff=25, <i>Juni 2026</i> = <b>26 Jun – 25 Jul</b>.
                  </p>
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
