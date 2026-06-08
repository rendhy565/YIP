import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Input, Label, Table, Th, Td } from "../components/ui";
import { errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Save } from "lucide-react";

export default function Settings() {
  const [rows, setRows] = useState([]);
  const [edited, setEdited] = useState({});

  const load = () => api.get("/settings").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const save = async (key_name) => {
    try {
      const val = edited[key_name] ?? rows.find((r) => r.key_name === key_name)?.key_value;
      await api.put(`/settings/${key_name}`, { key_name, key_value: String(val) });
      toast.success("Tersimpan");
      setEdited((e) => { const n = { ...e }; delete n[key_name]; return n; });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const tax = rows.filter((r) => r.key_name.startsWith("tax_ppn"));
  const company = rows.filter((r) => r.key_name.startsWith("company_"));

  const labelMap = {
    company_name: "Nama Perusahaan",
    company_npwp: "NPWP Perusahaan",
    company_address: "Alamat Perusahaan",
    tax_ppn_0: "PPN 0%",
    tax_ppn_11: "PPN 11%",
    tax_ppn_12: "PPN 12%",
  };

  const renderRow = (r) => (
    <tr key={r.key_name}>
      <Td className="font-mono text-xs">{r.key_name}</Td>
      <Td>{labelMap[r.key_name] || r.key_name}</Td>
      <Td>
        <Input
          data-testid={`setting-${r.key_name}`}
          value={edited[r.key_name] ?? r.key_value}
          onChange={(e) => setEdited({ ...edited, [r.key_name]: e.target.value })}
        />
      </Td>
      <Td className="text-right">
        <Button variant="secondary" onClick={() => save(r.key_name)} disabled={!(r.key_name in edited)}>
          <Save size={14}/> Simpan
        </Button>
      </Td>
    </tr>
  );

  return (
    <div data-testid="settings-page">
      <PageHeader title="Pengaturan" subtitle="Kelola tarif pajak dinamis dan profil perusahaan." />

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Pajak (PPN)</h3></div>
        <Table>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Nilai (%)</Th><Th></Th></tr></thead>
          <tbody>{tax.map(renderRow)}</tbody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200"><h3 className="font-bold">Profil Perusahaan</h3></div>
        <Table>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Nilai</Th><Th></Th></tr></thead>
          <tbody>{company.map(renderRow)}</tbody>
        </Table>
      </Card>
    </div>
  );
}
