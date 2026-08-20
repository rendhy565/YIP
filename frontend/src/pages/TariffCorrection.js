import React, { useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Search, Coins, X, Save, AlertTriangle } from "lucide-react";
import NumberInput from "../components/NumberInput";

export default function TariffCorrection() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [edit, setEdit] = useState(null); // row being edited
  const [newTariff, setNewTariff] = useState("");
  const [saving, setSaving] = useState(false);

  const search = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/tariff/search", { params: { q } });
      setRows(r.data);
      setSearched(true);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setLoading(false); }
  };

  const openEdit = (row) => {
    setEdit(row);
    setNewTariff(String(row.total_tariff || 0));
  };

  // Client-side preview of new PPN & grand total
  const preview = React.useMemo(() => {
    if (!edit) return null;
    const t = parseFloat(newTariff);
    if (isNaN(t) || t < 0) return null;
    const pct = Number(edit.tax_percentage || 0);
    const tax = Math.round(t * pct / 100 * 100) / 100;
    const addons = Number(edit.addons_total || 0);
    const gt = Math.round((t + tax + addons) * 100) / 100;
    return { tariff: t, tax, addons, grand_total: gt, pct };
  }, [edit, newTariff]);

  const save = async () => {
    if (!edit || !preview) { toast.error("Nilai tarif tidak valid"); return; }
    setSaving(true);
    try {
      const r = await api.post(`/admin/tariff/${edit.id}/correct`, { new_total_tariff: preview.tariff });
      const j = (r.data.journals_adjusted || []).join(", ") || "-";
      toast.success(`Tarif ${r.data.awb_number} dikoreksi. Jurnal disesuaikan: ${j}`);
      setEdit(null);
      search();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="tariff-correction-page">
      <PageHeader
        title="Koreksi Tarif AWB"
        subtitle="Ubah nilai tarif AWB (super admin). PPN & grand total dihitung ulang, dan seluruh jurnal terkait otomatis disinkronkan agar neraca tetap benar."
      />

      <Card className="p-4 mb-5">
        <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Fitur khusus super admin. Perubahan tarif akan otomatis menyesuaikan jurnal
            <strong> PYMHD, Pengakuan Revenue, Piutang &amp; PPN (invoice)</strong> di periode aslinya —
            jadi <strong>tidak perlu</strong> reject reconcile / ulang dari awal. AWB berstatus <strong>Paid</strong> tidak bisa dikoreksi di sini.
          </span>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label>Cari Nomor AWB</Label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                data-testid="tariff-search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") search(); }}
                placeholder="contoh: 205605"
                className="pl-9"
              />
            </div>
          </div>
          <Button data-testid="tariff-search-btn" onClick={search} disabled={loading}>
            <Search size={14} /> {loading ? "Mencari..." : "Cari"}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <h3 className="font-bold inline-flex items-center gap-2"><Coins size={16} className="text-amber-600" /> Hasil Pencarian</h3>
          <span className="ml-auto text-xs text-slate-500">{rows.length} AWB</span>
        </div>
        <Table>
          <thead><tr>
            <Th>No. AWB</Th><Th>Customer</Th><Th>No. Invoice</Th><Th>Status</Th>
            <Th className="text-right">Tarif (DPP)</Th><Th className="text-right">PPN</Th>
            <Th className="text-right">Grand Total</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`tariff-row-${r.id}`}>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-sm">{r.customer_name || <span className="text-slate-400">—</span>}</Td>
                <Td className="font-mono text-xs">{r.invoice_number || <span className="text-slate-400">—</span>}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="text-right font-semibold" data-testid={`tariff-value-${r.id}`}>{fmtIDR(r.total_tariff)}</Td>
                <Td className="text-right text-xs text-slate-600">{fmtIDR(r.tax_amount)} <span className="text-slate-400">({r.tax_percentage}%)</span></Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td className="text-right">
                  {r.status === "Paid" ? (
                    <span className="text-[11px] text-slate-400">Terkunci (Paid)</span>
                  ) : (
                    <Button data-testid={`correct-tariff-${r.id}`} variant="secondary" onClick={() => openEdit(r)}>
                      <Coins size={14} /> Koreksi Tarif
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
            {searched && rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Tidak ada AWB ditemukan.</Td></tr>}
            {!searched && <tr><Td colSpan={8} className="text-center text-slate-400 py-10">Ketik nomor AWB lalu klik Cari.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {/* Edit modal */}
      {edit && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="tariff-edit-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl"><Coins className="inline mr-2" size={18} />Koreksi Tarif — {edit.awb_number}</h3>
              <button onClick={() => setEdit(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              <div className="bg-slate-50 border border-slate-200 rounded p-2">
                <div className="text-slate-500 mb-1 font-semibold">SEBELUM</div>
                <div>Tarif: <strong>{fmtIDR(edit.total_tariff)}</strong></div>
                <div>PPN ({edit.tax_percentage}%): {fmtIDR(edit.tax_amount)}</div>
                {edit.addons_total > 0 && <div>Addon: {fmtIDR(edit.addons_total)}</div>}
                <div>Grand Total: <strong>{fmtIDR(edit.grand_total)}</strong></div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                <div className="text-emerald-700 mb-1 font-semibold">SESUDAH (preview)</div>
                {preview ? (<>
                  <div>Tarif: <strong>{fmtIDR(preview.tariff)}</strong></div>
                  <div>PPN ({preview.pct}%): {fmtIDR(preview.tax)}</div>
                  {preview.addons > 0 && <div>Addon: {fmtIDR(preview.addons)}</div>}
                  <div>Grand Total: <strong className="text-emerald-800">{fmtIDR(preview.grand_total)}</strong></div>
                </>) : <div className="text-rose-600">Nilai tidak valid</div>}
              </div>
            </div>

            <div>
              <Label>Tarif Baru (DPP, tanpa PPN) *</Label>
              <NumberInput
                data-testid="tariff-new-input"
                value={newTariff}
                onChange={(e) => setNewTariff(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              />
              <p className="text-[11px] text-slate-500 mt-1">PPN dihitung otomatis {edit.tax_percentage}% dari tarif. Grand total = tarif + PPN{edit.addons_total > 0 ? " + addon" : ""}.</p>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setEdit(null)} disabled={saving}>Batal</Button>
              <Button data-testid="tariff-save-btn" onClick={save} disabled={saving || !preview}>
                <Save size={14} /> {saving ? "Menyimpan..." : "Simpan & Sinkron Jurnal"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
