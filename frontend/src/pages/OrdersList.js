import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Table, Th, Td, StatusBadge, Input, Label } from "../components/ui";
import { fmtIDR, fmtDate } from "../lib/utils";
import { Eye, Filter } from "lucide-react";

export default function OrdersList() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");

  const load = () => {
    const params = {};
    if (status) params.status_v = status;
    if (customerId) params.customer_id = customerId;
    api.get("/orders", { params }).then((r) => setRows(r.data));
  };

  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); }, [status, customerId]);

  return (
    <div data-testid="orders-list-page">
      <PageHeader title="Daftar AWB" subtitle="Semua order dengan filter status & customer." />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label>Status</Label>
            <Select data-testid="filter-status-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Semua Status</option>
              <option value="Open">Open</option>
              <option value="Reconciled">Rekonsiliasi</option>
              <option value="Invoiced">Invoiced</option>
              <option value="Paid">Lunas</option>
            </Select>
          </div>
          <div className="min-w-[220px]">
            <Label>Customer</Label>
            <Select data-testid="filter-customer-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="text-xs text-slate-500 ml-auto">{rows.length} baris</div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Qty (Kg)</Th><Th className="text-right">Total Tarif</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`order-row-${r.id}`}>
                <Td><span className="font-mono font-semibold">{r.awb_number}</span></Td>
                <Td className="text-slate-600 text-xs">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name || "-"}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right">{r.qty_kg}</Td>
                <Td className="text-right">{fmtIDR(r.total_tariff)}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status} /></Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-500 py-10">Tidak ada order untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
