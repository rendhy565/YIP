import MonthPicker from "../components/MonthPicker";
import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth } from "../lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

function Bucket({ title, color, inflow, outflow, net, items }) {
  return (
    <Card>
      <div className={`px-4 py-2 ${color} font-bold flex items-center justify-between`}>
        <div>{title}</div>
        <div className="font-mono text-sm">{fmtIDR(net)}</div>
      </div>
      <div className="px-4 py-3 grid grid-cols-3 text-sm border-b border-slate-200">
        <div><div className="text-[10px] uppercase text-slate-500 font-bold">Inflow</div><div className="font-mono text-emerald-700 font-bold">{fmtIDR(inflow)}</div></div>
        <div><div className="text-[10px] uppercase text-slate-500 font-bold">Outflow</div><div className="font-mono text-rose-700 font-bold">{fmtIDR(outflow)}</div></div>
        <div><div className="text-[10px] uppercase text-slate-500 font-bold">Net</div><div className={`font-mono font-bold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtIDR(net)}</div></div>
      </div>
      {items && items.length > 0 && (
        <div className="max-h-44 overflow-y-auto px-4 py-2 text-xs">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between py-1 border-b border-slate-100 last:border-0">
              <div className="truncate flex-1 mr-2"><span className="font-mono text-slate-500 mr-2">{it.entry_no}</span>{it.description}</div>
              <div className={`font-mono ${it.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtIDR(it.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function LaporanArusKas() {
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/reports/cash-flow", { params: period ? { period } : {} }).then((r) => setData(r.data));
  }, [period]);

  return (
    <div data-testid="cash-flow-page">
      <PageHeader title="Laporan Arus Kas (Cash Flow)" subtitle="Metode langsung — mutasi seluruh akun kas/bank dikelompokkan ke Operasi · Investasi · Pendanaan." />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Periode</Label><MonthPicker value={period} onChange={setPeriod}/></div>
        </div>
      </Card>
      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Card className="p-3"><div className="text-[10px] uppercase text-slate-500 font-bold">Kas Awal</div><div className="font-mono font-bold text-xl">{fmtIDR(data.beginning_cash)}</div></Card>
            <Card className={`p-3 ${data.net_change >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
              <div className="text-[10px] uppercase text-slate-500 font-bold">Perubahan Bersih</div>
              <div className={`font-mono font-bold text-xl ${data.net_change >= 0 ? "text-emerald-800" : "text-rose-800"}`}>{fmtIDR(data.net_change)}</div>
            </Card>
            <Card className="p-3 bg-blue-50 border-blue-200"><div className="text-[10px] uppercase text-blue-700 font-bold">Kas Akhir</div><div className="font-mono font-bold text-xl text-blue-800">{fmtIDR(data.ending_cash)}</div></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Bucket title="OPERASI" color="bg-emerald-100 text-emerald-900" inflow={data.operating.inflow} outflow={data.operating.outflow} net={data.operating.net} items={[...(data.detail.operating_in || []), ...(data.detail.operating_out || []).map((x) => ({ ...x, amount: -Math.abs(x.amount) }))]}/>
            <Bucket title="INVESTASI" color="bg-amber-100 text-amber-900" inflow={data.investing.inflow} outflow={data.investing.outflow} net={data.investing.net} items={data.detail.investing}/>
            <Bucket title="PENDANAAN" color="bg-purple-100 text-purple-900" inflow={data.financing.inflow} outflow={data.financing.outflow} net={data.financing.net} items={data.detail.financing}/>
          </div>
        </>
      )}
    </div>
  );
}
