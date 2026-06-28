import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useFeatureFlags } from "../lib/featureFlags";
import {
  LayoutDashboard, PackagePlus, ListChecks, Users, FileText,
  Wallet, ClipboardCheck, BadgeDollarSign, TrendingUp, Settings as SettingsIcon,
  LogOut, FileSpreadsheet, Coins, Building2, Menu, X, Banknote, ShieldCheck,
  BookOpen, BookText, Library, Scale, Building, LineChart, Lock,
  UserCog, Percent, Briefcase, GitMerge, Upload, BarChart3,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, perm: "*" },

  { type: "section", label: "Order to Cash" },
  { to: "/orders/new", label: "Input Order", icon: PackagePlus, perm: "orders_input" },
  { to: "/orders", label: "Daftar AWB", icon: ListChecks, perm: "orders_list" },
  { to: "/recap", label: "Rekap & Rekonsiliasi", icon: FileSpreadsheet, perm: "recap" },
  { to: "/invoices", label: "Buat Invoice", icon: FileText, perm: "invoices" },
  { to: "/invoices/created", label: "Invoice Tercetak", icon: FileText, perm: "invoices" },
  { to: "/payments", label: "Pembayaran", icon: BadgeDollarSign, perm: "payments" },

  { type: "section", label: "Biaya" },
  { to: "/costs", label: "Plotting Biaya", icon: Coins, perm: "costs" },
  { to: "/accrue", label: "Settle Hutang Vendor", icon: Wallet, perm: "accrue" },
  { to: "/panjar", label: "Panjar Kerja", icon: Wallet, perm: "*" },
  { to: "/purchase-orders", label: "PO / Surat Perintah Vendor", icon: FileText, perm: "*" },
  { to: "/fixed-costs", label: "Expense", icon: Banknote, perm: "fixed_costs" },

  { type: "section", label: "Master & Laporan" },
  { to: "/analytics", label: "Dashboard Analitik", icon: BarChart3, perm: "*" },
  { to: "/customers", label: "Customer", icon: Users, perm: "customers" },
  { to: "/contracts", label: "Perjanjian Rate", icon: ClipboardCheck, perm: "contracts" },
  { to: "/pnl", label: "Laba Rugi (Order)", icon: TrendingUp, perm: "pnl" },

  { type: "section", label: "Akunting (PSAK)", feature: "accounting" },
  { to: "/accounting/coa", label: "Bagan Akun", icon: BookOpen, perm: "*", feature: "accounting" },
  { to: "/accounting/journal", label: "Jurnal Umum", icon: BookText, perm: "*", feature: "accounting" },
  { to: "/accounting/ledger", label: "Buku Besar", icon: Library, perm: "*", feature: "accounting" },
  { to: "/accounting/trial-balance", label: "Neraca Saldo", icon: Scale, perm: "*", feature: "accounting" },
  { to: "/accounting/balance-sheet", label: "Neraca", icon: Building, perm: "*", feature: "accounting" },
  { to: "/accounting/income-statement", label: "Laporan Laba Rugi", icon: TrendingUp, perm: "*", feature: "accounting" },
  { to: "/accounting/cash-flow", label: "Arus Kas", icon: LineChart, perm: "*", feature: "accounting" },
  { to: "/accounting/opening-closing", label: "Saldo Awal & Tutup Buku", icon: Lock, perm: "*", feature: "accounting" },

  { type: "section", label: "HR & Payroll", feature: "hr" },
  { to: "/hr", label: "Karyawan & Gaji", icon: UserCog, perm: "*", feature: "hr" },

  { type: "section", label: "Perpajakan", feature: "tax" },
  { to: "/tax", label: "PPN & PPh", icon: Percent, perm: "*", feature: "tax" },

  { type: "section", label: "Aset Tetap", feature: "asset" },
  { to: "/assets", label: "Aset & Depresiasi", icon: Briefcase, perm: "*", feature: "asset" },

  { type: "section", label: "Bank Reconciliation", feature: "bank_recon" },
  { to: "/bank-recon", label: "Rekonsiliasi Bank", icon: GitMerge, perm: "*", feature: "bank_recon" },

  { type: "section", label: "Sistem" },
  { to: "/settings", label: "Pengaturan", icon: SettingsIcon, perm: "settings" },
  { type: "section", label: "Administrator", adminOnly: true },
  { to: "/import", label: "Import Excel", icon: Upload, perm: "*", adminOnly: true },
  { to: "/users", label: "User Management", icon: ShieldCheck, perm: "user_management" },
];

function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === "administrator") return true;
  if (perm === "*") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

// Feature modules require BOTH the global feature flag to be on AND the user to
// have the matching permission key in their `permissions` array (admin bypasses).
function canAccessFeature(user, featureKey, flags) {
  if (!featureKey) return true;
  if (!flags[featureKey]) return false;
  if (!user) return false;
  if (user.role === "administrator") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(featureKey);
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { flags } = useFeatureFlags();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const SidebarBody = (
    <>
      <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded bg-blue-600 flex items-center justify-center">
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <div className="font-heading font-black tracking-tight text-white text-lg leading-none">ARC</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mt-0.5">Business Suite</div>
          </div>
        </div>
        <button data-testid="sidebar-close-btn" onClick={() => setOpen(false)} className="lg:hidden p-1.5 rounded hover:bg-slate-800 text-slate-300" aria-label="Tutup menu"><X size={18} /></button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 text-sm">
        {(() => {
          // First pass: determine which items would be visible
          const visible = NAV.map((item) => {
            if (item.type === "section") {
              if (item.adminOnly && user?.role !== "administrator") return null;
              if (item.feature && !canAccessFeature(user, item.feature, flags)) return null;
              return item;
            }
            if (item.adminOnly && user?.role !== "administrator") return null;
            if (item.feature && !canAccessFeature(user, item.feature, flags)) return null;
            if (!hasPerm(user, item.perm)) return null;
            return item;
          });
          // Second pass: prune section headers without any child after them
          const pruned = [];
          for (let i = 0; i < visible.length; i++) {
            const it = visible[i];
            if (!it) continue;
            if (it.type === "section") {
              // Find next section index or end
              const nextSecIdx = visible.findIndex((x, idx) => idx > i && x && x.type === "section");
              const end = nextSecIdx === -1 ? visible.length : nextSecIdx;
              const childCount = visible.slice(i + 1, end).filter(Boolean).length;
              if (childCount === 0) continue;
            }
            pruned.push(it);
          }
          return pruned.map((item, i) => {
            if (item.type === "section") {
              return (
                <div key={`s-${i}`} className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">
                  {item.label}
                </div>
              );
            }
            const Icon = item.icon;
            const active = loc.pathname === item.to;
            return (
              <Link key={item.to} to={item.to} data-testid={`nav-${item.to.replace(/\//g, "-")}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          });
        })()}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-slate-700 text-slate-100 flex items-center justify-center font-bold text-xs uppercase">{user?.username?.slice(0, 2)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user?.full_name || user?.username}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{user?.role}</div>
          </div>
          <button data-testid="logout-button" onClick={logout} title="Keluar" className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"><LogOut size={16} /></button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="app-header lg:hidden sticky top-0 z-30 bg-slate-900 text-white px-4 h-14 flex items-center gap-3 border-b border-slate-800">
        <button data-testid="sidebar-open-btn" onClick={() => setOpen(true)} className="p-1.5 rounded hover:bg-slate-800" aria-label="Buka menu"><Menu size={20} /></button>
        <div className="flex items-center gap-2 flex-1">
          <div className="h-7 w-7 rounded bg-blue-600 flex items-center justify-center"><Building2 size={14} /></div>
          <div>
            <div className="font-heading font-black tracking-tight text-base leading-none">ARC</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">Business Suite</div>
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 font-bold">{user?.role}</div>
      </header>

      <aside data-testid="app-sidebar" className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-slate-900 text-slate-200 flex-col border-r border-slate-800">
        {SidebarBody}
      </aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div data-testid="sidebar-backdrop" onClick={() => setOpen(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"/>
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
