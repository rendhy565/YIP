import React, { useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Label } from "../components/ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Upload, Download, AlertTriangle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";

function Section({ title, items, render, tone = "slate" }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;
  const tones = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  };
  return (
    <div className={`border rounded ${tones[tone]}`}>
      <button className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="text-xs bg-white/70 rounded px-2 py-0.5">{items.length}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 max-h-64 overflow-auto text-xs space-y-1">
          {items.map((it, i) => <div key={i} className="border-t border-white/50 pt-1">{render(it)}</div>)}
        </div>
      )}
    </div>
  );
}

export default function BulkImport() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);   // { report, items }
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [flags, setFlags] = useState({ apply_dpp: true, apply_invoice: true, apply_po: true });

  const downloadTemplate = async () => {
    try {
      const r = await api.get("/admin/bulk-import/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a"); a.href = url; a.download = "Template_Import_Massal_AWB.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const doPreview = async () => {
    if (!file) { toast.error("Pilih file Excel dulu"); return; }
    setLoading(true); setPreview(null); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post("/admin/bulk-import/preview", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(r.data);
      if (r.data?.report?.has_actions === false) {
        toast.success("Semua data di file sudah sama dengan sistem — tidak ada yang perlu diubah");
      } else {
        toast.success("Pratinjau siap — periksa laporan di bawah");
      }
    } catch (e) { toast.error(errMsg(e)); }
    finally { setLoading(false); }
  };

  const doApply = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const r = await api.post("/admin/bulk-import/apply", { items: preview.items, ...flags });
      setResult(r.data);
      toast.success("Import selesai — lihat laporan hasil");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setLoading(false); }
  };

  const rep = preview?.report;

  return (
    <div data-testid="bulk-import-page">
      <PageHeader title="Import Massal AWB" subtitle="Cocokkan data dari Excel (No AWB, DPP, No Invoice, No PO) ke sistem. Dua tahap: pratinjau → konfirmasi → terapkan." />

      <Card className="p-4 mb-5">
        <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Khusus super admin. Perubahan DPP otomatis menyesuaikan jurnal (PYMHD, Revenue, Piutang/PPN). AWB yang belum diinvoice akan dibuatkan invoice; AWB dengan No. Invoice sama akan digabung jadi satu invoice.</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button data-testid="bulk-template-btn" variant="secondary" onClick={downloadTemplate}><Download size={14} /> Download Template</Button>
          <div>
            <Label>File Excel (.xlsx)</Label>
            <input data-testid="bulk-file-input" type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} className="block text-sm border border-slate-300 rounded p-2" />
          </div>
          <Button data-testid="bulk-preview-btn" onClick={doPreview} disabled={loading || !file}><Upload size={14} /> {loading ? "Memproses..." : "Pratinjau"}</Button>
        </div>
      </Card>

      {rep && !result && (
        <Card className="p-4 mb-5" data-testid="bulk-preview-report">
          <h3 className="font-bold inline-flex items-center gap-2 mb-3"><FileSpreadsheet size={16} className="text-blue-700" /> Laporan Pratinjau</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center text-sm">
            <div className="bg-slate-100 rounded p-2"><div className="font-bold text-lg">{rep.total_rows}</div><div className="text-xs text-slate-500">Total Baris</div></div>
            <div className="bg-emerald-100 rounded p-2"><div className="font-bold text-lg">{rep.valid_count}</div><div className="text-xs text-slate-600">AWB Ditemukan</div></div>
            <div className="bg-rose-100 rounded p-2"><div className="font-bold text-lg">{(rep.not_found || []).length}</div><div className="text-xs text-slate-600">Tidak Ditemukan</div></div>
            <div className="bg-blue-100 rounded p-2"><div className="font-bold text-lg">{(rep.groupings || []).length}</div><div className="text-xs text-slate-600">Grup Invoice</div></div>
          </div>

          <div className="space-y-2">
            {rep.has_actions === false && (
              <div data-testid="bulk-no-changes" className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <CheckCircle2 size={18} className="shrink-0" />
                <span><strong>Semua data sudah sama.</strong> Isi file cocok dengan sistem — tidak ada perubahan yang perlu diterapkan{(rep.not_found || []).length > 0 ? `, kecuali ${(rep.not_found || []).length} AWB yang tidak ditemukan (di-skip).` : "."}</span>
              </div>
            )}
            <Section tone="rose" title="AWB Tidak Ditemukan (di-skip)" items={rep.not_found} render={(x) => <span className="font-mono">{x}</span>} />
            <Section tone="amber" title="DPP Berbeda — perlu konfirmasi" items={rep.dpp_changes} render={(x) => <span><span className="font-mono">{x.awb}</span>: {fmtIDR(x.old)} → <strong>{fmtIDR(x.new)}</strong></span>} />
            <Section tone="blue" title="PPN kosong → pakai default customer" items={rep.ppn_fills} render={(x) => <span><span className="font-mono">{x.awb}</span>: PPN {x.ppn}%</span>} />
            <Section tone="amber" title="No. Invoice Berbeda — perlu konfirmasi" items={rep.invoice_changes} render={(x) => <span><span className="font-mono">{x.awb}</span>: {x.old} → <strong>{x.new}</strong></span>} />
            <Section tone="emerald" title="No. Invoice akan diisi (kosong)" items={rep.invoice_fill} render={(x) => <span><span className="font-mono">{x.awb}</span> → <strong>{x.new}</strong></span>} />
            <Section tone="emerald" title="Invoice baru akan dibuat (belum diinvoice)" items={rep.invoice_create} render={(x) => <span><span className="font-mono">{x.awb}</span> → <strong>{x.new}</strong></span>} />
            <Section tone="amber" title="No. PO Berbeda — perlu konfirmasi" items={rep.po_changes} render={(x) => <span><span className="font-mono">{x.awb}</span>: {x.old} → <strong>{x.new}</strong></span>} />
            <Section tone="emerald" title="No. PO akan diisi (kosong)" items={rep.po_fill} render={(x) => <span><span className="font-mono">{x.awb}</span> → <strong>{x.new}</strong></span>} />
            <Section tone="blue" title="Grouping — beberapa AWB → 1 invoice" items={rep.groupings} render={(x) => <span><strong>{x.invoice}</strong>: <span className="font-mono">{x.awbs.join(", ")}</span></span>} />
          </div>

          <div className="mt-4 border-t pt-3">
            <div className="text-xs font-bold text-slate-600 mb-2">Konfirmasi perubahan (per-kategori) — centang untuk menerapkan:</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input data-testid="flag-dpp" type="checkbox" checked={flags.apply_dpp} onChange={(e) => setFlags({ ...flags, apply_dpp: e.target.checked })} /> Terapkan perubahan DPP ({(rep.dpp_changes || []).length})</label>
              <label className="inline-flex items-center gap-2"><input data-testid="flag-invoice" type="checkbox" checked={flags.apply_invoice} onChange={(e) => setFlags({ ...flags, apply_invoice: e.target.checked })} /> Terapkan perubahan No. Invoice ({(rep.invoice_changes || []).length})</label>
              <label className="inline-flex items-center gap-2"><input data-testid="flag-po" type="checkbox" checked={flags.apply_po} onChange={(e) => setFlags({ ...flags, apply_po: e.target.checked })} /> Terapkan perubahan No. PO ({(rep.po_changes || []).length})</label>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Catatan: pengisian nilai kosong, pembuatan invoice baru, dan grouping akan otomatis diterapkan.</p>
            <div className="flex justify-end mt-3">
              <Button data-testid="bulk-apply-btn" onClick={doApply} disabled={loading || rep.has_actions === false}><CheckCircle2 size={14} /> {loading ? "Menerapkan..." : (rep.has_actions === false ? "Tidak Ada Perubahan" : "Terapkan Import")}</Button>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-4 mb-5" data-testid="bulk-result-report">
          <h3 className="font-bold inline-flex items-center gap-2 mb-3"><CheckCircle2 size={16} className="text-emerald-600" /> Laporan Hasil Import</h3>
          <div className="space-y-2">
            <Section tone="emerald" title="DPP diubah" items={result.dpp_applied} render={(x) => <span><span className="font-mono">{x.awb}</span>: {fmtIDR(x.old)} → <strong>{fmtIDR(x.new)}</strong> (PPN {x.ppn_pct}%)</span>} />
            <Section tone="slate" title="DPP dilewati (tidak dikonfirmasi)" items={result.dpp_skipped} render={(x) => <span><span className="font-mono">{x.awb}</span>: {fmtIDR(x.old)} → {fmtIDR(x.new)}</span>} />
            <Section tone="blue" title="PPN diisi dari default customer" items={result.ppn_filled} render={(x) => <span><span className="font-mono">{x.awb}</span>: {x.ppn}%</span>} />
            <Section tone="emerald" title="Invoice baru dibuat" items={result.invoice_created} render={(x) => <span><strong>{x.invoice}</strong>: <span className="font-mono">{x.awbs.join(", ")}</span></span>} />
            <Section tone="emerald" title="No. Invoice diisi" items={result.invoice_filled} render={(x) => <span><strong>{x.invoice}</strong>: <span className="font-mono">{x.awbs.join(", ")}</span></span>} />
            <Section tone="emerald" title="No. Invoice diubah" items={result.invoice_changed} render={(x) => <span>{x.old} → <strong>{x.new}</strong> (<span className="font-mono">{x.awbs.join(", ")}</span>)</span>} />
            <Section tone="slate" title="No. Invoice dilewati" items={result.invoice_skipped} render={(x) => <span>{x.old} → {x.requested} (dilewati)</span>} />
            <Section tone="emerald" title="No. PO diisi" items={result.po_filled} render={(x) => <span><strong>{x.invoice}</strong>: {x.po}</span>} />
            <Section tone="emerald" title="No. PO diubah" items={result.po_changed} render={(x) => <span>{x.old} → <strong>{x.new}</strong></span>} />
            <Section tone="slate" title="No. PO dilewati" items={result.po_skipped} render={(x) => <span>{x.old} → {x.requested} (dilewati)</span>} />
            <Section tone="blue" title="Grouping (AWB digabung ke satu invoice)" items={result.grouped} render={(x) => <span><strong>{x.invoice}</strong> [{x.action}]: <span className="font-mono">{x.awbs.join(", ")}</span></span>} />
            <Section tone="rose" title="AWB Tidak Ditemukan" items={result.not_found} render={(x) => <span className="font-mono">{x}</span>} />
            <Section tone="rose" title="PO tidak bisa diisi (belum ada invoice)" items={result.po_no_invoice} render={(x) => <span className="font-mono">{x}</span>} />
            <Section tone="rose" title="Error" items={result.errors} render={(x) => <span>{x}</span>} />
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="secondary" data-testid="bulk-reset-btn" onClick={() => { setResult(null); setPreview(null); setFile(null); }}><X size={14} /> Selesai / Import Lagi</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
