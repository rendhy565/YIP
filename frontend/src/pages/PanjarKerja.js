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
  const [carryOverApply, setCarryOverApply] = useState([]);       // selected source panjar IDs (checkboxes)
  const [transferRemaining, setTransferRemaining] = useState(false);
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
  const [expenseCats, setExpenseCats] = useState([]);
  const [showAddCat, setShowAddCat] = useState(null); // { rowIdx } | null
  const [catForm, setCatForm] = useState({ name: "", posting_type: "expense" });
  const [savingCat, setSavingCat] = useState(false);

  // Approval flow builder — per pengajuan
  const [approvalTemplate, setApprovalTemplate] = useState(null); // default steps dari config
  const [customSteps, setCustomSteps] = useState([]);             // [{name, approver_ids:[]}]

  const load = async () => {
    const [ca, os, usr, st, rec, snd, ec, cfg] = await Promise.all([
      api.get("/cash-advances"),
      api.get("/orders"),
      api.get("/users").catch(() => ({ data: [] })),
      api.get("/settings").catch(() => ({ data: [] })),
      api.get("/payment-recipients").catch(() => ({ data: [] })),
      api.get("/payment-senders").catch(() => ({ data: [] })),
      api.get("/expense-categories").catch(() => ({ data: [] })),
      api.get("/approval-configs/cash_advance").catch(() => ({ data: null })),
    ]);
    setRows(ca.data); setAllOrders(os.data); setUsers(usr.data || []);
    setRecipients(rec.data || []); setSenders(snd.data || []);
    setExpenseCats(ec.data || []);
    setApprovalTemplate(cfg.data || null);
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

  const resetApprovalSteps = () => {
    // Load default dari template global (kalau ada)
    if (approvalTemplate && approvalTemplate.steps && approvalTemplate.steps.length > 0) {
      setCustomSteps(approvalTemplate.steps.map((s) => ({
        name: s.name || "Diperiksa Oleh",
        approver_ids: [...(s.approver_ids || [])],
      })));
    } else {
      setCustomSteps([]);
    }
  };
  const addStep = () => setCustomSteps([...customSteps, { name: "Diperiksa Oleh", approver_ids: [] }]);
  const updateStep = (idx, key, val) => setCustomSteps(customSteps.map((s, i) => i === idx ? { ...s, [key]: val } : s));
  const removeStep = (idx) => setCustomSteps(customSteps.filter((_, i) => i !== idx));
  const moveStep = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= customSteps.length) return;
    const next = [...customSteps];
    [next[idx], next[j]] = [next[j], next[idx]];
    setCustomSteps(next);
  };
  const resetToTemplate = () => resetApprovalSteps();
  const clearAllSteps = () => setCustomSteps([]);

  const submit = async (e) => {
    e.preventDefault();
    // Validate custom steps (kalau ada, tidak boleh ada approver_ids kosong)
    for (const s of customSteps) {
      if (!s.name?.trim()) { toast.error("Setiap langkah approval harus punya nama"); return; }
      if (!s.approver_ids || s.approver_ids.length === 0) {
        toast.error(`Langkah "${s.name}" belum punya approver`); return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        ppn_amount: parseFloat(form.ppn_amount) || 0,
        pph_amount: parseFloat(form.pph_amount) || 0,
        custom_approval_steps: customSteps.length > 0 ? customSteps : null,
      };
      await api.post("/cash-advances", payload);
      toast.success("Panjar dibuat");
      setShowAdd(false); setForm(empty); resetApprovalSteps(); load();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSaving(false); }
  };

  const openSettle = (r) => {
    setSettleFor(r);
    setSettleForm({ refund_amount: "0", settle_date: todayStr(), notes: "" });
    setBreakdown([{ target: "awb", awb_id: "", amount: "", description: "", expense_category: "", transaction_date: todayStr() }]);
    setCarryOverApply([]);
    setTransferRemaining(false);
  };

  const addRow = (target = "awb") => setBreakdown([...breakdown, { target, awb_id: "", amount: "", description: "", expense_category: "", transaction_date: todayStr() }]);
  const removeRow = (idx) => setBreakdown(breakdown.filter((_, i) => i !== idx));
  const updateRow = (idx, key, val) => setBreakdown(breakdown.map((b, i) => i === idx ? { ...b, [key]: val } : b));

  const openAddCat = (rowIdx) => {
    setCatForm({ name: "", posting_type: "expense" });
    setShowAddCat({ rowIdx });
  };
  const saveCategory = async (e) => {
    e.preventDefault();
    if (!catForm.name.trim()) { toast.error("Nama kategori wajib diisi"); return; }
    setSavingCat(true);
    try {
      const r = await api.post("/expense-categories", catForm);
      toast.success("Kategori baru dibuat");
      const cats = (await api.get("/expense-categories").catch(() => ({ data: expenseCats }))).data || [];
      setExpenseCats(cats);
      if (showAddCat && typeof showAddCat.rowIdx === "number") {
        updateRow(showAddCat.rowIdx, "expense_category", r.data.name);
      }
      setShowAddCat(null);
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSavingCat(false); }
  };

  const breakdownTotal = breakdown.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  const refund = parseFloat(settleForm.refund_amount) || 0;
  const settleTotal = breakdownTotal + refund;
  const panjarAmt = settleFor?.amount || 0;
  const prevSettled = settleFor?.settled_amount || 0;
  const prevRefund = settleFor?.refund_amount || 0;

  // Carry-over sources yang tersedia untuk penerima ini (excl. panjar sekarang, harus transferred & belum consumed)
  const carryOverAvailable = (rows || []).filter((r) =>
    settleFor
    && r.id !== settleFor.id
    && (r.recipient_name || "").trim().toLowerCase() === (settleFor.recipient_name || "").trim().toLowerCase()
    && r.carry_over_transferred
    && !r.carry_over_consumed_by
    && (parseFloat(r.carry_over_amount) || 0) > 0
  );
  const carryOverAppliedTotal = carryOverAvailable
    .filter((r) => carryOverApply.includes(r.id))
    .reduce((s, r) => s + (parseFloat(r.carry_over_amount) || 0), 0);

  const remainingBefore = panjarAmt - prevSettled - prevRefund + carryOverAppliedTotal;
  const newRemaining = remainingBefore - settleTotal;
  const isFullSettle = Math.abs(newRemaining) < 0.01;
  const isOverSettle = newRemaining < -0.01;
  const canTransferRemaining = newRemaining > 0.01;   // hanya bisa transfer kalau ada sisa

  const doSettle = async () => {
    // Skip baris breakdown yang kosong (amount = 0 atau null)
    const validBreakdown = breakdown.filter((b) => parseFloat(b.amount) > 0);
    // Validate only non-empty rows
    for (const b of validBreakdown) {
      if ((b.target || "awb") === "awb" && !b.awb_id) {
        toast.error("Untuk target AWB, pilih AWB-nya"); return;
      }
      if (b.target === "finance" && !b.expense_category) {
        toast.error("Untuk target Finance, pilih kategori expense-nya"); return;
      }
    }
    // Boleh: (a) ada settle > 0, atau (b) centang transfer sisa, atau (c) pilih carry-over dari panjar sebelumnya
    const anyAction = settleTotal > 0 || transferRemaining || carryOverApply.length > 0;
    if (!anyAction) {
      toast.error("Isi minimal 1 baris breakdown, centang 'Transfer sisa', atau pilih carry-over dari panjar sebelumnya");
      return;
    }
    if (isOverSettle) {
      toast.error(`Total settle (${fmtIDR(settleTotal)}) melebihi budget (${fmtIDR(remainingBefore)})`);
      return;
    }
    if (transferRemaining && !canTransferRemaining) {
      toast.error("Tidak ada sisa untuk di-transfer");
      return;
    }
    const willBeDone = isFullSettle || transferRemaining;
    if (!willBeDone) {
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
        awb_breakdown: validBreakdown.length > 0 ? validBreakdown.map((b) => ({
          target: b.target || "awb",
          awb_id: (b.target === "operation" || b.target === "finance") ? null : b.awb_id,
          amount: parseFloat(b.amount),
          description: b.description || null,
          expense_category: b.target === "finance" ? (b.expense_category || null) : null,
          transaction_date: b.transaction_date || settleForm.settle_date || null,
        })) : null,
        apply_carry_over_from: carryOverApply.length > 0 ? carryOverApply : null,
        transfer_remaining_to_next: transferRemaining,
      });
      toast.success(
        transferRemaining
          ? (settleTotal > 0
              ? `Panjar ${settleFor.number} settled — sisa ${fmtIDR(newRemaining)} disimpan sebagai carry-over`
              : `Panjar ${settleFor.number} ditutup — semua saldo (${fmtIDR(newRemaining)}) jadi carry-over untuk ${settleFor.recipient_name}`)
          : isFullSettle
          ? `Panjar ${settleFor.number} fully settled`
          : settleTotal <= 0 && carryOverApply.length > 0
          ? `Carry-over ${fmtIDR(carryOverAppliedTotal)} berhasil dipindahkan ke ${settleFor.number}`
          : `Partial settle (${fmtIDR(settleTotal)}) berhasil. Sisa: ${fmtIDR(newRemaining)} — status tetap Open`
      );
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
        action={canCreate ? <Button data-testid="add-panjar-btn" onClick={() => { setForm(empty); resetApprovalSteps(); setShowAdd(true); }}><Plus size={16}/> Buat Panjar</Button> : null}
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
                  {r.carry_over_transferred && !r.carry_over_consumed_by && (
                    <div className="text-[9px] font-bold text-purple-700 mt-0.5 inline-flex items-center gap-1 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                      💰 Carry-Over: {fmtIDR(r.carry_over_amount)}
                    </div>
                  )}
                  {r.carry_over_consumed_by && (
                    <div className="text-[9px] text-slate-500 mt-0.5" title={`Diserap ke ${r.carry_over_consumed_number || ''}`}>
                      → diserap ke {r.carry_over_consumed_number || "panjar berikut"}
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

              {/* ===== Approval Flow Builder (per pengajuan) ===== */}
              <div className="border border-purple-200 rounded-lg p-3 bg-purple-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-purple-700">Alur Approval</div>
                    <div className="text-[10px] text-slate-500">
                      Default dari template. Anda bisa custom untuk pengajuan ini saja. Kolom <b>Disetujui Oleh: Amrullah & Abidin</b> akan otomatis ditambahkan di voucher final.
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" data-testid="reset-approval-btn" onClick={resetToTemplate} className="px-2 py-1 text-[10px] rounded bg-slate-200 hover:bg-slate-300 text-slate-700">Reset ke Template</button>
                    <button type="button" data-testid="clear-approval-btn" onClick={clearAllSteps} className="px-2 py-1 text-[10px] rounded bg-red-100 hover:bg-red-200 text-red-700">Kosongkan</button>
                  </div>
                </div>

                <div className="space-y-2">
                  {customSteps.length === 0 && (
                    <div className="text-[11px] text-slate-500 italic px-2 py-3 bg-white border border-dashed border-slate-300 rounded text-center">
                      Belum ada langkah pemeriksaan. Panjar akan langsung ke tanda tangan final (Amrullah & Abidin).
                    </div>
                  )}
                  {customSteps.map((s, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center bg-white border border-slate-200 rounded p-2" data-testid={`approval-step-${i}`}>
                      <div className="col-span-1 text-center text-[10px] font-bold text-slate-500">
                        #{i + 1}
                      </div>
                      <div className="col-span-4">
                        <Input
                          data-testid={`step-name-${i}`}
                          placeholder="Nama tahap (mis. Diperiksa Oleh Finance)"
                          value={s.name}
                          onChange={(e) => updateStep(i, "name", e.target.value)}
                        />
                      </div>
                      <div className="col-span-5">
                        <Select
                          data-testid={`step-approver-${i}`}
                          value={s.approver_ids[0] || ""}
                          onChange={(e) => updateStep(i, "approver_ids", e.target.value ? [e.target.value] : [])}
                        >
                          <option value="">— Pilih approver —</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.full_name || u.username} · {u.role}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="col-span-2 flex gap-1 justify-end">
                        <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Naikkan" className="px-1.5 py-1 rounded hover:bg-slate-100 disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moveStep(i, +1)} disabled={i === customSteps.length - 1} title="Turunkan" className="px-1.5 py-1 rounded hover:bg-slate-100 disabled:opacity-30">↓</button>
                        <button type="button" onClick={() => removeStep(i)} title="Hapus" className="px-1.5 py-1 rounded hover:bg-red-50 text-red-600"><Trash2 size={12}/></button>
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" data-testid="add-step-btn" onClick={addStep} className="mt-2 w-full text-[11px] font-bold text-purple-700 hover:bg-purple-100 border border-dashed border-purple-300 rounded py-2 inline-flex items-center justify-center gap-1">
                  <Plus size={12}/> Tambah Langkah Pemeriksaan
                </button>

                {/* Preview alur lengkap */}
                <div className="mt-3 pt-2 border-t border-purple-200">
                  <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Preview Alur di Voucher:</div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">Dibuat Oleh</span>
                    <span className="text-slate-400">→</span>
                    {customSteps.map((s, i) => (
                      <React.Fragment key={i}>
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">{s.name || "?"}</span>
                        <span className="text-slate-400">→</span>
                      </React.Fragment>
                    ))}
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold">Disetujui: Amrullah</span>
                    <span className="text-slate-400">+</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold">Disetujui: Abidin</span>
                  </div>
                </div>
              </div>

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

      {/* ===== Add New Expense Category modal ===== */}
      {showAddCat && (
        <div className="fixed inset-0 bg-slate-900/70 z-[60] flex items-center justify-center p-4" data-testid="add-cat-modal">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start justify-between mb-3">
              <h4 className="font-heading font-bold text-lg">Tambah Kategori Expense Baru</h4>
              <button onClick={() => setShowAddCat(null)} className="p-1 hover:bg-slate-100 rounded"><X size={16}/></button>
            </div>
            <form onSubmit={saveCategory} className="space-y-3">
              <div>
                <Label>Nama Kategori *</Label>
                <Input data-testid="cat-name" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="Mis. Bensin Kendaraan Operasional" required autoFocus/>
              </div>
              <div>
                <Label>Tipe Posting *</Label>
                <Select data-testid="cat-posting-type" value={catForm.posting_type} onChange={(e) => setCatForm({ ...catForm, posting_type: e.target.value })}>
                  <option value="expense">Operating Expense (di bawah Gross Margin, akun 62xx dibuat otomatis)</option>
                  <option value="cogs">HPP / Cost of Goods Sold (mengurangi Gross Margin, akun 5102)</option>
                </Select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Pilih {`"Operating Expense"`} untuk beban umum (gaji, sewa, ATK, dll). Pilih {`"HPP"`} hanya untuk biaya yang langsung terkait pengiriman.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="secondary" type="button" onClick={() => setShowAddCat(null)}>Batal</Button>
                <Button data-testid="save-cat-btn" type="submit" disabled={savingCat}>{savingCat ? "Menyimpan..." : "Simpan Kategori"}</Button>
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
              {/* ===== Carry-Over dari panjar sebelumnya (penerima sama) ===== */}
              {carryOverAvailable.length > 0 && (
                <div className="border border-purple-300 rounded-lg p-3 bg-purple-50" data-testid="carryover-section">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-purple-800">💰 Carry-Over Tersedia</div>
                      <div className="text-[10px] text-slate-600">Sisa panjar sebelumnya untuk penerima <b>{settleFor?.recipient_name}</b>. Centang untuk menyerap ke settle ini.</div>
                    </div>
                    {carryOverAppliedTotal > 0 && (
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">Total diserap</div>
                        <div className="font-mono font-bold text-purple-700">{fmtIDR(carryOverAppliedTotal)}</div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {carryOverAvailable.map((c) => (
                      <label key={c.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${carryOverApply.includes(c.id) ? "bg-purple-100 border border-purple-300" : "bg-white border border-slate-200 hover:bg-slate-50"}`} data-testid={`carryover-item-${c.number}`}>
                        <input
                          type="checkbox"
                          checked={carryOverApply.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) setCarryOverApply([...carryOverApply, c.id]);
                            else setCarryOverApply(carryOverApply.filter((x) => x !== c.id));
                          }}
                          data-testid={`carryover-check-${c.number}`}
                        />
                        <div className="flex-1 flex items-center justify-between">
                          <span className="font-mono font-semibold">{c.number}</span>
                          <span className="text-slate-500 truncate ml-2 flex-1">{c.purpose || "-"}</span>
                          <span className="font-mono font-bold text-purple-700 ml-2">{fmtIDR(c.carry_over_amount)}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500">Breakdown ke AWB / Operation / Finance</h4>
                  <div className="flex gap-2">
                    <button type="button" data-testid="add-awb-row-btn" onClick={() => addRow("awb")} className="text-[11px] font-bold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"><Plus size={12}/> Baris AWB</button>
                    <button type="button" data-testid="add-operation-row-btn" onClick={() => addRow("operation")} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"><Plus size={12}/> Baris Operation</button>
                    <button type="button" data-testid="add-finance-row-btn" onClick={() => addRow("finance")} className="text-[11px] font-bold text-purple-700 hover:text-purple-900 inline-flex items-center gap-1"><Plus size={12}/> Baris Finance</button>
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center px-1 pb-1 text-[9px] uppercase tracking-wide font-bold text-slate-500">
                  <div className="col-span-2">Target</div>
                  <div className="col-span-3">Detail</div>
                  <div className="col-span-2">Tgl Transaksi</div>
                  <div className="col-span-2">Nominal</div>
                  <div className="col-span-2">Deskripsi</div>
                  <div className="col-span-1"></div>
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
                            <option value="finance">Finance</option>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          {target === "awb" && (
                            <SearchableSelect
                              testid={`breakdown-awb-${i}`}
                              value={b.awb_id}
                              onChange={(v) => updateRow(i, "awb_id", v)}
                              options={allOrders.map((o) => ({ value: o.id, label: o.awb_number, sub: `${o.status} · ${o.customer_name} · ${o.origin}→${o.destination}` }))}
                              placeholder="— Pilih AWB —"
                              emptyText="AWB tidak ditemukan"
                            />
                          )}
                          {target === "operation" && (
                            <div className="px-2 py-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
                              Direct Cost → HPP Operation
                            </div>
                          )}
                          {target === "finance" && (
                            <div className="flex gap-1">
                              <Select
                                data-testid={`breakdown-cat-${i}`}
                                value={b.expense_category || ""}
                                onChange={(e) => updateRow(i, "expense_category", e.target.value)}
                                className="flex-1"
                              >
                                <option value="">— Pilih kategori —</option>
                                {expenseCats.map((c) => (
                                  <option key={c.id} value={c.name}>
                                    {c.name} {c.posting_type === "cogs" ? "· HPP" : "· Expense"}
                                  </option>
                                ))}
                              </Select>
                              <button
                                type="button"
                                data-testid={`add-cat-${i}`}
                                onClick={() => openAddCat(i)}
                                title="Tambah kategori baru"
                                className="px-2 rounded bg-purple-100 hover:bg-purple-200 text-purple-800 border border-purple-200"
                              >
                                <Plus size={14}/>
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="col-span-2">
                          <Input
                            data-testid={`breakdown-date-${i}`}
                            type="date"
                            title="Tanggal transaksi"
                            value={b.transaction_date || ""}
                            onChange={(e) => updateRow(i, "transaction_date", e.target.value)}
                          />
                        </div>
                        <div className="col-span-2">
                          <Input data-testid={`breakdown-amount-${i}`} type="number" step="0.01" placeholder="Nominal" value={b.amount} onChange={(e) => updateRow(i, "amount", e.target.value)}/>
                        </div>
                        <div className="col-span-2">
                          <Input data-testid={`breakdown-desc-${i}`} placeholder="Deskripsi" value={b.description} onChange={(e) => updateRow(i, "description", e.target.value)}/>
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
                <div className="mt-1 text-[10px] text-slate-500">
                  <b>AWB</b>: cost per-AWB (5102) · <b>Operation</b>: HPP langsung (5102) · <b>Finance</b>: expense per-kategori (auto-input ke halaman Expenses & P&L)
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                <div><Label>Refund (Sisa Dikembalikan Tunai)</Label><Input data-testid="panjar-refund" type="number" step="0.01" value={settleForm.refund_amount} onChange={(e) => setSettleForm({ ...settleForm, refund_amount: e.target.value })}/></div>
                <div><Label>Tanggal Settle</Label><Input data-testid="panjar-settle-date" type="date" value={settleForm.settle_date} onChange={(e) => setSettleForm({ ...settleForm, settle_date: e.target.value })}/></div>
              </div>
              <div><Label>Catatan</Label><Input value={settleForm.notes} onChange={(e) => setSettleForm({ ...settleForm, notes: e.target.value })}/></div>

              {/* Transfer sisa ke panjar berikutnya */}
              {canTransferRemaining && (
                <label className={`flex items-start gap-2 p-3 rounded border cursor-pointer ${transferRemaining ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-slate-200"}`} data-testid="transfer-remaining-toggle">
                  <input
                    type="checkbox"
                    checked={transferRemaining}
                    onChange={(e) => setTransferRemaining(e.target.checked)}
                    className="mt-0.5"
                    data-testid="transfer-remaining-checkbox"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-amber-900">Transfer sisa ke panjar berikutnya</div>
                    <div className="text-slate-600 mt-0.5">
                      Sisa <span className="font-mono font-bold">{fmtIDR(newRemaining)}</span> disimpan sebagai <b>carry-over</b> untuk {settleFor?.recipient_name}. Panjar {settleFor?.number} dinyatakan <b>Settled</b> — sisa bisa diserap ke panjar berikut dengan penerima sama.
                    </div>
                  </div>
                </label>
              )}

              <div className={`p-3 rounded border text-sm ${isOverSettle ? "bg-rose-50 border-rose-200 text-rose-800" : (transferRemaining ? "bg-amber-50 border-amber-200 text-amber-900" : (isFullSettle ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-blue-50 border-blue-200 text-blue-800"))}`}>
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>Panjar Awal:</span><span className="font-semibold">{fmtIDR(panjarAmt)}</span>
                </div>
                {carryOverAppliedTotal > 0 && (
                  <div className="flex items-center justify-between font-mono text-xs text-purple-800">
                    <span>+ Carry-over dari panjar sebelumnya:</span><span>+{fmtIDR(carryOverAppliedTotal)}</span>
                  </div>
                )}
                {(prevSettled > 0 || prevRefund > 0) && (
                  <>
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span>Sudah Disettle Sebelumnya:</span><span>−{fmtIDR(prevSettled)}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span>Sudah Direfund Sebelumnya:</span><span>−{fmtIDR(prevRefund)}</span>
                    </div>
                    <div className="flex items-center justify-between font-mono text-xs border-t border-current/20 pt-1 mt-1">
                      <span>Budget Tersedia:</span><span className="font-semibold">{fmtIDR(remainingBefore)}</span>
                    </div>
                  </>
                )}
                {(prevSettled === 0 && prevRefund === 0 && carryOverAppliedTotal > 0) && (
                  <div className="flex items-center justify-between font-mono text-xs border-t border-current/20 pt-1 mt-1">
                    <span>Budget Tersedia:</span><span className="font-semibold">{fmtIDR(remainingBefore)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-mono text-xs mt-2 pt-2 border-t border-current/30">
                  <span>Settle kali ini (breakdown):</span><span>{fmtIDR(breakdownTotal)}</span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>Refund kali ini:</span><span>{fmtIDR(refund)}</span>
                </div>
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-current/20 font-bold">
                  <span>{transferRemaining ? "Sisa jadi Carry-Over" : (isFullSettle ? "Status: SETTLED" : (isOverSettle ? "⚠ MELEBIHI" : "Sisa setelah ini"))}:</span>
                  <span>{isOverSettle ? `+${fmtIDR(Math.abs(newRemaining))}` : fmtIDR(Math.max(0, newRemaining))}</span>
                </div>
                {transferRemaining && <p className="text-[10px] mt-1">Sisa akan disimpan sebagai carry-over untuk penerima {settleFor?.recipient_name} — bisa diserap oleh panjar berikutnya.</p>}
                {!transferRemaining && !isFullSettle && !isOverSettle && settleTotal > 0 && <p className="text-[10px] mt-1">Partial settle — status tetap {`"Open"`}, bisa lanjut settle berikutnya.</p>}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setSettleFor(null)}>Batal</Button>
              <Button data-testid="confirm-settle-panjar" variant="success" onClick={doSettle} disabled={settling || isOverSettle || (settleTotal <= 0 && !transferRemaining && carryOverApply.length === 0)}>
                {settling ? "Memproses..." : (transferRemaining ? "Settle + Transfer Sisa" : (isFullSettle ? "Settle (Final)" : (settleTotal <= 0 && carryOverApply.length > 0 ? "Serap Carry-Over" : "Settle (Partial)")))}
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
