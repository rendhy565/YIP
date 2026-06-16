import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg, currentMonth } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, X, FileMinus } from "lucide-react";

const PPH_TYPES = ["PPh21", "PPh23", "PPh25", "PPh4(2)", "PPh22"];

export default function TaxModule() {
  const [tab, setTab] = useState("ppn");
  const [period, setPeriod] = useState(currentMonth());
  const [ppn, setPpn] = useState(null);
  const [masukan, setMasukan] = useState([]);
  const [pph, setPph] = useState([]);
  const [form, setForm] = useState({ period_month: currentMonth(), pph_type: "PPh21", description: "", amount: 0 });

  // PPN Masukan manual input modal
  const [openMasukan, setOpenMasukan] = useState(false);
  const today = () => new Date().toISOString().slice(0, 10);
  const newMasukanForm = () => ({
    date: today(),
    supplier_name: "",
    no_faktur: "",
    dpp: "",
    ppn_pct: 11,
    expense_account_code: "6199",
    cash_account_code: "1101",
    description: "",
  });
  const [masukanForm, setMasukanForm] = useState(newMasukanForm());
  const [savingMasukan, setSavingMasukan] = useState(false);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [cashAccounts, setCashAccounts] = useState([]);

  const reload = () => {
    api.get("/tax/ppn-summary", { params: { period } }).then((r) => setPpn(r.data));
    api.get("/tax/ppn-masukan", { params: { period } }).then((r) => setMasukan(r.data)).catch(() => setMasukan([]));
    api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [period]);
  useEffect(() => {
    api.get("/accounts").then((r) => {
      const accs = r.data || [];
      setExpenseAccounts(accs.filter((a) => ["expense", "cogs"].includes(a.type)));
      setCashAccounts(accs.filter((a) => a.is_cash));
    });
  }, []);

  const submit = async () => {
    if (!form.amount) return toast.error("Jumlah wajib");
    try {
      await api.post("/tax/pph", { ...form, amount: Number(form.amount) });
      toast.success("Tersimpan");
      setForm({ ...form, amount: 0, description: "" });
      api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data));
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => {
    if (!window.confirm("Hapus catatan PPh?")) return;
    try { await api.delete(`/tax/pph/${id}`); toast.success("Dihapus"); api.get("/tax/pph", { params: { period } }).then((r) => setPph(r.data)); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const totalPph = pph.reduce((s, r) => s + (r.amount || 0), 0);

  const dppNum = parseFloat(masukanForm.dpp) || 0;
  const ppnNum = Math.round(dppNum * (parseFloat(masukanForm.ppn_pct) || 0) / 100 * 100) / 100;
  const totalNum = dppNum + ppnNum;

  const submitMasukan = async (e) => {
    e.preventDefault();
    if (dppNum <= 0) return toast.error("DPP harus > 0");
    if (!masukanForm.supplier_name.trim()) return toast.error("Nama supplier wajib");
    setSavingMasukan(true);
    try {
      await api.post("/tax/ppn-masukan", { ...masukanForm, dpp: dppNum, ppn_pct: parseFloat(masukanForm.ppn_pct) });
      toast.success(`PPN Masukan ${fmtIDR(ppnNum)} dicatat & dijurnal`);
      setOpenMasukan(false);
      setMasukanForm(newMasukanForm());
      reload();
    } catch (e2) { toast.error(errMsg(e2)); }
    finally { setSavingMasukan(false); }
  };

  const delMasukan = async (id) => {
    if (!window.confirm("Hapus entry PPN Masukan ini? Jurnal terkait juga akan dihapus.")) return;
    try { await api.delete(`/tax/ppn-masukan/${id}`); toast.success("Dihapus"); reload(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="tax-page">
      <PageHeader title="Perpajakan" subtitle="PPN Keluaran otomatis dari penjualan AWB, PPN Masukan dari input pembelian manual, PPh otomatis dari payment vendor." />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Periode</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}/></div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button data-testid="tax-tab-ppn" onClick={() => setTab("ppn")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "ppn" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>PPN</button>
        <button data-testid="tax-tab-pph" onClick={() => setTab("pph")} className={`px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === "pph" ? "border-b-2 border-blue-700 text-blue-700" : "text-slate-500"}`}>PPh</button>
      </div>

      {tab === "ppn" && ppn && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Card className="p-3 bg-emerald-50 border-emerald-200" data-testid="card-ppn-keluaran"><div className="text-[10px] uppercase text-emerald-700 font-bold">PPN Keluaran</div><div className="font-mono font-bold text-xl text-emerald-800">{fmtIDR(ppn.ppn_keluaran)}</div></Card>
            <Card className="p-3 bg-blue-50 border-blue-200" data-testid="card-ppn-masukan"><div className="text-[10px] uppercase text-blue-700 font-bold">PPN Masukan</div><div className="font-mono font-bold text-xl text-blue-800">{fmtIDR(ppn.ppn_masukan)}</div></Card>
            <Card className={`p-3 ${ppn.ppn_kurang_bayar > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50"}`} data-testid="card-ppn-selisih">
              <div className="text-[10px] uppercase text-slate-600 font-bold">{ppn.ppn_kurang_bayar >= 0 ? "Kurang Bayar" : "Lebih Bayar (Kompensasi)"}</div>
              <div className="font-mono font-bold text-xl">{fmtIDR(Math.abs(ppn.ppn_kurang_bayar))}</div>
            </Card>
          </div>

          {/* PPN MASUKAN — manual input section */}
          <Card className="mb-4">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold inline-flex items-center gap-2"><FileMinus size={16} className="text-blue-700"/> PPN Masukan — Input Manual</h3>
              <Button data-testid="add-ppn-masukan-btn" onClick={() => { setMasukanForm(newMasukanForm()); setOpenMasukan(true); }}>
                <Plus size={14}/> Input PPN Masukan
              </Button>
            </div>
            <Table>
              <thead><tr><Th>Tanggal</Th><Th>Supplier</Th><Th>No Faktur</Th><Th className="text-right">DPP</Th><Th className="text-right">PPN%</Th><Th className="text-right">PPN</Th><Th>Jurnal</Th><Th className="text-right"></Th></tr></thead>
              <tbody>
                {masukan.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-400 py-6">Belum ada PPN Masukan untuk periode ini.</Td></tr>}
                {masukan.map((m) => (
                  <tr key={m.id} data-testid={`ppn-masukan-row-${m.id}`}>
                    <Td className="text-xs">{fmtDate(m.date)}</Td>
                    <Td className="font-semibold">{m.supplier_name}</Td>
                    <Td className="font-mono text-xs">{m.no_faktur || "-"}</Td>
                    <Td className="text-right font-mono">{fmtIDR(m.dpp)}</Td>
                    <Td className="text-right text-xs">{m.ppn_pct}%</Td>
                    <Td className="text-right font-mono font-semibold text-blue-700">{fmtIDR(m.ppn_amount)}</Td>
                    <Td className="font-mono text-[11px] text-slate-500">{m.journal_entry_no || "-"}</Td>
                    <Td className="text-right">
                      <button data-testid={`del-ppn-masukan-${m.id}`} onClick={() => delMasukan(m.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={13}/></button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* PPN KELUARAN — read-only detail */}
          <Card className="mb-4">
            <div className="px-4 py-2 bg-emerald-100 text-emerald-900 font-bold">Detail PPN Keluaran (dari Invoice Penjualan)</div>
            <Table>
              <thead><tr><Th>Tanggal</Th><Th>No Jurnal</Th><Th>Deskripsi</Th><Th className="text-right">Jumlah</Th></tr></thead>
              <tbody>
                {ppn.detail_keluaran.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-4">Tidak ada</Td></tr>}
                {ppn.detail_keluaran.map((d, i) => <tr key={i}><Td className="text-xs">{fmtDate(d.date)}</Td><Td className="font-mono text-xs">{d.entry_no}</Td><Td>{d.description}</Td><Td className="text-right font-mono">{fmtIDR(d.amount)}</Td></tr>)}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "pph" && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-bold">Catatan PPh ({period})</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">PPh 23 dari payment vendor di-otomatisasi (badge <span className="font-bold text-emerald-700">AUTO</span>); selain itu input manual.</p>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div><Label>Tipe</Label><Select value={form.pph_type} onChange={(e) => setForm({...form, pph_type: e.target.value})} className="w-32">{PPH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
              <div><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} className="w-48"/></div>
              <div><Label>Jumlah</Label><Input type="number" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-32"/></div>
              <Button variant="success" onClick={submit}><Plus size={13}/> Tambah</Button>
            </div>
          </div>
          <Table>
            <thead><tr><Th>Tanggal</Th><Th>Tipe</Th><Th>Deskripsi</Th><Th>Vendor/AWB</Th><Th className="text-right">Jumlah</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {pph.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-6">Belum ada</Td></tr>}
              {pph.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">{fmtDate(r.created_at)}</Td>
                  <Td>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] uppercase font-bold">{r.pph_type}</span>
                    {r.auto_generated && <span className="ml-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] uppercase font-bold">Auto</span>}
                  </Td>
                  <Td className="text-xs">{r.description || "-"}</Td>
                  <Td className="text-xs">{r.vendor_name ? `${r.vendor_name}${r.awb_number ? ` · ${r.awb_number}` : ""}` : "-"}</Td>
                  <Td className="text-right font-mono">{fmtIDR(r.amount)}</Td>
                  <Td className="text-right">{!r.auto_generated && <Button variant="ghost" onClick={() => del(r.id)}><Trash2 size={13}/></Button>}</Td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50"><Td colSpan={4}>TOTAL</Td><Td className="text-right font-mono">{fmtIDR(totalPph)}</Td><Td></Td></tr>
            </tbody>
          </Table>
        </Card>
      )}

      {/* PPN Masukan input modal */}
      {openMasukan && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Card className="w-full max-w-xl my-8 p-6" data-testid="ppn-masukan-modal">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl">Input PPN Masukan</h3>
                <p className="text-xs text-slate-500">Otomatis post jurnal: DR Beban + DR PPN Masukan / CR Kas/Bank</p>
              </div>
              <button onClick={() => setOpenMasukan(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>
            <form onSubmit={submitMasukan} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Tanggal *</Label><Input type="date" value={masukanForm.date} onChange={(e) => setMasukanForm({...masukanForm, date: e.target.value})} required/></div>
                <div><Label>No Faktur Pajak</Label><Input data-testid="masukan-no-faktur" placeholder="010.xxx-xx.xxxxxxxx" value={masukanForm.no_faktur} onChange={(e) => setMasukanForm({...masukanForm, no_faktur: e.target.value})}/></div>
              </div>
              <div><Label>Nama Supplier *</Label><Input data-testid="masukan-supplier" value={masukanForm.supplier_name} onChange={(e) => setMasukanForm({...masukanForm, supplier_name: e.target.value})} required/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>DPP (Dasar Pengenaan Pajak) *</Label><Input data-testid="masukan-dpp" type="number" step="0.01" value={masukanForm.dpp} onChange={(e) => setMasukanForm({...masukanForm, dpp: e.target.value})} required/></div>
                <div>
                  <Label>PPN %</Label>
                  <Select data-testid="masukan-ppn-pct" value={masukanForm.ppn_pct} onChange={(e) => setMasukanForm({...masukanForm, ppn_pct: e.target.value})}>
                    <option value="0">0%</option>
                    <option value="1">1%</option>
                    <option value="11">11%</option>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Akun Beban / Persediaan</Label>
                  <Select data-testid="masukan-expense-acc" value={masukanForm.expense_account_code} onChange={(e) => setMasukanForm({...masukanForm, expense_account_code: e.target.value})}>
                    {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Akun Bayar (Kas/Bank)</Label>
                  <Select data-testid="masukan-cash-acc" value={masukanForm.cash_account_code} onChange={(e) => setMasukanForm({...masukanForm, cash_account_code: e.target.value})}>
                    {cashAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </Select>
                </div>
              </div>
              <div><Label>Deskripsi (opsional)</Label><Input value={masukanForm.description} onChange={(e) => setMasukanForm({...masukanForm, description: e.target.value})}/></div>

              <div className="bg-slate-50 border border-slate-200 rounded p-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-[10px] uppercase text-slate-500 font-bold">DPP</div><div className="font-mono font-semibold">{fmtIDR(dppNum)}</div></div>
                <div><div className="text-[10px] uppercase text-slate-500 font-bold">PPN</div><div className="font-mono font-semibold text-blue-700" data-testid="preview-ppn">{fmtIDR(ppnNum)}</div></div>
                <div><div className="text-[10px] uppercase text-slate-500 font-bold">Total</div><div className="font-mono font-bold" data-testid="preview-total">{fmtIDR(totalNum)}</div></div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <Button variant="secondary" type="button" onClick={() => setOpenMasukan(false)}>Batal</Button>
                <Button data-testid="save-ppn-masukan-btn" type="submit" disabled={savingMasukan}>{savingMasukan ? "Menyimpan..." : "Simpan & Post Jurnal"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
