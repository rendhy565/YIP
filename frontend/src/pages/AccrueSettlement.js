import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Table, Th, Td } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { CheckCircle2, Wallet } from "lucide-react";

export default function AccrueSettlement() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/costs", { params: { payment_type: "Accrue", is_settled: false } }).then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const settle = async (id) => {
    if (!window.confirm("Tandai hutang vendor ini sebagai sudah dibayar (Cash)?")) return;
    try { await api.post(`/costs/${id}/settle`); toast.success("Hutang ditandai sebagai Cash"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div data-testid="accrue-settlement-page">
      <PageHeader
        title="Settle Hutang Vendor"
        subtitle="Modul 2 (Finance) — Update biaya Accrue → Cash setelah invoice vendor dibayar."
      />

      <Card className="p-5 mb-5 bg-orange-50 border-orange-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-orange-600 text-white flex items-center justify-center"><Wallet size={20}/></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-orange-700">Total Hutang Belum Dibayar</div>
            <div className="font-heading font-black text-3xl text-orange-900">{fmtIDR(total)}</div>
          </div>
          <div className="ml-auto text-sm text-orange-700">{rows.length} item</div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>Tanggal</Th><Th>AWB</Th><Th>Vendor</Th><Th>Deskripsi</Th>
            <Th className="text-right">Jumlah</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`accrue-row-${r.id}`}>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td>{r.vendor_name || "-"}</Td>
                <Td className="text-slate-600 text-sm">{r.description || "-"}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.amount)}</Td>
                <Td className="text-right">
                  <Button data-testid={`settle-btn-${r.id}`} variant="success" onClick={() => settle(r.id)}>
                    <CheckCircle2 size={14}/> Tandai Cash
                  </Button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-500 py-10">Tidak ada hutang vendor yang menunggu pembayaran.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
