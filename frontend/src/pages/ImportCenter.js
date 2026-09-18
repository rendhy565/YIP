import React, { useState } from "react";
import { PageHeader, Card, Button } from "../components/ui";
import api from "../lib/api";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import {
  Upload, Search, Save, PackagePlus, ListChecks,
  Ruler, Banknote, CalendarClock, Info, ShieldCheck,
} from "lucide-react";
import ImportExcel from "./ImportExcel";
import BulkImport from "./BulkImport";

const TABS = [
  { key: "awb-detail", label: "AWB & Revenue (Report)", icon: PackagePlus,
    desc: "Import/insert AWB dari Report (buat AWB baru, update detail & finansial, seed database awal)." },
  { key: "massal", label: "Rekonsiliasi Massal (DPP / Invoice / PO)", icon: ListChecks,
    desc: "Cocokkan Excel (No AWB, DPP, No Invoice, No PO) → isi/ubah DPP, nomor invoice + grouping, dan nomor PO sekaligus." },
  { key: "qty-tariff", label: "Qty & Tarif/Kg (Lampiran)", icon: Ruler,
    desc: "Isi kolom Qty & Tarif/Kg untuk tampilan lampiran invoice. TIDAK mengubah total & jurnal." },
  { key: "polis-asuransi", label: "Polis & Asuransi", icon: ShieldCheck,
    desc: "Isi nilai Polis & Asuransi per AWB (cocok by No. AWB). Nilai ini penambah invoice → grand_total dihitung ulang otomatis. DPP & PPN tidak diubah." },
  { key: "bkk", label: "BKK Expense", icon: Banknote,
    desc: "Import biaya BKK (panjar & expense) dari Excel ke modul Expense." },
  { key: "attendance", label: "Absensi Karyawan", icon: CalendarClock,
    desc: "Import kehadiran karyawan (merge / timpa) dari Excel/CSV." },
];

export default function ImportCenter() {
  const [tab, setTab] = useState("awb-detail");
  const active = TABS.find((t) => t.key === tab);
  return (
    <div data-testid="import-center-page">
      <PageHeader title="Pusat Import" subtitle="Semua fitur import terpusat di sini (khusus Administrator)." />

      <div className="flex flex-wrap gap-2 mb-4" data-testid="import-center-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              data-testid={`import-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 text-sm text-blue-900">
        <Info size={16} className="mt-0.5 shrink-0" /> <span>{active?.desc}</span>
      </div>

      {tab === "awb-detail" && <ImportExcel embedded />}
      {tab === "massal" && <BulkImport embedded />}
      {tab === "qty-tariff" && <QtyTariffImporter />}
      {tab === "polis-asuransi" && <PolisAsuransiImporter />}
      {tab === "bkk" && <BkkImporter />}
      {tab === "attendance" && <AttendanceImporter />}
    </div>
  );
}

// ── Qty & Tarif/Kg ──────────────────────────────────────────────────────────
function QtyTariffImporter() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const runPreview = async () => {
    if (!file) return toast.error("Pilih file Excel dulu");
    setBusy(true); setPreview(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/import/qty-tariff/preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(r.data);
      if (r.data.matched === 0) toast.error("Tidak ada AWB yang cocok");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const runApply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/import/qty-tariff/apply", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data); toast.success(`Selesai — ${r.data.updated} AWB diupdate`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const dlTemplate = async () => {
    try {
      const r = await api.get("/import/qty-tariff/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url; a.download = "Template_Qty_Tarif.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Card className="p-5" data-testid="qty-tariff-importer">
      <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900 mb-3">
        Hanya mengisi kolom <b>Qty & Tarif/Kg</b> (tampilan lampiran). Total invoice & jurnal <b>TIDAK diubah</b>. Cocok by <b>No. AWB</b>. Kolom: <code>AWB</code>, <code>Qty</code>, <code>Harga /KG</code>.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={dlTemplate}><Upload size={14}/> Unduh Template</Button>
        <input type="file" accept=".xlsx,.xls" data-testid="qt-file"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} className="text-sm"/>
        {!preview && <Button data-testid="qt-preview" onClick={runPreview} disabled={busy || !file}><Search size={14}/> {busy ? "Membaca..." : "Preview"}</Button>}
        {preview && !result && <Button data-testid="qt-apply" onClick={runApply} disabled={busy || preview.matched === 0}><Save size={14}/> Terapkan ({preview.matched})</Button>}
      </div>
      {preview && !result && (
        <div className="mt-3 text-sm flex flex-wrap gap-4">
          <span className="text-emerald-700">Cocok: <b>{preview.matched}</b></span>
          <span>Qty diisi: <b>{preview.qty_to_fill}</b></span>
          <span>Tarif diisi: <b>{preview.tariff_to_fill}</b></span>
          {preview.mismatch_count > 0 && <span className="text-amber-700">⚠ {preview.mismatch_count} mismatch</span>}
          {preview.not_found?.length > 0 && <span className="text-rose-700">Tidak ketemu: <b>{preview.not_found.length}</b></span>}
        </div>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-emerald-900" data-testid="qt-result">
          ✅ {result.updated} AWB diupdate — Qty: {result.qty_set}, Tarif: {result.tariff_set}. {result.not_found?.length ? `${result.not_found.length} tidak ketemu.` : ""}
        </div>
      )}
    </Card>
  );
}

// ── Polis & Asuransi ─────────────────────────────────────────────────────────
function PolisAsuransiImporter() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const runPreview = async () => {
    if (!file) return toast.error("Pilih file Excel dulu");
    setBusy(true); setPreview(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/import/polis-asuransi/preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(r.data);
      if (r.data.matched === 0) toast.error("Tidak ada AWB yang cocok");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const runApply = async () => {
    if (!file) return;
    if (!window.confirm(`Terapkan Polis & Asuransi ke ${preview?.to_change || 0} AWB? grand_total akan dihitung ulang.`)) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/import/polis-asuransi/apply", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data); toast.success(`Selesai — ${r.data.updated} AWB diupdate`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const dlTemplate = async () => {
    try {
      const r = await api.get("/import/polis-asuransi/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url; a.download = "Template_Polis_Asuransi.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const fmt = (n) => "Rp " + (Number(n || 0)).toLocaleString("id-ID", { maximumFractionDigits: 0 });
  return (
    <Card className="p-5" data-testid="polis-asuransi-importer">
      <div className="bg-teal-50 border border-teal-200 rounded p-2 text-xs text-teal-900 mb-3">
        Mengisi <b>Polis</b> & <b>Asuransi</b> per AWB (cocok by <b>No. AWB</b>). Nilai ini <b>penambah invoice</b> → <b>grand_total dihitung ulang</b> otomatis. DPP, PPN & jurnal <b>TIDAK diubah</b>. Kolom: <code>AWB</code>, <code>Polis</code>, <code>Asuransi</code>. Kolom kosong = nilai lama dipertahankan.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={dlTemplate} data-testid="pa-template"><Upload size={14}/> Unduh Template</Button>
        <input type="file" accept=".xlsx,.xls" data-testid="pa-file"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} className="text-sm"/>
        {!preview && <Button data-testid="pa-preview" onClick={runPreview} disabled={busy || !file}><Search size={14}/> {busy ? "Membaca..." : "Preview"}</Button>}
        {preview && !result && <Button data-testid="pa-apply" onClick={runApply} disabled={busy || preview.to_change === 0}><Save size={14}/> Terapkan ({preview.to_change})</Button>}
      </div>
      {preview && !result && (
        <>
          <div className="mt-3 text-sm flex flex-wrap gap-4" data-testid="pa-preview-summary">
            <span className="text-emerald-700">Cocok: <b>{preview.matched}</b></span>
            <span>Akan berubah: <b>{preview.to_change}</b></span>
            <span>Polis diisi: <b>{preview.polis_to_fill}</b></span>
            <span>Asuransi diisi: <b>{preview.asuransi_to_fill}</b></span>
            {preview.not_found?.length > 0 && <span className="text-rose-700">Tidak ketemu: <b>{preview.not_found.length}</b></span>}
          </div>
          {preview.items?.some((it) => it.changed) && (
            <div className="mt-3 overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">AWB</th>
                    <th className="text-right px-3 py-2">Polis</th>
                    <th className="text-right px-3 py-2">Asuransi</th>
                    <th className="text-right px-3 py-2">Grand Total (lama → baru)</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.filter((it) => it.changed).slice(0, 100).map((it) => (
                    <tr key={it.awb_id} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{it.awb_number}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmt(it.new_polis)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmt(it.new_asuransi)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        <span className="text-slate-400">{fmt(it.current_grand_total)}</span> → <b className="text-teal-700">{fmt(it.new_grand_total)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-emerald-900" data-testid="pa-result">
          ✅ {result.updated} AWB diupdate (Polis & Asuransi + grand_total). {result.not_found?.length ? `${result.not_found.length} tidak ketemu.` : ""}
        </div>
      )}
    </Card>
  );
}

// ── BKK Expense ───────────────────────────────────────────────────────────
function BkkImporter() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const runPreview = async () => {
    if (!file) return toast.error("Pilih file dulu");
    setBusy(true); setPreview(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/expense/import-bkk?dry_run=true", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(r.data);
      toast.success(`Preview: ${r.data.panjar_imported} panjar + ${r.data.expense_imported} expense`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const runApply = async () => {
    if (!file) return;
    if (!window.confirm(`Import ${preview?.panjar_imported || 0} panjar + ${preview?.expense_imported || 0} expense?`)) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/expense/import-bkk", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data); toast.success(`✓ ${r.data.panjar_imported} panjar & ${r.data.expense_imported} expense ter-import`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5" data-testid="bkk-importer">
      <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs text-slate-700 mb-3">
        Import biaya <b>BKK</b> (panjar & expense) dari Excel ke modul Expense. Tahap: Preview (dry-run) → Import.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.xls" data-testid="bkk-file"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} className="text-sm"/>
        {!preview && <Button data-testid="bkk-preview" onClick={runPreview} disabled={busy || !file}><Search size={14}/> {busy ? "Membaca..." : "Preview"}</Button>}
        {preview && !result && <Button data-testid="bkk-apply" onClick={runApply} disabled={busy}><Save size={14}/> Import</Button>}
      </div>
      {preview && !result && (
        <div className="mt-3 text-sm flex flex-wrap gap-4">
          <span>Panjar: <b>{preview.panjar_imported}</b></span>
          <span>Expense: <b>{preview.expense_imported}</b></span>
          {preview.skipped ? <span className="text-amber-700">Dilewati: <b>{preview.skipped}</b></span> : null}
        </div>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-emerald-900" data-testid="bkk-result">
          ✓ {result.panjar_imported} panjar & {result.expense_imported} expense ter-import.
        </div>
      )}
    </Card>
  );
}

// ── Absensi Karyawan ─────────────────────────────────────────────────────────
function AttendanceImporter() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("merge");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const runPreview = async () => {
    if (!file) return toast.error("Pilih file dulu");
    setBusy(true); setPreview(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/hr/attendance/import?mode=${mode}&dry_run=true`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(data);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const runApply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/hr/attendance/import?mode=${mode}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data); toast.success(`${data.imported} baris ter-import (${data.mode === "merge" ? "Merge" : "Timpa Total"})`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5" data-testid="attendance-importer">
      <div className="mb-3 flex flex-wrap gap-3">
        <label className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer text-sm ${mode === "merge" ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
          <input type="radio" name="attmode" className="mt-1" checked={mode === "merge"} onChange={() => setMode("merge")} data-testid="att-mode-merge"/>
          <span><b>Merge (rekomendasi)</b><br/><span className="text-xs text-slate-500">Hanya update kolom yang ada di file; pertahankan data lama.</span></span>
        </label>
        <label className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer text-sm ${mode === "overwrite" ? "border-rose-400 bg-rose-50" : "border-slate-200"}`}>
          <input type="radio" name="attmode" className="mt-1" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} data-testid="att-mode-overwrite"/>
          <span><b>Timpa Total</b><br/><span className="text-xs text-slate-500">Ganti seluruh baris dari file.</span></span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.xls,.csv" data-testid="att-file"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} className="text-sm"/>
        {!preview && <Button data-testid="att-preview" onClick={runPreview} disabled={busy || !file}><Search size={14}/> {busy ? "Membaca..." : "Preview"}</Button>}
        {preview && !result && <Button data-testid="att-apply" onClick={runApply} disabled={busy}><Save size={14}/> Import ({preview.to_import ?? preview.imported ?? "?"})</Button>}
      </div>
      {preview && !result && (
        <div className="mt-3 text-sm flex flex-wrap gap-4">
          <span>Baris siap: <b>{preview.to_import ?? preview.imported ?? "-"}</b></span>
          {preview.conflicts?.length > 0 && <span className="text-amber-700">⚠ {preview.conflicts.length} konflik (data lama akan berubah)</span>}
          {preview.not_matched?.length > 0 && <span className="text-rose-700">Karyawan tak cocok: <b>{preview.not_matched.length}</b></span>}
        </div>
      )}
      {result && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-emerald-900" data-testid="att-result">
          ✓ {result.imported} baris ter-import ({result.mode === "merge" ? "Merge" : "Timpa Total"}).
        </div>
      )}
    </Card>
  );
}
