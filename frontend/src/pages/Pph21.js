import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Select, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Receipt, ChevronDown, ChevronRight, CheckCircle2, Banknote, X } from "lucide-react";
import Pagination, { usePagination } from "../components/Pagination";

const STATUS_BADGE = {
  paid: "bg-emerald-50 text-emerald-800 border-emerald-200",
  unpaid: "bg-amber-50 text-amber-800 border-amber-200",
  none: "bg-slate-50 text-slate-500 border-slate-200",
};
const STATUS_LABEL = { paid: "Sudah Dibayar", unpaid: "Belum Dibayar", none: "Nihil" };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Pph21() {
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [cashAccounts, setCashAccounts] = useState([]);
  const [payFor, setPayFor] = useState(null);   // period row being paid
  const [payForm, setPayForm] = useState({ cash_account_code: "1101", expense_date: todayStr() });
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/hr/pph21").then((r) => setRows(r.data || [])).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); api.get("/accounts", { params: { is_cash: true } }).then((r) => setCashAccounts(r.data || [])); }, []);
  const pag = usePagination(rows, { resetKey: "", defaultSize: 50 });

  const openPay = (row) => {
    setPayFor(row);
    setPayForm({ cash_account_code: cashAccounts[0]?.code || "1101", expense_date: todayStr() });
  };
  const submitPay = async () => {
    if (!payFor) return;
    setSaving(true);
    try {
      await api.post(`/hr/pph21/${payFor.payroll_id}/pay`, payForm);
      toast.success("PPh21 berhasil dibayar & tercatat sebagai expense");
      setPayFor(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="pph21-page">
      <PageHeader
        title="PPh 21 Karyawan"
        subtitle="Metode TER (PMK 168/2023) — ditanggung perusahaan (nett). Bayar per periode untuk mencatat sebagai expense."
      />

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <thead><tr>
              <Th></Th><Th>Periode Payroll</Th><Th className="text-right">Total PPh21</Th><Th>Status</Th><Th>Tgl Bayar</Th><Th className="text-right">Aksi</Th>
            </tr></thead>
            <tbody>
              {pag.paged.map((r) => (
                <React.Fragment key={r.payroll_id}>
                  <tr data-testid={`pph21-row-${r.period_month}`} className="hover:bg-slate-50">
                    <Td>
                      <button onClick={() => setExpanded(expanded === r.payroll_id ? null : r.payroll_id)} className="p-1 hover:bg-slate-100 rounded" data-testid={`pph21-expand-${r.period_month}`}>
                        {expanded === r.payroll_id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                      </button>
                    </Td>
                    <Td className="font-bold">{r.period_month}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(r.total_pph21)}</Td>
                    <Td><span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded border ${STATUS_BADGE[r.status] || STATUS_BADGE.none}`}>{STATUS_LABEL[r.status] || r.status}</span></Td>
                    <Td>{r.paid_at ? fmtDate(r.paid_at) : "-"}</Td>
                    <Td className="text-right">
                      {r.status === "unpaid" && r.total_pph21 > 0 ? (
                        <Button data-testid={`pph21-pay-btn-${r.period_month}`} variant="success" onClick={() => openPay(r)}><Banknote size={13}/> Bayar PPh21</Button>
                      ) : r.status === "paid" ? (
                        <span className="text-emerald-600 inline-flex items-center gap-1 text-xs font-bold"><CheckCircle2 size={13}/> Lunas</span>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                    </Td>
                  </tr>
                  {expanded === r.payroll_id && (
                    <tr>
                      <Td colSpan={6} className="bg-slate-50 p-0">
                        <div className="p-3">
                          <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Rincian per Karyawan</div>
                          <Table>
                            <thead><tr>
                              <Th>Karyawan</Th><Th>PTKP</Th><Th>Kategori TER</Th><Th className="text-right">Tarif</Th><Th className="text-right">Bruto</Th><Th className="text-right">PPh21</Th>
                            </tr></thead>
                            <tbody>
                              {(r.slips || []).map((s) => (
                                <tr key={s.employee_id}>
                                  <Td>{s.employee_name}{s.employee_no ? <span className="text-slate-400 text-xs ml-1">({s.employee_no})</span> : null}</Td>
                                  <Td>{s.ptkp_status}</Td>
                                  <Td>{s.ter_category || "-"}</Td>
                                  <Td className="text-right">{s.ter_rate != null ? `${(s.ter_rate * 100).toFixed(2)}%` : "Progresif (Des)"}</Td>
                                  <Td className="text-right font-mono">{fmtIDR(s.pph21_bruto)}</Td>
                                  <Td className="text-right font-mono font-bold">{fmtIDR(s.pph21)}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr><Td colSpan={6} className="text-center text-slate-400 py-6">Belum ada data payroll. Jalankan payroll dulu di menu HR & Payroll.</Td></tr>
              )}
            </tbody>
          </Table>
          <Pagination {...pag} testid="pagination-pph21"/>
        </div>
      </Card>

      {/* Pay modal */}
      {payFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" data-testid="pph21-pay-modal">
          <Card className="w-full max-w-md p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <div className="flex items-center gap-2 font-bold"><Receipt size={16} className="text-emerald-600"/> Bayar PPh21 — {payFor.period_month}</div>
              <button onClick={() => setPayFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={16}/></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="p-3 rounded bg-emerald-50 border border-emerald-200">
                <div className="text-[10px] uppercase font-bold text-emerald-700">Total PPh21 Dibayar</div>
                <div className="font-heading font-black text-xl text-emerald-900">{fmtIDR(payFor.total_pph21)}</div>
              </div>
              <div>
                <Label>Rekening Sumber Pembayaran</Label>
                <Select data-testid="pph21-cash-account" value={payForm.cash_account_code} onChange={(e) => setPayForm({ ...payForm, cash_account_code: e.target.value })}>
                  {cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Tanggal Pembayaran</Label>
                <Input type="date" data-testid="pph21-expense-date" value={payForm.expense_date} onChange={(e) => setPayForm({ ...payForm, expense_date: e.target.value })}/>
              </div>
              <p className="text-xs text-slate-500">Jurnal: Dr Beban PPh21 Karyawan (6106) / Cr Kas. Akan muncul di halaman Expenses.</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <Button variant="ghost" onClick={() => setPayFor(null)}>Batal</Button>
              <Button data-testid="pph21-confirm-pay" variant="success" disabled={saving} onClick={submitPay}><Banknote size={14}/> {saving ? "Memproses..." : "Bayar & Catat Expense"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
