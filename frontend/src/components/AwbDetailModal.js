import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, Button, StatusBadge } from "./ui";
import { fmtIDR, fmtDate, errMsg } from "../lib/utils";
import { X, Package } from "lucide-react";
import { toast } from "sonner";

const Row = ({ label, value, mono, strong }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-slate-500 text-xs">{label}</span>
    <span className={`text-sm text-right ${mono ? "font-mono" : ""} ${strong ? "font-bold" : ""}`}>{value ?? "—"}</span>
  </div>
);

const Section = ({ title, children }) => (
  <div className="mb-4">
    <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 mb-1">{title}</div>
    <div className="rounded-lg border border-slate-200 px-3 py-1 bg-slate-50/50">{children}</div>
  </div>
);

export default function AwbDetailModal({ awbId, awbNumber, onClose }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get(`/orders/${awbId}`)
      .then((r) => { if (alive) setD(r.data); })
      .catch((e) => { toast.error(errMsg(e)); onClose(); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [awbId]); // eslint-disable-line

  const val = (v) => (v === null || v === undefined || v === "" ? null : v);
  const num = (v) => (v ? Number(v).toLocaleString("id-ID") : null);

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="awb-detail-modal">
      <Card className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-heading font-bold text-xl text-slate-900"><Package className="inline mr-2" size={18}/>Detail AWB</h3>
            <p className="text-xs text-slate-500 mt-1">No. AWB <span className="font-mono font-bold">{awbNumber || d?.awb_number}</span></p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" data-testid="awb-detail-close"><X size={18}/></button>
        </div>

        {loading || !d ? (
          <div className="py-10 text-center text-slate-500 text-sm">Memuat detail...</div>
        ) : (
          <div>
            <Section title="Umum">
              <Row label="No. AWB" value={d.awb_number} mono strong />
              <Row label="Customer" value={val(d.customer_name)} />
              <Row label="Consignee" value={val(d.consignee)} />
              <Row label="No. Referensi" value={val(d.reff_no)} />
              <Row label="Perusahaan Penerbit" value={val(d.company_name)} />
              <Row label="Layanan / Moda" value={val(d.service || d.mode)} />
              <Row label="Jenis Pekerjaan" value={val(d.work_type)} />
              <Row label="Status" value={<StatusBadge status={d.status} />} />
            </Section>

            <Section title="Rute & Barang">
              <Row label="Asal" value={val(d.origin)} />
              <Row label="Tujuan" value={val(d.destination)} />
              <Row label="Isi Barang" value={val(d.goods_content)} />
              <Row label="Koli" value={num(d.koli)} />
              <Row label="Qty (Kg)" value={num(d.qty_kg)} />
              {Number(d.min_kg) > 0 && <Row label="Min Kg" value={num(d.min_kg)} />}
              {Number(d.final_kg) > 0 && <Row label="Final Kg" value={num(d.final_kg)} />}
            </Section>

            <Section title="Nilai">
              <Row label="Tarif / Kg" value={val(d.tariff_per_kg) ? fmtIDR(d.tariff_per_kg) : null} mono />
              <Row label="Total Tarif (DPP)" value={fmtIDR(d.total_tariff)} mono />
              <Row label="PPN" value={`${d.tax_percentage ?? 0}%`} />
              <Row label="Nilai PPN" value={fmtIDR(d.tax_amount)} mono />
              {Number(d.polis_amount) > 0 && <Row label="+ Polis" value={fmtIDR(d.polis_amount)} mono />}
              {Number(d.insurance_amount) > 0 && <Row label="+ Asuransi" value={fmtIDR(d.insurance_amount)} mono />}
              {Number(d.spsi_amount) > 0 && <Row label="+ SPSI" value={fmtIDR(d.spsi_amount)} mono />}
              {Number(d.sewa_forklift_amount) > 0 && <Row label="+ Sewa Forklift" value={fmtIDR(d.sewa_forklift_amount)} mono />}
              <Row label="Grand Total" value={fmtIDR(d.grand_total)} mono strong />
            </Section>

            <Section title="Status & Tanggal">
              <Row label="Tgl Pickup" value={fmtDate(d.created_at)} />
              <Row label="Tgl Terima" value={d.received_at ? fmtDate(d.received_at) : null} />
              <Row label="Penerima" value={val(d.received_by_name)} />
              <Row label="Tgl POD" value={d.pod_received_at ? fmtDate(d.pod_received_at) : null} />
              {val(d.notes) && <Row label="Catatan" value={d.notes} />}
              {val(d.received_notes) && <Row label="Catatan Terima" value={d.received_notes} />}
            </Section>
          </div>
        )}

        <div className="flex justify-end pt-3 border-t">
          <Button variant="secondary" onClick={onClose} data-testid="awb-detail-close-btn">Tutup</Button>
        </div>
      </Card>
    </div>
  );
}
