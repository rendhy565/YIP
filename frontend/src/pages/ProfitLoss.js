import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth, errMsg } from "../lib/utils";
import { TrendingUp, TrendingDown, Wallet, Download } from "lucide-react";
import * as XLSX from "xlsx";

export default function ProfitLoss() {
  const [data, setData] = useState({ rows: [], summary: {} });
  const [customers, setCustomers] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [customerId, setCustomerId] = useState("");

  const load = () => {
    const params = {};
    if (month) params.month = month;
    if (customerId) params.customer_id = customerId;
    api.get("/reports/profit-loss", { params }).then((r) => setData(r.data));
  };
  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); }, [month, customerId]);

  const exportXLS = () => {
    const rows = data.rows.map((r) => ({
      "AWB": r.awb_number, "Tanggal": fmtDate(r.created_at), "Customer": r.customer_name,
      "Status": r.status, "Revenue": r.revenue, "Total Biaya": r.total_cost,
      "Net Profit": r.net_profit, "Margin %": r.margin_pct.toFixed(2),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `PnL ${month}`);
    XLSX.writeFile(wb, `Laba_Rugi_${month}.xlsx`);
  };

  const s = data.summary || {};

  return (
    <div data-testid="pnl-page">
      <PageHeader title="Laporan Laba Rugi" subtitle="Modul 7 — Pendapatan AWB dikurangi total biaya per order." />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]"><Label>Bulan</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)}/></div>
          <div className="min-w-[220px]"><Label>Customer</Label>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="ml-auto"><Button variant="secondary" onClick={exportXLS} disabled={data.rows.length === 0}><Download size={14}/> Export Excel</Button></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-emerald-700 mb-1"><TrendingUp size={16}/><span className="text-[10px] uppercase tracking-[0.12em] font-bold">Total Revenue</span></div>
          <div data-testid="pnl-total-revenue" className="font-heading font-black text-2xl text-slate-900">{fmtIDR(s.total_revenue)}</div>
          <div className="text-[11px] text-slate-500">{s.count || 0} order</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-red-700 mb-1"><TrendingDown size={16}/><span className="text-[10px] uppercase tracking-[0.12em] font-bold">Total Biaya</span></div>
          <div data-testid="pnl-total-cost" className="font-heading font-black text-2xl text-slate-900">{fmtIDR(s.total_cost)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-blue-700 mb-1"><Wallet size={16}/><span className="text-[10px] uppercase tracking-[0.12em] font-bold">Net Profit</span></div>
          <div data-testid="pnl-net-profit" className={`font-heading font-black text-2xl ${(s.net_profit || 0) >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmtIDR(s.net_profit)}</div>
          <div className="text-[11px] text-slate-500">
            Margin {s.total_revenue ? ((s.net_profit / s.total_revenue) * 100).toFixed(1) : "0.0"}%
          </div>
        </Card>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Status</Th>
            <Th className="text-right">Revenue</Th><Th className="text-right">Total Biaya</Th>
            <Th className="text-right">Net Profit</Th><Th className="text-right">Margin</Th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.awb_id} data-testid={`pnl-row-${r.awb_id}`}>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">{fmtIDR(r.revenue)}</Td>
                <Td className="text-right text-red-700">{fmtIDR(r.total_cost)}</Td>
                <Td className={`text-right font-semibold ${r.net_profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmtIDR(r.net_profit)}</Td>
                <Td className="text-right text-xs">{r.margin_pct.toFixed(1)}%</Td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Tidak ada data untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
