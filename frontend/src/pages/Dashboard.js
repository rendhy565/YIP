import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, StatusBadge } from "../components/ui";
import { fmtIDR } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { useCan } from "../lib/useCan";
import {
  TrendingUp, TrendingDown, FileCheck2, FileText, FileSpreadsheet,
  PackageCheck, PackagePlus, Wallet, ArrowUpRight, Hourglass
} from "lucide-react";

const StatCard = ({ icon: Icon, label, value, accent = "text-slate-900", sub }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">{label}</div>
        <div className={`font-heading font-black text-2xl mt-1.5 tracking-tight ${accent}`}>{value}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
      </div>
      <div className="h-9 w-9 rounded bg-slate-100 flex items-center justify-center text-slate-600">
        <Icon size={18} />
      </div>
    </div>
  </Card>
);

export default function Dashboard() {
  // Granular permissions for quicklinks (must be at top — React hooks rule)
  const canOrdersCreate = useCan("orders_input", "create");
  const canRecapEdit = useCan("recap", "edit_selling");
  const canRecapReconcile = useCan("recap", "reconcile");
  const canRecapExport = useCan("recap", "export");
  const canRecap = canRecapEdit || canRecapReconcile || canRecapExport;
  const canInvoicesCreate = useCan("invoices", "create");
  const canAccrueSettle = useCan("accrue", "settle");
  const canPayMark = useCan("payments", "mark_paid");
  const canPayMulti = useCan("payments", "multi_payment");
  const canPayments = canPayMark || canPayMulti;
  const canPnlExport = useCan("pnl", "export");
  const { user } = useAuth();
  const [k, setK] = useState(null);
  const [pymhd, setPymhd] = useState(null);
  useEffect(() => {
    api.get("/dashboard/kpis").then((r) => setK(r.data));
    api.get("/dashboard/pymhd-pipeline").then((r) => setPymhd(r.data)).catch(() => setPymhd(null));
  }, []);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title={`Halo, ${user?.full_name || user?.username}`}
        subtitle={`Anda masuk sebagai role ${user?.role?.toUpperCase()}. Berikut ringkasan operasional terkini.`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={PackagePlus} label="AWB Open" value={k?.status_counts?.Open ?? "-"} accent="text-blue-700" />
        <StatCard icon={FileSpreadsheet} label="Rekonsiliasi" value={k?.status_counts?.Reconciled ?? "-"} accent="text-amber-700" />
        <StatCard icon={FileText} label="Invoiced" value={k?.status_counts?.Invoiced ?? "-"} accent="text-purple-700" />
        <StatCard icon={PackageCheck} label="Lunas" value={k?.status_counts?.Paid ?? "-"} accent="text-emerald-700" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={TrendingUp} label="Total Pendapatan" value={fmtIDR(k?.total_revenue)} accent="text-emerald-700" sub="Akumulasi tarif AWB" />
        <StatCard icon={TrendingDown} label="Total Biaya" value={fmtIDR(k?.total_cost)} accent="text-red-700" sub="Semua kategori biaya" />
        <StatCard icon={Wallet} label="Hutang Vendor (Belum Settle)" value={fmtIDR(k?.outstanding_accrue)} accent="text-orange-700" sub="Status Accrue aktif" />
      </div>

      {/* ─── PYMHD Pipeline Panel (PSAK 72) ─── */}
      {pymhd && pymhd.total_count > 0 && (
        <Card className="mb-6" data-testid="pymhd-pipeline-panel">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-2">
              <Hourglass size={18} className="text-indigo-700"/>
              <div>
                <div className="font-heading font-bold text-slate-900">Pipeline PYMHD</div>
                <div className="text-[11px] text-slate-500">Pendapatan Yang Masih Harus Diterima — order belum di-invoice</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total Saldo</div>
              <div className="font-mono font-black text-2xl text-indigo-800" data-testid="pymhd-total">{fmtIDR(pymhd.total_amount)}</div>
              <div className="text-[11px] text-slate-500">{pymhd.total_count} AWB</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-5 py-4 border-b border-slate-200">
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <div className="text-[10px] uppercase font-bold text-amber-800">Belum Ada Cost</div>
              <div className="font-mono font-bold text-lg text-amber-900" data-testid="pymhd-unrecognized">{fmtIDR(pymhd.unrecognized_amount)}</div>
              <div className="text-[10px] text-amber-700">Murni PYMHD (jasa belum jalan)</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <div className="text-[10px] uppercase font-bold text-emerald-800">Sudah Ada Cost</div>
              <div className="font-mono font-bold text-lg text-emerald-900" data-testid="pymhd-recognized">{fmtIDR(pymhd.recognized_amount)}</div>
              <div className="text-[10px] text-emerald-700">Revenue diakui, tunggu invoice</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3">
              <div className="text-[10px] uppercase font-bold text-slate-600">Status Breakdown</div>
              <div className="text-sm mt-1">Open: <b className="font-mono">{pymhd.by_status.Open.count}</b> ({fmtIDR(pymhd.by_status.Open.amount)})</div>
              <div className="text-sm">Reconciled: <b className="font-mono">{pymhd.by_status.Reconciled.count}</b> ({fmtIDR(pymhd.by_status.Reconciled.amount)})</div>
            </div>
          </div>
          <div className="px-5 py-3">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Top 5 Customer dengan Saldo PYMHD</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-200">
                  <th className="text-left py-1.5">Customer</th>
                  <th className="text-right">AWB</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Belum Ada Cost</th>
                </tr>
              </thead>
              <tbody>
                {pymhd.by_customer.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0" data-testid={`pymhd-cust-row-${i}`}>
                    <td className="py-1.5 font-semibold">{r.customer}</td>
                    <td className="text-right text-slate-600">{r.count}</td>
                    <td className="text-right font-mono">{fmtIDR(r.amount)}</td>
                    <td className="text-right font-mono text-amber-700">{fmtIDR(r.unrecognized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-3">Pintasan Cepat</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {canOrdersCreate && (
            <Link data-testid="quick-new-order" to="/orders/new" className="group p-4 rounded-md border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-colors">
              <PackagePlus size={18} className="text-blue-700 mb-2" />
              <div className="text-sm font-bold text-slate-900">Input AWB Baru</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 1 <ArrowUpRight size={11} /></div>
            </Link>
          )}
          {canRecap && (
            <Link to="/recap" className="group p-4 rounded-md border border-slate-200 hover:border-amber-500 hover:bg-amber-50 transition-colors">
              <FileSpreadsheet size={18} className="text-amber-600 mb-2" />
              <div className="text-sm font-bold text-slate-900">Rekap & Excel</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 3 & 4 <ArrowUpRight size={11} /></div>
            </Link>
          )}
          {canInvoicesCreate && (
            <Link to="/invoices" className="group p-4 rounded-md border border-slate-200 hover:border-purple-500 hover:bg-purple-50 transition-colors">
              <FileText size={18} className="text-purple-700 mb-2" />
              <div className="text-sm font-bold text-slate-900">Invoice</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 5 <ArrowUpRight size={11} /></div>
            </Link>
          )}
          {canAccrueSettle && (
            <Link to="/accrue" className="group p-4 rounded-md border border-slate-200 hover:border-orange-500 hover:bg-orange-50 transition-colors">
              <Wallet size={18} className="text-orange-600 mb-2" />
              <div className="text-sm font-bold text-slate-900">Settle Hutang</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 2 <ArrowUpRight size={11} /></div>
            </Link>
          )}
          {canPayments && (
            <Link to="/payments" className="group p-4 rounded-md border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-colors">
              <FileCheck2 size={18} className="text-emerald-700 mb-2" />
              <div className="text-sm font-bold text-slate-900">Mark as Paid</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 6 <ArrowUpRight size={11} /></div>
            </Link>
          )}
          {canPnlExport && (
            <Link to="/pnl" className="group p-4 rounded-md border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-colors">
              <TrendingUp size={18} className="text-emerald-700 mb-2" />
              <div className="text-sm font-bold text-slate-900">Laba Rugi</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">Modul 7 <ArrowUpRight size={11} /></div>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
