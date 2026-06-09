import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label } from "../components/ui";
import { fmtIDR, fmtDate } from "../lib/utils";
import { CheckCircle2, AlertTriangle } from "lucide-react";

function Section({ title, items, total, color }) {
  return (
    <div className="border-b border-slate-200 last:border-0">
      <div className={`px-4 py-2 ${color} font-bold text-sm uppercase tracking-wider`}>{title}</div>
      <div className="px-4 py-2">
        {items.length === 0 && <div className="text-slate-400 text-sm py-1">— belum ada —</div>}
        {items.map((it) => (
          <div key={it.code} className="flex justify-between py-1 text-sm">
            <div><span className="font-mono text-slate-500 mr-2">{it.code}</span>{it.name}</div>
            <div className="font-mono">{fmtIDR(it.balance)}</div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 bg-slate-50 flex justify-between font-bold border-t border-slate-200">
        <div>Total {title}</div>
        <div className="font-mono">{fmtIDR(total)}</div>
      </div>
    </div>
  );
}

export default function Neraca() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = asOf ? { as_of: new Date(asOf).toISOString() } : {};
    api.get("/reports/balance-sheet", { params }).then((r) => setData(r.data));
  }, [asOf]);

  return (
    <div data-testid="balance-sheet-page">
      <PageHeader title="Neraca (Balance Sheet)" subtitle="Posisi keuangan: ASET = LIABILITAS + EKUITAS" />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Per Tanggal</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}/></div>
        </div>
      </Card>
      {data && (
        <>
          <Card className={`p-4 mb-3 flex items-center gap-3 ${data.balanced ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
            {data.balanced ? <CheckCircle2 className="text-emerald-700"/> : <AlertTriangle className="text-rose-700"/>}
            <div className={`font-bold ${data.balanced ? "text-emerald-800" : "text-rose-800"}`}>
              {data.balanced ? "Neraca seimbang ✓ — per " + fmtDate(data.as_of) : "TIDAK seimbang — selisih " + fmtIDR(data.total_assets - (data.total_liabilities + data.total_equity))}
            </div>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <div className="px-4 py-2 bg-blue-700 text-white font-bold">ASET</div>
              <Section title="Aset" items={data.assets} total={data.total_assets} color="bg-blue-50 text-blue-900"/>
            </Card>
            <Card>
              <div className="px-4 py-2 bg-purple-700 text-white font-bold">LIABILITAS & EKUITAS</div>
              <Section title="Liabilitas" items={data.liabilities} total={data.total_liabilities} color="bg-amber-50 text-amber-900"/>
              <Section title="Ekuitas" items={data.equity} total={data.total_equity} color="bg-purple-50 text-purple-900"/>
              <div className="px-4 py-3 bg-slate-100 flex justify-between font-extrabold text-sm border-t-2 border-slate-300">
                <div>TOTAL LIABILITAS + EKUITAS</div>
                <div className="font-mono">{fmtIDR(data.total_liabilities + data.total_equity)}</div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
