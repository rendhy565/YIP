import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { fmtIDR } from "../lib/utils";
import { AlertCircle, Calendar, PlayCircle, CheckCircle2 } from "lucide-react";

/**
 * RecurringNotifications — Dashboard widget yg tampilkan recurring expense.
 * - H-1 (besok)                  → card PINK, tanpa tombol
 * - H (hari ini) / overdue       → card MERAH, tombol "Laksanakan Pembayaran"
 * - Hari ini + sudah auto-exec   → card HIJAU, tombol disabled "Sudah Dieksekusi"
 * - Klik tombol laksanakan → /fixed-costs?recurring={id} (halaman Expense).
 */
export default function RecurringNotifications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get("/recurring-expenses/upcoming")
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return null;
  if (!rows || rows.length === 0) return null;

  const formatExecTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div className="mb-6" data-testid="dashboard-recurring-notifications">
      <h3 className="text-[11px] uppercase tracking-[0.14em] font-bold text-slate-500 mb-2 inline-flex items-center gap-1.5">
        <Calendar size={12} /> Recurring Expense — Jadwal Pembayaran
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => {
          const executed = !!r.already_executed;
          const isDue = !executed && (r.is_today || r.is_overdue);
          const isTomorrow = !executed && r.is_tomorrow;

          const cardCls = executed
            ? "bg-emerald-50 border-emerald-300"
            : isDue
              ? "bg-red-50 border-red-400"
              : "bg-pink-50 border-pink-300";
          const accentText = executed
            ? "text-emerald-700"
            : isDue
              ? "text-red-700"
              : "text-pink-700";
          const label = executed
            ? "Sudah Dieksekusi Hari Ini"
            : r.is_overdue
              ? "Terlambat"
              : r.is_today
                ? "Jatuh Tempo Hari Ini"
                : "Besok Jatuh Tempo";
          const Icon = executed ? CheckCircle2 : AlertCircle;

          return (
            <div
              key={r.id}
              data-testid={`recurring-notif-${r.id}`}
              className={`rounded-lg border-2 p-3 ${cardCls}`}
            >
              <div className="flex-1 min-w-0">
                <div className={`text-[10px] uppercase font-bold tracking-wider ${accentText}`}>
                  <Icon size={10} className="inline mr-0.5" />
                  {label}
                </div>
                <div className="font-bold text-slate-900 truncate mt-1" title={r.name}>{r.name}</div>
                <div className="text-xs text-slate-600 mt-0.5">{r.category}</div>
                <div className={`text-lg font-bold mt-1 ${accentText}`}>
                  {fmtIDR(r.amount)}
                </div>
                {executed && r.last_executed_at && (
                  <div className="text-[11px] text-emerald-700 mt-1">
                    {r.auto_execute ? "Auto-eksekusi" : "Dieksekusi manual"} pukul {formatExecTime(r.last_executed_at)}
                  </div>
                )}
              </div>

              {executed && (
                <button
                  data-testid={`exec-recurring-${r.id}-done`}
                  disabled
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600/70 text-white text-xs font-bold py-2 rounded uppercase tracking-wide cursor-not-allowed opacity-90"
                >
                  <CheckCircle2 size={14} /> Sudah Dieksekusi
                </button>
              )}
              {isDue && (
                <button
                  data-testid={`exec-recurring-${r.id}`}
                  onClick={() => navigate(`/fixed-costs?recurring=${r.id}`)}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 rounded uppercase tracking-wide"
                >
                  <PlayCircle size={14} /> Laksanakan Pembayaran
                </button>
              )}
              {isTomorrow && (
                <div className="mt-2 text-[11px] text-pink-700 italic">
                  Persiapkan dana — jatuh tempo besok
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
