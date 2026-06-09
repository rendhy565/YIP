import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, currentMonth } from "../lib/utils";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default function NeracaSaldo() {
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/reports/trial-balance", { params: period ? { period } : {} }).then((r) => setData(r.data));
  }, [period]);

  return (
    <div data-testid="trial-balance-page">
      <PageHeader title="Neraca Saldo (Trial Balance)" subtitle="Daftar saldo seluruh akun pada akhir periode — wajib seimbang." />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Sampai dengan periode</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}/></div>
        </div>
      </Card>
      {data && (
        <>
          <Card className={`p-4 mb-3 flex items-center gap-3 ${data.balanced ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
            {data.balanced ? <CheckCircle2 className="text-emerald-700"/> : <AlertTriangle className="text-rose-700"/>}
            <div className={`font-bold ${data.balanced ? "text-emerald-800" : "text-rose-800"}`}>
              {data.balanced ? "Neraca seimbang ✓" : "Neraca TIDAK seimbang — selisih " + fmtIDR(data.total_debit - data.total_credit)}
            </div>
          </Card>
          <Card>
            <Table>
              <thead><tr><Th>Kode</Th><Th>Nama Akun</Th><Th>Tipe</Th><Th className="text-right">Debit</Th><Th className="text-right">Kredit</Th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-6">Belum ada mutasi</Td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.code}>
                    <Td className="font-mono font-bold">{r.code}</Td>
                    <Td>{r.name}</Td>
                    <Td className="text-xs text-slate-500 uppercase">{r.type}</Td>
                    <Td className="text-right font-mono">{r.debit ? fmtIDR(r.debit) : "-"}</Td>
                    <Td className="text-right font-mono">{r.credit ? fmtIDR(r.credit) : "-"}</Td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-bold">
                  <Td colSpan={3}>TOTAL</Td>
                  <Td className="text-right font-mono">{fmtIDR(data.total_debit)}</Td>
                  <Td className="text-right font-mono">{fmtIDR(data.total_credit)}</Td>
                </tr>
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
