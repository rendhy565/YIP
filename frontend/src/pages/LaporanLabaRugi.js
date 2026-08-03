import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label } from "../components/ui";
import { fmtIDR, currentMonth } from "../lib/utils";

function Row({ label, value, bold, indent, color }) {
  return (
    <div className={`flex justify-between py-1.5 ${bold ? "font-bold" : ""} ${indent ? "pl-6" : ""} ${color || ""}`}>
      <div>{label}</div>
      <div className="font-mono">{fmtIDR(value)}</div>
    </div>
  );
}

export default function LaporanLabaRugi() {
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/reports/income-statement", { params: period ? { period } : {} }).then((r) => setData(r.data));
  }, [period]);

  return (
    <div data-testid="income-statement-page">
      <PageHeader title="Laporan Laba Rugi (Income Statement)" subtitle="Berbasis jurnal — sesuai PSAK. Hasil ini berbeda dari menu 'Laba Rugi (Order)' yang berbasis AWB." />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Periode</Label><MonthPicker value={period} onChange={setPeriod}/></div>
        </div>
      </Card>
      {data && (
        <Card className="p-5">
          <div className="text-center mb-4 pb-4 border-b border-slate-200">
            <div className="text-xs uppercase tracking-[0.15em] text-slate-500 font-bold">Laporan Laba Rugi</div>
            <div className="font-heading font-black text-2xl tracking-tight">Periode {period}</div>
          </div>

          <div className="text-emerald-900">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold mb-1">PENDAPATAN</div>
            {data.revenue.map((r) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.balance} indent/>)}
            <Row label="Total Pendapatan" value={data.total_revenue} bold color="border-t border-slate-300 mt-1"/>
          </div>

          <div className="text-rose-900 mt-4">
            <div className="text-[11px] uppercase tracking-wider text-rose-700 font-bold mb-1">HARGA POKOK PENJUALAN (HPP)</div>
            {data.cogs.map((r) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.balance} indent/>)}
            <Row label="Total HPP" value={data.total_cogs} bold color="border-t border-slate-300 mt-1"/>
          </div>

          <div className="bg-emerald-50 mt-4 px-3 py-2 rounded">
            <Row label={`LABA KOTOR (Gross Profit)  •  ${data.gross_margin_pct.toFixed(1)}%`} value={data.gross_profit} bold/>
          </div>

          <div className="text-orange-900 mt-4">
            <div className="text-[11px] uppercase tracking-wider text-orange-700 font-bold mb-1">BEBAN OPERASIONAL</div>
            {data.expenses.map((r) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.balance} indent/>)}
            <Row label="Total Beban" value={data.total_expenses} bold color="border-t border-slate-300 mt-1"/>
          </div>

          <div className={`mt-4 px-3 py-3 rounded ${data.net_income >= 0 ? "bg-blue-600" : "bg-rose-600"} text-white`}>
            <div className="flex justify-between font-extrabold text-lg">
              <div>LABA BERSIH (Net Income) • {data.net_margin_pct.toFixed(1)}%</div>
              <div className="font-mono">{fmtIDR(data.net_income)}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
