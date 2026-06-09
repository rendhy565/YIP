import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Lock, Unlock, Plus, X, Save, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function SaldoAwal() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [accounts, setAccounts] = useState([]);
  const [closings, setClosings] = useState([]);
  const [period, setPeriod] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), lines: [{ account_code: "", debit: 0, credit: 0, memo: "" }] });

  const load = async () => {
    const c = await api.get("/period-closing"); setClosings(c.data);
    const a = await api.get("/accounts"); setAccounts(a.data);
  };
  useEffect(() => { load(); }, []);

  const addLine = () => setForm({ ...form, lines: [...form.lines, { account_code: "", debit: 0, credit: 0, memo: "" }] });
  const updLine = (i, k, v) => { const ls = [...form.lines]; ls[i] = { ...ls[i], [k]: v }; setForm({ ...form, lines: ls }); };
  const removeLine = (i) => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) });
  const totDr = form.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totCr = form.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totDr - totCr) < 0.01 && totDr > 0;

  const postOpening = async () => {
    if (!balanced) return toast.error("Debit harus = Kredit");
    try {
      await api.post("/opening-balance", { date: new Date(form.date).toISOString(), lines: form.lines.map((l) => ({ ...l, debit: Number(l.debit||0), credit: Number(l.credit||0) })) });
      toast.success("Saldo awal terposting");
      setOpenForm(false); setForm({ date: new Date().toISOString().slice(0, 10), lines: [{ account_code: "", debit: 0, credit: 0, memo: "" }] });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const closeP = async () => {
    if (!period) return toast.error("Pilih periode (YYYY-MM)");
    if (!window.confirm(`Tutup buku periode ${period}? Semua jurnal di periode tersebut akan terkunci.`)) return;
    try { await api.post("/period-closing", { period }); toast.success("Periode ditutup"); setPeriod(""); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const reopen = async (p) => {
    if (!window.confirm(`Buka kembali periode ${p}?`)) return;
    try { await api.delete(`/period-closing/${p}`); toast.success("Periode dibuka"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="opening-closing-page">
      <PageHeader title="Saldo Awal & Tutup Buku" subtitle="Setup saldo awal akun, dan tutup periode untuk mengunci jurnal." />

      {!isAdmin && (
        <Card className="p-3 mb-4 bg-amber-50 border-amber-200 text-amber-900 text-sm flex items-center gap-2">
          <ShieldAlert size={16}/> Halaman ini hanya tersedia untuk Administrator. Anda bisa melihat namun tidak bisa mengubah.
        </Card>
      )}

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-bold">Saldo Awal (Opening Balance)</h3>
          {isAdmin && <Button onClick={() => setOpenForm(!openForm)}><Plus size={14}/> Posting Saldo Awal</Button>}
        </div>
        {openForm && isAdmin && (
          <div className="p-4">
            <div className="mb-3"><Label>Tanggal</Label><Input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}/></div>
            <Table>
              <thead><tr><Th>Akun</Th><Th className="text-right">Debit</Th><Th className="text-right">Kredit</Th><Th>Memo</Th><Th></Th></tr></thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i}>
                    <Td><Select value={l.account_code} onChange={(e) => updLine(i, "account_code", e.target.value)}><option value="">— pilih —</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}</Select></Td>
                    <Td><Input type="number" className="text-right" value={l.debit} onChange={(e) => updLine(i, "debit", e.target.value)}/></Td>
                    <Td><Input type="number" className="text-right" value={l.credit} onChange={(e) => updLine(i, "credit", e.target.value)}/></Td>
                    <Td><Input value={l.memo || ""} onChange={(e) => updLine(i, "memo", e.target.value)}/></Td>
                    <Td><Button variant="ghost" onClick={() => removeLine(i)}><X size={13}/></Button></Td>
                  </tr>
                ))}
                <tr className="font-bold"><Td><Button variant="secondary" onClick={addLine}><Plus size={13}/> Baris</Button></Td><Td className="text-right">{fmtIDR(totDr)}</Td><Td className="text-right">{fmtIDR(totCr)}</Td><Td colSpan={2}></Td></tr>
              </tbody>
            </Table>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={() => setOpenForm(false)}>Batal</Button>
              <Button variant="success" onClick={postOpening} disabled={!balanced}><Save size={14}/> Posting</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-bold">Tutup Buku Periodik</h3>
          {isAdmin && (
            <div className="flex items-end gap-2">
              <div><Label>Periode</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40"/></div>
              <Button variant="danger" onClick={closeP}><Lock size={14}/> Tutup Buku</Button>
            </div>
          )}
        </div>
        <Table>
          <thead><tr><Th>Periode</Th><Th>Ditutup pada</Th><Th className="text-right">Total Aset</Th><Th className="text-right">Laba Bersih</Th><Th className="text-right">Aksi</Th></tr></thead>
          <tbody>
            {closings.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-6">Belum ada periode tertutup</Td></tr>}
            {closings.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono font-bold">{c.period}</Td>
                <Td className="text-xs">{fmtDate(c.closed_at)}</Td>
                <Td className="text-right font-mono">{fmtIDR(c.summary?.balance_sheet_totals?.assets || 0)}</Td>
                <Td className="text-right font-mono">{fmtIDR(c.summary?.income_statement?.net_income || 0)}</Td>
                <Td className="text-right">{isAdmin && <Button variant="secondary" onClick={() => reopen(c.period)}><Unlock size={13}/> Buka</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
