import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Save, X, BookOpen } from "lucide-react";
import { useAuth } from "../lib/auth";
import NumberInput from "../components/NumberInput";

export default function JournalUmum() {
  const { user } = useAuth();
  const canCreate = ["administrator", "finance"].includes(user?.role);
  const isAdmin = user?.role === "administrator";
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [period, setPeriod] = useState(currentMonth());
  const [refType, setRefType] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: "", date: new Date().toISOString().slice(0, 10), lines: [{ account_code: "", debit: 0, credit: 0, memo: "" }, { account_code: "", debit: 0, credit: 0, memo: "" }] });
  const [expanded, setExpanded] = useState({});

  const load = () => {
    const p = {};
    if (period) p.period = period;
    if (refType) p.reference_type = refType;
    if (accountCode) p.account_code = accountCode;
    api.get("/journal", { params: p }).then((r) => setEntries(r.data));
  };
  useEffect(() => { api.get("/accounts").then((r) => setAccounts(r.data)); }, []);
  useEffect(() => { load(); }, [period, refType, accountCode]);

  const addLine = () => setForm({ ...form, lines: [...form.lines, { account_code: "", debit: 0, credit: 0, memo: "" }] });
  const removeLine = (i) => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) });
  const updLine = (i, k, v) => { const ls = [...form.lines]; ls[i] = { ...ls[i], [k]: v }; setForm({ ...form, lines: ls }); };

  const totalDr = form.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = form.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;

  const submit = async () => {
    if (!form.description) return toast.error("Deskripsi wajib");
    if (!balanced) return toast.error("Debit harus = Kredit dan > 0");
    if (form.lines.some((l) => !l.account_code)) return toast.error("Pilih akun untuk semua baris");
    try {
      await api.post("/journal", {
        description: form.description,
        date: new Date(form.date).toISOString(),
        lines: form.lines.map((l) => ({ ...l, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
      });
      toast.success("Jurnal terposting");
      setShowForm(false);
      setForm({ description: "", date: new Date().toISOString().slice(0, 10), lines: [{ account_code: "", debit: 0, credit: 0, memo: "" }, { account_code: "", debit: 0, credit: 0, memo: "" }] });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Hapus jurnal manual ini?")) return;
    try { await api.delete(`/journal/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const accName = (c) => accounts.find((a) => a.code === c)?.name || c;

  return (
    <div data-testid="journal-page">
      <PageHeader
        title="Jurnal Umum"
        subtitle="Semua transaksi double-entry — otomatis dari sistem (penjualan, biaya, payment) dan manual."
        action={canCreate && <Button data-testid="journal-new-btn" onClick={() => setShowForm(!showForm)}><Plus size={14}/> Jurnal Manual</Button>}
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Periode</Label><MonthPicker value={period} onChange={setPeriod}/></div>
          <div><Label>Tipe Referensi</Label>
            <Select value={refType} onChange={(e) => setRefType(e.target.value)}>
              <option value="">Semua</option>
              <option value="awb_order">Penjualan AWB</option>
              <option value="payment">Pelunasan</option>
              <option value="cost">Biaya AWB</option>
              <option value="fixed_cost">Beban Tetap</option>
              <option value="invoice">Invoice</option>
              <option value="manual">Manual</option>
              <option value="opening_balance">Saldo Awal</option>
              <option value="payroll">Payroll</option>
              <option value="depreciation">Depresiasi</option>
            </Select>
          </div>
          <div><Label>Akun</Label>
            <Select value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
              <option value="">Semua</option>
              {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {showForm && canCreate && (
        <Card className="p-4 mb-4 border-blue-300">
          <h3 className="font-bold mb-3">Jurnal Manual Baru</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div><Label>Tanggal</Label><Input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}/></div>
            <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="cth: Penyesuaian akhir bulan"/></div>
          </div>
          <Table>
            <thead><tr><Th>Akun</Th><Th>Memo</Th><Th className="text-right">Debit</Th><Th className="text-right">Kredit</Th><Th></Th></tr></thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={i}>
                  <Td>
                    <Select value={l.account_code} onChange={(e) => updLine(i, "account_code", e.target.value)}>
                      <option value="">— Pilih akun —</option>
                      {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
                    </Select>
                  </Td>
                  <Td><Input value={l.memo || ""} onChange={(e) => updLine(i, "memo", e.target.value)}/></Td>
                  <Td><NumberInput className="text-right" value={l.debit} onChange={(e) => updLine(i, "debit", e.target.value)}/></Td>
                  <Td><NumberInput className="text-right" value={l.credit} onChange={(e) => updLine(i, "credit", e.target.value)}/></Td>
                  <Td><Button variant="ghost" onClick={() => removeLine(i)}><X size={14}/></Button></Td>
                </tr>
              ))}
              <tr className="font-bold">
                <Td colSpan={2}><Button variant="secondary" onClick={addLine}><Plus size={13}/> Baris</Button></Td>
                <Td className="text-right">{fmtIDR(totalDr)}</Td>
                <Td className="text-right">{fmtIDR(totalCr)}</Td>
                <Td></Td>
              </tr>
            </tbody>
          </Table>
          <div className="flex justify-between items-center mt-3">
            <div className={`text-sm font-bold ${balanced ? "text-emerald-700" : "text-rose-700"}`}>
              {balanced ? "✓ Seimbang" : "✗ Tidak seimbang (selisih " + fmtIDR(totalDr - totalCr) + ")"}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              <Button data-testid="journal-submit-btn" variant="success" onClick={submit} disabled={!balanced}><Save size={14}/> Posting</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <thead><tr><Th>No Jurnal</Th><Th>Tanggal</Th><Th>Deskripsi</Th><Th>Ref</Th><Th className="text-right">Total</Th><Th></Th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-6">Belum ada jurnal pada filter ini</Td></tr>}
            {entries.map((j) => {
              const tot = (j.lines || []).reduce((s, l) => s + (l.debit || 0), 0);
              const isOpen = !!expanded[j.id];
              return (
                <React.Fragment key={j.id}>
                  <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded({ ...expanded, [j.id]: !isOpen })}>
                    <Td className="font-mono text-xs font-bold">{j.entry_no}</Td>
                    <Td className="text-xs">{fmtDate(j.date)}</Td>
                    <Td>{j.description}</Td>
                    <Td><span className="text-[10px] uppercase tracking-wider bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">{j.reference_type}</span>{j.is_locked && <span className="ml-1 text-[10px] text-rose-700">🔒</span>}</Td>
                    <Td className="text-right font-mono">{fmtIDR(tot)}</Td>
                    <Td className="text-right">{isAdmin && j.reference_type === "manual" && !j.is_locked && <Button variant="ghost" onClick={(e) => { e.stopPropagation(); del(j.id); }}><Trash2 size={13}/></Button>}</Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <Td colSpan={6}>
                        <div className="pl-2">
                          <table className="w-full text-xs">
                            <thead><tr className="text-slate-500"><th className="text-left py-1">Akun</th><th className="text-left">Memo</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead>
                            <tbody>
                              {(j.lines || []).map((l, i) => (
                                <tr key={i}><td className="py-1 font-mono">{l.account_code} {accName(l.account_code)}</td><td className="text-slate-500">{l.memo || "-"}</td><td className="text-right font-mono">{l.debit ? fmtIDR(l.debit) : "-"}</td><td className="text-right font-mono">{l.credit ? fmtIDR(l.credit) : "-"}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
