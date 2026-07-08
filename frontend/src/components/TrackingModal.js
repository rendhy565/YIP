import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, Button, Input, Label } from "./ui";
import { errMsg, fmtDateTime } from "../lib/utils";
import { toast } from "sonner";
import { X, MapPin, Plus, Lock } from "lucide-react";

/**
 * TrackingModal — popup untuk update posisi barang berjalan.
 * - History entry ditampilkan dari yang terbaru
 * - Setiap simpan = row baru (append-only, tidak overwrite)
 * - Tanggal & jam auto (server-side)
 * - Locked jika AWB sudah "received" (barang diterima)
 */
export default function TrackingModal({ awb, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState("");
  const [saving, setSaving] = useState(false);

  const locked = !!awb?.received_at;

  const load = () => {
    if (!awb?.id) return;
    setLoading(true);
    api.get(`/orders/${awb.id}/tracking`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [awb?.id]);

  const submit = async (e) => {
    e.preventDefault();
    const val = position.trim();
    if (!val) { toast.error("Posisi tidak boleh kosong"); return; }
    if (locked) return;
    setSaving(true);
    try {
      await api.post(`/orders/${awb.id}/tracking`, { position: val });
      setPosition("");
      toast.success("Posisi tercatat");
      load();
      if (onSaved) onSaved();
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" data-testid="tracking-modal">
      <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200">
          <div>
            <h3 className="font-heading font-bold text-lg text-slate-900 inline-flex items-center gap-2">
              <MapPin size={16} className="text-blue-700"/>
              Tracking Posisi Barang
              {locked && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                  <Lock size={10}/> Dikunci
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              AWB <span className="font-mono font-semibold text-slate-700">{awb?.awb_number}</span>
              {" · "}<span>{awb?.customer_name || "-"}</span>
            </p>
          </div>
          <button type="button" data-testid="tracking-modal-close" onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18}/></button>
        </div>

        {/* Input baru (disembunyikan kalau locked) */}
        {!locked && (
          <form onSubmit={submit} className="p-5 border-b border-slate-200 bg-blue-50/40">
            <Label>Posisi terkini *</Label>
            <div className="flex gap-2">
              <Input
                data-testid="tracking-position-input"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Mis. Sudah loading di Cikarang, ETA Semarang 14:00"
                autoFocus
              />
              <Button data-testid="tracking-save-btn" type="submit" disabled={saving || !position.trim()}>
                <Plus size={14}/> Simpan
              </Button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">Tanggal &amp; jam akan tercatat otomatis. Simpan berkali-kali; setiap entri jadi row baru.</p>
          </form>
        )}
        {locked && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <Lock size={14} className="mt-0.5 flex-shrink-0"/>
            <span>Barang sudah diterima ({fmtDateTime(awb.received_at)}) — histori tracking tidak dapat ditambah lagi.</span>
          </div>
        )}

        {/* History list */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-2">Riwayat ({rows.length})</p>
          {loading && <div className="text-sm text-slate-400 italic">Memuat…</div>}
          {!loading && rows.length === 0 && (
            <div className="text-sm text-slate-400 italic text-center py-6">Belum ada catatan posisi.</div>
          )}
          {!loading && rows.length > 0 && (
            <ol className="relative border-l-2 border-slate-200 ml-2" data-testid="tracking-history-list">
              {rows.map((r, i) => (
                <li key={r.id} className={`ml-4 pb-4 ${i === 0 ? "" : ""}`} data-testid={`tracking-row-${r.id}`}>
                  <span className={`absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full ${i === 0 ? "bg-blue-600 ring-4 ring-blue-100" : "bg-slate-300"}`}></span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{fmtDateTime(r.created_at)}</span>
                    {i === 0 && <span className="text-[9px] uppercase font-bold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">Terakhir</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-900">{r.position}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">oleh {r.created_by_name || "-"}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}
