import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { BadgeDollarSign, CheckCircle2 } from "lucide-react";

export default function Payments() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/orders", { params: { status_v: "Invoiced" } }).then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const markPaid = async (id) => {
    if (!window.confirm("Tandai AWB ini sebagai LUNAS?")) return;
    try { await api.post(`/orders/${id}/mark-paid`); toast.success("Ditandai LUNAS"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.grand_total || 0), 0);

  return (
    <div data-testid="payments-page">
      <PageHeader title="Pembayaran (Closing)" subtitle="Modul 6 — Tandai invoice yang sudah dibayar customer sebagai LUNAS." />

      <Card className="p-5 mb-5 bg-purple-50 border-purple-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-purple-700 text-white flex items-center justify-center"><BadgeDollarSign size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-purple-700">Outstanding Receivable</div>
            <div className="font-heading font-black text-3xl text-purple-900">{fmtIDR(total)}</div>
          </div>
          <div className="ml-auto text-sm text-purple-700">{rows.length} invoice</div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`payment-row-${r.id}`}>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">
                  <Button data-testid={`mark-paid-${r.id}`} variant="success" onClick={() => markPaid(r.id)}>
                    <CheckCircle2 size={14}/> Mark as Paid
                  </Button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10">Tidak ada invoice yang menunggu pembayaran.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
