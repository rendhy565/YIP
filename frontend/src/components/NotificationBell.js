import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { Bell } from "lucide-react";

export default function NotificationBell() {
  const [data, setData] = useState({ notifications: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => api.get("/notifications").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);  // refresh every minute
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    load();
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    load();
  };

  const count = data.unread_count || 0;
  return (
    <div ref={ref} className="relative">
      <button data-testid="notification-bell" onClick={() => setOpen((o) => !o)} className="relative p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white">
        <Bell size={16}/>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-0.5 flex items-center justify-center">{count > 9 ? "9+" : count}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-80 bg-white text-slate-900 rounded-lg shadow-2xl border border-slate-200 max-h-96 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div className="font-bold text-sm">Notifikasi</div>
            {count > 0 && <button onClick={markAll} className="text-[10px] text-blue-600 font-semibold hover:underline">Tandai semua dibaca</button>}
          </div>
          <div className="overflow-y-auto flex-1">
            {(data.notifications || []).length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-500">Tidak ada notifikasi.</div>
            )}
            {data.notifications.map((n) => (
              <Link key={n.id} to={n.link || "#"} onClick={() => markRead(n.id)} className={`block px-3 py-2 border-b border-slate-50 hover:bg-slate-50 ${n.read ? "opacity-60" : ""}`}>
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1">
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500"/>}
                  {n.title}
                </div>
                <div className="text-xs text-slate-600 mt-0.5">{n.message}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString("id-ID")}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
