import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Link2, Unlink, CheckCircle2, X } from "lucide-react";
import Pagination, { usePagination } from "../components/Pagination";

export default function BankReconciliation() {
  const [cashAccounts, setCashAccounts] = useState([]);
  const [bankCode, setBankCode] = useState("1102");
  const [period, setPeriod] = useState(currentMonth());
  const [matchedFilter, setMatchedFilter] = useState("");
  const [lines, setLines] = useState([]);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), description: "", amount: 0 });
  const [candidates, setCandidates] = useState({});

  const load = () => {
    const p = { bank_account_code: bankCode };
    if (period) p.period = period;
    if (matchedFilter !== "") p.matched = matchedFilter === "1";
    api.get("/bank-recon", { params: p }).then((r) => setLines(r.data));
  };
  useEffect(() => { api.get("/accounts", { params: { is_cash: true } }).then((r) => { setCashAccounts(r.data); if (r.data.length && !r.data.find((x) => x.code === bankCode)) setBankCode(r.data[0].code); }); }, []);
  useEffect(() => { load(); }, [bankCode, period, matchedFilter]);

  const pag = usePagination(lines, { resetKey: `${bankCode}|${period}|${matchedFilter}` });

  const submit = async () => {
    if (!form.description || !form.amount) return toast.error("Isi semua field");
    try { await api.post("/bank-recon", { ...form, amount: Number(form.amount), bank_account_code: bankCode }); toast.success("Tersimpan"); setOpenForm(false); setForm({ date: new Date().toISOString().slice(0, 10), description: "", amount: 0 }); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    if (!window.confirm("Hapus mutasi bank?")) return;
    try { await api.delete(`/bank-recon/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const loadCandidates = async (id) => {
    try { const r = await api.get(`/bank-recon/candidates/${id}`); setCandidates({ ...candidates, [id]: r.data.candidates }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const match = async (id, journalId) => {
    try { await api.post(`/bank-recon/${id}/match`, { journal_id: journalId }); toast.success("Match!"); load(); setCandidates({ ...candidates, [id]: undefined }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const unmatch = async (id) => {
    try { await api.post(`/bank-recon/${id}/unmatch`); toast.success("Unmatched"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="bank-recon-page">
      <PageHeader title="Rekonsiliasi Bank" subtitle="Cocokkan mutasi bank (rekening koran) dengan jurnal yang sudah diposting." />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Bank/Akun</Label>
            <Select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>{cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}</Select>
          </div>
          <div><Label>Periode</Label><MonthPicker value={period} onChange={setPeriod}/></div>
          <div><Label>Status</Label>
            <Select value={matchedFilter} onChange={(e) => setMatchedFilter(e.target.value)}>
              <option value="">Semua</option><option value="0">Belum match</option><option value="1">Sudah match</option>
            </Select>
          </div>
          <div className="flex items-end"><Button onClick={() => setOpenForm(!openForm)}><Plus size={14}/> Tambah Mutasi</Button></div>
        </div>
      </Card>

      {openForm && (
        <Card className="p-4 mb-4 border-blue-300">
          <h3 className="font-bold mb-3">Mutasi Bank Manual ({bankCode})</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Tanggal</Label><Input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}/></div>
            <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="cth: Transfer dari PT XYZ"/></div>
            <div><Label>Jumlah (+ inflow, − outflow)</Label><Input type="number" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})}/></div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" onClick={() => setOpenForm(false)}>Batal</Button>
            <Button variant="success" onClick={submit}>Simpan</Button>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <thead><tr><Th>Tanggal</Th><Th>Deskripsi</Th><Th className="text-right">Jumlah</Th><Th>Status</Th><Th>Aksi</Th></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-6">Belum ada mutasi</Td></tr>}
            {pag.paged.map((l) => (
              <React.Fragment key={l.id}>
                <tr>
                  <Td className="text-xs">{fmtDate(l.date)}</Td>
                  <Td>{l.description}</Td>
                  <Td className={`text-right font-mono font-bold ${l.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtIDR(l.amount)}</Td>
                  <Td>{l.matched ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] uppercase font-bold"><CheckCircle2 size={11}/> Match</span> : <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] uppercase font-bold">Pending</span>}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {!l.matched && <Button variant="secondary" onClick={() => loadCandidates(l.id)}><Link2 size={13}/> Match</Button>}
                      {l.matched && <Button variant="secondary" onClick={() => unmatch(l.id)}><Unlink size={13}/> Unmatch</Button>}
                      <Button variant="ghost" onClick={() => del(l.id)}><Trash2 size={13}/></Button>
                    </div>
                  </Td>
                </tr>
                {candidates[l.id] && (
                  <tr><Td colSpan={5} className="bg-blue-50 p-3">
                    <div className="font-bold mb-2 text-sm">Kandidat Jurnal:</div>
                    {candidates[l.id].length === 0 && <div className="text-xs text-slate-500">Tidak ada kandidat (±Rp1 dalam 7 hari)</div>}
                    {candidates[l.id].map((c) => (
                      <div key={c.id} className="flex justify-between items-center py-1 border-b border-slate-200 last:border-0">
                        <div className="text-sm"><span className="font-mono text-xs text-slate-500 mr-2">{c.entry_no}</span>{c.description} · <span className="font-mono">{fmtIDR(c.amount)}</span></div>
                        <Button variant="success" onClick={() => match(l.id, c.id)}><CheckCircle2 size={13}/></Button>
                      </div>
                    ))}
                    <div className="text-right mt-2"><Button variant="ghost" onClick={() => setCandidates({ ...candidates, [l.id]: undefined })}><X size={13}/></Button></div>
                  </Td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-bank-recon"/>
      </Card>
    </div>
  );
}
