import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, X, Save, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import Pagination, { usePagination } from "../components/Pagination";

const TYPE_OPTIONS = [
  { v: "asset", l: "Aset" },
  { v: "liability", l: "Liabilitas" },
  { v: "equity", l: "Ekuitas" },
  { v: "revenue", l: "Pendapatan" },
  { v: "cogs", l: "HPP (COGS)" },
  { v: "expense", l: "Beban" },
];
const TYPE_COLORS = {
  asset: "bg-blue-50 text-blue-800 border-blue-200",
  liability: "bg-amber-50 text-amber-800 border-amber-200",
  equity: "bg-purple-50 text-purple-800 border-purple-200",
  revenue: "bg-emerald-50 text-emerald-800 border-emerald-200",
  cogs: "bg-rose-50 text-rose-800 border-rose-200",
  expense: "bg-orange-50 text-orange-800 border-orange-200",
};

export default function ChartOfAccounts() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ code: "", name: "", type: "asset", subtype: "", normal: "debit", is_cash: false });

  const load = () => api.get("/accounts").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing("new"); setForm({ code: "", name: "", type: "asset", subtype: "", normal: "debit", is_cash: false }); };
  const openEdit = (a) => { setEditing(a.code); setForm({ code: a.code, name: a.name, type: a.type, subtype: a.subtype || "", normal: a.normal, is_cash: !!a.is_cash }); };
  const cancel = () => { setEditing(null); };

  const save = async () => {
    try {
      if (!form.code || !form.name) return toast.error("Kode & nama wajib");
      if (editing === "new") await api.post("/accounts", form);
      else await api.put(`/accounts/${editing}`, form);
      toast.success("Tersimpan"); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const del = async (code) => {
    if (!window.confirm(`Hapus akun ${code}?`)) return;
    try { await api.delete(`/accounts/${code}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const list = rows.filter((r) =>
    !filter || r.code.includes(filter) || r.name.toLowerCase().includes(filter.toLowerCase()) || r.type.includes(filter)
  );
  const pag = usePagination(list, { resetKey: filter, defaultSize: 50 });

  return (
    <div data-testid="coa-page">
      <PageHeader
        title="Bagan Akun (Chart of Accounts)"
        subtitle="Master akun PSAK 1xxx Aset · 2xxx Liabilitas · 3xxx Ekuitas · 4xxx Pendapatan · 5xxx HPP · 6xxx Beban"
        action={isAdmin && <Button data-testid="coa-add-btn" onClick={openNew}><Plus size={14}/> Tambah Akun</Button>}
      />
      <Card className="p-4 mb-4">
        <Input data-testid="coa-filter" placeholder="Cari kode/nama/tipe..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </Card>
      {!isAdmin && (
        <Card className="p-3 mb-4 bg-amber-50 border-amber-200 text-amber-900 text-sm flex items-center gap-2">
          <ShieldAlert size={16}/> Tambah/edit/hapus akun hanya bisa dilakukan oleh Administrator.
        </Card>
      )}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Kode</Th><Th>Nama Akun</Th><Th>Tipe</Th><Th>Subtipe</Th><Th>Normal</Th><Th>Cash?</Th><Th>Sistem?</Th><Th className="text-right">Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {editing === "new" && (
              <tr className="bg-blue-50/50">
                <Td><Input data-testid="coa-form-code" placeholder="9999" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})}/></Td>
                <Td><Input placeholder="Nama akun" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}/></Td>
                <Td><Select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>{TYPE_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select></Td>
                <Td><Input value={form.subtype} onChange={(e) => setForm({...form, subtype: e.target.value})}/></Td>
                <Td><Select value={form.normal} onChange={(e) => setForm({...form, normal: e.target.value})}><option value="debit">Debit</option><option value="credit">Credit</option></Select></Td>
                <Td><input type="checkbox" checked={form.is_cash} onChange={(e) => setForm({...form, is_cash: e.target.checked})}/></Td>
                <Td>-</Td>
                <Td className="text-right">
                  <div className="flex gap-1.5 justify-end">
                    <Button data-testid="coa-save-btn" onClick={save} variant="success"><Save size={14}/></Button>
                    <Button onClick={cancel} variant="ghost"><X size={14}/></Button>
                  </div>
                </Td>
              </tr>
            )}
            {pag.paged.map((a) => editing === a.code ? (
              <tr key={a.code} className="bg-blue-50/50">
                <Td><Input value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} disabled={a.is_system}/></Td>
                <Td><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}/></Td>
                <Td><Select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>{TYPE_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select></Td>
                <Td><Input value={form.subtype} onChange={(e) => setForm({...form, subtype: e.target.value})}/></Td>
                <Td><Select value={form.normal} onChange={(e) => setForm({...form, normal: e.target.value})}><option value="debit">Debit</option><option value="credit">Credit</option></Select></Td>
                <Td><input type="checkbox" checked={form.is_cash} onChange={(e) => setForm({...form, is_cash: e.target.checked})}/></Td>
                <Td>{a.is_system ? "Ya" : "-"}</Td>
                <Td className="text-right">
                  <div className="flex gap-1.5 justify-end">
                    <Button onClick={save} variant="success"><Save size={14}/></Button>
                    <Button onClick={cancel} variant="ghost"><X size={14}/></Button>
                  </div>
                </Td>
              </tr>
            ) : (
              <tr key={a.code}>
                <Td className="font-mono font-bold">{a.code}</Td>
                <Td>{a.name}</Td>
                <Td><span className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${TYPE_COLORS[a.type] || "bg-slate-100 border-slate-200"}`}>{a.type}</span></Td>
                <Td className="text-xs text-slate-600">{a.subtype || "-"}</Td>
                <Td className="text-xs uppercase">{a.normal}</Td>
                <Td>{a.is_cash ? "✓" : "-"}</Td>
                <Td>{a.is_system ? <span className="text-xs text-slate-500">Sistem</span> : <span className="text-xs text-emerald-700">Custom</span>}</Td>
                <Td className="text-right">
                  {isAdmin && (
                    <div className="flex gap-1.5 justify-end">
                      <Button onClick={() => openEdit(a)} variant="secondary"><Edit2 size={13}/></Button>
                      {!a.is_system && <Button onClick={() => del(a.code)} variant="danger"><Trash2 size={13}/></Button>}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination {...pag} testid="pagination-coa"/>
      </Card>
    </div>
  );
}
