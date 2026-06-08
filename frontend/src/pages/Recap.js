import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Button, Select, Input, Label, Table, Th, Td, StatusBadge } from "../components/ui";
import { fmtIDR, fmtDate, currentMonth, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { Download, Undo2, FileSpreadsheet, CheckSquare, Square } from "lucide-react";
import * as XLSX from "xlsx";

export default function Recap() {
  const [openRows, setOpenRows] = useState([]);
  const [reconciledRows, setReconciledRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [customerId, setCustomerId] = useState("");
  const [selected, setSelected] = useState(new Set());

  const load = async () => {
    const params = { month };
    if (customerId) params.customer_id = customerId;
    const [op, rc] = await Promise.all([
      api.get("/orders", { params: { ...params, status_v: "Open" } }),
      api.get("/orders", { params: { ...params, status_v: "Reconciled" } }),
    ]);
    setOpenRows(op.data); setReconciledRows(rc.data); setSelected(new Set());
  };

  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); }, [month, customerId]);

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === openRows.length) setSelected(new Set());
    else setSelected(new Set(openRows.map((r) => r.id)));
  };

  const selectedRows = useMemo(
    () => openRows.filter((r) => selected.has(r.id)),
    [openRows, selected]
  );

  const generateExcel = async () => {
    const rows = selected.size > 0 ? selectedRows : openRows;
    if (rows.length === 0) { toast.error("Tidak ada data untuk diekspor"); return; }

    const data = rows.map((r) => ({
      "No. AWB": r.awb_number,
      "Tanggal": fmtDate(r.created_at),
      "Customer": r.customer_name,
      "Origin": r.origin,
      "Destination": r.destination,
      "Item": r.item_description,
      "Goods Content": r.goods_content,
      "Qty (Kg)": r.qty_kg,
      "Tarif/Kg (IDR)": r.tariff_per_kg,
      "Total Tarif (IDR)": r.total_tariff,
      "PPN %": r.tax_percentage,
      "PPN (IDR)": r.tax_amount,
      "Grand Total (IDR)": r.grand_total,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 20 }, { wch: 14 }, { wch: 28 }, { wch: 10 }, { wch: 12 },
      { wch: 30 }, { wch: 20 }, { wch: 10 }, { wch: 15 }, { wch: 18 },
      { wch: 8 }, { wch: 15 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Rekap ${month}`);
    XLSX.writeFile(wb, `Rekap_AWB_${month}${customerId ? "_filtered" : ""}.xlsx`);

    // mark as Reconciled
    try {
      const r = await api.post("/orders/reconcile", { awb_ids: rows.map((x) => x.id) });
      toast.success(`Excel dibuat dan ${r.data.updated} AWB ditandai sebagai Reconciled`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const revert = async (id) => {
    if (!window.confirm("Kembalikan AWB ini ke status Open?")) return;
    try { await api.post(`/orders/${id}/revert-to-open`); toast.success("Direvert ke Open"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="recap-page">
      <PageHeader title="Rekap Bulanan & Rekonsiliasi" subtitle="Modul 3 & 4 — Filter AWB Open, ekspor Excel, dan tangani rejection." />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Label>Bulan (YYYY-MM)</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="min-w-[220px]">
            <Label>Customer</Label>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Semua Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="ml-auto">
            <Button data-testid="generate-excel-btn" onClick={generateExcel} disabled={openRows.length === 0}>
              <Download size={16}/> Generate Excel ({selected.size || openRows.length} AWB) → Reconciled
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-blue-700"/>
          <h3 className="font-bold">AWB Status OPEN — Siap Rekap</h3>
          <span className="text-xs text-slate-500 ml-2">{openRows.length} baris</span>
        </div>
        <Table>
          <thead><tr>
            <Th>
              <button onClick={toggleAll} className="inline-flex items-center">
                {selected.size === openRows.length && openRows.length > 0 ? <CheckSquare size={14}/> : <Square size={14}/>}
              </button>
            </Th>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Qty</Th><Th className="text-right">Grand Total</Th>
          </tr></thead>
          <tbody>
            {openRows.map((r) => (
              <tr key={r.id} data-testid={`open-row-${r.id}`}>
                <Td>
                  <button onClick={() => toggle(r.id)}>
                    {selected.has(r.id) ? <CheckSquare size={14} className="text-blue-700"/> : <Square size={14} className="text-slate-400"/>}
                  </button>
                </Td>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right">{r.qty_kg}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
              </tr>
            ))}
            {openRows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Tidak ada AWB Open untuk filter ini.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Undo2 size={16} className="text-amber-600"/>
          <h3 className="font-bold">AWB Sudah Reconciled — Tangani Reject</h3>
          <span className="text-xs text-slate-500 ml-2">{reconciledRows.length} baris</span>
        </div>
        <Table>
          <thead><tr>
            <Th>AWB</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Grand Total</Th><Th>Status</Th><Th></Th>
          </tr></thead>
          <tbody>
            {reconciledRows.map((r) => (
              <tr key={r.id} data-testid={`reconciled-row-${r.id}`}>
                <Td className="font-mono font-semibold">{r.awb_number}</Td>
                <Td className="text-xs text-slate-600">{fmtDate(r.created_at)}</Td>
                <Td>{r.customer_name}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status}/></Td>
                <Td className="text-right">
                  <Button data-testid={`revert-btn-${r.id}`} variant="secondary" onClick={() => revert(r.id)}>
                    <Undo2 size={14}/> Reject → Open
                  </Button>
                </Td>
              </tr>
            ))}
            {reconciledRows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-8">Tidak ada AWB Reconciled.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
