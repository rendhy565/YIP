import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useFeatureFlags } from "../lib/featureFlags";
import {
  LayoutDashboard, PackagePlus, ListChecks, Users, FileText,
  Wallet, ClipboardCheck, BadgeDollarSign, TrendingUp, Settings as SettingsIcon,
  LogOut, FileSpreadsheet, Coins, Building2, Menu, X, Banknote, ShieldCheck,
  BookOpen, BookText, Library, Scale, Building, LineChart, Lock,
  UserCog, Percent, Briefcase, GitMerge, Upload, BarChart3, Repeat, Activity, FileSignature, CalendarClock,
  ChevronDown, ChevronRight, FileClock, Receipt,
} from "lucide-react";
import NotificationBell from "./NotificationBell";

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
  { to: "/panjar", label: "Panjar Kerja", icon: Wallet, perm: "fixed_costs" },
  { to: "/purchase-orders", label: "PO / Surat Perintah Vendor", icon: FileText, perm: "purchase_orders" },
  { to: "/fixed-costs", label: "Expense", icon: Banknote, perm: "fixed_costs" },

  { type: "section", label: "Approval" },
  { to: "/approvals", label: "Approval", icon: ClipboardCheck, perm: "approval", badge: "approval_pending" },
  { to: "/approvals/config", label: "Konfigurasi Approval", icon: SettingsIcon, perm: "*", adminOnly: true },

  { type: "section", label: "Master & Laporan" },
  { to: "/analytics", label: "Dashboard Analitik", icon: BarChart3, perm: "pnl" },
  { to: "/customers", label: "Customer", icon: Users, perm: "customers" },
  { to: "/vendors", label: "Master Vendor", icon: Briefcase, perm: "accrue" },
  { to: "/contracts", label: "Perjanjian Rate", icon: ClipboardCheck, perm: "contracts" },
  { to: "/expense-categories", label: "Master Kategori Expense", icon: Banknote, perm: "expense_categories" },
  { to: "/recurring-expenses", label: "Cost Automatic (Recurring)", icon: Repeat, perm: "fixed_costs" },
  { to: "/pnl", label: "Laba Rugi (Order)", icon: TrendingUp, perm: "pnl" },
  { to: "/pipeline", label: "Pipeline Penerimaan", icon: FileClock, perm: "pnl" },

  { type: "section", label: "Akunting (PSAK)", feature: "accounting" },
  { to: "/accounting/coa", label: "Bagan Akun", icon: BookOpen, perm: "accounting", feature: "accounting" },
  { to: "/accounting/journal", label: "Jurnal Umum", icon: BookText, perm: "accounting", feature: "accounting" },
  { to: "/accounting/ledger", label: "Buku Besar", icon: Library, perm: "accounting", feature: "accounting" },
  { to: "/accounting/trial-balance", label: "Neraca Saldo", icon: Scale, perm: "accounting", feature: "accounting" },
  { to: "/accounting/balance-sheet", label: "Neraca", icon: Building, perm: "accounting", feature: "accounting" },
  { to: "/accounting/income-statement", label: "Laporan Laba Rugi", icon: TrendingUp, perm: "accounting", feature: "accounting" },
  { to: "/accounting/cash-flow", label: "Arus Kas", icon: LineChart, perm: "accounting", feature: "accounting" },
  { to: "/accounting/amortization", label: "Amortisasi Beban", icon: CalendarClock, perm: "accounting", feature: "accounting" },
  { to: "/accounting/opening-closing", label: "Saldo Awal & Tutup Buku", icon: Lock, perm: "accounting", feature: "accounting" },

  { type: "section", label: "HR & Payroll", feature: "hr" },
  { to: "/hr", label: "Karyawan & Gaji", icon: UserCog, perm: "hr", feature: "hr" },
  { to: "/hr/attendance", label: "Absensi", icon: ClipboardCheck, perm: "hr", feature: "hr" },
  { to: "/hr/contracts", label: "Kontrak Kerja", icon: FileSignature, perm: "hr", feature: "hr" },
  { to: "/hr/kasbon", label: "Kasbon Karyawan", icon: Wallet, perm: "hr", feature: "hr" },
  { to: "/hr/pph21", label: "PPh21 Karyawan", icon: Receipt, perm: "hr", feature: "hr" },

  { type: "section", label: "Perpajakan", feature: "tax" },
  { to: "/tax", label: "PPN & PPh", icon: Percent, perm: "tax", feature: "tax" },

  { type: "section", label: "Aset Tetap", feature: "asset" },
  { to: "/assets", label: "Aset & Depresiasi", icon: Briefcase, perm: "asset", feature: "asset" },

  { type: "section", label: "Bank Reconciliation", feature: "bank_recon" },
  { to: "/bank-recon", label: "Rekonsiliasi Bank", icon: GitMerge, perm: "bank_recon", feature: "bank_recon" },

  { type: "section", label: "Sistem" },
  { to: "/settings", label: "Pengaturan", icon: SettingsIcon, perm: "settings" },
  { type: "section", label: "Administrator", adminOnly: true },
  { to: "/activity-log", label: "Activity Log", icon: Activity, perm: "*", adminOnly: true },
  { to: "/admin/koreksi-tarif", label: "Koreksi Tarif AWB", icon: Coins, perm: "*", adminOnly: true },
  { to: "/admin/import-center", label: "Pusat Import", icon: Upload, perm: "*", adminOnly: true },
  { to: "/admin/gabung-customer", label: "Gabung Customer Duplikat", icon: GitMerge, perm: "*", adminOnly: true },
  { to: "/users", label: "User Management", icon: ShieldCheck, perm: "user_management" },
];

function hasPerm(user, perm) {
  if (!user) return false;
  if (perm === "*") return true;
  // Granular: only show menu if user has AT LEAST ONE feature enabled in this module
  // (admin gets auto-seeded with all features=true at login, so admin also driven by permission_actions)
  const pa = user.permission_actions || {};
  const moduleObj = pa[perm];
  if (moduleObj && Object.values(moduleObj).some(Boolean)) return true;
  // Backward-compat: fall back to legacy permissions array only if permission_actions is entirely empty for this user
  if (!user.permission_actions || Object.keys(user.permission_actions).length === 0) {
    return Array.isArray(user.permissions) && user.permissions.includes(perm);
  }
  return false;
}

// Feature modules require BOTH the global feature flag to be on AND the user to
// have any feature enabled in their permission_actions for that module.
function canAccessFeature(user, featureKey, flags) {
  if (!featureKey) return true;
  if (!flags[featureKey]) return false;
  if (!user) return false;
  return hasPerm(user, featureKey);
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { flags } = useFeatureFlags();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [approvalPending, setApprovalPending] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar_collapsed") || "[]")); }
    catch { return new Set(); }
  });

  const toggleSection = (label) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem("sidebar_collapsed", JSON.stringify([...next])); } catch (_e) {}
      return next;
    });
  };

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  // Auto-expand the section that contains the active route
  useEffect(() => {
    let sec = null;
    for (const item of NAV) {
      if (item.type === "section") sec = item.label;
      else if (item.to === loc.pathname) break;
    }
    if (sec && collapsed.has(sec)) {
      setCollapsed((prev) => {
        const next = new Set(prev); next.delete(sec);
        try { localStorage.setItem("sidebar_collapsed", JSON.stringify([...next])); } catch (_e) {}
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  // Poll approval pending count for badge
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const fetch = async () => {
      try {
        const api = (await import("../lib/api")).default;
        const { data } = await api.get("/approvals/pending-count");
        if (mounted) setApprovalPending(data.count || 0);
      } catch (_e) { /* ignore */ }
    };
    fetch();
    const iv = setInterval(fetch, 45000); // refresh every 45s
    return () => { mounted = false; clearInterval(iv); };
  }, [user, loc.pathname]);

  // Rekam navigasi antar halaman (khusus user NON-admin) → Activity Log tab "Navigasi"
  const lastNavRef = useRef("");
  useEffect(() => {
    if (!user || (user.role || "").toLowerCase() === "administrator") return;
    const path = loc.pathname;
    if (lastNavRef.current === path) return;
    lastNavRef.current = path;
    const exact = NAV.find((i) => i.to === path);
    const prefix = exact ? null : NAV.filter((i) => i.to && i.to !== "/" && path.startsWith(i.to)).sort((a, b) => b.to.length - a.to.length)[0];
    const label = (exact || prefix)?.label || path;
    (async () => {
      try {
        const api = (await import("../lib/api")).default;
        await api.post("/navigation-logs", { path, label });
      } catch (_e) { /* ignore */ }
    })();
  }, [user, loc.pathname]);

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
          return (() => {
            const nodes = [];
            let curSection = null;
            for (let i = 0; i < pruned.length; i++) {
              const item = pruned[i];
              if (item.type === "section") {
                curSection = item.label;
                const isCol = collapsed.has(item.label);
                nodes.push(
                  <button key={`s-${i}`} data-testid={`nav-section-${item.label.replace(/[^a-zA-Z0-9]+/g, "-")}`}
                    onClick={() => toggleSection(item.label)}
                    className="w-full mt-4 mb-1 px-3 py-1 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold hover:text-slate-300 transition-colors">
                    <span>{item.label}</span>
                    {isCol ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                );
                continue;
              }
              if (curSection && collapsed.has(curSection)) continue;
              const Icon = item.icon;
              const active = loc.pathname === item.to;
              const badgeCount = item.badge === "approval_pending" ? approvalPending : 0;
              nodes.push(
                <Link key={item.to} to={item.to} data-testid={`nav-${item.to.replace(/\//g, "-")}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
                  <Icon size={16} />
                  <span className="flex-1">{item.label}</span>
                  {badgeCount > 0 && (
                    <span data-testid={`badge-${item.to.replace(/\//g, "-")}`} className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </Link>
              );
            }
            return nodes;
          })();
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
          <NotificationBell/>
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
