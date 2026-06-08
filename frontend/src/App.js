import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
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
import Payments from "./pages/Payments";
import ProfitLoss from "./pages/ProfitLoss";
import FixedCosts from "./pages/FixedCosts";
import Settings from "./pages/Settings";
import Users from "./pages/Users";

function Protected({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Administrator can access everything
  if (user.role === "administrator") return children;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
          <Route path="/invoices/:id/print" element={<Protected><InvoicePrint /></Protected>} />
          <Route path="/payments" element={<Protected roles={["finance"]}><Shell><Payments /></Shell></Protected>} />
          <Route path="/fixed-costs" element={<Protected roles={["finance"]}><Shell><FixedCosts /></Shell></Protected>} />
          <Route path="/pnl" element={<Protected><Shell><ProfitLoss /></Shell></Protected>} />
          <Route path="/users" element={<Protected roles={["administrator"]}><Shell><Users /></Shell></Protected>} />
          <Route path="/settings" element={<Protected><Shell><Settings /></Shell></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
