import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { FeatureFlagsProvider, useFeatureFlags } from "./lib/featureFlags";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import MasterVendor from "./pages/MasterVendor";
import Contracts from "./pages/Contracts";
import OrderInput from "./pages/OrderInput";
import OrdersList from "./pages/OrdersList";
import Costs from "./pages/Costs";
import AccrueSettlement from "./pages/AccrueSettlement";
import Recap from "./pages/Recap";
import Invoices from "./pages/Invoices";
import InvoicePrint from "./pages/InvoicePrint";
import InvoicePrintBulk from "./pages/InvoicePrintBulk";
import Payments from "./pages/Payments";
import ProfitLoss from "./pages/ProfitLoss";
import FixedCosts from "./pages/FixedCosts";
import ExpenseCategories from "./pages/ExpenseCategories";
import RecurringExpenses from "./pages/RecurringExpenses";
import ActivityLog from "./pages/ActivityLog";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
// Accounting pages
import ChartOfAccounts from "./pages/ChartOfAccounts";
import JournalUmum from "./pages/JournalUmum";
import BukuBesar from "./pages/BukuBesar";
import NeracaSaldo from "./pages/NeracaSaldo";
import Neraca from "./pages/Neraca";
import LaporanLabaRugi from "./pages/LaporanLabaRugi";
import LaporanArusKas from "./pages/LaporanArusKas";
import Amortisasi from "./pages/Amortisasi";
import SaldoAwal from "./pages/SaldoAwal";
// Optional module pages
import HrPayroll from "./pages/HrPayroll";
import Attendance from "./pages/Attendance";
import KontrakKerja from "./pages/KontrakKerja";
import KasbonKaryawan from "./pages/KasbonKaryawan";
import TaxModule from "./pages/TaxModule";
import AssetModule from "./pages/AssetModule";
import BankReconciliation from "./pages/BankReconciliation";
import ImportExcel from "./pages/ImportExcel";
import TariffCorrection from "./pages/TariffCorrection";
import BulkImport from "./pages/BulkImport";
import CustomerMerge from "./pages/CustomerMerge";
import ImportCenter from "./pages/ImportCenter";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import PanjarKerja from "./pages/PanjarKerja";
import InvoicesCreated from "./pages/InvoicesCreated";
import PurchaseOrders from "./pages/PurchaseOrders";
import Approvals from "./pages/Approvals";
import ApprovalConfig from "./pages/ApprovalConfig";
import ReceivablePipeline from "./pages/ReceivablePipeline";
import Pph21 from "./pages/Pph21";

function Protected({ children, roles, module }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Granular permission check: if `module` is provided, allow access when user has
  // at least one feature enabled in their permission_actions for that module.
  // This makes Protected route guard consistent with sidebar gating.
  if (module) {
    const pa = user.permission_actions || {};
    const moduleObj = pa[module];
    const hasAny = moduleObj && Object.values(moduleObj).some(Boolean);
    if (hasAny) return children;
    // Backward-compat: legacy users (no permission_actions at all) fall back to roles[]
    if (!user.permission_actions || Object.keys(user.permission_actions).length === 0) {
      if (!roles || roles.includes(user.role)) return children;
    }
    return <Navigate to="/" replace />;
  }
  // Legacy role-based check (used by routes that have no module mapping)
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function FeatureGate({ feature, children }) {
  const { flags, loading } = useFeatureFlags();
  const { user } = useAuth();
  if (loading) return <div className="p-8 text-slate-400 text-sm">Memuat...</div>;
  // Global flag must be on
  if (!flags[feature]) return <Navigate to="/" replace />;
  // Per-user permission must include the feature key (admin bypass)
  if (user && user.role !== "administrator") {
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (!perms.includes(feature)) return <Navigate to="/" replace />;
  }
  return children;
}

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <FeatureFlagsProvider>
        <BrowserRouter basename={window.location.pathname.startsWith('/arc/') || window.location.pathname === '/arc' ? '/arc' : '/'}>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Shell><Dashboard /></Shell></Protected>} />
            <Route path="/orders/new" element={<Protected module="orders_input"><Shell><OrderInput /></Shell></Protected>} />
            <Route path="/orders" element={<Protected module="orders_list"><Shell><OrdersList /></Shell></Protected>} />
            <Route path="/customers" element={<Protected module="customers"><Shell><Customers /></Shell></Protected>} />
            <Route path="/vendors" element={<Protected module="accrue"><Shell><MasterVendor /></Shell></Protected>} />
            <Route path="/contracts" element={<Protected module="contracts"><Shell><Contracts /></Shell></Protected>} />
            <Route path="/costs" element={<Protected module="costs"><Shell><Costs /></Shell></Protected>} />
            <Route path="/accrue" element={<Protected module="accrue"><Shell><AccrueSettlement /></Shell></Protected>} />
            <Route path="/recap" element={<Protected module="recap"><Shell><Recap /></Shell></Protected>} />
            <Route path="/invoices" element={<Protected module="invoices"><Shell><Invoices /></Shell></Protected>} />
            <Route path="/invoices/created" element={<Protected module="invoices_created"><Shell><InvoicesCreated /></Shell></Protected>} />
            <Route path="/invoices/:id/print" element={<Protected module="invoices_created"><InvoicePrint /></Protected>} />
            <Route path="/invoices/print-bulk" element={<Protected module="invoices_created"><InvoicePrintBulk /></Protected>} />
            <Route path="/payments" element={<Protected module="payments"><Shell><Payments /></Shell></Protected>} />
            <Route path="/fixed-costs" element={<Protected module="fixed_costs"><Shell><FixedCosts /></Shell></Protected>} />
            <Route path="/expense-categories" element={<Protected module="expense_categories"><Shell><ExpenseCategories /></Shell></Protected>} />
            <Route path="/recurring-expenses" element={<Protected module="fixed_costs"><Shell><RecurringExpenses /></Shell></Protected>} />
            <Route path="/activity-log" element={<Protected roles={["administrator"]}><Shell><ActivityLog /></Shell></Protected>} />
            <Route path="/pnl" element={<Protected module="pnl"><Shell><ProfitLoss /></Shell></Protected>} />
            <Route path="/pipeline" element={<Protected module="pnl"><Shell><ReceivablePipeline /></Shell></Protected>} />
            <Route path="/users" element={<Protected module="user_management"><Shell><Users /></Shell></Protected>} />
            <Route path="/settings" element={<Protected module="settings"><Shell><Settings /></Shell></Protected>} />

            {/* Accounting (gated by feature flag "accounting" + accounting module perm) */}
            <Route path="/accounting/coa" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><ChartOfAccounts /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/journal" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><JournalUmum /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/ledger" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><BukuBesar /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/trial-balance" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><NeracaSaldo /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/balance-sheet" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><Neraca /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/income-statement" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><LaporanLabaRugi /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/cash-flow" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><LaporanArusKas /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/amortization" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><Amortisasi /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/opening-closing" element={<Protected module="accounting"><FeatureGate feature="accounting"><Shell><SaldoAwal /></Shell></FeatureGate></Protected>} />

            {/* Optional modules */}
            <Route path="/hr" element={<Protected module="hr"><FeatureGate feature="hr"><Shell><HrPayroll /></Shell></FeatureGate></Protected>} />
            <Route path="/hr/attendance" element={<Protected module="hr"><FeatureGate feature="hr"><Shell><Attendance /></Shell></FeatureGate></Protected>} />
            <Route path="/hr/contracts" element={<Protected module="hr"><FeatureGate feature="hr"><Shell><KontrakKerja /></Shell></FeatureGate></Protected>} />
            <Route path="/hr/kasbon" element={<Protected module="hr"><FeatureGate feature="hr"><Shell><KasbonKaryawan /></Shell></FeatureGate></Protected>} />
            <Route path="/hr/pph21" element={<Protected module="hr"><FeatureGate feature="hr"><Shell><Pph21 /></Shell></FeatureGate></Protected>} />
            <Route path="/tax" element={<Protected module="tax"><FeatureGate feature="tax"><Shell><TaxModule /></Shell></FeatureGate></Protected>} />
            <Route path="/assets" element={<Protected module="asset"><FeatureGate feature="asset"><Shell><AssetModule /></Shell></FeatureGate></Protected>} />
            <Route path="/bank-recon" element={<Protected module="bank_recon"><FeatureGate feature="bank_recon"><Shell><BankReconciliation /></Shell></FeatureGate></Protected>} />

            <Route path="/import" element={<Protected roles={["administrator"]}><Shell><ImportCenter /></Shell></Protected>} />
            <Route path="/admin/import-center" element={<Protected roles={["administrator"]}><Shell><ImportCenter /></Shell></Protected>} />
            <Route path="/admin/koreksi-tarif" element={<Protected roles={["administrator"]}><Shell><TariffCorrection /></Shell></Protected>} />
            <Route path="/admin/import-massal" element={<Protected roles={["administrator"]}><Shell><ImportCenter /></Shell></Protected>} />
            <Route path="/admin/gabung-customer" element={<Protected roles={["administrator"]}><Shell><CustomerMerge /></Shell></Protected>} />
            <Route path="/analytics" element={<Protected module="pnl"><Shell><AnalyticsDashboard /></Shell></Protected>} />
            <Route path="/panjar" element={<Protected module="fixed_costs"><Shell><PanjarKerja /></Shell></Protected>} />
            <Route path="/purchase-orders" element={<Protected module="purchase_orders"><Shell><PurchaseOrders /></Shell></Protected>} />
            <Route path="/approvals" element={<Protected><Shell><Approvals /></Shell></Protected>} />
            <Route path="/approvals/config" element={<Protected roles={["administrator"]}><Shell><ApprovalConfig /></Shell></Protected>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
