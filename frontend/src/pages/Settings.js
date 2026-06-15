import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Save, ShieldAlert, ToggleLeft, ToggleRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useFeatureFlags } from "../lib/featureFlags";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const { refresh: refreshFlags } = useFeatureFlags();
  const [rows, setRows] = useState([]);
  const [edited, setEdited] = useState({});
  const [flags, setFlags] = useState([]);

  const load = () => api.get("/settings").then((r) => setRows(r.data));
  const loadFlags = () => api.get("/feature-flags").then((r) => setFlags(r.data));
  useEffect(() => { load(); loadFlags(); }, []);

  const save = async (key_name) => {
    try {
      const val = edited[key_name] ?? rows.find((r) => r.key_name === key_name)?.key_value;
      await api.put(`/settings/${key_name}`, { key_name, key_value: String(val) });
      toast.success("Tersimpan");
      setEdited((e) => { const n = { ...e }; delete n[key_name]; return n; });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const toggleFlag = async (key, enabled) => {
    try {
      await api.put(`/feature-flags/${key}`, { enabled });
      toast.success(`Modul ${key} ${enabled ? "diaktifkan" : "dinonaktifkan"}`);
      loadFlags();
      refreshFlags();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const tax = rows.filter((r) => r.key_name.startsWith("tax_ppn"));
  const company = rows.filter((r) => r.key_name.startsWith("company_"));
  const issuerKeys = rows.filter((r) => r.key_name.startsWith("signer_") || r.key_name.startsWith("address_") || r.key_name.startsWith("npwp_"));

  const labelMap = {
    company_name: "Nama Perusahaan (Default)", company_npwp: "NPWP Perusahaan (Default)", company_address: "Alamat Perusahaan (Default)",
    tax_ppn_0: "PPN 0%", tax_ppn_1: "PPN 1%", tax_ppn_11: "PPN 11%", tax_ppn_12: "PPN 12%",
  };
  const issuerLabel = (key) => {
    if (key.startsWith("signer_")) return `Penandatangan — ${key.slice(7)}`;
    if (key.startsWith("address_")) return `Alamat — ${key.slice(8)}`;
    if (key.startsWith("npwp_")) return `NPWP — ${key.slice(5)}`;
    return key;
  };

  const renderRow = (r) => (
    <tr key={r.key_name}>
      <Td className="font-mono text-xs">{r.key_name}</Td>
      <Td>{labelMap[r.key_name] || r.key_name}</Td>
      <Td>
        <Input data-testid={`setting-${r.key_name}`} value={edited[r.key_name] ?? r.key_value} onChange={(e) => setEdited({ ...edited, [r.key_name]: e.target.value })}/>
      </Td>
      <Td className="text-right">
        <Button variant="secondary" onClick={() => save(r.key_name)} disabled={!(r.key_name in edited)}><Save size={14}/> Simpan</Button>
      </Td>
    </tr>
  );

  return (
    <div data-testid="settings-page">
      <PageHeader title="Pengaturan" subtitle="Kelola tarif pajak, profil perusahaan, dan modul aktif." />

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <h3 className="font-bold">Aktivasi Modul</h3>
          {!isAdmin && <span className="text-xs text-amber-700 flex items-center gap-1"><ShieldAlert size={12}/> hanya admin</span>}
        </div>
        <div className="divide-y divide-slate-200">
          {flags.map((f) => (
            <div key={f.key} data-testid={`feature-flag-${f.key}`} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 mr-4">
                <div className="font-bold text-sm">{f.label}</div>
                <div className="text-xs text-slate-500">{f.description}</div>
                <div className="text-[10px] uppercase tracking-wider font-mono text-slate-400 mt-0.5">{f.key}</div>
              </div>
              <button
                data-testid={`feature-toggle-${f.key}`}
                disabled={!isAdmin}
                onClick={() => toggleFlag(f.key, !f.enabled)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${f.enabled ? "bg-emerald-600" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${f.enabled ? "translate-x-6" : "translate-x-1"}`}/>
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Pajak (PPN)</h3></div>
        <Table>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Nilai (%)</Th><Th></Th></tr></thead>
          <tbody>{tax.map(renderRow)}</tbody>
        </Table>
      </Card>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Profil Perusahaan (Default)</h3></div>
        <Table>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Nilai</Th><Th></Th></tr></thead>
          <tbody>{company.map(renderRow)}</tbody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="font-bold">Per Issuer — Signer / Alamat / NPWP</h3>
          <p className="text-xs text-slate-500 mt-1">Setting per Perusahaan Issuer (PT. Abirama Mitra Pradana / Pratama) untuk dipakai di Invoice Excel.</p>
        </div>
        <Table>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Nilai</Th><Th></Th></tr></thead>
          <tbody>
            {issuerKeys.map((r) => (
              <tr key={r.key_name}>
                <Td className="font-mono text-[10px]">{r.key_name}</Td>
                <Td>{issuerLabel(r.key_name)}</Td>
                <Td>
                  <Input data-testid={`setting-${r.key_name}`} value={edited[r.key_name] ?? r.key_value} onChange={(e) => setEdited({ ...edited, [r.key_name]: e.target.value })}/>
                </Td>
                <Td className="text-right">
                  <Button variant="secondary" onClick={() => save(r.key_name)} disabled={!(r.key_name in edited)}><Save size={14}/> Simpan</Button>
                </Td>
              </tr>
            ))}
            {issuerKeys.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-500 py-6">Belum ada setting per issuer.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
