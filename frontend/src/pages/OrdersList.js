import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Select, Table, Th, Td, StatusBadge, Label } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { Trash2, MinusCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";

export default function OrdersList() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";

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

  const dropOrder = async (r) => {
    if (!window.confirm(`Tandai AWB ${r.awb_number} sebagai DROP? AWB akan tetap tercatat tapi tidak ditagih.`)) return;
    try {
      await api.patch(`/orders/${r.id}/status`, { status: "Drop" });
      toast.success(`AWB ${r.awb_number} di-drop`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const deleteOrder = async (r) => {
    if (!window.confirm(`HAPUS PERMANEN AWB ${r.awb_number}? Semua biaya, invoice, dan jurnal terkait akan ikut terhapus. Tindakan ini TIDAK BISA di-undo.`)) return;
    try {
      const res = await api.delete(`/orders/${r.id}`);
      const d = res.data.deleted;
      toast.success(`AWB ${d.awb} dihapus (${d.costs} biaya, ${d.invoices} invoice, ${d.journals} jurnal terhapus)`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

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
              <option value="Drop">Drop</option>
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
            <Th className="text-right">Aksi</Th>
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
                <Td className="text-right">
                  <div className="flex gap-1 justify-end whitespace-nowrap">
                    {r.status !== "Drop" && (
                      <button
                        data-testid={`drop-order-btn-${r.awb_number}`}
                        onClick={() => dropOrder(r)}
                        title="Drop AWB"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1"
                      ><MinusCircle size={11}/> Drop</button>
                    )}
                    {isAdmin && (
                      <button
                        data-testid={`delete-order-btn-${r.awb_number}`}
                        onClick={() => deleteOrder(r)}
                        title="Hapus permanen (admin only)"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 inline-flex items-center gap-1"
                      ><Trash2 size={11}/> Hapus</button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={9} className="text-center text-slate-500 py-10">Tidak ada order untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
