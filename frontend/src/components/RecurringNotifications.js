import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { fmtIDR } from "../lib/utils";
import { useCan } from "../lib/useCan";
import { AlertCircle, Calendar, PlayCircle } from "lucide-react";

/**
 * RecurringNotifications — Dashboard widget yg tampilkan recurring expense yg akan
 * jatuh tempo besok (H-1) atau hari ini (H) atau overdue.
 * - H-1 (besok): kartu PINK, tanpa tombol
 * - H (hari ini) / overdue: kartu MERAH, ada tombol "Laksanakan Pembayaran"
 * - Klik tombol → pindah ke /fixed-costs?recurring={id} yg auto-open modal payment
 * Hanya user dgn akses modul expense (fixed_costs) yg melihat komponen ini.
 */
export default function RecurringNotifications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Backend endpoint di-guard oleh require_role → cukup fetch, kalau 403 abaikan.
    api.get("/recurring-expenses/upcoming")
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mb-6" data-testid="dashboard-recurring-notifications">
      <h3 className="text-[11px] uppercase tracking-[0.14em] font-bold text-slate-500 mb-2 inline-flex items-center gap-1.5">
        <Calendar size={12}/> Recurring Expense — Jadwal Pembayaran
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => {
          const isDue = r.is_today || r.is_overdue;
          return (
            <div
              key={r.id}
              data-testid={`recurring-notif-${r.id}`}
              className={`rounded-lg border-2 p-3 ${isDue
                ? "bg-red-50 border-red-400"
                : "bg-pink-50 border-pink-300"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`text-[10px] uppercase font-bold tracking-wider ${isDue ? "text-red-700" : "text-pink-700"}`}>
                    <AlertCircle size={10} className="inline mr-0.5"/>
                    {r.is_overdue ? "Terlambat" : r.is_today ? "Jatuh Tempo Hari Ini" : "Besok Jatuh Tempo"}
                  </div>
                  <div className="font-bold text-slate-900 truncate mt-1" title={r.name}>{r.name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{r.category}</div>
                  <div className={`text-lg font-bold mt-1 ${isDue ? "text-red-700" : "text-pink-700"}`}>
                    {fmtIDR(r.amount)}
                  </div>
                </div>
              </div>
              {isDue && (
                <button
                  data-testid={`exec-recurring-${r.id}`}
                  onClick={() => navigate(`/fixed-costs?recurring=${r.id}`)}
                  className="mt-2 w-full inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 rounded uppercase tracking-wide"
                >
                  <PlayCircle size={14}/> Laksanakan Pembayaran
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
