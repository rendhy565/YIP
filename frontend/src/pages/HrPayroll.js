import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import ExcelJS from "exceljs";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, Edit2, PlayCircle, User, Users, Settings, Eye, FileSpreadsheet, Wallet, FileText } from "lucide-react";
import PayslipPrint from "../components/PayslipPrint";
import { useAuth } from "../lib/auth";
import { useNavigate } from "react-router-dom";
import NumberInput from "../components/NumberInput";

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
  position: "", bpjs_no: "", ptkp_status: "TK/0", pph21_active: false, base_salary: 0, allowance: 0, meal_allowance: 0, gaji_lumpsum: false, join_date: "", active: true,
  work_days: [], work_schedule: {}, sort_priority: "",
};

const WORK_DAY_OPTS = [
  { k: "mon", l: "Sen" }, { k: "tue", l: "Sel" }, { k: "wed", l: "Rab" },
  { k: "thu", l: "Kam" }, { k: "fri", l: "Jum" }, { k: "sat", l: "Sab" }, { k: "sun", l: "Min" },
];

// Kolom yang bisa toggle di table karyawan (fixed cols not in this list)
const TOGGLABLE_COLS = [
  { key: "employee_no", label: "ID Karyawan" },
  { key: "position", label: "Posisi/Jabatan" },
  { key: "base_salary", label: "Gaji Pokok" },
  { key: "gaji_lumpsum", label: "Lumpsum" },
  { key: "active", label: "Status Aktif" },
  { key: "nickname", label: "Nama Panggilan" },
  { key: "tempat_lahir", label: "Tempat Lahir" },
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

const DEFAULT_VISIBLE_COLS = ["employee_no", "position", "base_salary", "gaji_lumpsum", "active"];

export default function HrPayroll() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
        sort_priority: (form.sort_priority === "" || form.sort_priority == null || isNaN(parseInt(form.sort_priority, 10))) ? null : parseInt(form.sort_priority, 10),
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
  // ---- Slip gaji preview ----
  const [slipPreview, setSlipPreview] = useState(null);   // slip object atau null
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
  // ---- Export Simulasi ke Excel (format PERSIS PT ABIRAMA MITRA PRATAMA) ----
  const exportSimToExcel = async () => {
    if (!sim) return;
    const MONTH_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const MONTH_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
    const [yy, mm] = period.split("-");
    const monthIdx = Number(mm) - 1;
    const periodLabel = `${MONTH_ID[monthIdx]} ${yy}`;
    const shortLabel = `${MONTH_SHORT[monthIdx]} '${yy.slice(-2)}`;

    // Styling constants (dari reference file)
    const NUMFMT_ACCT = '_-* #,##0_-;\\-* #,##0_-;_-* "-"??_-';
    const NUMFMT_DATE = '[$-409]dd\\-mmm\\-yy;@';
    const COL_GRAY  = "FFD9D9D9";   // header abu-abu (theme 0 tint -0.15)
    const COL_BLUE  = "FFDDEBF7";   // biru muda (theme 7 tint 0.8)
    const COL_ROSE  = "FFFCE4D6";   // rose/orange muda (theme 8 tint 0.8) — KEHADIRAN
    const COL_YEL   = "FFFFFF66";   // kuning muda (POTONGAN GAJI/KASBON)
    const COL_YEL2  = "FFFFFF00";   // kuning terang (TOTAL row)
    const COL_LIGHT = "FFF2F2F2";   // paling terang (Take Home Pay theme 0 tint -0.05)

    const wb = new ExcelJS.Workbook();
    wb.creator = "AR-Cargo TMS";
    const ws = wb.addWorksheet(`Salary ${shortLabel}`, {
      views: [{ state: "frozen", ySplit: 7 }],
    });

    // Column widths (dari reference)
    ws.columns = [
      { width: 1.6 },   // A (spacer)
      { width: 4.5 },   // B  No
      { width: 25.7 },  // C  Nama
      { width: 8.9 },   // D  No. ID
      { width: 20.3 },  // E  Posisi
      { width: 12.4 },  // F  Mulai Kerja
      { width: 16.1 },  // G  No. Rekening
      { width: 8.6 },   // H  Bank
      { width: 12 },    // I  Gaji Pokok
      { width: 11.7 },  // J  Uang makan @Hari
      { width: 10.7 },  // K  TOTAL Hari Kerja
      { width: 8.3 },   // L  Hari Kerja
      { width: 5.3 },   // M  Cuti
      { width: 6.1 },   // N  Izin/Sakit
      { width: 5.3 },   // O  Alpa
      { width: 10 },    // P  TOTAL MASUK
      { width: 13.7 },  // Q  UANG MAKAN/HARI
      { width: 11 },    // R  UANG LEMBUR
      { width: 12.7 },  // S  TOTAL GAJI
      { width: 14 },    // T  POTONGAN GAJI
      { width: 14 },    // U  POTONGAN KASBON
      { width: 17.1 },  // V  Take Home Pay
    ];

    // Row 2-4: header block PT
    ws.getCell("B2").value = "GAJI KARYAWAN";
    ws.getCell("B3").value = "PT. ABIRAMA MITRA PRATAMA";
    ws.getCell("B4").value = `BULAN : ${periodLabel}`;
    // Row 5: spacer (kosong)
    ws.getRow(5).height = 5.25;

    // Row 6-7: header tabel (merged)
    ws.getRow(6).height = 24;
    ws.getRow(7).height = 45;
    // Level 1 (row 6)
    ws.getCell("B6").value = "No";
    ws.getCell("C6").value = "Nama";
    ws.getCell("D6").value = "No. ID \n( NIK )";
    ws.getCell("E6").value = "Posisi / Jabatan";
    ws.getCell("F6").value = "Mulai Kerja";
    ws.getCell("G6").value = "No. Rekening";
    ws.getCell("H6").value = "Bank";
    ws.getCell("I6").value = "KOMPONEN GAJI";
    ws.getCell("K6").value = `TOTAL \nHari Kerja\n@${shortLabel}`;
    ws.getCell("L6").value = "KEHADIRAN";
    ws.getCell("Q6").value = "UANG\nMAKAN/HARI";
    ws.getCell("R6").value = "UANG\nLEMBUR";
    ws.getCell("S6").value = "TOTAL\nGAJI";
    ws.getCell("T6").value = "POTONGAN\nGAJI";
    ws.getCell("U6").value = "POTONGAN\nKASBON";
    ws.getCell("V6").value = "Take Home Pay\nTOTAL TERIMA";
    // Level 2 (row 7)
    ws.getCell("I7").value = "Gaji Pokok";
    ws.getCell("J7").value = "Uang makan @Hari";
    ws.getCell("L7").value = "Hari Kerja";
    ws.getCell("M7").value = "Cuti";
    ws.getCell("N7").value = "Izin/\nSakit";
    ws.getCell("O7").value = "Alpa";
    ws.getCell("P7").value = "TOTAL MASUK";

    // Merges
    const merges = [
      "B6:B7","C6:C7","D6:D7","E6:E7","F6:F7","G6:G7","H6:H7",
      "I6:J6","K6:K7","L6:P6","Q6:Q7","R6:R7","S6:S7","T6:T7","U6:U7","V6:V7",
      "B5:H5",
    ];
    merges.forEach((m) => ws.mergeCells(m));

    // Style helper
    const setBg = (addr, argb) => {
      ws.getCell(addr).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    };
    const setBorder = (addr, style = "thin") => {
      const b = { style };
      ws.getCell(addr).border = { top: b, bottom: b, left: b, right: b };
    };
    const setHeader = (addr, bgColor) => {
      const c = ws.getCell(addr);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      setBg(addr, bgColor);
      setBorder(addr, "thin");
      c.font = { name: "Calibri", size: 11, bold: false };
    };
    // Apply header colors (row 6 + row 7 spans)
    ["B6","C6","D6","E6","F6","G6","H6","I6","J6","K6"].forEach((a) => setHeader(a, COL_GRAY));
    ["L6","M6","N6","O6","P6"].forEach((a) => setHeader(a, COL_ROSE));
    ["Q6","R6","S6"].forEach((a) => setHeader(a, COL_BLUE));
    ["T6","U6"].forEach((a) => setHeader(a, COL_YEL));
    setHeader("V6", COL_LIGHT);
    // Row 7 (sub-headers)
    ["I7","J7"].forEach((a) => setHeader(a, COL_GRAY));
    ["L7","M7","N7","O7","P7"].forEach((a) => setHeader(a, COL_ROSE));

    // Data rows dimulai baris 8
    const startRow = 8;
    // Urutan person disamakan PERSIS dengan file "8. AR-Cargo Gaji Periode Agust 2026.xlsx"
    const PERSON_ORDER = [
      "Amrullah", "Abidin", "Aris Priyanto", "Desvian Dwirendy Burhan", "Jensen Lif",
      "Reeza Marwan", "Elvina Abirahma", "Mohammad Raffy Anwar", "Iwan Habibi", "Ardiansyah",
      "Samsir", "M. Agus Masrukhan", "Dede Jubaedi", "Rachel Putri Indria",
      "Abdul Aziz Haddad Mujahid", "Wahyu Addien Althaf", "Deni Nugraha",
    ];
    const _normName = (x) => (x || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
    const _rankMap = new Map(PERSON_ORDER.map((n, i) => [_normName(n), i]));
    const slips = [...sim.slips].sort((a, b) => {
      const ra = _rankMap.has(_normName(a.employee_name)) ? _rankMap.get(_normName(a.employee_name)) : 999;
      const rb = _rankMap.has(_normName(b.employee_name)) ? _rankMap.get(_normName(b.employee_name)) : 999;
      return ra - rb;
    });
    slips.forEach((s, i) => {
      const r = startRow + i;
      const row = ws.getRow(r);
      row.height = 22;
      row.getCell(2).value = i + 1;
      row.getCell(3).value = s.employee_name || "";
      row.getCell(4).value = s.employee_no || "";
      row.getCell(5).value = s.position || "";
      // Mulai kerja: Date object jika ada, else string
      if (s.join_date) {
        const d = new Date(s.join_date);
        if (!isNaN(d)) row.getCell(6).value = d;
      }
      row.getCell(7).value = s.bank_account || "";
      row.getCell(8).value = s.bank_type || "";
      row.getCell(9).value = Number(s.gaji_pokok_net) || 0;   // I: Gaji Pokok (net setelah potongan Alfa langsung)
      row.getCell(10).value = Number(s.meal_allowance_per_day) || 0;  // J: Uang makan @Hari
      row.getCell(11).value = Number(s.working_days) || 0;    // K: TOTAL Hari Kerja
      row.getCell(12).value = Number(s.working_days) || 0;    // L: Hari Kerja
      row.getCell(13).value = 0;                              // M: Cuti (belum ada tracking)
      row.getCell(14).value = Number(s.hari_sakit || 0) + Number(s.hari_izin || 0);  // N
      row.getCell(15).value = Number(s.hari_alfa) || 0;       // O: Alpa
      row.getCell(16).value = Number(s.hari_hadir) || 0;      // P: TOTAL MASUK
      row.getCell(17).value = Number(s.uang_makan) || 0;      // Q: UANG MAKAN (total = per_day × hari_hadir)
      row.getCell(18).value = Number(s.lembur_total) || 0;    // R
      row.getCell(19).value = Number(s.gross) || 0;           // S
      // T (POTONGAN GAJI) sengaja dikosongkan — pengurangan Alfa sudah di-net di kolom I (Gaji Pokok)
      row.getCell(21).value = Number(s.potongan_kasbon) || 0; // U
      row.getCell(22).value = Number(s.net) || 0;             // V

      // Format & border per cell dalam baris
      const isLast = i === slips.length - 1;
      const isFirst = i === 0;
      for (let c = 2; c <= 22; c++) {
        const cell = row.getCell(c);
        // number formatting
        if ([9,10,17,18,19,20,21,22].includes(c)) cell.numFmt = NUMFMT_ACCT;
        else if ([11,12,13,14,15,16].includes(c)) cell.numFmt = NUMFMT_ACCT;
        else if (c === 6) cell.numFmt = NUMFMT_DATE;
        // alignment
        if (c === 3) cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        else cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        // background rules
        if ([20,21].includes(c)) setBg(row.getCell(c).address, COL_YEL);
        // border: top = thin/hair, bottom = hair/thin (last row), sides = hair, outer sides thin
        const top = isFirst ? "thin" : "hair";
        const bottom = isLast ? "thin" : "hair";
        const left = c === 2 ? "thin" : "hair";
        const right = c === 22 ? "thin" : "hair";
        cell.border = {
          top: { style: top },
          bottom: { style: bottom },
          left: { style: left },
          right: { style: right },
        };
      }
    });

    // TOTAL row
    const endRow = startRow + slips.length - 1;
    const totalRow = endRow + 1;
    const trow = ws.getRow(totalRow);
    trow.height = 25.5;
    ws.mergeCells(`B${totalRow}:F${totalRow}`);
    trow.getCell(2).value = "TOTAL";
    // SUM formulas untuk kolom angka utama
    trow.getCell(9).value  = { formula: `SUM(I${startRow}:I${endRow})` };
    trow.getCell(17).value = { formula: `SUM(Q${startRow}:Q${endRow})` };
    trow.getCell(18).value = { formula: `SUM(R${startRow}:R${endRow})` };
    trow.getCell(19).value = { formula: `SUM(S${startRow}:S${endRow})` };
    // T (POTONGAN GAJI) sengaja dikosongkan
    trow.getCell(21).value = { formula: `SUM(U${startRow}:U${endRow})` };
    trow.getCell(22).value = { formula: `SUM(V${startRow}:V${endRow})` };
    // Style TOTAL row (kuning terang + bold)
    for (let c = 2; c <= 22; c++) {
      const cell = trow.getCell(c);
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.alignment = { horizontal: c === 2 ? "center" : "center", vertical: "middle" };
      setBg(cell.address, COL_YEL2);
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: c === 2 ? "thin" : "hair" },
        right: { style: c === 22 ? "thin" : "hair" },
      };
      if ([9,17,18,19,20,21,22].includes(c)) cell.numFmt = NUMFMT_ACCT;
    }

    // Write & download
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Gaji ${periodLabel}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
                return c ? <Th key={k} className={["base_salary","meal_allowance","allowance"].includes(k) ? "text-right" : ""}>{c.label}</Th> : null;
              })}
              <Th className="text-right">Aksi</Th>
            </tr></thead>
            <tbody>
              {emps.length === 0 && <tr><Td colSpan={2 + visibleCols.length} className="text-center text-slate-400 py-6">Belum ada karyawan</Td></tr>}
              {emps.map((e) => (
                <tr key={e.id}>
                  <Td className="font-bold">{e.full_name}</Td>
                  {visibleCols.map((k) => {
                    let content = "-";
                    let alignRight = false;
                    if (k === "sim") {
                      const parts = [e.sim_a && `A:${e.sim_a}`, e.sim_c && `C:${e.sim_c}`, e.sim_lain && `Lain:${e.sim_lain}`].filter(Boolean);
                      content = parts.length ? parts.join(" ") : "-";
                    } else if (k === "bank") {
                      content = e.bank_type ? `${e.bank_type} ${e.bank_account || ""}` : "-";
                    } else if (k === "meal_allowance" || k === "allowance" || k === "base_salary") {
                      content = e[k] ? fmtIDR(e[k]) : "-";
                      alignRight = true;
                    } else if (k === "jenis_kelamin") {
                      content = e[k] === "L" ? "Laki-laki" : e[k] === "P" ? "Perempuan" : "-";
                    } else if (k === "gaji_lumpsum") {
                      content = e.gaji_lumpsum
                        ? <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">LUMPSUM</span>
                        : "-";
                    } else if (k === "active") {
                      content = <span className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold ${e.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{e.active ? "Aktif" : "Nonaktif"}</span>;
                    } else {
                      content = e[k] || "-";
                    }
                    const isMono = ["no_hp", "nik", "npwp", "bpjs_no", "employee_no"].includes(k);
                    return <Td key={k} className={`text-xs${isMono ? " font-mono" : ""}${alignRight ? " text-right" : ""}`}>{content}</Td>;
                  })}
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
                  <div><Label>Status PTKP</Label>
                    <Select data-testid="emp-ptkp-status" value={form.ptkp_status || "TK/0"} onChange={(e) => setForm({ ...form, ptkp_status: e.target.value })}>
                      {["TK/0","TK/1","TK/2","TK/3","K/0","K/1","K/2","K/3"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Hitung PPh21?</Label>
                    <label className="flex items-center gap-2 h-10 px-3 rounded border border-slate-200 cursor-pointer bg-white">
                      <input type="checkbox" data-testid="emp-pph21-active" checked={!!form.pph21_active} onChange={(e) => setForm({ ...form, pph21_active: e.target.checked })}/>
                      <span className="text-sm">{form.pph21_active ? "Aktif — PPh21 dihitung" : "Nonaktif — PPh21 = 0"}</span>
                    </label>
                  </div>
                  <div><Label>Tanggal Bergabung</Label><Input type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })}/></div>
                  <div><Label>Gaji Pokok (IDR)</Label><NumberInput value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })}/></div>
                  <div><Label>Uang Makan / Hari (IDR)</Label><NumberInput value={form.meal_allowance} onChange={(e) => setForm({ ...form, meal_allowance: e.target.value })} placeholder="Mis. 25000"/></div>
                  <div><Label>Tunjangan Lain (IDR)</Label><NumberInput value={form.allowance} onChange={(e) => setForm({ ...form, allowance: e.target.value })}/></div>
                  <div><Label>Status</Label>
                    <Select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                      <option value="1">Aktif</option>
                      <option value="0">Nonaktif</option>
                    </Select>
                  </div>
                </div>
                {/* Prioritas urutan tampil (angka) */}
                <div className="mt-3">
                  <Label>Prioritas Urutan (angka)</Label>
                  <Input type="number" data-testid="emp-sort-priority" value={form.sort_priority} onChange={(e) => setForm({ ...form, sort_priority: e.target.value })} placeholder="mis. 1, 2, 3 — makin kecil makin atas" />
                  <p className="text-[11px] text-slate-500 mt-1">Menentukan urutan karyawan di dropdown & daftar. Kosong = tampil paling bawah.</p>
                </div>
                {/* Jadwal Kerja per HARI per karyawan (override config global absensi) */}
                <div className="mt-3 border border-indigo-200 rounded p-3 bg-indigo-50/50" data-testid="emp-schedule-section">
                  <div className="font-heading font-bold text-sm text-indigo-900 mb-1">Jadwal Kerja per Hari (opsional)</div>
                  <p className="text-[11px] text-slate-500 mb-2">Centang hari kerja lalu isi jam masuk/pulang <b>masing-masing hari</b> (boleh beda tiap hari). Hari yang dikosongkan jam-nya tetap ikut jadwal global. Absen masuk melebihi jam ini ditandai <b>Telat</b>.</p>
                  <div className="space-y-1.5">
                    {WORK_DAY_OPTS.map((d) => {
                      const on = (form.work_days || []).includes(d.k);
                      const sc = (form.work_schedule || {})[d.k] || {};
                      const setDay = (patch) => setForm({ ...form, work_schedule: { ...(form.work_schedule || {}), [d.k]: { ...sc, ...patch } } });
                      const toggleDay = () => { const s = new Set(form.work_days || []); on ? s.delete(d.k) : s.add(d.k); setForm({ ...form, work_days: Array.from(s) }); };
                      return (
                        <div key={d.k} className="flex items-center gap-2">
                          <button type="button" data-testid={`emp-day-${d.k}`} onClick={toggleDay}
                            className={`w-16 px-2 py-1.5 rounded-lg text-xs font-bold border transition-colors ${on ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}>{d.l}</button>
                          <Input type="time" data-testid={`emp-in-${d.k}`} className="w-32" disabled={!on} value={sc.in || ""} onChange={(e) => setDay({ in: e.target.value })} />
                          <span className="text-slate-400 text-xs">s/d</span>
                          <Input type="time" data-testid={`emp-out-${d.k}`} className="w-32" disabled={!on} value={sc.out || ""} onChange={(e) => setDay({ out: e.target.value })} />
                          {!on ? <span className="text-[10px] text-slate-400">libur</span>
                            : (!sc.in && !sc.out) ? <span className="text-[10px] text-slate-400">ikut global</span> : null}
                        </div>
                      );
                    })}
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
              <div><Label>Periode</Label><MonthPicker value={period} onChange={(v) => { setPeriod(v); setSim(null); }} className="w-56"/></div>
              <div><Label>Bayar dari (Netto)</Label>
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
                    {" · "}Gross: <b>{fmtIDR(sim.total_gross)}</b>
                    {(sim.total_kasbon || 0) > 0 && <> {" · "}Kasbon: <b className="text-rose-700">−{fmtIDR(sim.total_kasbon)}</b></>}
                    {" · "}<span className="text-emerald-800">Net: <b>{fmtIDR(sim.total_net)}</b></span>
                  </div>
                  {sim.already_executed && (
                    <div className="text-xs text-rose-700 font-bold mt-1">⚠️ Periode ini SUDAH pernah dijalankan. Hapus dulu payroll lama sebelum re-run.</div>
                  )}
                  {(sim.total_kasbon || 0) > 0 && (
                    <div className="mt-2 text-[11px] bg-white/60 border border-blue-200 rounded p-2">
                      <b>📝 Preview Jurnal saat Konfirmasi Jalankan:</b>
                      <div className="font-mono mt-1 space-y-0.5">
                        <div>Dr <b>6101 Beban Gaji</b> ................. {fmtIDR(sim.total_gross)}</div>
                        <div>Cr <b>{cashAcc}</b> (Transfer netto) ...... {fmtIDR(sim.total_net)}</div>
                        <div>Cr <b>1109 Piutang Karyawan</b> (Kasbon) .. {fmtIDR(sim.total_kasbon)}</div>
                      </div>
                      <div className="mt-1 text-slate-600 italic">
                        Potongan kasbon otomatis mengurangi piutang kasbon karyawan (1109). Cicilan dikelola di menu <b>Kasbon Karyawan</b>.
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="ghost" onClick={() => setSim(null)}><X size={13}/> Tutup Preview</Button>
                  <Button variant="secondary" onClick={() => navigate("/hr/kasbon")} data-testid="sim-kasbon-btn">
                    <Wallet size={14}/> Kelola Kasbon{sim.total_kasbon > 0 ? ` (${fmtIDR(sim.total_kasbon)})` : ""}
                  </Button>
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
                    <Th className="text-right">Gross</Th>
                    <Th className="text-right">Kasbon</Th>
                    <Th className="text-right">Take Home</Th>
                    <Th className="text-right w-14">Slip</Th>
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
                        <Td className="text-right font-mono">{fmtIDR(s.gross)}</Td>
                        <Td className="text-right font-mono">
                          {(s.potongan_kasbon || 0) > 0
                            ? <span className="text-rose-700">−{fmtIDR(s.potongan_kasbon)}</span>
                            : <span className="text-slate-400">-</span>}
                        </Td>
                        <Td className="text-right font-mono font-bold text-emerald-900">{fmtIDR(s.net)}</Td>
                        <Td className="text-right">
                          <button
                            className="p-1 rounded hover:bg-blue-100 text-blue-700"
                            onClick={() => setSlipPreview(s)}
                            title="Lihat & Print Slip Gaji"
                            data-testid={`sim-slip-${s.employee_id}`}
                          >
                            <FileText size={14}/>
                          </button>
                        </Td>
                      </tr>
                    ))}
                    <tr className="bg-blue-100 font-bold">
                      <Td colSpan={7} className="text-right">TOTAL</Td>
                      <Td className="text-right font-mono">{fmtIDR(sim.total_gross)}</Td>
                      <Td className="text-right font-mono text-rose-700">{(sim.total_kasbon || 0) > 0 ? `−${fmtIDR(sim.total_kasbon)}` : "-"}</Td>
                      <Td className="text-right font-mono text-emerald-900">{fmtIDR(sim.total_net)}</Td>
                      <Td></Td>
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
                  <Th className="text-right w-14">Slip</Th>
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
                      <Td className="text-right font-mono font-bold">{fmtIDR(s.net != null ? s.net : s.gross)}</Td>
                      <Td className="text-right">
                        <button
                          className="p-1 rounded hover:bg-blue-100 text-blue-700"
                          onClick={() => setSlipPreview({ ...s, _period: p.period_month, _periodStart: p.period_start, _periodEnd: p.period_end })}
                          title="Slip Gaji"
                          data-testid={`hist-slip-${p.id}-${i}`}
                        >
                          <FileText size={13}/>
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ))}
        </Card>
      )}

      {/* Slip Gaji Preview Modal */}
      {slipPreview && (
        <PayslipPrint
          slip={slipPreview}
          period={slipPreview._period || period}
          periodStart={slipPreview._periodStart || (sim && sim.period_start)}
          periodEnd={slipPreview._periodEnd || (sim && sim.period_end)}
          onClose={() => setSlipPreview(null)}
        />
      )}
    </div>
  );
}
