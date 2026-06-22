import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label, Table, Th, Td, Button } from "../components/ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Calendar, RefreshCw } from "lucide-react";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function VendorAging() {
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    try {
      const r = await api.get("/reports/vendor-aging", { params: { as_of: asOf } });
      setData(r.data);
    } catch (e) { toast.error(errMsg(e)); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const toggle = (v) => setExpanded((s) => ({ ...s, [v]: !s[v] }));

  if (!data) return <div className="p-10 text-center text-slate-500">Memuat aging hutang vendor...</div>;

  return (
    <div data-testid="vendor-aging-page">
      <PageHeader
        title="Aging Hutang Vendor"
        subtitle="Umur hutang vendor (accrue, belum settled) per bucket: 0-30 / 31-60 / 61-90 / 90+ hari."
      />

      <Card className="p-4 mb-5">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <Label>As of date</Label>
            <Input data-testid="aging-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}/>
          </div>
          <Button data-testid="reload-aging-btn" onClick={load}><RefreshCw size={14}/> Reload</Button>
          <div className="ml-auto text-sm text-slate-500">
            <Calendar size={12} className="inline mr-1"/> {data.count_vendors} vendor dengan outstanding
          </div>
        </div>
      </Card>

      {/* Summary totals */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-blue-700">Total Outstanding</div>
          <div className="font-heading font-black text-xl text-blue-900">{fmtIDR(data.totals.total)}</div>
        </Card>
        <Card className="p-4 bg-emerald-50 border-emerald-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-700">0-30 hari</div>
          <div className="font-heading font-black text-xl text-emerald-900">{fmtIDR(data.totals["0-30"])}</div>
        </Card>
        <Card className="p-4 bg-yellow-50 border-yellow-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-yellow-700">31-60 hari</div>
          <div className="font-heading font-black text-xl text-yellow-900">{fmtIDR(data.totals["31-60"])}</div>
        </Card>
        <Card className="p-4 bg-orange-50 border-orange-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-orange-700">61-90 hari</div>
          <div className="font-heading font-black text-xl text-orange-900">{fmtIDR(data.totals["61-90"])}</div>
        </Card>
        <Card className="p-4 bg-rose-50 border-rose-200">
          <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-rose-700">90+ hari (overdue)</div>
          <div className="font-heading font-black text-xl text-rose-900">{fmtIDR(data.totals["90+"])}</div>
        </Card>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>Vendor</Th>
            <Th className="text-right">0-30</Th>
            <Th className="text-right">31-60</Th>
            <Th className="text-right">61-90</Th>
            <Th className="text-right">90+</Th>
            <Th className="text-right">Total</Th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <React.Fragment key={r.vendor}>
                <tr data-testid={`aging-row-${r.vendor}`} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(r.vendor)}>
                  <Td className="font-semibold">{r.vendor} <span className="text-[10px] text-slate-400">({r.items.length} item)</span></Td>
                  <Td className="text-right font-mono">{fmtIDR(r["0-30"])}</Td>
                  <Td className="text-right font-mono">{fmtIDR(r["31-60"])}</Td>
                  <Td className="text-right font-mono">{fmtIDR(r["61-90"])}</Td>
                  <Td className="text-right font-mono text-rose-700 font-bold">{fmtIDR(r["90+"])}</Td>
                  <Td className="text-right font-bold">{fmtIDR(r.total)}</Td>
                </tr>
                {expanded[r.vendor] && r.items.map((it) => (
                  <tr key={it.cost_id} className="bg-slate-50">
                    <Td colSpan={6}>
                      <div className="flex items-center gap-3 text-xs text-slate-600 px-2">
                        <span className="font-mono">{it.awb_number || "(no AWB)"}</span>
                        <span>·</span>
                        <span className="text-slate-500">{it.description}</span>
                        <span className="ml-auto font-mono">{fmtIDR(it.amount)} <span className="text-[10px] text-slate-400">({it.days} hari · {it.bucket})</span></span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {data.rows.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-8">Tidak ada hutang vendor outstanding 🎉</Td></tr>}
            {data.rows.length > 0 && (
              <tr className="bg-slate-100 font-bold">
                <Td>TOTAL</Td>
                <Td className="text-right font-mono">{fmtIDR(data.totals["0-30"])}</Td>
                <Td className="text-right font-mono">{fmtIDR(data.totals["31-60"])}</Td>
                <Td className="text-right font-mono">{fmtIDR(data.totals["61-90"])}</Td>
                <Td className="text-right font-mono text-rose-700">{fmtIDR(data.totals["90+"])}</Td>
                <Td className="text-right">{fmtIDR(data.totals.total)}</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
