import React, { useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Search, Wand2, X, Save, AlertTriangle, Scissors, RefreshCw } from "lucide-react";
import NumberInput from "../components/NumberInput";

const STATUS_OPTIONS = ["Open", "Reconciled", "Invoiced", "Paid", "Cancelled"];

const TEXT_FIELDS = [
  ["awb_number", "No. AWB"],
  ["consignee", "Consignee"],
  ["sender_name", "Pengirim"],
  ["reff_no", "No. Referensi"],
  ["company_name", "Company / Issuer"],
  ["origin", "Origin"],
  ["destination", "Tujuan"],
  ["nopol", "Nopol"],
  ["status_pengiriman", "Status Pengiriman"],
  ["work_type", "Jenis Pekerjaan"],
  ["item_description", "Deskripsi Barang"],
  ["goods_content", "Isi Barang"],
  ["received_by_name", "Diterima Oleh"],
];

const DRIVER_NUM = [
  ["tariff_per_kg", "Tarif / Kg"],
  ["qty_kg", "Qty (Kg)", true],
  ["tax_percentage", "PPN (%)", true],
  ["charter_amount", "Nilai Charter"],
];

const ADDON_FIELDS = [
  ["received_polis_amount", "Nilai Polis"],
  ["received_asuransi_amount", "Nilai Asuransi"],
  ["spsi_amount", "SPSI"],
  ["sewa_forklift_amount", "Sewa Forklift"],
];

const OVERRIDE_FIELDS = [
  ["total_tariff", "Total Tarif (DPP)"],
  ["tax_amount", "PPN (Rp)"],
  ["addons_total", "Total Addon"],
  ["grand_total", "Grand Total"],
];

const isoToDate = (v) => {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return ""; }
};

export default function SuperEdit() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null); // full lookup response
  const [form, setForm] = useState({});
  const [initial, setInitial] = useState({});
  const [override, setOverride] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    if (!q.trim()) return;
    setLoading(true); setPreview(null);
    try {
      const r = await api.get("/admin/super-edit/lookup", { params: { awb: q.trim() } });
      const a = r.data.awb;
      const base = {};
      TEXT_FIELDS.forEach(([k]) => { base[k] = a[k] ?? ""; });
      DRIVER_NUM.forEach(([k]) => { base[k] = a[k] ?? ""; });
      ADDON_FIELDS.forEach(([k]) => { base[k] = a[k] ?? ""; });
      base.is_charter = !!a.is_charter;
      base.status = a.status || "Open";
      base.cash_account_code = a.cash_account_code || "";
      base.pickup_date = isoToDate(a.created_at);
      base.invoice_number = r.data.invoice?.invoice_number || "";
      base.invoice_date = isoToDate(r.data.invoice?.invoice_date);
      setData(r.data);
      setForm(base);
      setInitial(base);
      setOverride({});
    } catch (e) { toast.error(errMsg(e)); setData(null); }
    finally { setLoading(false); }
  };

  const upd = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const updOv = (k, v) => { setOverride((o) => ({ ...o, [k]: v })); setPreview(null); };

  const buildChanges = () => {
    const ch = {};
    Object.keys(form).forEach((k) => {
      const cur = form[k]; const init = initial[k];
      if (cur !== init) {
        if (DRIVER_NUM.some(([f]) => f === k) || k === "invoice_date" || k === "pickup_date") {
          ch[k] = cur === "" ? null : (["invoice_date", "pickup_date"].includes(k) ? cur : Number(cur));
        } else {
          ch[k] = cur;
        }
      }
    });
    OVERRIDE_FIELDS.forEach(([k]) => {
      if (override[k] !== undefined && override[k] !== "") ch[k] = Number(override[k]);
    });
    return ch;
  };

  const doPreview = async () => {
    const changes = buildChanges();
    setBusy(true);
    try {
      const r = await api.post("/admin/super-edit/preview", { awb_id: data.awb.id, changes });
      setPreview(r.data);
      if (Object.keys(changes).length === 0) toast.info("Belum ada perubahan yang diketik.");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doApply = async () => {
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) { toast.error("Tidak ada perubahan untuk diterapkan."); return; }
    setBusy(true);
    try {
      const r = await api.post("/admin/super-edit/apply", { awb_id: data.awb.id, changes });
      toast.success(`Perubahan diterapkan. Status: ${r.data.status}. Jurnal & neraca disinkronkan.`);
      setQ(r.data.awb.awb_number);
      await lookup();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const split = async (awbId, awbNumber) => {
    const newNum = window.prompt(
      `Pecah AWB ${awbNumber} dari invoice ${data.invoice?.invoice_number}.\n\nMasukkan No. Invoice BARU untuk AWB ini.\n(Kosongkan lalu OK → AWB dilepas jadi belum-invoice / Reconciled)`,
      ""
    );
    if (newNum === null) return;
    setBusy(true);
    try {
      const r = await api.post("/admin/super-edit/split-invoice", {
        invoice_id: data.invoice.id, awb_id: awbId, new_invoice_number: newNum.trim(),
      });
      toast.success(r.data.split_invoice
        ? `AWB dipecah ke invoice baru ${r.data.split_invoice}.`
        : `AWB dilepas dari invoice (jadi belum-invoice).`);
      await lookup();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const group = data?.invoice_group || [];
  const joined = group.length > 1;

  return (
    <div data-testid="super-edit-page">
      <PageHeader title="Super Edit AWB" />

      <Card className="p-4 mb-5">
        <div className="mb-3 flex items-start gap-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Alat master override (khusus administrator).</strong> Edit field apa pun tanpa batas.
            Jurnal double-entry & neraca dihitung ulang otomatis. Selalu klik <strong>Pratinjau</strong> untuk
            melihat selisih Neraca sebelum menerapkan. Aksi ini <strong>tidak dicatat</strong> di Activity Log.
          </span>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <Label>Cari Nomor AWB</Label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input data-testid="super-edit-search-input" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") lookup(); }} placeholder="contoh: 205605" className="pl-9" />
            </div>
          </div>
          <Button data-testid="super-edit-search-btn" onClick={lookup} disabled={loading}>
            <Search size={14} /> {loading ? "Mencari..." : "Cari"}
          </Button>
        </div>
      </Card>

      {data && (
        <>
          <Card className="p-4 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-bold">{data.awb.awb_number}</h3>
              <StatusBadge status={data.awb.status} />
              {data.customer_name && <span className="text-xs text-slate-500">• {data.customer_name}</span>}
            </div>

            {/* Umum & Rute */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {TEXT_FIELDS.map(([k, lbl]) => (
                <div key={k}>
                  <Label>{lbl}</Label>
                  <Input data-testid={`se-${k}`} value={form[k] ?? ""} onChange={(e) => upd(k, e.target.value)} />
                </div>
              ))}
            </div>

            {/* Status & Invoice */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 pt-3 border-t border-slate-200">
              <div>
                <Label>Status</Label>
                <select data-testid="se-status" value={form.status} onChange={(e) => upd("status", e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Tanggal AWB (pickup)</Label>
                <Input type="date" data-testid="se-pickup_date" value={form.pickup_date || ""} onChange={(e) => upd("pickup_date", e.target.value)} />
              </div>
              <div>
                <Label>No. Invoice</Label>
                <Input data-testid="se-invoice_number" value={form.invoice_number || ""} onChange={(e) => upd("invoice_number", e.target.value)} />
              </div>
              <div>
                <Label>Tanggal Invoice</Label>
                <Input type="date" data-testid="se-invoice_date" value={form.invoice_date || ""} onChange={(e) => upd("invoice_date", e.target.value)} />
              </div>
            </div>

            {/* Nilai otomatis */}
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-semibold text-slate-600 uppercase">Nilai (otomatis dihitung)</span>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" data-testid="se-is_charter" checked={!!form.is_charter} onChange={(e) => upd("is_charter", e.target.checked)} />
                  Charter (harga borongan)
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {DRIVER_NUM.map(([k, lbl, dec]) => (
                  <div key={k}>
                    <Label>{lbl}</Label>
                    <NumberInput data-testid={`se-${k}`} decimal={!!dec} value={form[k] ?? ""} onChange={(e) => upd(k, e.target.value)} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                {ADDON_FIELDS.map(([k, lbl]) => (
                  <div key={k}>
                    <Label>{lbl}</Label>
                    <NumberInput data-testid={`se-${k}`} value={form[k] ?? ""} onChange={(e) => upd(k, e.target.value)} />
                  </div>
                ))}
                <div>
                  <Label>Akun Kas (bila Paid)</Label>
                  <Input data-testid="se-cash_account_code" value={form.cash_account_code || ""} onChange={(e) => upd("cash_account_code", e.target.value)} placeholder="1101" />
                </div>
              </div>
            </div>

            {/* Override langsung */}
            <div className="pt-3 mt-3 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-600 uppercase mb-2">Override Langsung (opsional — isi hanya bila mau paksa nilai persis)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {OVERRIDE_FIELDS.map(([k, lbl]) => (
                  <div key={k}>
                    <Label>{lbl}</Label>
                    <NumberInput data-testid={`se-ov-${k}`} value={override[k] ?? ""} onChange={(e) => updOv(k, e.target.value)}
                      placeholder={fmtIDR(data.awb[k])} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-200">
              <Button variant="secondary" data-testid="se-preview-btn" onClick={doPreview} disabled={busy}>
                <RefreshCw size={14} /> Pratinjau
              </Button>
              <Button data-testid="se-apply-btn" onClick={doApply} disabled={busy}>
                <Save size={14} /> {busy ? "Memproses..." : "Terapkan"}
              </Button>
            </div>
          </Card>

          {/* Preview neraca */}
          {preview && (
            <Card className="p-4 mb-5" data-testid="se-preview-panel">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                {Object.entries(preview.new_financials).map(([k, v]) => (
                  <div key={k} className="bg-slate-50 border rounded p-2">
                    <div className="text-slate-500">{k}</div>
                    <div className="font-semibold">{fmtIDR(v)}</div>
                  </div>
                ))}
              </div>
              <div className="text-sm mb-2">Status akhir: <StatusBadge status={preview.target_status} /></div>
              {preview.neraca_will_change ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm mb-2">
                    <AlertTriangle size={16} /> Perubahan ini akan MENGUBAH Neraca (Trial Balance)
                  </div>
                  <Table>
                    <thead><tr><Th>Akun</Th><Th className="text-right">Sebelum</Th><Th className="text-right">Sesudah</Th><Th className="text-right">Selisih</Th></tr></thead>
                    <tbody>
                      {preview.neraca_changes.map((c) => (
                        <tr key={c.code}>
                          <Td className="text-xs">{c.code} — {c.name}</Td>
                          <Td className="text-right text-xs">{fmtIDR(c.before)}</Td>
                          <Td className="text-right text-xs font-semibold">{fmtIDR(c.after)}</Td>
                          <Td className={`text-right text-xs font-bold ${c.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{c.delta >= 0 ? "+" : ""}{fmtIDR(c.delta)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <p className="text-[11px] text-amber-800 mt-2">Neraca tetap seimbang (total debit=kredit) — kedua sisi tiap jurnal ikut berubah. Ini hanya reklasifikasi nilai per akun.</p>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <Wand2 size={16} className="inline mr-1" /> Tidak ada perubahan pada Neraca dari edit ini.
                </div>
              )}
            </Card>
          )}

          {/* Split invoice */}
          {joined && (
            <Card className="p-4" data-testid="se-split-panel">
              <div className="flex items-center gap-2 mb-2">
                <Scissors size={16} className="text-indigo-600" />
                <h3 className="font-bold">Invoice Gabungan — {data.invoice?.invoice_number}</h3>
                <span className="text-xs text-slate-500">{group.length} AWB tergabung</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">Pecah salah satu AWB agar keluar dari invoice gabungan ini menjadi invoice sendiri (atau lepaskan jadi belum-invoice). Jurnal AR gabungan otomatis dibangun ulang.</p>
              <Table>
                <thead><tr><Th>No. AWB</Th><Th>Status</Th><Th className="text-right">Tarif</Th><Th className="text-right">Grand Total</Th><Th></Th></tr></thead>
                <tbody>
                  {group.map((g) => (
                    <tr key={g.id} data-testid={`se-group-${g.id}`}>
                      <Td className="font-mono">{g.awb_number}</Td>
                      <Td><StatusBadge status={g.status} /></Td>
                      <Td className="text-right text-xs">{fmtIDR(g.total_tariff)}</Td>
                      <Td className="text-right text-xs">{fmtIDR(g.grand_total)}</Td>
                      <Td className="text-right">
                        <Button variant="secondary" data-testid={`se-split-${g.id}`} onClick={() => split(g.id, g.awb_number)} disabled={busy}>
                          <Scissors size={14} /> Pecah
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
