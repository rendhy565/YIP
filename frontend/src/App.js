import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { FeatureFlagsProvider, useFeatureFlags } from "./lib/featureFlags";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
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
import SaldoAwal from "./pages/SaldoAwal";
// Optional module pages
import HrPayroll from "./pages/HrPayroll";
import TaxModule from "./pages/TaxModule";
import AssetModule from "./pages/AssetModule";
import BankReconciliation from "./pages/BankReconciliation";
import ImportExcel from "./pages/ImportExcel";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import PanjarKerja from "./pages/PanjarKerja";
import InvoicesCreated from "./pages/InvoicesCreated";
import PurchaseOrders from "./pages/PurchaseOrders";

function Protected({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "administrator") return children;
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
        <BrowserRouter basename="/arc">
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Shell><Dashboard /></Shell></Protected>} />
            <Route path="/orders/new" element={<Protected roles={["operation"]}><Shell><OrderInput /></Shell></Protected>} />
            <Route path="/orders" element={<Protected><Shell><OrdersList /></Shell></Protected>} />
            <Route path="/customers" element={<Protected><Shell><Customers /></Shell></Protected>} />
            <Route path="/contracts" element={<Protected><Shell><Contracts /></Shell></Protected>} />
            <Route path="/costs" element={<Protected><Shell><Costs /></Shell></Protected>} />
            <Route path="/accrue" element={<Protected roles={["finance"]}><Shell><AccrueSettlement /></Shell></Protected>} />
            <Route path="/recap" element={<Protected roles={["operation"]}><Shell><Recap /></Shell></Protected>} />
            <Route path="/invoices" element={<Protected><Shell><Invoices /></Shell></Protected>} />
            <Route path="/invoices/created" element={<Protected><Shell><InvoicesCreated /></Shell></Protected>} />
            <Route path="/invoices/:id/print" element={<Protected><InvoicePrint /></Protected>} />
            <Route path="/invoices/print-bulk" element={<Protected><InvoicePrintBulk /></Protected>} />
            <Route path="/payments" element={<Protected roles={["finance"]}><Shell><Payments /></Shell></Protected>} />
            <Route path="/fixed-costs" element={<Protected roles={["finance"]}><Shell><FixedCosts /></Shell></Protected>} />
            <Route path="/expense-categories" element={<Protected roles={["finance","administrator"]}><Shell><ExpenseCategories /></Shell></Protected>} />
            <Route path="/pnl" element={<Protected><Shell><ProfitLoss /></Shell></Protected>} />
            <Route path="/users" element={<Protected roles={["administrator"]}><Shell><Users /></Shell></Protected>} />
            <Route path="/settings" element={<Protected><Shell><Settings /></Shell></Protected>} />

            {/* Accounting (gated by feature flag "accounting") */}
            <Route path="/accounting/coa" element={<Protected><FeatureGate feature="accounting"><Shell><ChartOfAccounts /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/journal" element={<Protected><FeatureGate feature="accounting"><Shell><JournalUmum /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/ledger" element={<Protected><FeatureGate feature="accounting"><Shell><BukuBesar /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/trial-balance" element={<Protected><FeatureGate feature="accounting"><Shell><NeracaSaldo /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/balance-sheet" element={<Protected><FeatureGate feature="accounting"><Shell><Neraca /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/income-statement" element={<Protected><FeatureGate feature="accounting"><Shell><LaporanLabaRugi /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/cash-flow" element={<Protected><FeatureGate feature="accounting"><Shell><LaporanArusKas /></Shell></FeatureGate></Protected>} />
            <Route path="/accounting/opening-closing" element={<Protected><FeatureGate feature="accounting"><Shell><SaldoAwal /></Shell></FeatureGate></Protected>} />

            {/* Optional modules */}
            <Route path="/hr" element={<Protected><FeatureGate feature="hr"><Shell><HrPayroll /></Shell></FeatureGate></Protected>} />
            <Route path="/tax" element={<Protected><FeatureGate feature="tax"><Shell><TaxModule /></Shell></FeatureGate></Protected>} />
            <Route path="/assets" element={<Protected><FeatureGate feature="asset"><Shell><AssetModule /></Shell></FeatureGate></Protected>} />
            <Route path="/bank-recon" element={<Protected roles={["finance"]}><FeatureGate feature="bank_recon"><Shell><BankReconciliation /></Shell></FeatureGate></Protected>} />

            <Route path="/import" element={<Protected roles={["administrator"]}><Shell><ImportExcel /></Shell></Protected>} />
            <Route path="/analytics" element={<Protected><Shell><AnalyticsDashboard /></Shell></Protected>} />
            <Route path="/panjar" element={<Protected><Shell><PanjarKerja /></Shell></Protected>} />
            <Route path="/purchase-orders" element={<Protected><Shell><PurchaseOrders /></Shell></Protected>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
