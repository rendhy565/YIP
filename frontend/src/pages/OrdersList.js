import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Select, Input, Table, Th, Td, StatusBadge, Label, Button } from "../components/ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { Trash2, MinusCircle, PackageCheck, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WORK_TYPES = ["Kirim Barang", "Dismantle Barang", "Relokasi Barang"];
const MODES = ["Air", "Trucking", "Konsul"];

export default function OrdersList() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";

  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");

  // Receive modal
  const [recvFor, setRecvFor] = useState(null);
  const [recvForm, setRecvForm] = useState({
    received_date: todayStr(),
    received_by_name: "",
    polis_enabled: false,
    polis_amount: "",
    asuransi_enabled: false,
    asuransi_amount: "",
    spsi_enabled: false,
    spsi_amount: "",
    sewa_forklift_enabled: false,
    sewa_forklift_amount: "",
    work_type: "Kirim Barang",
    mode: "Trucking",
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    const params = {};
    if (status) params.status_v = status;
    if (customerId) params.customer_id = customerId;
    api.get("/orders", { params }).then((r) => setRows(r.data));
  };

  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, customerId]);

  const dropOrder = async (r) => {
    if (!window.confirm(`Tandai AWB ${r.awb_number} sebagai DROP?`)) return;
    try { await api.patch(`/orders/${r.id}/status`, { status: "Drop" }); toast.success(`AWB ${r.awb_number} di-drop`); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const deleteOrder = async (r) => {
    if (!window.confirm(`HAPUS PERMANEN AWB ${r.awb_number}? Tindakan TIDAK BISA di-undo.`)) return;
    try {
      const res = await api.delete(`/orders/${r.id}`);
      const d = res.data.deleted;
      toast.success(`AWB ${d.awb} dihapus (${d.costs} biaya, ${d.invoices} invoice, ${d.journals} jurnal)`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openReceive = (r) => {
    setRecvFor(r);
    const hasPolis = !!(r.polis_amount && r.polis_amount > 0);
    const hasAsuransi = !!(r.insurance_amount && r.insurance_amount > 0);
    setRecvForm({
      received_date: todayStr(),
      received_by_name: r.consignee || "",
      polis_enabled: hasPolis,
      polis_amount: hasPolis ? String(r.polis_amount) : "",
      asuransi_enabled: hasAsuransi,
      asuransi_amount: hasAsuransi ? String(r.insurance_amount) : "",
      spsi_enabled: false,
      spsi_amount: "",
      sewa_forklift_enabled: false,
      sewa_forklift_amount: "",
      work_type: "Kirim Barang",
      mode: r.service === "AIR" ? "Air" : "Trucking",
    });
  };

  const submitReceive = async () => {
    if (!recvFor) return;
    setSaving(true);
    try {
      const payload = {
        ...recvForm,
        polis_amount: recvForm.polis_enabled && recvForm.polis_amount !== "" ? parseFloat(recvForm.polis_amount) : null,
        asuransi_amount: recvForm.asuransi_enabled && recvForm.asuransi_amount !== "" ? parseFloat(recvForm.asuransi_amount) : null,
        spsi_amount: recvForm.spsi_enabled && recvForm.spsi_amount !== "" ? parseFloat(recvForm.spsi_amount) : null,
        sewa_forklift_amount: recvForm.sewa_forklift_enabled && recvForm.sewa_forklift_amount !== "" ? parseFloat(recvForm.sewa_forklift_amount) : null,
      };
      await api.post(`/orders/${recvFor.id}/receive`, payload);
      toast.success(`Barang AWB ${recvFor.awb_number} ditandai DITERIMA`);
      setRecvFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };

  return (
    <div data-testid="orders-list-page">
      <PageHeader title="Daftar AWB" subtitle="Semua order. Tombol 'Terima Barang' untuk catat tanggal terima + biaya tambahan." />

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
            <Th>AWB</Th><Th>Tgl Pickup</Th><Th>Tgl Terima</Th><Th>Customer</Th><Th>Rute</Th>
            <Th className="text-right">Qty (Kg)</Th><Th className="text-right">Grand Total</Th>
            <Th>Status</Th><Th className="text-right">Aksi</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`order-row-${r.id}`}>
                <Td><span className="font-mono font-semibold">{r.awb_number}</span></Td>
                <Td className="text-slate-600 text-xs">{fmtDate(r.created_at)}</Td>
                <Td className="text-slate-600 text-xs">
                  {r.received_at ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <PackageCheck size={11}/> {fmtDate(r.received_at)}
                    </span>
                  ) : <span className="text-slate-400">—</span>}
                </Td>
                <Td>{r.customer_name || "-"}</Td>
                <Td className="font-mono text-xs">{r.origin} → {r.destination}</Td>
                <Td className="text-right">{r.qty_kg}</Td>
                <Td className="text-right font-semibold">{fmtIDR(r.grand_total)}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="text-right">
                  <div className="flex gap-1 justify-end whitespace-nowrap">
                    {!r.received_at && r.status !== "Drop" && (
                      <button
                        data-testid={`receive-btn-${r.awb_number}`}
                        onClick={() => openReceive(r)}
                        title="Tanda barang sudah diterima"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 inline-flex items-center gap-1"
                      ><PackageCheck size={11}/> Terima</button>
                    )}
                    {r.status !== "Drop" && (
                      <button data-testid={`drop-order-btn-${r.awb_number}`} onClick={() => dropOrder(r)} title="Drop AWB"
                        className="px-2 py-1 text-[10px] uppercase font-bold rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1"
                      ><MinusCircle size={11}/> Drop</button>
                    )}
                    {isAdmin && (
                      <button data-testid={`delete-order-btn-${r.awb_number}`} onClick={() => deleteOrder(r)} title="Hapus permanen"
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

      {/* ========== RECEIVE (Tanggal Terima) MODAL ========== */}
      {recvFor && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="receive-modal">
          <Card className="w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading font-bold text-xl text-slate-900">Barang Diterima</h3>
                <p className="text-xs text-slate-500 mt-1">AWB <span className="font-mono font-bold">{recvFor.awb_number}</span> · {recvFor.customer_name}</p>
              </div>
              <button type="button" onClick={() => setRecvFor(null)} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Tanggal Terima *</Label>
                <Input data-testid="receive-date" type="date" value={recvForm.received_date} onChange={(e) => setRecvForm({ ...recvForm, received_date: e.target.value })} required/>
              </div>
              <div>
                <Label>Nama Penerima *</Label>
                <Input data-testid="receive-name" value={recvForm.received_by_name} onChange={(e) => setRecvForm({ ...recvForm, received_by_name: e.target.value })} required placeholder="Nama orang yang menerima"/>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200">
              <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Penambah Nilai Invoice</h4>
              <p className="text-[11px] text-slate-500 mb-3">Checkbox default OFF. Aktif otomatis jika nilai sudah diisi di Input Order. Saat aktif, nilainya jadi penambah Grand Total invoice (realtime kalkulasi).</p>
              <div className="space-y-2">
                {/* Polis */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-polis-check" type="checkbox" checked={recvForm.polis_enabled} onChange={(e) => setRecvForm({ ...recvForm, polis_enabled: e.target.checked })}/>
                    <span className="font-semibold">Polis</span>
                  </label>
                  {recvForm.polis_enabled && (
                    <Input data-testid="receive-polis-amount" type="number" step="0.01" placeholder="Nilai Polis (IDR)" value={recvForm.polis_amount} onChange={(e) => setRecvForm({ ...recvForm, polis_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* Asuransi */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-asuransi-check" type="checkbox" checked={recvForm.asuransi_enabled} onChange={(e) => setRecvForm({ ...recvForm, asuransi_enabled: e.target.checked })}/>
                    <span className="font-semibold">Asuransi</span>
                  </label>
                  {recvForm.asuransi_enabled && (
                    <Input data-testid="receive-asuransi" type="number" step="0.01" placeholder="Nilai Asuransi (IDR)" value={recvForm.asuransi_amount} onChange={(e) => setRecvForm({ ...recvForm, asuransi_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* SPSI */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-spsi-check" type="checkbox" checked={recvForm.spsi_enabled} onChange={(e) => setRecvForm({ ...recvForm, spsi_enabled: e.target.checked })}/>
                    <span className="font-semibold">SPSI</span>
                  </label>
                  {recvForm.spsi_enabled && (
                    <Input data-testid="receive-spsi-amount" type="number" step="0.01" placeholder="Nilai SPSI (IDR)" value={recvForm.spsi_amount} onChange={(e) => setRecvForm({ ...recvForm, spsi_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
                {/* Sewa Forklift */}
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-w-[140px]">
                    <input data-testid="receive-forklift-check" type="checkbox" checked={recvForm.sewa_forklift_enabled} onChange={(e) => setRecvForm({ ...recvForm, sewa_forklift_enabled: e.target.checked })}/>
                    <span className="font-semibold">Sewa Forklift</span>
                  </label>
                  {recvForm.sewa_forklift_enabled && (
                    <Input data-testid="receive-forklift-amount" type="number" step="0.01" placeholder="Nilai Sewa Forklift (IDR)" value={recvForm.sewa_forklift_amount} onChange={(e) => setRecvForm({ ...recvForm, sewa_forklift_amount: e.target.value })} className="flex-1"/>
                  )}
                </div>
              </div>

              {/* Realtime calc summary */}
              {(() => {
                const polis = recvForm.polis_enabled ? (parseFloat(recvForm.polis_amount) || 0) : 0;
                const asuransi = recvForm.asuransi_enabled ? (parseFloat(recvForm.asuransi_amount) || 0) : 0;
                const spsi = recvForm.spsi_enabled ? (parseFloat(recvForm.spsi_amount) || 0) : 0;
                const forklift = recvForm.sewa_forklift_enabled ? (parseFloat(recvForm.sewa_forklift_amount) || 0) : 0;
                const penambah = polis + asuransi + spsi + forklift;
                const gt = (recvFor.grand_total || 0) + penambah;
                return (
                  <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs">
                    <div className="flex items-center justify-between"><span>Nilai AWB:</span><span className="font-mono">{fmtIDR(recvFor.grand_total)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Polis:</span><span className="font-mono">{fmtIDR(polis)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Asuransi:</span><span className="font-mono">{fmtIDR(asuransi)}</span></div>
                    <div className="flex items-center justify-between"><span>+ SPSI:</span><span className="font-mono">{fmtIDR(spsi)}</span></div>
                    <div className="flex items-center justify-between"><span>+ Sewa Forklift:</span><span className="font-mono">{fmtIDR(forklift)}</span></div>
                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-blue-300 font-bold text-blue-900" data-testid="receive-total-preview">
                      <span>Total Invoice (preview):</span><span className="font-heading">{fmtIDR(gt)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200">
              <h4 className="text-[11px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">Klasifikasi (untuk Report AR)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Jenis Pekerjaan *</Label>
                  <Select data-testid="receive-work-type" value={recvForm.work_type} onChange={(e) => setRecvForm({ ...recvForm, work_type: e.target.value })} required>
                    {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Moda *</Label>
                  <Select data-testid="receive-mode" value={recvForm.mode} onChange={(e) => setRecvForm({ ...recvForm, mode: e.target.value })} required>
                    {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </Select>
                </div>
              </div>
              <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-sm">
                <span className="text-slate-500">Nilai AWB (Grand Total) →</span>
                <span className="font-heading font-bold text-blue-700">{fmtIDR(recvFor.grand_total)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Nilai AWB akan masuk ke kolom <strong>{recvForm.work_type} → {recvForm.mode}</strong> di Report AR Excel.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
              <Button variant="secondary" type="button" onClick={() => setRecvFor(null)}>Batal</Button>
              <Button data-testid="confirm-receive-btn" variant="success" onClick={submitReceive} disabled={saving || !recvForm.received_by_name}>
                <PackageCheck size={14}/> {saving ? "Memproses..." : "Tandai Diterima"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
