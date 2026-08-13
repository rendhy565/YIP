import React, { useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Label } from "../components/ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2, PlayCircle, Eye, FileWarning } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function ImportExcel() {
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [step, setStep] = useState(1); // 1=upload, 2=sheets, 3=preview, 4=done

  // ── Update Cost (Timpa) — importer terpisah khusus biaya ──
  const [costFile, setCostFile] = useState(null);
  const [costPreview, setCostPreview] = useState(null);
  const [costResult, setCostResult] = useState(null);
  const [costBusy, setCostBusy] = useState(false);

  if (user?.role !== "administrator") {
    return (
      <div className="p-8 max-w-2xl">
        <Card className="p-6 bg-amber-50 border-amber-200 text-amber-900">
          <h3 className="font-bold mb-2 flex items-center gap-2"><AlertCircle size={18}/> Akses Ditolak</h3>
          <p className="text-sm">Hanya Administrator yang dapat melakukan import & wipe data.</p>
        </Card>
      </div>
    );
  }

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setSheets(null); setPreview(null); setResult(null); setSelectedSheets([]);
    setStep(1);
  };

  const listSheets = async () => {
    if (!file) return toast.error("Pilih file dulu");
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/import/excel/list-sheets", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setSheets(r.data);
      setSelectedSheets(r.data.recommended || []);
      setStep(2);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy(true); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dry_run", "true");
      if (selectedSheets.length > 0) fd.append("sheet_names", selectedSheets.join(","));
      const r = await api.post("/import/excel", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(r.data);
      setStep(3);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!window.confirm(`Yakin import ${preview?.awbs_created || 0} AWB? Auto-jurnal akan diposting.`)) return;
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dry_run", "false");
      if (selectedSheets.length > 0) fd.append("sheet_names", selectedSheets.join(","));
      const r = await api.post("/import/excel", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 180000,
      });
      setResult(r.data);
      setStep(4);
      toast.success("Import selesai!");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const runWipe = async () => {
    if (wipeText !== "HAPUS SEMUA DATA") return toast.error("Ketik tepat: HAPUS SEMUA DATA");
    if (!window.confirm("KONFIRMASI TERAKHIR — semua data transaksional (AWB, biaya, invoice, customer, vendor, jurnal, dst.) akan dihapus PERMANEN. Lanjut?")) return;
    setBusy(true);
    try {
      const r = await api.post("/admin/wipe-transactions", { confirm: "HAPUS SEMUA DATA" });
      const total = Object.values(r.data.deleted).reduce((s, n) => s + n, 0);
      toast.success(`${total} dokumen terhapus`);
      setWipeText("");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const toggleSheet = (n) => {
    setSelectedSheets((s) => s.includes(n) ? s.filter((x) => x !== n) : [...s, n]);
  };

  const costRunPreview = async () => {
    if (!costFile) return toast.error("Pilih file dulu");
    setCostBusy(true); setCostPreview(null); setCostResult(null);
    try {
      const fd = new FormData(); fd.append("file", costFile);
      const r = await api.post("/import/cost/preview", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 180000 });
      setCostPreview(r.data);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setCostBusy(false); }
  };
  const costRunApply = async () => {
    if (!costPreview) return;
    if (!window.confirm(`TIMPA biaya untuk ${costPreview.matched} AWB?\n\nCost lama pada AWB tsb (${costPreview.old_costs_to_replace} baris) akan DIHAPUS beserta jurnalnya, lalu diganti ${costPreview.new_costs} cost baru + jurnal biaya. Revenue TIDAK berubah.`)) return;
    setCostBusy(true);
    try {
      const fd = new FormData(); fd.append("file", costFile);
      const r = await api.post("/import/cost/apply", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 300000 });
      setCostResult(r.data);
      toast.success(`Selesai — ${r.data.awbs_updated} AWB, ${r.data.new_costs_created} cost, ${r.data.journals_posted} jurnal`);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setCostBusy(false); }
  };

  return (
    <div data-testid="import-page">
      <PageHeader title="Import Data Excel" subtitle="Import REPORT PENJUALAN dari file XLSX. Master Customer & Vendor otomatis dibuat. Jurnal akunting otomatis terposting." />

      {/* Loading overlay — spinner + progress text when import is busy */}
      {busy && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center" data-testid="import-loading-overlay">
          <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md text-center">
            {/* Circle spinner */}
            <div className="inline-block">
              <svg className="animate-spin h-16 w-16 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div className="mt-4 font-heading font-bold text-lg text-slate-900">Memproses Import...</div>
            <div className="text-xs text-slate-600 mt-1">Mohon tunggu, jangan tutup halaman ini.</div>
            {/* Indeterminate progress bar */}
            <div className="mt-4 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 animate-pulse" style={{ width: "70%" }}></div>
            </div>
          </div>
        </div>
      )}

      {/* UPDATE COST (TIMPA) — importer khusus biaya */}
      <Card className="mb-6 border-indigo-300" data-testid="cost-import-card">
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-indigo-700"/>
          <h3 className="font-bold text-indigo-900">Update Cost (Timpa) — Biaya per AWB</h3>
        </div>
        <div className="p-4 text-sm">
          <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900 mb-3">
            Upload file yang <b>AWB-nya sama</b> tapi kolom <b>biaya</b> sudah diisi. Sistem mencocokkan <b>No. AWB</b>, lalu <b>menimpa (overwrite)</b> semua cost lama AWB tsb dengan yang baru dan <b>membuat jurnal biaya langsung</b> (Dr Beban / Cr Hutang Vendor 2101 atau Kas 1101 bila "sudah bayar"). <b>Revenue & jurnal revenue TIDAK diubah.</b> Kolom terbaca: Vendor 1/2 + T.Tagihan/Inv + Status, Biaya Ops, Uang Jalan (Lintas).
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <Label>File (.xlsx)</Label>
              <input
                data-testid="cost-import-file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => { setCostFile(e.target.files?.[0] || null); setCostPreview(null); setCostResult(null); }}
                className="block w-full text-sm border border-slate-300 rounded px-3 py-2 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white file:cursor-pointer file:font-bold"
              />
              {costFile && <div className="text-xs text-slate-500 mt-1">📎 {costFile.name} ({(costFile.size/1024).toFixed(1)} KB)</div>}
            </div>
            <Button data-testid="cost-import-preview-btn" onClick={costRunPreview} disabled={!costFile || costBusy}>
              <Eye size={14}/> {costBusy && !costResult ? "Membaca..." : "Cek / Preview"}
            </Button>
          </div>

          {costPreview && !costResult && (
            <div className="mt-4" data-testid="cost-import-preview">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Stat label="AWB cocok" value={costPreview.matched} good/>
                <Stat label="Cost baru" value={costPreview.new_costs} good/>
                <Stat label="Cost lama ditimpa" value={costPreview.old_costs_to_replace} warn={costPreview.old_costs_to_replace > 0}/>
                <Stat label="AWB tak ditemukan" value={(costPreview.not_found || []).length} warn={(costPreview.not_found || []).length > 0}/>
              </div>
              <div className="text-xs text-slate-600 mb-3">
                Total cost baru: <b>{fmtIDR(costPreview.new_cost_sum)}</b> · Total cost lama yang akan diganti: <b>{fmtIDR(costPreview.old_cost_sum)}</b>
              </div>
              {(costPreview.not_found || []).length > 0 && (
                <details className="rounded border border-rose-300 bg-rose-50/60 mb-3">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-bold text-rose-900">{costPreview.not_found.length} AWB tidak ditemukan (dilewati)</summary>
                  <div className="px-3 pb-3 font-mono text-xs max-h-32 overflow-auto">{costPreview.not_found.join(", ")}</div>
                </details>
              )}
              <div className="border border-slate-200 rounded max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0"><tr>
                    <th className="p-2 text-left">No. AWB</th><th className="p-2 text-right">Cost Lama</th><th className="p-2 text-right">Cost Baru</th><th className="p-2 text-right">Nilai Baru</th>
                  </tr></thead>
                  <tbody>
                    {costPreview.items.map((it) => (
                      <tr key={it.awb_number} className="border-t border-slate-100">
                        <td className="p-2 font-mono">{it.awb_number}</td>
                        <td className="p-2 text-right">{it.old_cost_count}</td>
                        <td className="p-2 text-right font-semibold">{it.new_cost_count}</td>
                        <td className="p-2 text-right font-mono">{fmtIDR(it.new_cost_sum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-right mt-3">
                <Button data-testid="cost-import-apply-btn" variant="success" onClick={costRunApply} disabled={costBusy || costPreview.matched === 0}>
                  <PlayCircle size={14}/> {costBusy ? "Menerapkan..." : `Timpa & Buat Jurnal (${costPreview.matched} AWB)`}
                </Button>
              </div>
            </div>
          )}

          {costResult && (
            <div className="mt-4 bg-emerald-50/50 rounded p-3" data-testid="cost-import-result">
              <div className="text-sm font-bold mb-2 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-700"/> Selesai</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="AWB diupdate" value={costResult.awbs_updated} good/>
                <Stat label="Cost lama dihapus" value={costResult.old_costs_removed}/>
                <Stat label="Cost baru dibuat" value={costResult.new_costs_created} good/>
                <Stat label="Jurnal diposting" value={costResult.journals_posted} good/>
              </div>
              {(costResult.not_found || []).length > 0 && (
                <p className="text-xs text-rose-700 mt-2">{costResult.not_found.length} AWB tidak ditemukan: <span className="font-mono">{costResult.not_found.slice(0,40).join(", ")}</span></p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* DANGER ZONE: WIPE */}
      <Card className="mb-6 border-rose-300">
        <div className="px-4 py-3 bg-rose-50 border-b border-rose-200 flex items-center gap-2">
          <Trash2 size={16} className="text-rose-700"/>
          <h3 className="font-bold text-rose-900">Danger Zone — Hapus Data</h3>
        </div>
        <div className="p-4 text-sm">
          <p className="text-rose-900 mb-3">
            Hapus seluruh data transaksional & master (AWB, biaya, invoice, customer, vendor, jurnal, payroll, aset, dll).
            <br/>Akun pengguna, Chart of Accounts, & Setting tetap aman.
          </p>
          <div className="flex items-center gap-3">
            <input
              data-testid="wipe-confirm-input"
              value={wipeText}
              onChange={(e) => setWipeText(e.target.value)}
              placeholder='Ketik "HAPUS SEMUA DATA" untuk konfirmasi'
              className="flex-1 px-3 py-2 border border-rose-300 rounded text-sm focus:ring-2 focus:ring-rose-300 outline-none"
            />
            <Button data-testid="wipe-execute-btn" variant="danger" onClick={runWipe} disabled={busy || wipeText !== "HAPUS SEMUA DATA"}>
              <Trash2 size={14}/> HAPUS
            </Button>
          </div>
        </div>
      </Card>

      {/* IMPORT WIZARD */}
      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-blue-700"/>
          <h3 className="font-bold">Import Wizard</h3>
          <div className="ml-auto flex gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= s ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>{s}</div>
            ))}
          </div>
        </div>

        {/* STEP 1: Upload */}
        <div className="p-5 border-b border-slate-200">
          <div className="text-sm font-bold mb-2 flex items-center gap-2"><span className="bg-blue-600 text-white rounded-full w-6 h-6 text-xs inline-flex items-center justify-center">1</span> Pilih File Excel</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <Label>File (.xlsx)</Label>
              <input
                data-testid="import-file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={onFileChange}
                className="block w-full text-sm border border-slate-300 rounded px-3 py-2 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer file:font-bold"
              />
              {file && <div className="text-xs text-slate-500 mt-1">📎 {file.name} ({(file.size/1024).toFixed(1)} KB)</div>}
            </div>
            <Button data-testid="import-list-sheets-btn" onClick={listSheets} disabled={!file || busy}>
              <Upload size={14}/> Baca Struktur File
            </Button>
          </div>
        </div>

        {/* STEP 2: Sheet selection */}
        {sheets && (
          <div className="p-5 border-b border-slate-200">
            <div className="text-sm font-bold mb-2 flex items-center gap-2"><span className="bg-blue-600 text-white rounded-full w-6 h-6 text-xs inline-flex items-center justify-center">2</span> Pilih Sheet untuk Diimport</div>
            <p className="text-xs text-slate-600 mb-3">
              💡 Rekomendasi: <strong className="text-blue-700">{(sheets.recommended || []).join(", ")}</strong> — paling lengkap & tidak duplikat.
              Jika pilih per-bulan, bisa multi-select tapi pastikan tidak overlap dengan DATA ALL BASE.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {sheets.sheets.map((s) => (
                <label key={s.name} className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${selectedSheets.includes(s.name) ? "bg-blue-50 border-blue-400" : "border-slate-200 hover:border-slate-300"} ${!s.is_data_sheet ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selectedSheets.includes(s.name)}
                    onChange={() => toggleSheet(s.name)}
                    disabled={!s.is_data_sheet}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.estimated_data_rows} baris data {s.is_data_sheet ? "" : "(bukan data sheet)"}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-3 text-right">
              <Button data-testid="import-preview-btn" onClick={runPreview} disabled={busy || selectedSheets.length === 0}>
                <Eye size={14}/> Lihat Preview
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Preview */}
        {preview && (
          <div className="p-5 border-b border-slate-200 bg-amber-50/30">
            <div className="text-sm font-bold mb-2 flex items-center gap-2"><span className="bg-blue-600 text-white rounded-full w-6 h-6 text-xs inline-flex items-center justify-center">3</span> Preview Hasil (belum disimpan)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <Stat label="Customer baru" value={preview.customers_created}/>
              <Stat label="Vendor baru" value={preview.vendors_created}/>
              <Stat label="AWB akan dibuat" value={preview.awbs_created}/>
              <Stat label="Item lines" value={preview.awb_items_added}/>
              <Stat label="Costs" value={preview.costs_created}/>
              <Stat label="Invoices" value={preview.invoices_created}/>
              <Stat label="Sheets diproses" value={(preview.sheets_processed || []).length}/>
              <Stat label="Baris di-skip" value={preview.skipped_rows} warn={preview.skipped_rows > 0}/>
            </div>
            {preview.sheets_processed && preview.sheets_processed.length > 0 && (
              <div className="text-xs text-slate-600 mb-3">
                <strong>Detail per sheet:</strong>
                {preview.sheets_processed.map((s, i) => (
                  <div key={i} className="ml-2">• <strong>{s.sheet}</strong>: {s.rows_read} baris dibaca → {s.awbs} AWB · {s.items} item · {s.costs} biaya</div>
                ))}
              </div>
            )}
            {preview.errors && preview.errors.length > 0 && (
              <Card className="p-3 mb-3 bg-rose-50 border-rose-200">
                <div className="text-sm font-bold text-rose-900 mb-1 flex items-center gap-1"><FileWarning size={14}/> {preview.errors.length} error(s):</div>
                <ul className="text-xs text-rose-800 list-disc pl-5">
                  {preview.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  {preview.errors.length > 5 && <li>... dan {preview.errors.length - 5} lagi</li>}
                </ul>
              </Card>
            )}
            <DataQualityPanels data={preview}/>
            <div className="text-right">
              <Button data-testid="import-execute-btn" variant="success" onClick={runImport} disabled={busy}>
                <PlayCircle size={14}/> Eksekusi Import
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4: Result */}
        {result && (
          <div className="p-5 bg-emerald-50/40">
            <div className="text-sm font-bold mb-2 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-700"/> 4. Selesai!</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Customer" value={result.customers_created} good/>
              <Stat label="Vendor" value={result.vendors_created} good/>
              <Stat label="AWB" value={result.awbs_created} good/>
              <Stat label="Item lines" value={result.awb_items_added} good/>
              <Stat label="Costs" value={result.costs_created} good/>
              <Stat label="Invoices" value={result.invoices_created} good/>
              <Stat label="Jurnal posted" value={result.journals_posted} good/>
              <Stat label="Skipped" value={result.skipped_rows} warn={result.skipped_rows > 0}/>
            </div>
            <DataQualityPanels data={result}/>
            <p className="text-xs text-slate-600 mt-3">Data sudah masuk. Cek <a className="text-blue-700 underline" href="/orders">Daftar AWB</a>, <a className="text-blue-700 underline" href="/accounting/journal">Jurnal Umum</a>, atau <a className="text-blue-700 underline" href="/accounting/balance-sheet">Neraca</a>.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, good, warn }) {
  return (
    <div className={`rounded border p-3 ${good ? "bg-emerald-50 border-emerald-200" : warn ? "bg-amber-50 border-amber-300" : "bg-white border-slate-200"}`}>
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</div>
      <div className={`text-xl font-mono font-black ${good ? "text-emerald-800" : warn ? "text-amber-800" : "text-slate-800"}`}>{value ?? 0}</div>
    </div>
  );
}

function DataQualityPanels({ data }) {
  const corrected = data.auto_corrected || [];
  const skipped = data.skipped_details || [];
  if (corrected.length === 0 && skipped.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      {corrected.length > 0 && (
        <details className="rounded border border-blue-300 bg-blue-50/60" open>
          <summary className="px-3 py-2 cursor-pointer text-sm font-bold text-blue-900 flex items-center gap-2">
            <FileWarning size={14}/> {corrected.length} baris di-auto-correct (INV+PPN tidak match SELLING+PPN di Excel)
          </summary>
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-slate-600">
                <tr className="text-left border-b border-blue-200">
                  <th className="py-1.5 pr-3">Sheet</th>
                  <th className="pr-3">Row</th>
                  <th className="pr-3">AWB</th>
                  <th className="pr-3">Field</th>
                  <th className="pr-3 text-right">Asli (Excel)</th>
                  <th className="pr-3 text-right">Diperbaiki</th>
                  <th className="pr-3 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {corrected.slice(0, 50).map((c, i) => (
                  <tr key={i} className="border-b border-blue-100 last:border-0">
                    <td className="py-1 pr-3 text-slate-500">{c.sheet}</td>
                    <td className="pr-3 text-slate-500">{c.row}</td>
                    <td className="pr-3 font-mono font-bold">{c.awb}</td>
                    <td className="pr-3">{c.field}</td>
                    <td className="pr-3 text-right font-mono text-rose-700">{Number(c.original).toLocaleString("id-ID")}</td>
                    <td className="pr-3 text-right font-mono text-emerald-800 font-bold">{Number(c.corrected).toLocaleString("id-ID")}</td>
                    <td className="pr-3 text-right font-mono">{c.diff > 0 ? "+" : ""}{Number(c.diff).toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {corrected.length > 50 && (
                  <tr><td colSpan={7} className="text-slate-500 py-1 italic">... dan {corrected.length - 50} baris lainnya</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {skipped.length > 0 && (
        <details className="rounded border border-amber-300 bg-amber-50/60" open>
          <summary className="px-3 py-2 cursor-pointer text-sm font-bold text-amber-900 flex items-center gap-2">
            <AlertCircle size={14}/> {skipped.length} baris di-skip (data rusak / tidak bisa diperbaiki otomatis)
          </summary>
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-slate-600">
                <tr className="text-left border-b border-amber-200">
                  <th className="py-1.5 pr-3">Sheet</th>
                  <th className="pr-3">Row</th>
                  <th className="pr-3">AWB</th>
                  <th className="pr-3">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {skipped.map((s, i) => (
                  <tr key={i} className="border-b border-amber-100 last:border-0">
                    <td className="py-1 pr-3 text-slate-500">{s.sheet}</td>
                    <td className="pr-3 text-slate-500">{s.row}</td>
                    <td className="pr-3 font-mono font-bold">{s.awb || "(kosong)"}</td>
                    <td className="pr-3">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
