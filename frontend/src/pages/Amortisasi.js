import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import MonthPicker from "../components/MonthPicker";
import { toast } from "sonner";
import { CalendarClock, Plus, X, ChevronDown, ChevronRight, Ban, Trash2 } from "lucide-react";

const STATUS_BADGE = {
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  stopped: "bg-amber-50 text-amber-800 border-amber-200",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
};
const STATUS_LABEL = { active: "Aktif", stopped: "Dihentikan", completed: "Selesai" };

export default function Amortisasi() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [months, setMonths] = useState(12);
  const [startMonth, setStartMonth] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/amortizations").then((r) => setRows(r.data || [])).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openForm = () => {
    setSourceId(""); setMonths(12); setStartMonth("");
    api.get("/amortizations/available-expenses").then((r) => setExpenses(r.data || [])).catch((e) => toast.error(errMsg(e)));
    setShowForm(true);
  };

  const selected = expenses.find((e) => e.id === sourceId);
  const total = selected ? Number(selected.amount) || 0 : 0;
  const perMonth = months >= 1 && total ? Math.floor(total / months) : 0;
  const lastMonth = months >= 1 && total ? total - perMonth * (months - 1) : 0;

  const onSelectExpense = (id) => {
    setSourceId(id);
    const e = expenses.find((x) => x.id === id);
    if (e && !startMonth) setStartMonth(e.period_month || (e.expense_date ? e.expense_date.slice(0, 7) : ""));
  };

  const save = async () => {
    if (!sourceId) { toast.error("Pilih beban yang mau diamortisasi"); return; }
    if (months < 2) { toast.error("Jumlah bulan minimal 2"); return; }
    setSaving(true);
    try {
      await api.post("/amortizations", { source_id: sourceId, months: Number(months), start_month: startMonth || undefined });
      toast.success("Amortisasi dibuat");
      setShowForm(false);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const stop = async (a) => {
    if (!window.confirm(`Hentikan amortisasi "${a.name}"? Sisa prepaid (${fmtIDR(a.remaining_prepaid)}) akan dibebankan sekaligus bulan ini.`)) return;
    try { await api.post(`/amortizations/${a.id}/stop`); toast.success("Amortisasi dihentikan"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Hapus amortisasi "${a.name}"? Semua jurnal amortisasi dibatalkan dan beban kembali penuh di bulan asal.`)) return;
    try { await api.delete(`/amortizations/${a.id}`); toast.success("Amortisasi dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="amortisasi-page">
      <PageHeader
        title="Amortisasi Beban"
        subtitle="Sebar pengakuan beban (mis. THR, asuransi, sewa dibayar di muka) ke beberapa bulan. Kas keluar sekali, beban diakui bertahap via Biaya Dibayar di Muka (PSAK)."
        action={<Button data-testid="new-amort-btn" onClick={openForm}><Plus size={14} /> Buat Amortisasi</Button>}
      />

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <CalendarClock size={16} className="text-blue-700" />
          <h3 className="font-bold">Daftar Amortisasi</h3>
          <span className="text-xs text-slate-500 ml-2">{rows.length} entri</span>
        </div>
        <Table>
          <thead><tr>
            <Th>Beban</Th><Th>Kategori</Th><Th className="text-right">Total</Th>
            <Th>Mulai</Th><Th className="text-center">Progress</Th>
            <Th className="text-right">Sisa Prepaid</Th><Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {loading && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Memuat…</Td></tr>}
            {!loading && rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Belum ada amortisasi. Klik "Buat Amortisasi" untuk mulai.</Td></tr>}
            {!loading && rows.map((a) => {
              const expanded = expandedId === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr data-testid={`amort-row-${a.id}`} className="hover:bg-slate-50">
                    <Td>
                      <button onClick={() => setExpandedId(expanded ? null : a.id)} className="inline-flex items-center gap-1 font-semibold hover:text-blue-700" data-testid={`amort-expand-${a.id}`}>
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {a.name}
                      </button>
                    </Td>
                    <Td className="text-sm">{a.category || "—"}</Td>
                    <Td className="text-right font-mono">{fmtIDR(a.total_amount)}</Td>
                    <Td className="text-xs">{a.start_month} · {a.months} bln</Td>
                    <Td className="text-center text-xs">{a.recognized_count}/{a.total_count}</Td>
                    <Td className="text-right font-mono">{fmtIDR(a.remaining_prepaid)}</Td>
                    <Td><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[a.status] || STATUS_BADGE.completed}`}>{STATUS_LABEL[a.status] || a.status}</span></Td>
                    <Td className="text-right">
                      <div className="inline-flex gap-1.5">
                        {a.status === "active" && <Button data-testid={`stop-amort-${a.id}`} variant="secondary" onClick={() => stop(a)}><Ban size={13} /> Stop</Button>}
                        <Button data-testid={`delete-amort-${a.id}`} variant="ghost" onClick={() => remove(a)}><Trash2 size={13} /></Button>
                      </div>
                    </Td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50"><Td colSpan={8} className="p-0">
                      <div className="px-6 py-3">
                        <div className="text-[11px] uppercase tracking-wide font-bold text-slate-500 mb-2">Jadwal Amortisasi</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {(a.schedule || []).map((s, i) => (
                            <div key={i} className={`rounded border px-2 py-1.5 text-xs ${s.status === "cancelled" ? "border-slate-200 bg-slate-100 text-slate-400 line-through" : s.status === "stopped_lumpsum" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                              <div className="font-semibold">{s.period}</div>
                              <div className="font-mono">{fmtIDR(s.amount)}</div>
                              {s.status === "stopped_lumpsum" && <div className="text-[9px] text-amber-700">sisa (stop)</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </Td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-start justify-center p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <Card className="max-w-xl w-full my-8" data-testid="amort-form-modal">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <CalendarClock size={16} className="text-blue-700" />
              <h3 className="font-bold">Buat Amortisasi Beban</h3>
              <button onClick={() => setShowForm(false)} className="ml-auto p-1.5 hover:bg-slate-100 rounded" data-testid="amort-form-close"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <Label>Pilih Beban (dari yang sudah dibuat / history)</Label>
                <Select data-testid="amort-source-select" value={sourceId} onChange={(e) => onSelectExpense(e.target.value)}>
                  <option value="">— Pilih beban —</option>
                  {expenses.map((e) => (
                    <option key={e.id} value={e.id}>
                      {(e.expense_date || e.period_month || "")} · {e.category} · {e.description || "(tanpa deskripsi)"} · {fmtIDR(e.amount)}
                    </option>
                  ))}
                </Select>
                {expenses.length === 0 && <div className="text-xs text-slate-400 mt-1">Tidak ada beban yang bisa diamortisasi (atau semua sudah diamortisasi). Buat beban dulu di menu Expense.</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Jumlah Bulan</Label>
                  <Input data-testid="amort-months" type="number" min={2} value={months} onChange={(e) => setMonths(e.target.value)} />
                </div>
                <div>
                  <Label>Bulan Mulai</Label>
                  <MonthPicker value={startMonth} onChange={setStartMonth} />
                </div>
              </div>

              {selected && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm" data-testid="amort-preview">
                  <div className="flex justify-between"><span className="text-slate-600">Total beban</span><span className="font-mono font-semibold">{fmtIDR(total)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Per bulan ({months}×)</span><span className="font-mono">{fmtIDR(perMonth)}{lastMonth !== perMonth ? ` (bln terakhir ${fmtIDR(lastMonth)})` : ""}</span></div>
                  <div className="mt-2 text-xs text-slate-500">Jurnal: bulan asal beban akan direklas ke <b>Biaya Dibayar di Muka (1104)</b>, lalu diakui sebagai beban {fmtIDR(perMonth)}/bulan selama {months} bulan mulai {startMonth || "—"}.</div>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              <Button data-testid="save-amort-btn" onClick={save} disabled={saving || !sourceId}>{saving ? "Menyimpan…" : "Buat Amortisasi"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
