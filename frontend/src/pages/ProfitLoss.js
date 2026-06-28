import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth } from "../lib/utils";
import { TrendingUp, TrendingDown, Wallet, Download, Info, Banknote } from "lucide-react";
import * as XLSX from "xlsx";

const FIXED_CAT_COLORS = {
  Gaji: "bg-blue-50 border-blue-200 text-blue-800",
  Sewa: "bg-purple-50 border-purple-200 text-purple-800",
  Utilities: "bg-teal-50 border-teal-200 text-teal-800",
  Marketing: "bg-pink-50 border-pink-200 text-pink-800",
  Administrasi: "bg-amber-50 border-amber-200 text-amber-800",
  Lainnya: "bg-slate-50 border-slate-200 text-slate-800",
};

export default function ProfitLoss() {
  const [data, setData] = useState({ rows: [], fixed_costs: [], fixed_breakdown: {}, summary: {} });
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
      "Status": r.status, "Sudah Ada Biaya?": r.has_cost ? "Ya" : "Tidak",
      "Revenue (jika ada biaya)": r.has_cost ? r.revenue : 0,
      "COGS": r.total_cost, "Gross Profit": r.gross_profit,
      "Margin %": r.margin_pct.toFixed(2),
    }));
    const ws1 = XLSX.utils.json_to_sheet(rows);
    const ws2 = XLSX.utils.json_to_sheet(data.fixed_costs.map((f) => ({
      "Periode": f.period_month, "Kategori": f.category, "Deskripsi": f.description, "Jumlah": f.amount,
    })));
    const s = data.summary || {};
    const ws3 = XLSX.utils.aoa_to_sheet([
      ["RINGKASAN LABA RUGI", month],
      [],
      ["Total Revenue (AWB dengan biaya)", s.total_revenue],
      ["Total COGS", s.total_cogs],
      ["  — termasuk Operation Expense", s.total_cogs_expense || 0],
      ["Gross Margin", s.gross_margin],
      ["Gross Margin %", `${(s.gross_margin_pct || 0).toFixed(2)}%`],
      [],
      ["Total Expense (Operating)", s.total_fixed_cost],
      [],
      ["NET PROFIT", s.net_profit],
      ["Net Profit %", `${(s.net_profit_pct || 0).toFixed(2)}%`],
      [],
      ["AWB tanpa biaya (excluded)", s.excluded_count],
      ["Revenue excluded", s.excluded_revenue],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws3, "Ringkasan");
    XLSX.utils.book_append_sheet(wb, ws1, "Per AWB");
    XLSX.utils.book_append_sheet(wb, ws2, "Expense");
    XLSX.writeFile(wb, `Laba_Rugi_${month}.xlsx`);
  };

  const s = data.summary || {};

  return (
    <div data-testid="pnl-page">
      <PageHeader
        title="Laporan Laba Rugi"
        subtitle="Gross Margin = Revenue − COGS (termasuk Operation Expense). Net Profit = Gross Margin − Expense (Operating). Revenue hanya menghitung AWB yang sudah memiliki biaya."
      />

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

      {/* P&L Waterfall */}
      <Card className="p-5 mb-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-800">
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400 mb-3">Ringkasan Laba Rugi · {month}</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch">
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-400">Revenue</div>
            <div data-testid="pnl-total-revenue" className="font-heading font-black text-2xl mt-1">{fmtIDR(s.total_revenue)}</div>
            <div className="text-[11px] text-slate-400">{s.count_with_cost || 0} AWB ter-cost</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-slate-500 text-2xl">−</div>
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-orange-400">COGS</div>
            <div data-testid="pnl-total-cost" className="font-heading font-black text-2xl mt-1">{fmtIDR(s.total_cogs)}</div>
            <div className="text-[11px] text-slate-400">
              Per AWB
              {s.total_cogs_expense > 0 && (
                <> + Operation Exp <span className="text-emerald-300">{fmtIDR(s.total_cogs_expense)}</span></>
              )}
            </div>
          </div>
          <div className="hidden md:flex items-center justify-center text-slate-500 text-2xl">=</div>
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-400">Gross Margin</div>
            <div data-testid="pnl-gross-margin" className={`font-heading font-black text-2xl mt-1 ${(s.gross_margin || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtIDR(s.gross_margin)}</div>
            <div className="text-[11px] text-slate-400">{(s.gross_margin_pct || 0).toFixed(1)}% margin</div>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-5 pt-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch">
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-400">Gross Margin</div>
            <div className={`font-heading font-black text-2xl mt-1 ${(s.gross_margin || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtIDR(s.gross_margin)}</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-slate-500 text-2xl">−</div>
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-red-400">Expense</div>
            <div data-testid="pnl-fixed-cost" className="font-heading font-black text-2xl mt-1">{fmtIDR(s.total_fixed_cost)}</div>
            <div className="text-[11px] text-slate-400">Operating expense</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-slate-500 text-2xl">=</div>
          <div className="md:col-span-1">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-amber-400">Net Profit</div>
            <div data-testid="pnl-net-profit" className={`font-heading font-black text-3xl mt-1 ${(s.net_profit || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtIDR(s.net_profit)}</div>
            <div className="text-[11px] text-slate-400">{(s.net_profit_pct || 0).toFixed(1)}% margin</div>
          </div>
        </div>
      </Card>

      {s.excluded_count > 0 && (
        <Card className="p-3 mb-5 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <Info size={16} className="text-amber-700 mt-0.5"/>
            <div className="text-xs text-amber-900">
              <strong>{s.excluded_count} AWB</strong> dengan total tarif <strong>{fmtIDR(s.excluded_revenue)}</strong> tidak masuk Revenue karena belum memiliki biaya tercatat.
              AWB dianggap selesai untuk perhitungan margin hanya setelah biaya terkait di-input.
            </div>
          </div>
        </Card>
      )}

      {/* Expense Breakdown */}
      {Object.keys(data.fixed_breakdown || {}).length > 0 && (
        <Card className="mb-5">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
            <Banknote size={16} className="text-red-700"/>
            <h3 className="font-bold">Rincian Expense — {month}</h3>
            <span className="text-xs text-slate-500 ml-2">{(data.fixed_costs || []).filter((f) => (f.posting_type || "expense") !== "cogs").length} item</span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(data.fixed_breakdown).map(([cat, amt]) => (
              <div key={cat} className={`p-3 rounded border ${FIXED_CAT_COLORS[cat] || FIXED_CAT_COLORS.Lainnya}`}>
                <div className="text-[10px] uppercase tracking-[0.12em] font-bold opacity-70">{cat}</div>
                <div className="font-heading font-black text-lg mt-1">{fmtIDR(amt)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* COGS-typed Expense Breakdown (Operation kategori) */}
      {Object.keys(data.cogs_expense_breakdown || {}).length > 0 && (
        <Card className="mb-5 border-emerald-200">
          <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50/50 flex items-center gap-2">
            <Banknote size={16} className="text-emerald-700"/>
            <h3 className="font-bold">Rincian Expense yang masuk COGS — {month}</h3>
            <span className="text-xs text-emerald-700 ml-2">posting type: COGS</span>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(data.cogs_expense_breakdown).map(([cat, amt]) => (
              <div key={cat} className="p-3 rounded border bg-emerald-50 border-emerald-200 text-emerald-900">
                <div className="text-[10px] uppercase tracking-[0.12em] font-bold opacity-70">{cat}</div>
                <div className="font-heading font-black text-lg mt-1">{fmtIDR(amt)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Per-AWB Breakdown */}
      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-700"/>
          <h3 className="font-bold">Rincian per AWB (Revenue & COGS)</h3>
          <span className="text-xs text-slate-500 ml-2">{data.rows.length} AWB</span>
        </div>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Status</Th>
            <Th className="text-right">Revenue</Th><Th className="text-right">COGS</Th>
            <Th className="text-right">Gross Profit</Th><Th className="text-right">Margin %</Th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.awb_id} data-testid={`pnl-row-${r.awb_id}`} className={!r.has_cost ? "opacity-50" : ""}>
                <Td className="font-mono font-semibold">
                  {r.awb_number}
                  {!r.has_cost && <span className="ml-1 text-[10px] uppercase tracking-wider text-amber-600 font-bold">(tanpa biaya)</span>}
                </Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">{r.has_cost ? fmtIDR(r.revenue) : <span className="text-slate-400">excluded</span>}</Td>
                <Td className="text-right text-red-700">{fmtIDR(r.total_cost)}</Td>
                <Td className={`text-right font-semibold ${r.has_cost ? (r.gross_profit >= 0 ? "text-emerald-700" : "text-red-700") : "text-slate-400"}`}>{r.has_cost ? fmtIDR(r.gross_profit) : "-"}</Td>
                <Td className="text-right text-xs">{r.has_cost ? `${r.margin_pct.toFixed(1)}%` : "-"}</Td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Tidak ada data untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
