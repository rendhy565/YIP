import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, Button } from "./ui";
import { fmtIDR, errMsg } from "../lib/utils";
import { toast } from "sonner";
import { X, Trash2, Coins } from "lucide-react";

/**
 * Reusable popup yang menampilkan rincian COST per AWB + tombol hapus per item.
 *
 * Props:
 *   awb: { id, awb_number, customer_name?, ... }  — wajib (object AWB; minimal punya id + awb_number)
 *   onClose: () => void
 *   onChanged?: () => void  — dipanggil setelah cost ditambah/dihapus (untuk refresh parent)
 *   allowDelete?: boolean  (default true)
 */
export default function CostListModal({ awb, onClose, onChanged, allowDelete = true }) {
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!awb?.id) return;
    setLoading(true);
    try {
      const r = await api.get("/costs", { params: { awb_id: awb.id } });
      setCosts(r.data);
    } catch (e) {
      toast.error(errMsg(e));
      setCosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [awb?.id]);

  const deleteCost = async (c, confirmFlag = false) => {
    if (!confirmFlag && !window.confirm(`Hapus cost "${c.description || c.sub_label || c.vendor_name || c.cost_category}" sebesar ${fmtIDR(c.amount)}?`)) return;
    try {
      const res = await api.delete(`/costs/${c.id}`, { params: confirmFlag ? { confirm: true } : {} });
      if (res.data && res.data.needs_confirmation) {
        if (window.confirm(`⚠ ${res.data.warning}\n\nLanjutkan hapus dengan reversal pengakuan pendapatan?`)) {
          return deleteCost(c, true);
        }
        return;
      }
      toast.success("Cost dihapus" + (res.data?.reversal_info?.message ? ` — ${res.data.reversal_info.message}` : ""));
      load();
      onChanged?.();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const total = costs.reduce((s, c) => s + (c.amount || 0), 0);
  if (!awb) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="cost-list-modal">
      <Card className="w-full max-w-2xl p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-heading font-bold text-xl flex items-center gap-2">
              <Coins size={18} className="text-amber-600"/>
              Rincian Cost — AWB {awb.awb_number}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              History semua cost yang sudah ditambahkan ke AWB ini.
              {allowDelete && " Klik ikon hapus pada baris untuk delete."}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" data-testid="cost-modal-close"><X size={18}/></button>
        </div>
        {loading ? (
          <p className="text-center text-slate-500 py-6">Memuat...</p>
        ) : (
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-2 py-1.5 text-left">Kategori</th>
                  <th className="px-2 py-1.5 text-left">Deskripsi</th>
                  <th className="px-2 py-1.5 text-left">Vendor</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-right">Nominal</th>
                  {allowDelete && <th className="px-2 py-1.5 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100" data-testid={`cost-row-${c.id}`}>
                    <td className="px-2 py-1.5">
                      <span className="text-[10px] uppercase font-bold bg-slate-100 text-slate-700 rounded px-1.5 py-0.5">
                        {c.cost_category}{c.sub_label ? ` · ${c.sub_label}` : ""}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{c.description || "-"}</td>
                    <td className="px-2 py-1.5 text-xs">{c.vendor_name || "-"}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] uppercase font-bold rounded px-1.5 py-0.5 ${c.is_settled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {c.is_settled ? (c.payment_type || "Cash") : "Accrue"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmtIDR(c.amount)}</td>
                    {allowDelete && (
                      <td className="px-2 py-1.5 text-right">
                        <button data-testid={`delete-cost-${c.id}`} onClick={() => deleteCost(c)} className="p-1.5 rounded hover:bg-red-50 text-red-600">
                          <Trash2 size={12}/>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {costs.length === 0 && (
                  <tr><td colSpan={allowDelete ? 6 : 5} className="px-2 py-4 text-center text-slate-400 text-xs">Tidak ada cost.</td></tr>
                )}
              </tbody>
              {costs.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtIDR(total)}</td>
                    {allowDelete && <td/>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
          <Button variant="secondary" type="button" onClick={onClose}>Tutup</Button>
        </div>
      </Card>
    </div>
  );
}
