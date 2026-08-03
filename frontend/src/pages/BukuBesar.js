import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Select, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth } from "../lib/utils";

export default function BukuBesar() {
  const [accounts, setAccounts] = useState([]);
  const [code, setCode] = useState("");
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/accounts").then((r) => {
      setAccounts(r.data);
      if (r.data.length && !code) setCode(r.data[0].code);
    });
  }, []);

  useEffect(() => {
    if (!code) return;
    const p = { account_code: code };
    if (period) p.period = period;
    api.get("/ledger", { params: p }).then((r) => setData(r.data));
  }, [code, period]);

  return (
    <div data-testid="ledger-page">
      <PageHeader title="Buku Besar (General Ledger)" subtitle="Mutasi tiap akun secara kronologis dengan saldo berjalan." />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Akun</Label>
            <Select data-testid="ledger-account-select" value={code} onChange={(e) => setCode(e.target.value)}>
              {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
            </Select>
          </div>
          <div><Label>Periode (opsional, kosong = semua)</Label><MonthPicker allowEmpty value={period} onChange={setPeriod}/></div>
        </div>
      </Card>

      {data && (
        <>
          <Card className="p-4 mb-3 bg-slate-50">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Akun</div>
                <div className="font-bold text-lg">{data.account.code} — {data.account.name}</div>
                <div className="text-xs text-slate-500">Normal: {data.account.normal} · Tipe: {data.account.type}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Saldo Awal</div>
                <div className="font-mono text-lg">{fmtIDR(data.beginning_balance)}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Saldo Akhir</div>
                <div className="font-mono text-lg font-bold text-blue-700">{fmtIDR(data.ending_balance)}</div>
              </div>
            </div>
          </Card>

          <Card>
            <Table>
              <thead><tr><Th>Tanggal</Th><Th>No Jurnal</Th><Th>Deskripsi / Memo</Th><Th className="text-right">Debit</Th><Th className="text-right">Kredit</Th><Th className="text-right">Saldo</Th></tr></thead>
              <tbody>
                <tr className="bg-slate-50"><Td colSpan={5} className="font-bold">Saldo Awal</Td><Td className="text-right font-mono font-bold">{fmtIDR(data.beginning_balance)}</Td></tr>
                {data.rows.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-6">Tidak ada mutasi</Td></tr>}
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <Td className="text-xs">{fmtDate(r.date)}</Td>
                    <Td className="font-mono text-xs">{r.entry_no}</Td>
                    <Td><div>{r.description}</div>{r.memo && <div className="text-xs text-slate-500">{r.memo}</div>}</Td>
                    <Td className="text-right font-mono">{r.debit ? fmtIDR(r.debit) : "-"}</Td>
                    <Td className="text-right font-mono">{r.credit ? fmtIDR(r.credit) : "-"}</Td>
                    <Td className="text-right font-mono font-bold">{fmtIDR(r.balance)}</Td>
                  </tr>
                ))}
                <tr className="bg-blue-50 font-bold"><Td colSpan={5}>Saldo Akhir</Td><Td className="text-right font-mono">{fmtIDR(data.ending_balance)}</Td></tr>
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
