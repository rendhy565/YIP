import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, PageHeader, Input, Label, Table, Th, Td } from "../components/ui";
import { fmtDate, parseServerDate } from "../lib/utils";
import { Activity, ChevronRight, X, Navigation } from "lucide-react";

const ACTION_COLORS = {
  create: "bg-emerald-50 text-emerald-800 border-emerald-200",
  update: "bg-blue-50 text-blue-800 border-blue-200",
  delete: "bg-red-50 text-red-800 border-red-200",
  import: "bg-amber-50 text-amber-800 border-amber-200",
  export: "bg-purple-50 text-purple-800 border-purple-200",
  auto_create: "bg-cyan-50 text-cyan-800 border-cyan-200",
};

export default function ActivityLog() {
  const [tab, setTab] = useState("actions");
  const [rows, setRows] = useState([]);
  const [navRows, setNavRows] = useState([]);
  const [navUser, setNavUser] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [filters, setFilters] = useState({
    start_date: new Date(Date.now() + 7*3600000 - 7*86400000).toISOString().slice(0,10),
    end_date: new Date(Date.now() + 7*3600000).toISOString().slice(0,10),
    target_type: "", action: "",
  });

  const load = () => {
    const params = {};
    Object.keys(filters).forEach((k) => { if (filters[k]) params[k] = filters[k]; });
    api.get("/activity-logs", { params }).then((r) => setRows(r.data));
  };
  const loadNav = () => {
    const params = { start_date: filters.start_date, end_date: filters.end_date };
    if (navUser) params.user_id = navUser;
    api.get("/navigation-logs", { params }).then((r) => setNavRows(r.data)).catch(() => setNavRows([]));
  };
  useEffect(() => { load(); }, [filters.start_date, filters.end_date, filters.target_type, filters.action]);
  useEffect(() => { if (tab === "navigation") loadNav(); }, [tab, filters.start_date, filters.end_date, navUser]);

  const navUserOpts = [...new Map(navRows.filter((r) => r.user_id).map((r) => [r.user_id, r.user_name || r.user_id])).entries()];

  // module dropdown: value = raw target_type, label = friendly module_label
  const moduleOpts = [...new Map(rows.filter((r) => r.target_type).map((r) => [r.target_type, r.module_label || r.target_type])).entries()];

  return (
    <div data-testid="activity-log-page">
      <PageHeader title="Activity Log" subtitle="Audit trail semua aksi CRUD yang dilakukan user di sistem — klik baris untuk lihat detail."/>

      {/* Tabs */}
      <div className="flex gap-2 mb-4" data-testid="activity-tabs">
        <button data-testid="tab-actions" onClick={() => setTab("actions")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${tab === "actions" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
          <Activity size={15}/> Aksi (CRUD)
        </button>
        <button data-testid="tab-navigation" onClick={() => setTab("navigation")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${tab === "navigation" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
          <Navigation size={15}/> Navigasi
        </button>
      </div>

      {tab === "actions" && (<>
        <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]"><Label>Dari</Label><Input type="date" value={filters.start_date} onChange={(e) => setFilters({...filters, start_date: e.target.value})}/></div>
          <div className="min-w-[140px]"><Label>Sampai</Label><Input type="date" value={filters.end_date} onChange={(e) => setFilters({...filters, end_date: e.target.value})}/></div>
          <div className="min-w-[170px]"><Label>Modul</Label>
            <select data-testid="activity-module-filter" value={filters.target_type} onChange={(e) => setFilters({...filters, target_type: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
              <option value="">Semua</option>
              {moduleOpts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
            </select>
          </div>
          <div className="min-w-[120px]"><Label>Aksi</Label>
            <select value={filters.action} onChange={(e) => setFilters({...filters, action: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
              <option value="">Semua</option>
              <option value="create">Create</option><option value="update">Update</option>
              <option value="delete">Delete</option><option value="import">Import</option>
              <option value="export">Export</option>
            </select>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total Log</div>
            <div className="font-heading font-black text-2xl text-slate-800">{rows.length}</div>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <thead><tr>
            <Th>Waktu</Th><Th>User</Th><Th>Role</Th><Th>Aksi</Th><Th>Modul</Th><Th>Target</Th><Th>Detail</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const detailEntries = r.details && typeof r.details === "object" ? Object.entries(r.details) : [];
              const hasDetail = detailEntries.length > 0 || r.changes;
              return (
                <tr key={r.id} data-testid={`activity-row-${r.id}`} className={hasDetail ? "cursor-pointer hover:bg-slate-50" : ""} onClick={() => hasDetail && setDetailRow(r)}>
                  <Td className="text-xs font-mono text-slate-700 whitespace-nowrap">{parseServerDate(r.timestamp).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })} <span className="text-slate-400">{parseServerDate(r.timestamp).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB</span></Td>
                  <Td className="font-semibold">{r.user_name || "—"}</Td>
                  <Td><span className="text-[10px] uppercase font-bold text-slate-500">{r.user_role || "—"}</span></Td>
                  <Td>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ACTION_COLORS[r.action] || "bg-slate-50 text-slate-700 border-slate-200"}`}>
                      {r.action_label || r.action}
                    </span>
                  </Td>
                  <Td className="text-xs font-semibold text-slate-700">{r.module_label || r.target_type}</Td>
                  <Td className="text-xs">{r.entity_label ? <span className="font-semibold text-slate-800">{r.entity_label}</span> : (r.target_id ? <span className="text-[10px] text-slate-400">#{(r.target_id||"").slice(-6)}</span> : "—")}</Td>
                  <Td className="text-xs text-slate-600 max-w-md">
                    <div className="flex items-center gap-1">
                      <span className="line-clamp-1">{r.changes || r.summary || `${r.method} ${r.path}`}</span>
                      {hasDetail && <ChevronRight size={13} className="shrink-0 text-slate-400"/>}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500 py-10"><Activity size={28} className="mx-auto opacity-30 mb-2"/>Belum ada aktivitas.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      </>)}

      {tab === "navigation" && (
        <>
          <Card className="p-4 mb-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[140px]"><Label>Dari</Label><Input type="date" value={filters.start_date} onChange={(e) => setFilters({...filters, start_date: e.target.value})}/></div>
              <div className="min-w-[140px]"><Label>Sampai</Label><Input type="date" value={filters.end_date} onChange={(e) => setFilters({...filters, end_date: e.target.value})}/></div>
              <div className="min-w-[170px]"><Label>User</Label>
                <select data-testid="nav-user-filter" value={navUser} onChange={(e) => setNavUser(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                  <option value="">Semua User</option>
                  {navUserOpts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                </select>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500">Total Navigasi</div>
                <div className="font-heading font-black text-2xl text-slate-800">{navRows.length}</div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">Hanya navigasi user non-admin yang direkam. Log navigasi otomatis terhapus setelah 30 hari.</p>
          </Card>
          <Card>
            <Table>
              <thead><tr><Th>Waktu</Th><Th>User</Th><Th>Role</Th><Th>Halaman</Th><Th>Path</Th></tr></thead>
              <tbody>
                {navRows.map((r) => (
                  <tr key={r.id} data-testid={`nav-row-${r.id}`} className="hover:bg-slate-50">
                    <Td className="text-xs font-mono text-slate-700 whitespace-nowrap">{parseServerDate(r.timestamp).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })} <span className="text-slate-400">{parseServerDate(r.timestamp).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" })} WIB</span></Td>
                    <Td className="font-semibold">{r.user_name || "—"}</Td>
                    <Td><span className="text-[10px] uppercase font-bold text-slate-500">{r.user_role || "—"}</span></Td>
                    <Td className="text-sm font-semibold text-slate-800">{r.label || "—"}</Td>
                    <Td className="text-xs font-mono text-slate-500">{r.path}</Td>
                  </tr>
                ))}
                {navRows.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500 py-10"><Navigation size={28} className="mx-auto opacity-30 mb-2"/>Belum ada log navigasi.</Td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* Detail modal */}
      {detailRow && (() => {
        const r = detailRow;
        const detailEntries = r.details && typeof r.details === "object" ? Object.entries(r.details) : [];
        const meta = [
          ["Waktu", `${parseServerDate(r.timestamp).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })} ${parseServerDate(r.timestamp).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`],
          ["User", r.user_name || "—"],
          ["Role", (r.user_role || "—").toUpperCase()],
          ["Aksi", r.action_label || r.action],
          ["Modul", r.module_label || r.target_type || "—"],
          ["Target", r.entity_label || (r.target_id ? `#${r.target_id.slice(-6)}` : "—")],
        ];
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setDetailRow(null)} data-testid="activity-detail-modal">
            <Card className="w-full max-w-4xl my-8 p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
                <div className="font-heading font-black text-lg text-slate-900">Detail Aktivitas</div>
                <button data-testid="activity-detail-close" onClick={() => setDetailRow(null)} className="p-1 hover:bg-slate-200 rounded"><X size={18}/></button>
              </div>
              <div className="p-5 max-h-[75vh] overflow-y-auto">
                {/* Meta */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 mb-5">
                  {meta.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">{k}</div>
                      <div className="text-sm font-semibold text-slate-800 break-words">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] uppercase tracking-wide font-bold text-slate-500 mb-2 pt-3 border-t border-slate-100">Detail Perubahan</div>
                {detailEntries.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                    {detailEntries.map(([k, v]) => {
                      const isObj = v !== null && typeof v === "object";
                      const val = isObj ? JSON.stringify(v, null, 2) : String(v);
                      const isLong = isObj || val.length > 60;
                      return (
                        <div key={k} className={`min-w-0 ${isLong ? "sm:col-span-2 md:col-span-3" : ""}`}>
                          <div title={k} className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 truncate">{k}</div>
                          <pre className={`font-mono text-xs text-slate-800 whitespace-pre-wrap break-words m-0 mt-0.5 ${isObj ? "bg-slate-50 border border-slate-200 rounded p-2 max-h-64 overflow-auto" : ""}`}>{val}</pre>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="text-sm text-slate-500">{r.changes || "Tidak ada detail field."}</div>}
                <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 font-mono">{r.method} {r.path}</div>
              </div>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
