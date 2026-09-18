import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import SearchableSelect from "../components/SearchableSelect";
import MonthPicker from "../components/MonthPicker";
import { fmtIDR, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Wallet, Plus, X, CheckCircle2, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import NumberInput from "../components/NumberInput";
import Pagination, { usePagination } from "../components/Pagination";

const STATUS_BADGE = {
  active: "bg-blue-50 text-blue-800 border-blue-200",
  settled: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

function nextMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function KasbonKaryawan() {
  const [loans, setLoans] = useState([]);
  const [emps, setEmps] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: "", principal: "", installments: "", start_period: nextMonth(), note: "" });

  const load = () => {
    const params = {};
    if (statusFilter) params.status = statusFilter;
    api.get("/hr/kasbon", { params }).then((r) => setLoans(r.data || []));
  };
  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => { api.get("/hr/employees").then((r) => setEmps(r.data || [])); }, []);

  const pag = usePagination(loans, { resetKey: statusFilter });

  const perInstallment = (() => {
    const p = Number(form.principal), n = Number(form.installments);
    if (!p || !n || n < 1) return 0;
    return Math.round((p / n) * 100) / 100;
  })();

  const submit = async () => {
    if (!form.employee_id) return toast.error("Pilih karyawan");
    if (!Number(form.principal) || Number(form.principal) <= 0) return toast.error("Jumlah pinjaman harus > 0");
    if (!Number(form.installments) || Number(form.installments) < 1) return toast.error("Jumlah cicilan minimal 1");
    setSaving(true);
    try {
      await api.post("/hr/kasbon", {
        employee_id: form.employee_id,
        principal: Number(form.principal),
        installments: Number(form.installments),
        start_period: form.start_period,
        source_account_code: "1101",
        note: form.note || null,
      });
      toast.success("Kasbon dibuat & jurnal pencairan ter-post");
      setShowForm(false);
      setForm({ employee_id: "", principal: "", installments: "", start_period: nextMonth(), note: "" });
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  const settle = async (loan) => {
    if (!window.confirm(`Lunasi sisa kasbon ${loan.employee_name} sebesar ${fmtIDR(loan.outstanding)}? Jurnal: Dr Kas / Cr Piutang.`)) return;
    try {
      await api.post(`/hr/kasbon/${loan.id}/settle`, { account_code: "1101" });
      toast.success("Kasbon dilunasi");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const cancel = async (loan) => {
    if (!window.confirm(`Batalkan kasbon ${loan.employee_name}? Jurnal pencairan akan di-reverse.`)) return;
    try {
      await api.delete(`/hr/kasbon/${loan.id}`);
      toast.success("Kasbon dibatalkan");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="kasbon-page">
      <PageHeader title="Kasbon Karyawan" subtitle="Pinjaman karyawan (Piutang 1109) — dicairkan dari Kas, dicicil otomatis potong gaji tiap bulan sampai lunas." />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label>Status</Label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="kasbon-status-filter">
            <option value="">Semua</option>
            <option value="active">Aktif (belum lunas)</option>
            <option value="settled">Lunas</option>
          </select>
        </div>
        <Button onClick={() => setShowForm(true)} data-testid="kasbon-new-btn"><Plus size={14} /> Kasbon Baru</Button>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th></Th><Th>Karyawan</Th><Th>Mulai</Th><Th className="text-right">Pinjaman</Th>
            <Th className="text-right">Cicilan/bln</Th><Th className="text-right">Sisa</Th>
            <Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {pag.paged.map((k) => {
              const isOpen = expanded === k.id;
              const paidCount = (k.payments || []).length;
              return (
                <React.Fragment key={k.id}>
                  <tr data-testid={`kasbon-row-${k.id}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isOpen ? null : k.id)}>
                    <Td>{isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}</Td>
                    <Td className="font-semibold">{k.employee_name}{k.employee_no && <div className="text-[10px] text-slate-500 font-mono">{k.employee_no}</div>}</Td>
                    <Td className="font-mono text-xs">{k.start_period}</Td>
                    <Td className="text-right font-mono">{fmtIDR(k.principal)}</Td>
                    <Td className="text-right font-mono">{fmtIDR(k.installment_amount)} <span className="text-[10px] text-slate-400">× {k.installments}</span></Td>
                    <Td className="text-right font-mono font-bold text-rose-700">{fmtIDR(k.outstanding)}</Td>
                    <Td><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[k.status] || "bg-slate-50 text-slate-700 border-slate-200"}`}>{k.status === "settled" ? "Lunas" : "Aktif"}</span></Td>
                    <Td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {k.status === "active" && (
                        <>
                          <Button variant="success" onClick={() => settle(k)} data-testid={`kasbon-settle-${k.id}`} className="mr-1"><CheckCircle2 size={12} /> Lunasi</Button>
                          {paidCount === 0 && <Button variant="danger" onClick={() => cancel(k)} data-testid={`kasbon-cancel-${k.id}`}><Trash2 size={12} /></Button>}
                        </>
                      )}
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <Td colSpan={8} className="p-0">
                        <div className="px-6 py-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <div className="text-[11px] uppercase tracking-wide font-bold text-slate-500 mb-2">Jadwal Cicilan</div>
                            <div className="space-y-1">
                              {(k.schedule || []).map((s, i) => {
                                const paid = (k.payments || []).some((p) => p.period_month === s.period_month);
                                return (
                                  <div key={i} className="text-xs flex justify-between border-b border-slate-100 py-0.5">
                                    <span className="font-mono">{s.period_month}</span>
                                    <span className="font-mono">{fmtIDR(s.amount)}</span>
                                    <span className={paid ? "text-emerald-700 font-bold" : "text-slate-400"}>{paid ? "✓ dipotong" : "pending"}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-wide font-bold text-slate-500 mb-2">Riwayat Pemotongan</div>
                            {(k.payments || []).length === 0 ? <div className="text-xs text-slate-400 italic">Belum ada pemotongan.</div> : (
                              <div className="space-y-1">
                                {(k.payments || []).map((p, i) => (
                                  <div key={i} className="text-xs flex justify-between border-b border-slate-100 py-0.5">
                                    <span className="font-mono">{p.period_month || (p.type === "early_settlement" ? "Pelunasan" : "-")}</span>
                                    <span className="font-mono text-emerald-700">{fmtIDR(p.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {k.note && <div className="mt-2 text-xs text-slate-500">Catatan: {k.note}</div>}
                          </div>
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {loans.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10"><Wallet size={28} className="mx-auto opacity-30 mb-2" />Belum ada kasbon.</Td></tr>}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-kasbon"/>
      </Card>

      {showForm && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="kasbon-form-modal">
          <Card className="w-full max-w-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-lg flex items-center gap-2"><Wallet size={18} /> Kasbon Baru</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Karyawan</Label>
                <SearchableSelect
                  testid="kasbon-form-emp"
                  value={form.employee_id}
                  onChange={(v) => setForm({ ...form, employee_id: v })}
                  placeholder="— Pilih karyawan —"
                  options={emps.filter((e) => e.active !== false).map((e) => ({ value: e.id, label: e.full_name, sub: e.employee_no || "" }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Jumlah Pinjaman (Rp)</Label>
                  <NumberInput value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} placeholder="10000000" data-testid="kasbon-form-principal" />
                </div>
                <div>
                  <Label>Jumlah Cicilan (bulan)</Label>
                  <Input type="number" min="1" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} placeholder="10" data-testid="kasbon-form-installments" />
                </div>
              </div>
              <div>
                <Label>Mulai Potong (Periode Gajian)</Label>
                <MonthPicker value={form.start_period} onChange={(v) => setForm({ ...form, start_period: v })} />
              </div>
              <div>
                <Label>Catatan (opsional)</Label>
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Mis. pinjaman renovasi rumah" />
              </div>
              {perInstallment > 0 && (
                <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-blue-900">
                  Cicilan rata: <b>{fmtIDR(perInstallment)}</b>/bulan selama <b>{form.installments}</b> bulan.
                  <div className="mt-1 font-mono text-[11px]">Jurnal pencairan: Dr <b>1109 Piutang Karyawan</b> / Cr <b>1101 Kas</b> — {fmtIDR(Number(form.principal))}</div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={submit} disabled={saving} data-testid="kasbon-form-submit"><Plus size={13} /> {saving ? "Menyimpan..." : "Buat Kasbon"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
