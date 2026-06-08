import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  LayoutDashboard, PackagePlus, ListChecks, Users, FileText,
  Wallet, ClipboardCheck, BadgeDollarSign, TrendingUp, Settings as SettingsIcon,
  LogOut, FileSpreadsheet, Coins, Building2, Menu, X
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["operation", "finance"] },
  { type: "section", label: "Order to Cash" },
  { to: "/orders/new", label: "Input Order", icon: PackagePlus, roles: ["operation"] },
  { to: "/orders", label: "Daftar AWB", icon: ListChecks, roles: ["operation", "finance"] },
  { to: "/recap", label: "Rekap & Rekonsiliasi", icon: FileSpreadsheet, roles: ["operation"] },
  { to: "/invoices", label: "Invoice", icon: FileText, roles: ["operation", "finance"] },
  { to: "/payments", label: "Pembayaran", icon: BadgeDollarSign, roles: ["finance"] },
  { type: "section", label: "Biaya" },
  { to: "/costs", label: "Plotting Biaya", icon: Coins, roles: ["operation", "finance"] },
  { to: "/accrue", label: "Settle Hutang Vendor", icon: Wallet, roles: ["finance"] },
  { type: "section", label: "Master & Laporan" },
  { to: "/customers", label: "Customer", icon: Users, roles: ["operation", "finance"] },
  { to: "/contracts", label: "Kontrak", icon: ClipboardCheck, roles: ["operation", "finance"] },
  { to: "/pnl", label: "Laporan Laba Rugi", icon: TrendingUp, roles: ["operation", "finance"] },
  { to: "/settings", label: "Pengaturan", icon: SettingsIcon, roles: ["operation", "finance"] },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  // close sidebar on route change (mobile)
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const SidebarBody = (
    <>
      <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded bg-blue-600 flex items-center justify-center">
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <div className="font-heading font-black tracking-tight text-white text-lg leading-none">TMS</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mt-0.5">Order to Cash</div>
          </div>
        </div>
        <button
          data-testid="sidebar-close-btn"
          onClick={() => setOpen(false)}
          className="lg:hidden p-1.5 rounded hover:bg-slate-800 text-slate-300"
          aria-label="Tutup menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 text-sm">
        {NAV.map((item, i) => {
          if (item.type === "section") {
            return (
              <div key={i} className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">
                {item.label}
              </div>
            );
          }
          if (item.roles && user && !item.roles.includes(user.role)) return null;
          const Icon = item.icon;
          const active = loc.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              data-testid={`nav-${item.to.replace(/\//g, "-")}`}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${
                active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-slate-700 text-slate-100 flex items-center justify-center font-bold text-xs uppercase">
            {user?.username?.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user?.full_name || user?.username}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{user?.role}</div>
          </div>
          <button
            data-testid="logout-button"
            onClick={logout}
            title="Keluar"
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile header */}
      <header className="app-header lg:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 h-14 flex items-center gap-3 border-b border-slate-800">
        <button
          data-testid="sidebar-open-btn"
          onClick={() => setOpen(true)}
          className="p-1.5 rounded hover:bg-slate-800"
          aria-label="Buka menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <div className="h-7 w-7 rounded bg-blue-600 flex items-center justify-center">
            <Building2 size={14} />
          </div>
          <div>
            <div className="font-heading font-black tracking-tight text-base leading-none">TMS</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">Order to Cash</div>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 font-bold">{user?.role}</div>
      </header>

      {/* Desktop sidebar (fixed) */}
      <aside data-testid="app-sidebar" className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-slate-900 text-slate-200 flex-col border-r border-slate-800">
        {SidebarBody}
      </aside>

      {/* Mobile sidebar (slide-over) */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            data-testid="sidebar-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <aside className="relative h-full w-72 max-w-[85%] bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800 animate-in slide-in-from-left">
            {SidebarBody}
          </aside>
        </div>
      )}

      <main className="lg:ml-64 min-h-screen">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
