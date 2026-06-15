import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Wallet, CheckCircle2, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const empty = { recipient_name: "", purpose: "", amount: "", advance_date: todayStr(), notes: "" };

export default function PanjarKerja() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  // Settle modal
  const [settleFor, setSettleFor] = useState(null);
  const [settleForm, setSettleForm] = useState({ actual_amount: "", refund_amount: "0", settle_date: todayStr(), notes: "" });
  const [settling, setSettling] = useState(false);

  const load = () => api.get("/cash-advances").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/cash-advances", {
        ...form,
        amount: parseFloat(form.amount),
      });
      toast.success("Panjar dibuat");
      setShowAdd(false); setForm(empty); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const openSettle = (r) => {
    setSettleFor(r);
    setSettleForm({ actual_amount: String(r.amount), refund_amount: "0", settle_date: todayStr(), notes: "" });
  };
  const doSettle = async () => {
    setSettling(true);
    try {
      await api.post(`/cash-advances/${settleFor.id}/settle`, {
        actual_amount: parseFloat(settleForm.actual_amount),
        refund_amount: parseFloat(settleForm.refund_amount || 0),
        settle_date: settleForm.settle_date,
        notes: settleForm.notes,
      });
      toast.success(`Panjar ${settleFor.number} disettle`);
      setSettleFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSettling(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus panjar ini?")) return;
    try { await api.delete(`/cash-advances/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const openCount = rows.filter((r) => r.status === "Open").length;
  const openTotal = rows.filter((r) => r.status === "Open").reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="panjar-page">
      <PageHeader
        title="Panjar Kerja"
        subtitle="Kas operasional yang diberikan ke staff/driver. Otomatis di-jurnal & disettle."
        action={<Button data-testid="add-panjar-btn" onClick={() => { setForm(empty); setShowAdd(true); }}><Plus size={16}/> Buat Panjar</Button>}
      />

      <Card className="p-5 mb-5 bg-amber-50 border-amber-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-amber-700 text-white flex items-center justify-center"><Wallet size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-amber-700">Outstanding Panjar</div>
            <div className="font-heading font-black text-3xl text-amber-900">{fmtIDR(openTotal)}</div>
          </div>
          <div className="ml-auto text-sm text-amber-700">{openCount} panjar Open</div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>No.</Th><Th>Tanggal</Th><Th>Penerima</Th><Th>Keperluan</Th>
            <Th className="text-right">Panjar</Th><Th className="text-right">Aktual</Th><Th className="text-right">Refund</Th>
            <Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`panjar-row-${r.number}`}>
                <Td className="font-mono font-semibold">{r.number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.advance_date)}</Td>
                <Td className="font-semibold">{r.recipient_name}</Td>
                <Td className="text-xs">{r.purpose || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right">{r.actual_amount != null ? fmtIDR(r.actual_amount) : "-"}</Td>
                <Td className="text-right">{r.refund_amount != null ? fmtIDR(r.refund_amount) : "-"}</Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    r.status === "Settled" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"
                  }`}>{r.status}</span>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    {r.status === "Open" && (
                      <button data-testid={`settle-panjar-${r.number}`} onClick={() => openSettle(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 size={11}/> Settle
                      </button>
                    )}
                    {isAdmin && (
                      <button onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-8">Belum ada panjar kerja.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-panjar-modal">
          <Card className="w-full max-w-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-heading font-bold text-xl">Buat Panjar Kerja</h3>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>Penerima *</Label><Input data-testid="panjar-recipient" value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} required/></div>
              <div><Label>Keperluan</Label><Input data-testid="panjar-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Mis. BBM truk B 1234 XYZ"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Jumlah (IDR) *</Label><Input data-testid="panjar-amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required/></div>
                <div><Label>Tanggal Panjar</Label><Input data-testid="panjar-date" type="date" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })}/></div>
              </div>
              <div><Label>Catatan</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Batal</Button>
                <Button data-testid="save-panjar-btn" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {settleFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="settle-panjar-modal">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Settle Panjar</h3>
                <p className="text-xs text-slate-500">{settleFor.number} · {settleFor.recipient_name} · {fmtIDR(settleFor.amount)}</p>
              </div>
              <button onClick={() => setSettleFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div><Label>Realisasi Pengeluaran *</Label><Input data-testid="panjar-actual-amount" type="number" step="0.01" value={settleForm.actual_amount} onChange={(e) => setSettleForm({ ...settleForm, actual_amount: e.target.value })} required/></div>
              <div><Label>Refund (Sisa Dikembalikan)</Label><Input data-testid="panjar-refund-amount" type="number" step="0.01" value={settleForm.refund_amount} onChange={(e) => setSettleForm({ ...settleForm, refund_amount: e.target.value })}/></div>
              <div><Label>Tanggal Settle</Label><Input data-testid="panjar-settle-date" type="date" value={settleForm.settle_date} onChange={(e) => setSettleForm({ ...settleForm, settle_date: e.target.value })}/></div>
              <div><Label>Catatan</Label><Input data-testid="panjar-settle-notes" value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })}/></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setSettleFor(null)}>Batal</Button>
              <Button data-testid="confirm-settle-panjar" onClick={doSettle} disabled={settling || !settleForm.actual_amount}>
                {settling ? "Memproses..." : "Settle"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
