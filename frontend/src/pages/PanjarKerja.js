import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, X, Wallet, CheckCircle2, Trash2, History, Printer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/useCan";
import BPVPrintTemplate from "../components/BPVPrintTemplate";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const empty = {
  recipient_name: "", purpose: "", amount: "", advance_date: todayStr(), notes: "",
  recipient_id: "", recipient_bank: "", recipient_account: "",
  sender_id: "", sender_name: "", sender_bank: "", sender_account: "",
  ppn_amount: "", pph_amount: "", reff_number: "",
};

export default function PanjarKerja() {
  const canCreate = useCan("fixed_costs", "petty_cash_create");
  const canSettle = useCan("fixed_costs", "petty_cash_settle");
  const canDelete = useCan("fixed_costs", "petty_cash_delete");
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  // Settle modal
  const [settleFor, setSettleFor] = useState(null);
  const [settleForm, setSettleForm] = useState({ refund_amount: "0", settle_date: todayStr(), notes: "" });
  const [historyFor, setHistoryFor] = useState(null);
  const [breakdown, setBreakdown] = useState([]); // [{awb_id, amount, description}]
  const [settling, setSettling] = useState(false);
  const [printFor, setPrintFor] = useState(null); // { panjar, approval, requester_name }
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({});
  const [recipients, setRecipients] = useState([]);
  const [senders, setSenders] = useState([]);
  const [showAddParty, setShowAddParty] = useState(null); // 'recipient' | 'sender' | null
  const [partyForm, setPartyForm] = useState({ name: "", bank: "", account_number: "" });
  const [savingParty, setSavingParty] = useState(false);

  const load = async () => {
    const [ca, os, usr, st, rec, snd] = await Promise.all([
      api.get("/cash-advances"),
      api.get("/orders"),  // ALL AWBs (any status)
      api.get("/users").catch(() => ({ data: [] })),
      api.get("/settings").catch(() => ({ data: [] })),
      api.get("/payment-recipients").catch(() => ({ data: [] })),
      api.get("/payment-senders").catch(() => ({ data: [] })),
    ]);
    setRows(ca.data); setAllOrders(os.data); setUsers(usr.data || []);
    setRecipients(rec.data || []); setSenders(snd.data || []);
    // Build settings map: { logo_b64, kop_address, ... }
    const sm = {};
    (st.data || []).forEach((s) => {
      if (s.key_name === "invoice_logo_b64") sm.logo_b64 = s.key_value;
      else sm[s.key_name] = s.key_value;
    });
    setSettings(sm);
  };
  useEffect(() => { load(); }, []);

  // Auto-fill snapshot fields when dropdown changes
  const pickRecipient = (id) => {
    const r = recipients.find((x) => x.id === id);
    if (r) setForm((f) => ({ ...f, recipient_id: id, recipient_name: r.name, recipient_bank: r.bank, recipient_account: r.account_number }));
    else setForm((f) => ({ ...f, recipient_id: "" }));
  };
  const pickSender = (id) => {
    const s = senders.find((x) => x.id === id);
    if (s) setForm((f) => ({ ...f, sender_id: id, sender_name: s.name, sender_bank: s.bank, sender_account: s.account_number }));
    else setForm((f) => ({ ...f, sender_id: "" }));
  };

  const openAddParty = (kind) => {
    setPartyForm({ name: "", bank: "", account_number: "" });
    setShowAddParty(kind);
  };
  const saveParty = async (e) => {
    e.preventDefault();
    if (!partyForm.name.trim()) { toast.error("Nama wajib diisi"); return; }
    setSavingParty(true);
    try {
      const endpoint = showAddParty === "recipient" ? "/payment-recipients" : "/payment-senders";
      const r = await api.post(endpoint, partyForm);
      toast.success("Tersimpan ke master");
      if (showAddParty === "recipient") {
        setRecipients((prev) => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
        pickRecipient(r.data.id);
      } else {
        setSenders((prev) => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
        pickSender(r.data.id);
      }
      setShowAddParty(null);
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSavingParty(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        ppn_amount: parseFloat(form.ppn_amount) || 0,
        pph_amount: parseFloat(form.pph_amount) || 0,
      };
      await api.post("/cash-advances", payload);
      toast.success("Panjar dibuat");
      setShowAdd(false); setForm(empty); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const openSettle = (r) => {
    setSettleFor(r);
    setSettleForm({ refund_amount: "0", settle_date: todayStr(), notes: "" });
    setBreakdown([{ target: "awb", awb_id: "", amount: "", description: "" }]);
  };

  const addRow = (target = "awb") => setBreakdown([...breakdown, { target, awb_id: "", amount: "", description: "" }]);
  const removeRow = (idx) => setBreakdown(breakdown.filter((_, i) => i !== idx));
  const updateRow = (idx, key, val) => setBreakdown(breakdown.map((b, i) => i === idx ? { ...b, [key]: val } : b));

  const breakdownTotal = breakdown.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  const refund = parseFloat(settleForm.refund_amount) || 0;
  const settleTotal = breakdownTotal + refund;
  const panjarAmt = settleFor?.amount || 0;
  const prevSettled = settleFor?.settled_amount || 0;
  const prevRefund = settleFor?.refund_amount || 0;
  const remainingBefore = panjarAmt - prevSettled - prevRefund;
  const newRemaining = remainingBefore - settleTotal;
  const isFullSettle = Math.abs(newRemaining) < 0.01;
  const isOverSettle = newRemaining < -0.01;

  const doSettle = async () => {
    // Validate each row
    for (const b of breakdown) {
      if (!b.amount || parseFloat(b.amount) <= 0) {
        toast.error("Lengkapi semua baris breakdown (nominal > 0)"); return;
      }
      if ((b.target || "awb") === "awb" && !b.awb_id) {
        toast.error("Untuk target AWB, pilih AWB-nya"); return;
      }
    }
    if (settleTotal <= 0) {
      toast.error("Total settle harus > 0");
      return;
    }
    if (isOverSettle) {
      toast.error(`Total settle (${fmtIDR(settleTotal)}) melebihi sisa panjar (${fmtIDR(remainingBefore)})`);
      return;
    }
    if (!isFullSettle) {
      if (!window.confirm(
        `Settle PARTIAL: ${fmtIDR(settleTotal)} dari sisa ${fmtIDR(remainingBefore)}.\n` +
        `Status tetap "Open" — sisa ${fmtIDR(newRemaining)} bisa disettle lagi nanti.\n\nLanjutkan?`
      )) return;
    }
    setSettling(true);
    try {
      await api.post(`/cash-advances/${settleFor.id}/settle`, {
        actual_amount: breakdownTotal,
        refund_amount: refund,
        settle_date: settleForm.settle_date,
        notes: settleForm.notes,
        awb_breakdown: breakdown.map((b) => ({
          target: b.target || "awb",
          awb_id: (b.target === "operation") ? null : b.awb_id,
          amount: parseFloat(b.amount),
          description: b.description || null,
        })),
      });
      toast.success(isFullSettle
        ? `Panjar ${settleFor.number} fully settled`
        : `Partial settle (${fmtIDR(settleTotal)}) berhasil. Sisa: ${fmtIDR(newRemaining)} — status tetap Open`);
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
  const openTotal = rows.filter((r) => r.status === "Open").reduce((s, r) => {
    const consumed = (r.settled_amount || 0) + (r.refund_amount || 0);
    return s + Math.max(0, (r.amount || 0) - consumed);
  }, 0);

  const openPrint = async (r) => {
    try {
      let approval = null;
      if (r.approval_id) {
        approval = (await api.get(`/approvals/${r.approval_id}`)).data;
      }
      const requester = users.find((u) => u.id === r.created_by);
      setPrintFor({
        panjar: r,
        approval,
        requester_name: requester?.full_name || requester?.username || "-",
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doPrint = () => {
    // Print HTML via browser
    window.print();
  };

  return (
    <div data-testid="panjar-page">
      <PageHeader
        title="Panjar Kerja"
        subtitle="Kas operasional ke staff/driver. Saat settle, breakdown per AWB → otomatis jadi cost di AWB ybs."
        action={canCreate ? <Button data-testid="add-panjar-btn" onClick={() => { setForm(empty); setShowAdd(true); }}><Plus size={16}/> Buat Panjar</Button> : null}
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
            <Th>Status</Th><Th>Approval</Th><Th>Breakdown AWB</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const overspend = (r.overspend_amount || 0);
              const isOverspent = r.status === "Settled" && overspend > 0;
              const rowCls = isOverspent
                ? "bg-red-50/60 hover:bg-red-50"
                : (r.status === "Settled" ? "bg-emerald-50/40 hover:bg-emerald-50/70" : "bg-amber-50/40 hover:bg-amber-50/70");
              return (
              <tr key={r.id} data-testid={`panjar-row-${r.number}`} className={rowCls}>
                <Td className="font-mono font-semibold">{r.number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.advance_date)}</Td>
                <Td className="font-semibold">{r.recipient_name}</Td>
                <Td className="text-xs">{r.purpose || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className={`text-right ${isOverspent ? "text-red-700 font-bold" : ""}`}>{r.settled_amount != null ? fmtIDR(r.settled_amount) : (r.actual_amount != null ? fmtIDR(r.actual_amount) : "-")}</Td>
                <Td className="text-right">{r.refund_amount != null ? fmtIDR(r.refund_amount) : "-"}</Td>
                <Td>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    isOverspent ? "bg-red-100 text-red-800 border-red-300"
                    : (r.status === "Settled" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200")
                  }`}>{isOverspent ? "Overspent" : r.status}</span>
                  {isOverspent && (
                    <div className="text-[9px] text-red-700 font-bold mt-0.5">
                      Kurang panjar: {fmtIDR(overspend)}
                    </div>
                  )}
                  {r.status === "Open" && r.settled_amount > 0 && (
                    <div className="text-[9px] text-amber-700 mt-0.5">
                      Sisa: {fmtIDR(r.amount - (r.settled_amount || 0) - (r.refund_amount || 0))}
                    </div>
                  )}
                </Td>
                <Td>
                  {r.approval_status ? (
                    <ApprovalStatusPill status={r.approval_status} />
                  ) : (
                    <span className="text-slate-400 text-[10px]">—</span>
                  )}
                </Td>
                <Td className="text-xs">
                  {r.awb_breakdown && r.awb_breakdown.length > 0 ? (
                    <div className="space-y-0.5">
                      {r.awb_breakdown.map((b, i) => (
                        <div key={i} className="font-mono text-[10px] text-slate-700">{b.awb_number}: {fmtIDR(b.amount)}</div>
                      ))}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="flex gap-1 justify-end">
                    {r.approval_status === "Approved" && (
                      <button data-testid={`print-panjar-${r.number}`} onClick={() => openPrint(r)} title="Print Bank Payment Voucher (setelah disetujui)" className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-indigo-100 text-indigo-800 hover:bg-indigo-200 inline-flex items-center gap-1">
                        <Printer size={11}/> Print BPV
                      </button>
                    )}
                    {r.settle_history && r.settle_history.length > 0 && (
                      <button data-testid={`history-panjar-${r.number}`} onClick={() => setHistoryFor(r)} title="Lihat history settle" className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-blue-100 text-blue-800 hover:bg-blue-200 inline-flex items-center gap-1">
                        <History size={11}/> History ({r.settle_history.length})
                      </button>
                    )}
                    {canSettle && r.status === "Open" && (
                      <button data-testid={`settle-panjar-${r.number}`} onClick={() => openSettle(r)} className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 size={11}/> Settle
                      </button>
                    )}
                    {canDelete && (
                      <button data-testid={`delete-panjar-${r.number}`} onClick={() => del(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                    )}
                  </div>
                </Td>
              </tr>
              );
            })}
            {rows.length === 0 && <tr><Td colSpan={11} className="text-center text-slate-500 py-8">Belum ada panjar kerja.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="add-panjar-modal">
          <Card className="w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Buat Bank Payment Voucher</h3>
                <p className="text-xs text-slate-500">Data ini akan tercetak di voucher setelah disetujui.</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {/* Dibayarkan kepada */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Dibayarkan Kepada</div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8">
                    <Label>Penerima *</Label>
                    <Select data-testid="panjar-recipient-select" value={form.recipient_id} onChange={(e) => pickRecipient(e.target.value)}>
                      <option value="">— Pilih penerima —</option>
                      {recipients.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} · {r.bank} · {r.account_number}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Button type="button" variant="secondary" onClick={() => openAddParty("recipient")} data-testid="add-recipient-btn">
                      <Plus size={14}/> Add New
                    </Button>
                  </div>
                </div>
                {form.recipient_id && (
                  <div className="mt-2 text-[11px] font-mono text-slate-600 bg-white border border-slate-200 rounded px-2 py-1.5">
                    <div><b>Nama:</b> {form.recipient_name}</div>
                    <div><b>Bank:</b> {form.recipient_bank} · <b>No. Rek:</b> {form.recipient_account}</div>
                  </div>
                )}
                {!form.recipient_id && (
                  <div className="mt-2">
                    <Label className="text-[10px]">Atau ketik manual (kalau tidak dari master):</Label>
                    <Input data-testid="panjar-recipient" placeholder="Nama penerima" value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} />
                  </div>
                )}
              </div>

              {/* Dibayarkan dari */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Dibayarkan Dari (Rekening Perusahaan)</div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-8">
                    <Label>Penyetor *</Label>
                    <Select data-testid="panjar-sender-select" value={form.sender_id} onChange={(e) => pickSender(e.target.value)}>
                      <option value="">— Pilih rekening pembayar —</option>
                      {senders.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {s.bank} · {s.account_number}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Button type="button" variant="secondary" onClick={() => openAddParty("sender")} data-testid="add-sender-btn">
                      <Plus size={14}/> Add New
                    </Button>
                  </div>
                </div>
                {form.sender_id && (
                  <div className="mt-2 text-[11px] font-mono text-slate-600 bg-white border border-slate-200 rounded px-2 py-1.5">
                    <div><b>Penyetor:</b> {form.sender_name}</div>
                    <div><b>Bank:</b> {form.sender_bank} · <b>No. Rek:</b> {form.sender_account}</div>
                  </div>
                )}
              </div>

              {/* Detail transaksi */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Description / Keperluan *</Label><Input data-testid="panjar-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Mis. Pelunasan Biaya Pengiriman Surabaya-Kupang" required/></div>
                <div><Label>REFF# (Nomor Referensi)</Label><Input data-testid="panjar-reff" value={form.reff_number} onChange={(e) => setForm({ ...form, reff_number: e.target.value })} placeholder="Mis. INV CMB-311220240026"/></div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div><Label>Nilai (IDR) *</Label><Input data-testid="panjar-amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required/></div>
                <div><Label>PPN (IDR)</Label><Input data-testid="panjar-ppn" type="number" step="0.01" value={form.ppn_amount} onChange={(e) => setForm({ ...form, ppn_amount: e.target.value })} placeholder="0"/></div>
                <div><Label>PPH (IDR)</Label><Input data-testid="panjar-pph" type="number" step="0.01" value={form.pph_amount} onChange={(e) => setForm({ ...form, pph_amount: e.target.value })} placeholder="0"/></div>
                <div><Label>Tanggal</Label><Input data-testid="panjar-date" type="date" value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })}/></div>
              </div>

              <div><Label>Catatan Internal (opsional)</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Batal</Button>
                <Button data-testid="save-panjar-btn" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan Voucher"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* ===== Add New Recipient / Sender modal ===== */}
      {showAddParty && (
        <div className="fixed inset-0 bg-slate-900/70 z-[60] flex items-center justify-center p-4" data-testid="add-party-modal">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start justify-between mb-3">
              <h4 className="font-heading font-bold text-lg">
                Tambah {showAddParty === "recipient" ? "Penerima" : "Rekening Pembayar"} Baru
              </h4>
              <button onClick={() => setShowAddParty(null)} className="p-1 hover:bg-slate-100 rounded"><X size={16}/></button>
            </div>
            <form onSubmit={saveParty} className="space-y-3">
              <div>
                <Label>Nama *</Label>
                <Input data-testid="party-name" value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} placeholder={showAddParty === "recipient" ? "Mis. CMB EXPRESS - JELIVANSES IMELDA LOBO" : "Mis. PT. ABIRAMA MITRA PRATAMA"} required autoFocus/>
              </div>
              <div>
                <Label>Bank *</Label>
                <Input data-testid="party-bank" value={partyForm.bank} onChange={(e) => setPartyForm({ ...partyForm, bank: e.target.value })} placeholder="Mis. Mandiri / BCA / BRI" required/>
              </div>
              <div>
                <Label>No. Account *</Label>
                <Input data-testid="party-account" value={partyForm.account_number} onChange={(e) => setPartyForm({ ...partyForm, account_number: e.target.value })} placeholder="Mis. 161 0002 702 517" required/>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="secondary" type="button" onClick={() => setShowAddParty(null)}>Batal</Button>
                <Button data-testid="save-party-btn" type="submit" disabled={savingParty}>{savingParty ? "Menyimpan..." : "Simpan"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {settleFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="settle-panjar-modal">
          <Card className="w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Settle Panjar</h3>
                <p className="text-xs text-slate-500">{settleFor.number} · {settleFor.recipient_name} · {fmtIDR(settleFor.amount)}</p>
              </div>
              <button onClick={() => setSettleFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Breakdown ke AWB / Operation</h4>
                  <div className="flex gap-2">
                    <button type="button" data-testid="add-awb-row-btn" onClick={() => addRow("awb")} className="text-[11px] font-bold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"><Plus size={12}/> Baris AWB</button>
                    <button type="button" data-testid="add-operation-row-btn" onClick={() => addRow("operation")} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"><Plus size={12}/> Baris Operation</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {breakdown.map((b, i) => {
                    const target = b.target || "awb";
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`breakdown-row-${i}`}>
                        <div className="col-span-2">
                          <Select data-testid={`breakdown-target-${i}`} value={target} onChange={(e) => updateRow(i, "target", e.target.value)}>
                            <option value="awb">AWB</option>
                            <option value="operation">Operation</option>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          {target === "awb" ? (
                            <SearchableSelect
                              testid={`breakdown-awb-${i}`}
                              value={b.awb_id}
                              onChange={(v) => updateRow(i, "awb_id", v)}
                              options={allOrders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name} · ${o.origin}→${o.destination}` }))}
                              placeholder="— Pilih AWB —"
                              emptyText="AWB tidak ditemukan"
                            />
                          ) : (
                            <div className="px-2 py-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
                              Direct Cost → HPP Operation
                            </div>
                          )}
                        </div>
                        <div className="col-span-3">
                          <Input data-testid={`breakdown-amount-${i}`} type="number" step="0.01" placeholder="Nominal (IDR)" value={b.amount} onChange={(e) => updateRow(i, "amount", e.target.value)}/>
                        </div>
                        <div className="col-span-3">
                          <Input data-testid={`breakdown-desc-${i}`} placeholder="Deskripsi (opsional)" value={b.description} onChange={(e) => updateRow(i, "description", e.target.value)}/>
                        </div>
                        <div className="col-span-1 text-right">
                          {breakdown.length > 1 && (
                            <button type="button" onClick={() => removeRow(i)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={14}/></button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                <div><Label>Refund (Sisa Dikembalikan)</Label><Input data-testid="panjar-refund" type="number" step="0.01" value={settleForm.refund_amount} onChange={(e) => setSettleForm({ ...settleForm, refund_amount: e.target.value })}/></div>
                <div><Label>Tanggal Settle</Label><Input data-testid="panjar-settle-date" type="date" value={settleForm.settle_date} onChange={(e) => setSettleForm({ ...settleForm, settle_date: e.target.value })}/></div>
              </div>
              <div><Label>Catatan</Label><Input value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })}/></div>

              <div className={`p-3 rounded border text-sm ${isOverSettle ? "bg-rose-50 border-rose-200 text-rose-800" : (isFullSettle ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-blue-50 border-blue-200 text-blue-800")}`}>
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>Panjar Awal:</span><span className="font-semibold">{fmtIDR(panjarAmt)}</span>
                </div>
                {(prevSettled > 0 || prevRefund > 0) && (
                  <>
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span>Sudah Disettle Sebelumnya:</span><span>−{fmtIDR(prevSettled)}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span>Sudah Direfund Sebelumnya:</span><span>−{fmtIDR(prevRefund)}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-xs border-t border-current/20 pt-1 mt-1">
                      <span>Sisa Belum Settle:</span><span className="font-semibold">{fmtIDR(remainingBefore)}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between font-mono text-xs mt-2 pt-2 border-t border-current/30">
                  <span>Settle kali ini (breakdown):</span><span>{fmtIDR(breakdownTotal)}</span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>Refund kali ini:</span><span>{fmtIDR(refund)}</span>
                </div>
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-current/20 font-bold">
                  <span>{isFullSettle ? "Status setelah ini: SETTLED" : (isOverSettle ? "⚠ MELEBIHI" : "Sisa setelah ini")}:</span>
                  <span>{isOverSettle ? `+${fmtIDR(Math.abs(newRemaining))}` : fmtIDR(Math.max(0, newRemaining))}</span>
                </div>
                {!isFullSettle && !isOverSettle && settleTotal > 0 && <p className="text-[10px] mt-1">Partial settle — status tetap {`"Open"`}, bisa lanjut settle berikutnya.</p>}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setSettleFor(null)}>Batal</Button>
              <Button data-testid="confirm-settle-panjar" variant="success" onClick={doSettle} disabled={settling || isOverSettle || settleTotal <= 0}>
                {settling ? "Memproses..." : (isFullSettle ? "Settle (Final)" : "Settle (Partial)")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ===== HISTORY MODAL — settle_history per panjar ===== */}
      {historyFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="panjar-history-modal">
          <Card className="w-full max-w-2xl p-6 max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl flex items-center gap-2">
                  <History size={18} className="text-blue-600"/>
                  History Settlement — {historyFor.number}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Panjar untuk {historyFor.recipient_name} · Total {fmtIDR(historyFor.amount)} · {historyFor.settle_history?.length || 0} event
                </p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Card className="p-2 bg-blue-50 border-blue-200">
                  <div className="text-[9px] uppercase font-bold text-blue-700">Total Panjar</div>
                  <div className="font-mono font-bold text-sm text-blue-900">{fmtIDR(historyFor.amount)}</div>
                </Card>
                <Card className="p-2 bg-emerald-50 border-emerald-200">
                  <div className="text-[9px] uppercase font-bold text-emerald-700">Sudah Settle</div>
                  <div className="font-mono font-bold text-sm text-emerald-900">{fmtIDR(historyFor.settled_amount || 0)}</div>
                </Card>
                <Card className={`p-2 ${historyFor.status === "Settled" ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className={`text-[9px] uppercase font-bold ${historyFor.status === "Settled" ? "text-emerald-700" : "text-amber-700"}`}>Sisa Outstanding</div>
                  <div className={`font-mono font-bold text-sm ${historyFor.status === "Settled" ? "text-emerald-900" : "text-amber-900"}`}>
                    {fmtIDR(historyFor.amount - (historyFor.settled_amount || 0) - (historyFor.refund_amount || 0))}
                  </div>
                </Card>
              </div>

              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left">#</th>
                      <th className="px-2 py-1.5 text-left">Tanggal</th>
                      <th className="px-2 py-1.5 text-right">Settle</th>
                      <th className="px-2 py-1.5 text-right">Refund</th>
                      <th className="px-2 py-1.5 text-left">Breakdown</th>
                      <th className="px-2 py-1.5 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyFor.settle_history || []).map((h, i) => (
                      <tr key={i} className="border-t border-slate-100" data-testid={`history-event-${i}`}>
                        <td className="px-2 py-1.5 text-xs font-bold">#{i + 1}</td>
                        <td className="px-2 py-1.5 text-xs">{fmtDate(h.settle_date)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold text-emerald-700">{fmtIDR(h.actual_amount || 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmtIDR(h.refund_amount || 0)}</td>
                        <td className="px-2 py-1.5 text-xs">
                          {(h.breakdown || []).length > 0 ? (
                            <div className="space-y-0.5">
                              {h.breakdown.map((b, bi) => (
                                <div key={bi} className="text-[10px]">
                                  <span className={`uppercase font-bold ${b.target === "operation" ? "text-emerald-700" : "text-blue-700"}`}>
                                    {b.target === "operation" ? "OPS" : (b.awb_number || b.awb_id?.slice(-6))}
                                  </span>: <span className="font-mono">{fmtIDR(b.amount)}</span>
                                  {b.description && <span className="text-slate-500"> · {b.description}</span>}
                                </div>
                              ))}
                            </div>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-slate-600">{h.notes || "-"}</td>
                      </tr>
                    ))}
                    {(historyFor.settle_history || []).length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400 text-xs">Belum ada history settle.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setHistoryFor(null)}>Tutup</Button>
            </div>
          </Card>
        </div>
      )}

      {printFor && (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-start justify-center overflow-y-auto p-4" data-testid="print-panjar-modal">
          <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full my-8">
            <div className="flex items-center justify-between px-4 py-3 border-b no-print">
              <div>
                <div className="font-heading font-bold text-lg">Preview Bank Payment Voucher — {printFor.panjar.number}</div>
                <div className="text-xs text-slate-500">Ctrl+P atau tombol Print untuk cetak. Save as PDF juga tersedia dari dialog print browser.</div>
              </div>
              <div className="flex gap-2">
                <Button data-testid="print-bpv-btn" onClick={doPrint}>
                  <Printer size={14} className="mr-1"/> Print / Save PDF
                </Button>
                <Button variant="secondary" onClick={() => setPrintFor(null)}>Tutup</Button>
              </div>
            </div>
            <div className="p-4 overflow-x-auto">
              <BPVPrintTemplate
                panjar={printFor.panjar}
                approval={printFor.approval}
                requesterName={printFor.requester_name}
                settings={settings}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalStatusPill({ status }) {
  const cls = {
    Pending: "bg-amber-100 text-amber-800 border-amber-300",
    Approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
    Rejected: "bg-red-100 text-red-800 border-red-300",
  }[status] || "bg-slate-100 text-slate-700 border-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {status}
    </span>
  );
}
